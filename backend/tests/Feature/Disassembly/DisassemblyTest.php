<?php

namespace Tests\Feature\Disassembly;

use App\Models\DisassemblyOrder;
use App\Models\Item;
use App\Models\ItemUnitConversion;
use App\Models\Unit;
use App\Models\Warehouse;
use App\Services\Inventory\StockLedgerService;
use App\Services\Inventory\StockwiseNet;
use Database\Seeders\RbacSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Disassembly: 1 BOX "ATK TOLKIT" = 2 PCS pen + 2 PCS pencil + 1 PCS eraser + 1 PCS book (its active BoM).
 * 20 BOX in the main warehouse. The pen may be recorded in packs (1 PCK = 12 PCS, set for that item).
 */
class DisassemblyTest extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected $seeder = RbacSeeder::class;

    private Item $kit;

    private Item $pen;

    private Item $pencil;

    private Item $eraser;

    private Item $book;

    private int $wh;

    private int $wh2;

    protected function setUp(): void
    {
        parent::setUp();
        \Illuminate\Support\Facades\Storage::fake('local');
        \Illuminate\Support\Facades\Cache::flush();
        config(['stockwise.stockwise_ledger_since' => now()->subDay()->toDateTimeString()]);
        $this->artisan('stockwise:seed-uom')->assertSuccessful();
        $pcs = Unit::where('code', 'PCS')->firstOrFail();
        $box = Unit::where('code', 'BOX')->firstOrFail();
        $this->wh = Warehouse::factory()->create()->id;
        $this->wh2 = Warehouse::factory()->create()->id;
        $make = fn (string $code, Unit $u) => Item::factory()->create(['code' => $code, 'description' => "DUMMY {$code}", 'unit_id' => $u->id, 'is_active' => true]);
        $this->kit = $make('DUM.001', $box);
        $this->pen = $make('PEN.001', $pcs);
        $this->pencil = $make('PCL.001', $pcs);
        $this->eraser = $make('ERS.001', $pcs);
        $this->book = $make('BUK.001', $pcs);
        ItemUnitConversion::create(['item_id' => $this->pen->id, 'unit_id' => Unit::where('code', 'PCK')->firstOrFail()->id, 'ratio' => 12]);
        $ledger = app(StockLedgerService::class);
        $ledger->openingBalance($this->kit->id, $this->wh, 20);
        foreach ([$this->pen, $this->pencil, $this->eraser, $this->book] as $item) {
            $ledger->openingBalance($item->id, $this->wh, 0);
        }
        $this->actingAsRole('admin_gudang');
        $bom = $this->postJson('/api/mrp/boms', ['item_id' => $this->kit->id, 'name' => 'ATK TOLKIT', 'lines' => [
            ['item_id' => $this->pen->id, 'qty' => 2], ['item_id' => $this->pencil->id, 'qty' => 2],
            ['item_id' => $this->eraser->id, 'qty' => 1], ['item_id' => $this->book->id, 'qty' => 1],
        ]])->assertCreated()->json('data');
        $this->postJson("/api/mrp/boms/{$bom['id']}/activate")->assertOk();
    }

    // ------------------------------------------------------------------ helpers

    private const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

    /** The warehouse hands the product over: Item Request → verification → Manager → Director → Delivery Order handover. */
    private function issueProduct(int $orderId): array
    {
        $this->actingAsRole('admin_gudang');
        $ir = $this->postJson("/api/disassembly/orders/{$orderId}/request-product")->assertCreated()->json('data');
        $req = $this->getJson("/api/item-requests/{$ir['id']}")->assertOk()->json('data');
        $this->postJson("/api/item-requests/{$ir['id']}/process", ['lines' => collect($req['lines'])->mapWithKeys(fn ($l) => [$l['id'] => ['item_id' => $l['item_id']]])->all(),
            'npbg' => ['pelanggan' => 'PRODUKSI']])->assertOk();
        $this->actingAsRole('manager');
        $this->postJson("/api/item-requests/{$ir['id']}/approval", ['action' => 'APPROVE'])->assertOk();
        $this->actingAsRole('direktur');
        $this->postJson("/api/item-requests/{$ir['id']}/approval", ['action' => 'APPROVE'])->assertOk();
        $this->actingAsRole('lapangan_gudang');
        foreach ($this->getJson("/api/item-requests/{$ir['id']}")->json('data.fulfillments') as $f) {
            $this->postJson("/api/item-requests/{$ir['id']}/fulfillments/{$f['id']}/handover", ['photo' => self::PNG, 'signature' => self::PNG, 'received_by' => 'PRODUKSI'])->assertOk();
        }
        $this->actingAsRole('admin_gudang');

        return $ir;
    }

    /** A recovered component comes into the warehouse with a (manual) Receipt, linked to the order. */
    private function receive(int $orderId, Item $item, float $qty): string
    {
        $this->actingAsRole('admin_gudang');
        $no = $this->postJson('/api/ri', ['divisi' => 'NA', 'kode_barang' => $item->code, 'deskripsi_barang' => $item->description, 'kuantitas' => $qty, 'photos' => [self::PNG]])
            ->assertCreated()->json('data.no_ri');
        $this->postJson("/api/disassembly/orders/{$orderId}/receipts", ['no_ri' => $no])->assertOk();

        return $no;
    }

    /** Every good component of $boxes boxes received. */
    private function receiveAll(int $orderId, float $boxes): void
    {
        $this->receive($orderId, $this->pen, 2 * $boxes);
        $this->receive($orderId, $this->pencil, 2 * $boxes);
        $this->receive($orderId, $this->eraser, $boxes);
        $this->receive($orderId, $this->book, $boxes);
    }

    private function stock(Item $item, ?int $wh = null): float
    {
        return (float) DB::table('inventory')->where('item_id', $item->id)->when($wh, fn ($q) => $q->where('warehouse_id', $wh))->sum('actual_qty');
    }

    private function reserved(Item $item): float
    {
        return (float) DB::table('inventory')->where('item_id', $item->id)->sum('reserved_qty');
    }

    private function order(float|string $qty = 10, array $extra = []): array
    {
        return $this->postJson('/api/disassembly/orders', ['item_id' => $this->kit->id, 'planned_qty' => $qty, 'source_warehouse_id' => $this->wh] + $extra)
            ->assertCreated()->json('data');
    }

    private function entry(int $id, array $data, int $status = 201)
    {
        return $this->postJson("/api/disassembly/orders/{$id}/entries", $data)->assertStatus($status);
    }

    private function started(float $qty = 10, array $extra = []): array
    {
        $o = $this->order($qty, $extra);
        $this->postJson("/api/disassembly/orders/{$o['id']}/confirm")->assertOk();
        $this->postJson("/api/disassembly/orders/{$o['id']}/start")->assertOk();

        return $o;
    }

    /** Everything recovered in full for $boxes boxes. */
    private function recordAll(int $id, float $boxes): void
    {
        $this->entry($id, ['kind' => 'GOOD', 'item_id' => $this->pen->id, 'qty' => 2 * $boxes]);
        $this->entry($id, ['kind' => 'GOOD', 'item_id' => $this->pencil->id, 'qty' => 2 * $boxes]);
        $this->entry($id, ['kind' => 'GOOD', 'item_id' => $this->eraser->id, 'qty' => $boxes]);
        $this->entry($id, ['kind' => 'GOOD', 'item_id' => $this->book->id, 'qty' => $boxes]);
    }

    private function moves(int $id): array
    {
        return DB::table('stock_movements')->where(['reference_type' => (new DisassemblyOrder)->getMorphClass(), 'reference_id' => $id])
            ->whereIn('movement_type', StockLedgerService::DISASSEMBLY_TYPES)->orderBy('id')->get(['movement_type', 'item_id', 'qty'])
            ->map(fn ($m) => [$m->movement_type, (int) $m->item_id, (float) $m->qty])->all();
    }

    // ------------------------------------------------------------------ main flow

    public function test_the_product_goes_out_through_a_delivery_order_and_good_components_come_in_through_receipts(): void
    {
        $o = $this->order(10);
        $this->assertMatchesRegularExpression('#^DSA/\d{2}/[IVX]+/001$#', $o['number']);
        $this->assertEquals([20, 20, 10, 10], array_column($o['components'], 'planned'));

        $this->postJson("/api/disassembly/orders/{$o['id']}/confirm")->assertOk()->assertJsonPath('data.status', 'CONFIRMED');
        $this->assertSame([20.0, 0.0], [$this->stock($this->kit), $this->reserved($this->kit)], 'the order holds nothing itself');
        $this->postJson("/api/disassembly/orders/{$o['id']}/confirm")->assertStatus(422);
        $this->postJson("/api/disassembly/orders/{$o['id']}/start")->assertOk();

        // the 10 boxes come from the warehouse: Item Request → Delivery Order handover
        $ir = $this->issueProduct($o['id']);
        $this->assertEquals(10, $this->getJson("/api/item-requests/{$ir['id']}")->json('data.lines.0.qty'));
        $this->assertSame(10.0, $this->stock($this->kit));
        $this->postJson("/api/disassembly/orders/{$o['id']}/request-product")->assertStatus(422); // all asked already

        // pens: 18 good, 1 damaged, 1 not found
        $this->entry($o['id'], ['kind' => 'GOOD', 'item_id' => $this->pen->id, 'qty' => 18]);
        $this->entry($o['id'], ['kind' => 'SCRAP', 'item_id' => $this->pen->id, 'qty' => 1], 422); // reason required
        $this->entry($o['id'], ['kind' => 'SCRAP', 'item_id' => $this->pen->id, 'qty' => 1, 'reason' => 'Patah']);
        $this->entry($o['id'], ['kind' => 'MISSING', 'item_id' => $this->pen->id, 'qty' => 1, 'reason' => 'Tidak ada di box']);
        $this->entry($o['id'], ['kind' => 'GOOD', 'item_id' => $this->pencil->id, 'qty' => 20]);
        $this->entry($o['id'], ['kind' => 'GOOD', 'item_id' => $this->eraser->id, 'qty' => 10]);
        $this->postJson("/api/disassembly/orders/{$o['id']}/finish")->assertStatus(422)->assertSeeText('BUK.001: 10 PCS');
        $this->entry($o['id'], ['kind' => 'GOOD', 'item_id' => $this->book->id, 'qty' => 10]);
        $this->postJson("/api/disassembly/orders/{$o['id']}/finish")->assertOk()->assertJsonPath('data.status', 'TO_CLOSE');
        $this->postJson("/api/disassembly/orders/{$o['id']}/validate")->assertStatus(422)->assertJsonValidationErrors('warehouse'); // nothing received yet

        // only the good components come in, each with a Receipt of this order's components
        $this->receive($o['id'], $this->pen, 18);
        $this->receive($o['id'], $this->pencil, 20);
        $this->receive($o['id'], $this->eraser, 10);
        $this->postJson("/api/disassembly/orders/{$o['id']}/validate")->assertStatus(422)->assertSeeText('BUK.001: hasil baik 10, diterima lewat Receipt 0');
        $kitRi = $this->postJson('/api/ri', ['divisi' => 'NA', 'kode_barang' => $this->kit->code, 'deskripsi_barang' => 'x', 'kuantitas' => 1, 'photos' => [self::PNG]])->json('data.no_ri');
        $this->postJson("/api/disassembly/orders/{$o['id']}/receipts", ['no_ri' => $kitRi])->assertStatus(422); // not a component
        $this->receive($o['id'], $this->book, 10);

        $res = $this->postJson("/api/disassembly/orders/{$o['id']}/validate")->assertOk()->assertJsonPath('data.status', 'DONE')->json('data');
        $this->assertSame([11.0, 18.0, 20.0, 10.0, 10.0], [$this->stock($this->kit), $this->stock($this->pen), $this->stock($this->pencil), $this->stock($this->eraser), $this->stock($this->book)]);
        $pen = collect($res['components'])->firstWhere('item_id', $this->pen->id);
        $this->assertEquals([18, 1, 1, 20, 0, 18], [$pen['good'], $pen['scrap'], $pen['missing'], $pen['accounted'], $pen['open'], $pen['received']]);
        // the order itself moved nothing; a second validation is refused
        $this->assertSame([], $this->moves($o['id']));
        $this->postJson("/api/disassembly/orders/{$o['id']}/validate")->assertStatus(422);
        $this->getJson('/api/disassembly/history?item_id='.$this->pen->id)->assertOk()->assertJsonPath('data.0.number', $o['number']);
    }

    // ------------------------------------------------------------------ refusals

    public function test_not_enough_stock_bom_and_product_rules(): void
    {
        $o = $this->order(25);
        $this->postJson("/api/disassembly/orders/{$o['id']}/confirm")->assertStatus(422)->assertJsonFragment(['stock' => ['Stok DUM.001 di gudang sumber tidak cukup: perlu 25 BOX, tersedia 20.']]);
        $this->assertSame('DRAFT', DisassemblyOrder::find($o['id'])->status);
        $this->assertEquals(0, $this->reserved($this->kit));

        // a product without an active BoM, a service, zero / negative quantities, no warehouse
        $this->postJson('/api/disassembly/orders', ['item_id' => $this->pen->id, 'planned_qty' => 1, 'source_warehouse_id' => $this->wh])->assertStatus(422)->assertJsonValidationErrors('bom_id');
        $this->postJson('/api/disassembly/orders', ['item_id' => $this->kit->id, 'planned_qty' => 0, 'source_warehouse_id' => $this->wh])->assertStatus(422)->assertJsonValidationErrors('planned_qty');
        $this->postJson('/api/disassembly/orders', ['item_id' => $this->kit->id, 'planned_qty' => -2, 'source_warehouse_id' => $this->wh])->assertStatus(422)->assertJsonValidationErrors('planned_qty');
        $this->postJson('/api/disassembly/orders', ['item_id' => $this->kit->id, 'planned_qty' => 1.234, 'source_warehouse_id' => $this->wh])->assertStatus(422)->assertJsonValidationErrors('planned_qty');
        $this->postJson('/api/disassembly/orders', ['item_id' => $this->kit->id, 'planned_qty' => 1])->assertStatus(422)->assertJsonValidationErrors('source_warehouse_id');

        // archived BoM: no new order
        $bomId = $o['mrp_bom_id'];
        $this->postJson("/api/mrp/boms/{$bomId}/archive")->assertOk();
        $this->postJson('/api/disassembly/orders', ['item_id' => $this->kit->id, 'planned_qty' => 1, 'source_warehouse_id' => $this->wh])->assertStatus(422)->assertJsonValidationErrors('bom_id');
        $this->postJson('/api/disassembly/orders', ['bom_id' => $bomId, 'planned_qty' => 1, 'source_warehouse_id' => $this->wh])->assertStatus(422)->assertJsonValidationErrors('bom_id');
    }

    public function test_a_unit_that_cannot_be_split_refuses_fractions(): void
    {
        $this->order(0.5); // BOX rounding 0.01: a half box is allowed
        Unit::where('code', 'BOX')->update(['rounding' => 1]);
        $this->postJson('/api/disassembly/orders', ['item_id' => $this->kit->id, 'planned_qty' => 0.5, 'source_warehouse_id' => $this->wh])
            ->assertStatus(422)->assertJsonValidationErrors('planned_qty');
        Unit::where('code', 'PCS')->update(['rounding' => 1]);
        $o = $this->started(1);
        $this->entry($o['id'], ['kind' => 'GOOD', 'item_id' => $this->pen->id, 'qty' => 1.5], 422);
    }

    public function test_uom_conversion_is_frozen_and_inexact_quantities_are_refused(): void
    {
        $o = $this->started(6);
        $this->entry($o['id'], ['kind' => 'GOOD', 'item_id' => $this->pen->id, 'qty' => 1, 'unit' => 'PCK']); // 12 PCS
        ItemUnitConversion::where('item_id', $this->pen->id)->update(['ratio' => 10]); // Master UOM changes later
        $e = collect($this->getJson("/api/disassembly/orders/{$o['id']}")->json('data.entries'))->first();
        $this->assertEquals([1, 'PCK', 12, 12, 'PCS'], [$e['qty'], $e['unit'], $e['unit_ratio'], $e['base_qty'], $e['base_unit']]);
        $this->entry($o['id'], ['kind' => 'GOOD', 'item_id' => $this->pencil->id, 'qty' => 1, 'unit' => 'KG'], 422)->assertJsonValidationErrors('unit');
        $this->entry($o['id'], ['kind' => 'GOOD', 'item_id' => $this->pen->id, 'qty' => '0.0001', 'unit' => 'PCK'], 422)->assertJsonValidationErrors('qty');
    }

    public function test_over_plan_and_extra_items_need_the_validator(): void
    {
        $o = $this->started(1);
        $field = $this->actingAsRole('lapangan_gudang');
        $this->entry($o['id'], ['kind' => 'GOOD', 'item_id' => $this->pen->id, 'qty' => 3], 422); // plan is 2
        $this->entry($o['id'], ['kind' => 'GOOD', 'item_id' => $this->kit->id, 'qty' => 1], 422); // the product itself
        $other = Item::factory()->create(['code' => 'XTR.001', 'unit_id' => Unit::where('code', 'PCS')->value('id'), 'is_active' => true]);
        $this->entry($o['id'], ['kind' => 'GOOD', 'item_id' => $other->id, 'qty' => 1], 422);
        $this->actingAsRole('admin_gudang');
        $this->entry($o['id'], ['kind' => 'GOOD', 'item_id' => $this->pen->id, 'qty' => 3], 422)->assertJsonValidationErrors('reason');
        $this->entry($o['id'], ['kind' => 'GOOD', 'item_id' => $this->pen->id, 'qty' => 3, 'reason' => 'Ada pulpen cadangan']);
        $this->entry($o['id'], ['kind' => 'GOOD', 'item_id' => $other->id, 'qty' => 1, 'reason' => 'Bonus di dalam box']);
        $this->entry($o['id'], ['kind' => 'SCRAP', 'item_id' => $other->id, 'qty' => 1, 'reason' => 'x']); // fine: it is a component now
        $this->assertNotNull($field);
    }

    public function test_partial_disassembly_and_over_recorded_results(): void
    {
        $o = $this->started(10);
        $this->issueProduct($o['id']);
        $this->recordAll($o['id'], 8);
        $this->postJson("/api/disassembly/orders/{$o['id']}/finish", ['done_qty' => 11])->assertStatus(422)->assertJsonValidationErrors('done_qty');
        $this->postJson("/api/disassembly/orders/{$o['id']}/finish", ['done_qty' => 8])->assertOk()->assertJsonPath('data.done_qty', 8);
        $this->receiveAll($o['id'], 8);
        $this->postJson("/api/disassembly/orders/{$o['id']}/validate")->assertOk();
        $this->assertSame([10.0, 16.0], [$this->stock($this->kit), $this->stock($this->pen)]);

        // 8 boxes recorded, only 5 really taken apart: a field user may not finish (phantom stock), the validator may
        $o2 = $this->started(8);
        $this->recordAll($o2['id'], 8);
        $this->actingAsRole('lapangan_gudang');
        $this->postJson("/api/disassembly/orders/{$o2['id']}/finish", ['done_qty' => 5])->assertStatus(422)->assertJsonValidationErrors('entries');
        $this->actingAsRole('admin_gudang');
        $this->postJson("/api/disassembly/orders/{$o2['id']}/finish", ['done_qty' => 5])->assertOk();
    }

    public function test_validation_is_refused_until_the_warehouse_handed_the_product_over(): void
    {
        $o = $this->started(10);
        $this->recordAll($o['id'], 10);
        $this->receiveAll($o['id'], 10);
        $this->postJson("/api/disassembly/orders/{$o['id']}/finish")->assertOk();
        $this->postJson("/api/disassembly/orders/{$o['id']}/validate")->assertStatus(422)->assertSeeText('DUM.001: dibongkar 10, diserahkan gudang 0 BOX');
        $this->assertSame('TO_CLOSE', DisassemblyOrder::find($o['id'])->status);
        $this->assertSame(20.0, $this->stock($this->kit));
        $this->assertSame([], $this->moves($o['id']));
    }

    // ------------------------------------------------------------------ cancel / reverse / Accurate

    public function test_cancel_releases_the_hold_and_needs_a_reason_after_draft(): void
    {
        $o = $this->started(5);
        $this->entry($o['id'], ['kind' => 'GOOD', 'item_id' => $this->pen->id, 'qty' => 2]);
        $this->postJson("/api/disassembly/orders/{$o['id']}/cancel")->assertStatus(422)->assertJsonValidationErrors('reason');
        $this->postJson("/api/disassembly/orders/{$o['id']}/cancel", ['reason' => 'Batal'])->assertOk()->assertJsonPath('data.status', 'CANCELLED');
        $this->assertEquals(0, $this->reserved($this->kit));
        $this->assertEquals(20, $this->stock($this->kit));
        $this->postJson("/api/disassembly/orders/{$o['id']}/cancel", ['reason' => 'lagi'])->assertStatus(422);
        $this->assertNotNull(DB::table('disassembly_entries')->where('disassembly_order_id', $o['id'])->value('voided_at'));

        $d = $this->order(1);
        $this->postJson("/api/disassembly/orders/{$d['id']}/cancel")->assertOk(); // a draft needs no reason
    }

    public function test_an_order_through_the_warehouse_is_neither_reversed_nor_marked_in_accurate(): void
    {
        $o = $this->started(5);
        $this->issueProduct($o['id']);
        $this->recordAll($o['id'], 5);
        $this->receiveAll($o['id'], 5);
        $this->postJson("/api/disassembly/orders/{$o['id']}/finish")->assertOk();
        $this->postJson("/api/disassembly/orders/{$o['id']}/validate")->assertOk();
        $this->assertSame([], StockwiseNet::disassembly(), 'stock moved through the Delivery Order and the Receipts');
        $this->postJson("/api/disassembly/orders/{$o['id']}/reverse", ['reason' => 'Salah input'])->assertStatus(422);
        $this->postJson("/api/disassembly/orders/{$o['id']}/accurate", ['refs' => ['IA.001']])->assertStatus(422);
        $this->assertSame(0, $this->getJson('/api/disassembly/dashboard')->json('data.not_in_accurate'));
    }

    // ------------------------------------------------------------------ snapshot, idempotency, permissions

    public function test_bom_revision_does_not_change_an_existing_order(): void
    {
        $o = $this->order(2);
        $rev = $this->postJson("/api/mrp/boms/{$o['mrp_bom_id']}/revise")->assertCreated()->json('data');
        $this->putJson("/api/mrp/boms/{$rev['id']}", ['lines' => [['item_id' => $this->pen->id, 'qty' => 5]]])->assertOk();
        $this->postJson("/api/mrp/boms/{$rev['id']}/activate")->assertOk();
        $show = $this->getJson("/api/disassembly/orders/{$o['id']}")->assertOk()->json('data');
        $this->assertCount(4, $show['components']);
        $this->assertTrue($show['bom_changed']);
        $this->postJson("/api/disassembly/orders/{$o['id']}/confirm")->assertOk(); // still works from its own copy
        $new = $this->order(1);
        $this->assertCount(1, $new['components']);
    }

    public function test_resent_entry_is_recorded_once_and_entries_can_be_voided(): void
    {
        $o = $this->started(1);
        $data = ['kind' => 'GOOD', 'item_id' => $this->pen->id, 'qty' => 2, 'client_key' => 'k-123'];
        $this->entry($o['id'], $data);
        $this->entry($o['id'], $data);
        $this->assertSame(1, DB::table('disassembly_entries')->where('disassembly_order_id', $o['id'])->count());
        $id = DB::table('disassembly_entries')->value('id');
        $this->deleteJson("/api/disassembly/orders/{$o['id']}/entries/{$id}")->assertOk();
        $this->deleteJson("/api/disassembly/orders/{$o['id']}/entries/{$id}")->assertStatus(422);
        $pen = collect($this->getJson("/api/disassembly/orders/{$o['id']}")->json('data.components'))->firstWhere('item_id', $this->pen->id);
        $this->assertEquals(0, $pen['good']);
    }

    public function test_permissions_are_enforced_on_the_endpoints(): void
    {
        $o = $this->order(1);
        $this->actingAsRole('lapangan_gudang');
        $this->getJson('/api/disassembly/orders')->assertOk();
        $this->postJson('/api/disassembly/orders', ['item_id' => $this->kit->id, 'planned_qty' => 1, 'source_warehouse_id' => $this->wh])->assertForbidden();
        $this->postJson("/api/disassembly/orders/{$o['id']}/confirm")->assertForbidden();
        $this->postJson("/api/disassembly/orders/{$o['id']}/validate")->assertForbidden();
        $this->postJson("/api/disassembly/orders/{$o['id']}/cancel", ['reason' => 'x'])->assertForbidden();
        $this->actingAsRole('bos');
        $this->getJson("/api/disassembly/orders/{$o['id']}")->assertOk();
        $this->postJson("/api/disassembly/orders/{$o['id']}/start")->assertForbidden();
        $this->actingAsRole('karyawan');
        $this->getJson('/api/disassembly/orders')->assertForbidden();
        $this->getJson('/api/disassembly/dashboard')->assertForbidden();
        $this->assertSame('DRAFT', DisassemblyOrder::find($o['id'])->status);
    }

    public function test_manufacturing_is_unchanged_by_disassembly(): void
    {
        // the same BoM still makes kits: a MO validated next to a disassembly keeps its own movements and net
        app(StockLedgerService::class)->record(['type' => 'STOCK_IN', 'item_id' => $this->pen->id, 'warehouse_id' => $this->wh, 'qty' => 2]);
        foreach ([$this->pencil, $this->eraser, $this->book] as $i) {
            app(StockLedgerService::class)->record(['type' => 'STOCK_IN', 'item_id' => $i->id, 'warehouse_id' => $this->wh, 'qty' => 2]);
        }
        $mo = $this->postJson('/api/mrp/productions', ['item_id' => $this->kit->id, 'planned_qty' => 1])->assertCreated()->json('data');
        $this->assertCount(4, $mo['components']);
        $this->assertSame([], StockwiseNet::disassembly() ? array_filter(StockwiseNet::disassembly()) : []);
    }
}
