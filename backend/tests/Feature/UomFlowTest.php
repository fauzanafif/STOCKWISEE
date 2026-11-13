<?php

namespace Tests\Feature;

use App\Models\Item;
use App\Models\ItemUnitConversion;
use App\Models\Npbg;
use App\Models\Ppb;
use App\Models\PpbDraft;
use App\Models\PurchaseOrderItem;
use App\Models\Unit;
use App\Models\Warehouse;
use App\Services\Inventory\OnOrder;
use App\Services\Inventory\StockLedgerService;
use App\Services\UomConverter;
use Database\Seeders\RbacSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** A cable kept in meters and moved in rolls (1 ROL = 100 MTR), through the whole flow. */
class UomFlowTest extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected $seeder = RbacSeeder::class;

    private const PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

    private Item $cable;

    private Unit $roll;

    protected function setUp(): void
    {
        parent::setUp();
        config(['stockwise.manual_npbg' => true]); // the closed manual Delivery Order, for documents already pending
        $this->artisan('stockwise:seed-uom')->assertSuccessful();
        $mtr = Unit::where('code', 'MTR')->first();
        $this->roll = Unit::where('code', 'ROL')->first();
        $this->cable = Item::factory()->create(['code' => 'KBL.001', 'description' => 'Kabel NYA 2,5 mm', 'unit_id' => $mtr->id, 'is_active' => true]);
        ItemUnitConversion::create(['item_id' => $this->cable->id, 'unit_id' => $this->roll->id, 'ratio' => 100]);
        app(StockLedgerService::class)->openingBalance($this->cable->id, Warehouse::factory()->create()->id, 150);
    }

    private function stock(): float
    {
        return (float) DB::table('inventory')->where('item_id', $this->cable->id)->sum('actual_qty');
    }

    /** Verified, then approved by the Director. */
    private function requestRolls(float $qty, string $unit = 'ROL'): array
    {
        $this->actingAsRole('karyawan');
        $req = $this->postJson('/api/item-requests', ['lines' => [['deskripsi_barang' => 'kabel', 'qty' => $qty, 'satuan' => $unit]]])->assertCreated()->json('data');
        $this->actingAsRole('admin_gudang');
        $done = $this->postJson("/api/item-requests/{$req['id']}/process", ['lines' => [$req['lines'][0]['id'] => ['item_id' => $this->cable->id]]])->assertOk()->json('data');

        return [$req['id'], $done['lines'][0]];
    }

    public function test_2_rolls_with_150_meters_in_stock_give_150_meters_and_buy_50_then_a_roll_adds_100(): void
    {
        [$id, $line] = $this->requestRolls(2);
        // the original is kept beside what it makes
        $this->assertEquals([2, 'ROL', 100, 200, 'MTR', 200], [$line['requested_qty'], $line['requested_unit'], $line['unit_ratio'], $line['qty'], $line['satuan'], $line['approved_qty']]);

        // approved: the flow runs in meters; stock is short, the rest goes to Draft Purchase Request
        $this->actingAsRole('direktur');
        $this->postJson("/api/item-requests/{$id}/approval", ['action' => 'APPROVE'])->assertOk();
        $this->actingAsRole('admin_gudang');
        $issued = Npbg::where('kode_barang', 'KBL.001')->sole();
        $this->assertSame([150.0, 'MTR'], [(float) $issued->kuantitas, $issued->satuan]);
        $draftLine = PpbDraft::where('item_request_id', $id)->sole()->lines()->sole();
        $this->assertSame([50.0, 'MTR'], [(float) $draftLine->qty, $draftLine->satuan]);

        // Purchase Request in meters; ordered as one roll; the master changes before the goods arrive
        $draft = PpbDraft::where('item_request_id', $id)->sole();
        $this->postJson("/api/ppb-drafts/{$draft->id}/submit", ['no_ppb' => 'PPB/UOM/001', 'tgl_ppb' => now()->toDateString()])->assertOk();
        $ppb = Ppb::where('no_ppb', 'PPB/UOM/001')->sole();
        $this->assertEquals(1, $ppb->unit_ratio);
        $this->actingAsRole('manager');
        $this->postJson("/api/ppb/{$ppb->id}/approval", ['action' => 'APPROVE'])->assertOk();
        $this->actingAsRole('direktur');
        $this->postJson("/api/ppb/{$ppb->id}/approval", ['action' => 'APPROVE'])->assertOk();
        $poLine = PurchaseOrderItem::where('approved_ppb_id', $ppb->id)->sole();
        $vendor = \App\Models\Vendor::factory()->create();
        $this->actingAsRole('purchasing');
        $this->postJson('/api/po-draft-lines/to-quotation', ['line_ids' => [$poLine->id]])->assertOk();
        $quote = $this->putJson("/api/po-draft-lines/{$poLine->id}/quotes", ['vendor_id' => $vendor->id, 'unit_price' => 1000])->assertOk()->json('data.quotes.0.id');
        $this->postJson('/api/po-draft-lines/submit-quotation', ['line_ids' => [$poLine->id]])->assertOk();
        $this->actingAsRole('direktur');
        $this->postJson("/api/po-draft-lines/{$poLine->id}/choose", ['quote_id' => $quote])->assertOk();
        $this->actingAsRole('purchasing');
        $po = $this->postJson('/api/po-draft-lines/submit', ['line_ids' => [$poLine->id], 'vendor_id' => $vendor->id, 'lines' => [['id' => $poLine->id, 'qty' => 1, 'unit_id' => $this->roll->id, 'unit_price' => 100000]]])->assertCreated()->json('data');
        $poLine->refresh();
        $this->assertEquals([1, $this->roll->id, 100, 'MTR'], [$poLine->qty, $poLine->unit_id, $poLine->unit_ratio, $poLine->base_unit]);

        $this->actingAsRole('super_admin');
        \App\Models\PurchaseOrder::whereKey($po['id'])->update(['status' => 'APPROVED']);
        $this->assertEquals(100, OnOrder::approvedByItem([$this->cable->id])[$this->cable->id]['po']);
        ItemUnitConversion::where('item_id', $this->cable->id)->update(['ratio' => 50]);

        // received at the ratio it was ordered at, and only then does stock grow
        $before = $this->stock();
        $shown = collect($this->getJson('/api/ri/po-orders')->assertOk()->json('data'))->firstWhere('id', $po['id'])['lines'][0];
        $this->assertEquals([100, 'MTR'], [$shown['unit_ratio'], $shown['base_unit']]);
        $ri = $this->postJson('/api/ri/from-po', ['purchase_order_id' => $po['id'], 'divisi' => 'NA', 'no_surat_jalan' => 'SJ-UOM-1', 'lines' => [['purchase_order_item_id' => $poLine->id, 'qty' => 1, 'photos' => [self::PHOTO]]]])->assertCreated()->json('data');
        $this->assertEquals([1, 'ROL', 100, 'MTR'], [$ri['kuantitas'], $ri['satuan'], $ri['unit_ratio'], $ri['base_satuan']]);
        $this->assertEquals($before + 100, $this->stock());
    }

    public function test_a_change_of_the_master_leaves_what_was_verified_alone(): void
    {
        [, $line] = $this->requestRolls(2);
        ItemUnitConversion::where('item_id', $this->cable->id)->update(['ratio' => 50]);
        $row = DB::table('item_request_lines')->where('id', $line['id'])->first();
        $this->assertEquals([200, 100], [$row->approved_qty, $row->unit_ratio]);
    }

    public function test_a_returned_request_is_verified_again_from_what_was_asked(): void
    {
        [$id, $line] = $this->requestRolls(2);
        $this->actingAsRole('direktur');
        $this->postJson("/api/item-requests/{$id}/approval", ['action' => 'RETURN', 'note' => 'Periksa lagi'])->assertOk();
        $row = DB::table('item_request_lines')->where('id', $line['id'])->first();
        $this->assertEquals([2, 'ROL', null, null], [$row->qty, $row->satuan, $row->unit_ratio, $row->approved_qty]);
        $this->actingAsRole('admin_gudang');
        $again = $this->postJson("/api/item-requests/{$id}/process", ['lines' => [$line['id'] => ['item_id' => $this->cable->id, 'qty' => 1, 'reason' => 'Sisanya menyusul']]])->assertOk()->json('data.lines.0');
        $this->assertEquals([200, 100, 2, 'ROL'], [$again['qty'], $again['approved_qty'], $again['requested_qty'], $again['requested_unit']]);
    }

    public function test_the_warehouse_picks_an_item_before_verifying_and_the_asked_unit_survives(): void
    {
        $this->actingAsRole('karyawan');
        $req = $this->postJson('/api/item-requests', ['lines' => [['deskripsi_barang' => 'kabel', 'qty' => 3, 'satuan' => 'ROL']]])->json('data');
        $line = \App\Models\ItemRequestLine::find($req['lines'][0]['id']);
        $line->matchTo($this->cable->load('unit'))->save();
        $this->assertEquals(['MTR', 'ROL', 3], [$line->satuan, $line->requested_unit, $line->requested_qty]);
        $this->actingAsRole('admin_gudang');
        $done = $this->postJson("/api/item-requests/{$req['id']}/process", ['lines' => [$line->id => ['item_id' => $this->cable->id]]])->assertOk()->json('data.lines.0');
        $this->assertEquals([300, 'MTR', 100], [$done['qty'], $done['satuan'], $done['unit_ratio']]);
    }

    public function test_a_unit_can_be_corrected_while_verifying_and_one_with_no_ratio_stops(): void
    {
        $box = Unit::where('code', 'BOX')->first();
        $this->actingAsRole('karyawan');
        $req = $this->postJson('/api/item-requests', ['lines' => [['deskripsi_barang' => 'kabel', 'qty' => 2, 'satuan' => 'BOX']]])->json('data');
        $id = $req['lines'][0]['id'];
        $this->actingAsRole('admin_gudang');
        $this->postJson("/api/item-requests/{$req['id']}/process", ['lines' => [$id => ['item_id' => $this->cable->id]]])->assertStatus(422)->assertJsonValidationErrors("lines.{$id}.item_id");
        $this->assertSame('BOX', DB::table('item_request_lines')->where('id', $id)->value('satuan'), 'nothing saved');
        $this->assertNotNull($box);
        // it was really meters
        $done = $this->postJson("/api/item-requests/{$req['id']}/process", ['lines' => [$id => ['item_id' => $this->cable->id, 'unit' => 'MTR']]])->assertOk()->json('data.lines.0');
        $this->assertEquals([2, 'MTR', 2], [$done['qty'], $done['satuan'], $done['approved_qty']]);
    }

    public function test_splitting_a_request_between_items_converts_each_at_its_own_ratio(): void
    {
        $other = Item::factory()->create(['code' => 'KBL.002', 'description' => 'Kabel lain', 'unit_id' => $this->cable->unit_id, 'is_active' => true]);
        ItemUnitConversion::create(['item_id' => $other->id, 'unit_id' => $this->roll->id, 'ratio' => 50]);
        $this->actingAsRole('karyawan');
        $req = $this->postJson('/api/item-requests', ['lines' => [['deskripsi_barang' => 'kabel', 'qty' => 3, 'satuan' => 'ROL']]])->json('data');
        $this->actingAsRole('admin_gudang');
        $lines = $this->postJson("/api/item-requests/{$req['id']}/process", ['lines' => [$req['lines'][0]['id'] => ['items' => [['item_id' => $this->cable->id, 'qty' => 1], ['item_id' => $other->id, 'qty' => 2]]]]])->assertOk()->json('data.lines');
        $this->assertEquals([[100, 100, 1], [100, 50, 2]], array_map(fn ($l) => [$l['approved_qty'], $l['unit_ratio'], $l['requested_qty']], $lines));
    }

    public function test_old_style_lines_keep_working_and_nothing_is_guessed(): void
    {
        // the item's own unit, no unit at all: as before
        foreach ([['MTR', 5], [null, 7]] as [$unit, $qty]) {
            $this->actingAsRole('karyawan');
            $req = $this->postJson('/api/item-requests', ['lines' => [['deskripsi_barang' => 'kabel', 'qty' => $qty, 'satuan' => $unit]]])->json('data');
            $this->actingAsRole('admin_gudang');
            $l = $this->postJson("/api/item-requests/{$req['id']}/process", ['lines' => [$req['lines'][0]['id'] => ['item_id' => $this->cable->id]]])->assertOk()->json('data.lines.0');
            $this->assertEquals([$qty, 'MTR', $qty, null, null, false], [$l['qty'], $l['satuan'], $l['approved_qty'], $l['requested_unit'], $l['unit_ratio'], $l['uom_unmapped']]);
        }
        // words the master does not know: counted as written and marked for mapping
        $this->actingAsRole('karyawan');
        $req = $this->postJson('/api/item-requests', ['lines' => [['deskripsi_barang' => 'kabel', 'qty' => 4, 'satuan' => 'GULUNG']]])->json('data');
        $this->actingAsRole('admin_gudang');
        $l = $this->postJson("/api/item-requests/{$req['id']}/process", ['lines' => [$req['lines'][0]['id'] => ['item_id' => $this->cable->id]]])->assertOk()->json('data.lines.0');
        $this->assertEquals([4, 'MTR', 'GULUNG', null, true], [$l['qty'], $l['satuan'], $l['requested_unit'], $l['unit_ratio'], $l['uom_unmapped']]);
    }

    public function test_a_manual_delivery_order_and_purchase_request_keep_their_unit_and_freeze_the_ratio(): void
    {
        $this->actingAsRole('super_admin');
        // not enough once converted: 2 rolls are 200 meters, stock is 150
        $id = $this->postJson('/api/npbg', ['divisi' => 'NA', 'tipe_npbg' => 'Non Penjualan', 'pelanggan' => 'Proyek', 'kode_barang' => 'KBL.001', 'deskripsi_barang' => 'Kabel', 'kuantitas' => 2, 'satuan' => 'ROL', 'peminta' => 'A'])
            ->assertCreated()->assertJsonPath('data.base_satuan', 'MTR')->json('data.id');
        $this->assertEquals(100, Npbg::find($id)->unit_ratio);
        $no = Npbg::find($id)->no_npbg;
        $this->assertSame('MANUAL', explode('/', $no)[1], 'document numbers as before');
        $this->expectStockOut($no, 150.0, 200);

        $this->postJson('/api/npbg', ['divisi' => 'NA', 'tipe_npbg' => 'Non Penjualan', 'pelanggan' => 'Lain', 'kode_barang' => 'KBL.001', 'deskripsi_barang' => 'Kabel', 'kuantitas' => 2, 'satuan' => 'BOX', 'peminta' => 'B'])
            ->assertStatus(422)->assertJsonValidationErrors('satuan');

        $this->postJson('/api/ppb', ['no_ppb' => 'PPB/UOM/9', 'tgl_ppb' => now()->toDateString(), 'kode_barang' => 'KBL.001', 'deskripsi_barang' => 'Kabel', 'kuantitas' => 3, 'satuan' => 'ROL'])
            ->assertCreated()->assertJsonPath('data.base_satuan', 'MTR');
        $ppb = Ppb::where('no_ppb', 'PPB/UOM/9')->sole();
        $this->assertEquals([3, 'ROL', 100], [$ppb->kuantitas, $ppb->satuan, $ppb->unit_ratio]);
        ItemUnitConversion::where('item_id', $this->cable->id)->update(['ratio' => 50]);
        $this->assertEquals(100, $ppb->refresh()->unit_ratio);
    }

    /** The approval takes the converted amount out, and refuses more than there is. */
    private function expectStockOut(string $no, float $have, float $need): void
    {
        $this->assertSame(150.0, $this->stock());
        try {
            DB::transaction(fn () => (new \ReflectionMethod(\App\Services\NpbgApprovalService::class, 'issue'))->invoke(app(\App\Services\NpbgApprovalService::class), $no, \App\Models\User::first()));
            $this->fail('issued more than the stock');
        } catch (\Illuminate\Validation\ValidationException $e) {
            $this->assertStringContainsString('Stok', collect($e->errors())->flatten()->first());
        }
        Npbg::where('no_npbg', $no)->update(['kuantitas' => 1]);
        DB::transaction(fn () => (new \ReflectionMethod(\App\Services\NpbgApprovalService::class, 'issue'))->invoke(app(\App\Services\NpbgApprovalService::class), $no, \App\Models\User::first()));
        $this->assertSame(50.0, $this->stock());
    }

    public function test_ratios_are_validated_and_a_used_conversion_cannot_be_deleted(): void
    {
        $this->actingAsRole('super_admin');
        $pck = Unit::where('code', 'PCK')->first();
        foreach ([0, -1, 0.0000001] as $bad) {
            $this->postJson("/api/items/{$this->cable->id}/unit-conversions", ['unit_id' => $pck->id, 'ratio' => $bad])->assertStatus(422)->assertJsonValidationErrors('ratio');
        }
        // another ratio for the same unit changes the one row
        $this->postJson("/api/items/{$this->cable->id}/unit-conversions", ['unit_id' => $this->roll->id, 'ratio' => 120])->assertCreated();
        $this->assertSame(1, ItemUnitConversion::where(['item_id' => $this->cable->id, 'unit_id' => $this->roll->id])->count());

        $free = $this->postJson("/api/items/{$this->cable->id}/unit-conversions", ['unit_id' => $pck->id, 'ratio' => 10])->assertCreated()->json('data.id');
        $this->deleteJson("/api/items/{$this->cable->id}/unit-conversions/{$free}")->assertOk();

        $used = ItemUnitConversion::where(['item_id' => $this->cable->id, 'unit_id' => $this->roll->id])->value('id');
        $this->requestRolls(1);
        $this->actingAsRole('super_admin');
        $this->deleteJson("/api/items/{$this->cable->id}/unit-conversions/{$used}")->assertStatus(422)->assertJsonValidationErrors('unit');
        $this->assertNotNull(ItemUnitConversion::find($used));
    }

    public function test_items_with_no_unit_are_listed_for_mapping_and_get_one_once(): void
    {
        $this->actingAsRole('super_admin');
        $bare = Item::factory()->create(['code' => 'XX.1', 'unit_id' => null, 'is_active' => true]);
        $free = Unit::factory()->create(['code' => 'ZZZ', 'uom_category_id' => null]);
        $list = $this->getJson('/api/uom/unmapped')->assertOk()->json('data');
        $this->assertContains('XX.1', array_column($list['items'], 'code'));
        $this->assertContains('ZZZ', array_column($list['units'], 'code'));
        $mtr = $this->cable->unit_id;
        $this->putJson("/api/items/{$bare->id}/base-unit", ['unit_id' => $mtr])->assertOk();
        $this->assertSame($mtr, $bare->refresh()->unit_id);
        // a base unit already in use is not changed here: stock is counted in it
        $this->putJson("/api/items/{$this->cable->id}/base-unit", ['unit_id' => $this->roll->id])->assertStatus(422)->assertJsonValidationErrors('unit_id');
        $this->assertNotContains('XX.1', array_column($this->getJson('/api/uom/unmapped')->json('data.items'), 'code'));
    }

    public function test_quantities_are_counted_in_decimals(): void
    {
        $this->assertSame('0.30', UomConverter::baseQty('0.1', '3'));
        $this->assertSame('1.00', UomConverter::baseQty('3', '0.333333'));
        $this->assertSame('1.01', UomConverter::roundDec('1.005', 2));
        $this->assertTrue(UomConverter::isOne('1.000000'));
    }
}
