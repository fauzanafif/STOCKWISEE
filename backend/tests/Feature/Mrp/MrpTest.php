<?php

namespace Tests\Feature\Mrp;

use App\Models\Item;
use App\Models\ItemUnitConversion;
use App\Models\MrpProduction;
use App\Models\Unit;
use App\Models\Warehouse;
use App\Services\Inventory\StockLedgerService;
use App\Services\Inventory\StockwiseNet;
use Database\Seeders\RbacSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Manufacturing: 1 Panel Control = 5 MTR cable + 8 PCS bolt + 4 PCS terminal + 1 PCS panel box.
 * The cable is kept in meters and may be recorded in rolls (1 ROL = 100 MTR, set for that item).
 */
class MrpTest extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected $seeder = RbacSeeder::class;

    private Item $panel;

    private Item $cable;

    private Item $bolt;

    private Item $terminal;

    private Item $box;

    private int $wh;

    protected function setUp(): void
    {
        parent::setUp();
        \Illuminate\Support\Facades\Storage::fake('local');
        \Illuminate\Support\Facades\Cache::flush();
        config(['stockwise.stockwise_ledger_since' => now()->subDay()->toDateTimeString()]);
        $this->artisan('stockwise:seed-uom')->assertSuccessful();
        $pcs = Unit::where('code', 'PCS')->firstOrFail();
        $mtr = Unit::where('code', 'MTR')->firstOrFail();
        $this->wh = Warehouse::factory()->create()->id;
        $make = fn (string $code, Unit $u) => Item::factory()->create(['code' => $code, 'description' => "DUMMY {$code}", 'unit_id' => $u->id, 'is_active' => true]);
        $this->panel = $make('PNL.001', $pcs);
        $this->cable = $make('KBL.001', $mtr);
        $this->bolt = $make('BLT.001', $pcs);
        $this->terminal = $make('TRM.001', $pcs);
        $this->box = $make('BOX.001', $pcs);
        ItemUnitConversion::create(['item_id' => $this->cable->id, 'unit_id' => Unit::where('code', 'ROL')->firstOrFail()->id, 'ratio' => 100]);
        $ledger = app(StockLedgerService::class);
        foreach ([[$this->cable, 200], [$this->bolt, 100], [$this->terminal, 30], [$this->box, 20], [$this->panel, 0]] as [$item, $qty]) {
            $ledger->openingBalance($item->id, $this->wh, $qty);
        }
    }

    // ------------------------------------------------------------------ helpers

    private function stock(Item $item): float
    {
        return (float) DB::table('inventory')->where('item_id', $item->id)->sum('actual_qty');
    }

    private function reserved(Item $item): float
    {
        return (float) DB::table('inventory')->where('item_id', $item->id)->sum('reserved_qty');
    }

    private function lines(array $override = []): array
    {
        $qty = $override + [$this->cable->id => 5, $this->bolt->id => 8, $this->terminal->id => 4, $this->box->id => 1];

        return array_map(fn ($id, $q) => ['item_id' => $id, 'qty' => $q], array_keys($qty), $qty);
    }

    private function activeBom(): array
    {
        $this->actingAsRole('admin_gudang');
        $bom = $this->postJson('/api/mrp/boms', ['item_id' => $this->panel->id, 'name' => 'Panel Control', 'lines' => $this->lines()])->assertCreated()->json('data');
        $this->postJson("/api/mrp/boms/{$bom['id']}/activate")->assertOk();

        return $bom;
    }

    private function mo(float $qty = 10): array
    {
        $this->activeBom();

        return $this->postJson('/api/mrp/productions', ['item_id' => $this->panel->id, 'planned_qty' => $qty])->assertCreated()->json('data');
    }

    private function entry(int $moId, array $data, int $status = 201)
    {
        return $this->postJson("/api/mrp/productions/{$moId}/entries", $data)->assertStatus($status);
    }

    private function mrpMoves(int $moId): array
    {
        return DB::table('stock_movements')->where(['reference_type' => (new MrpProduction)->getMorphClass(), 'reference_id' => $moId])
            ->whereIn('movement_type', StockLedgerService::MRP_TYPES)->orderBy('id')->get(['movement_type', 'item_id', 'qty'])
            ->map(fn ($m) => [$m->movement_type, (int) $m->item_id, (float) $m->qty])->all();
    }

    /** Terminal stock up to 40 so that 10 panels can be made in full. */
    private function enoughTerminals(): void
    {
        app(StockLedgerService::class)->record(['type' => 'STOCK_IN', 'item_id' => $this->terminal->id, 'warehouse_id' => $this->wh, 'qty' => 10]);
    }

    private function runToClose(int $moId): void
    {
        $this->postJson("/api/mrp/productions/{$moId}/confirm")->assertOk();
        $this->postJson("/api/mrp/productions/{$moId}/start")->assertOk();
        $this->entry($moId, ['kind' => 'CONSUME', 'item_id' => $this->cable->id, 'qty' => 0.5, 'unit' => 'ROL']);
        $this->entry($moId, ['kind' => 'CONSUME', 'item_id' => $this->bolt->id, 'qty' => 78]);
        $this->entry($moId, ['kind' => 'SCRAP', 'item_id' => $this->bolt->id, 'qty' => 2, 'reason' => 'Ulir rusak']);
        $this->entry($moId, ['kind' => 'CONSUME', 'item_id' => $this->terminal->id, 'qty' => 40]);
        $this->entry($moId, ['kind' => 'CONSUME', 'item_id' => $this->box->id, 'qty' => 10]);
        $this->entry($moId, ['kind' => 'OUTPUT', 'qty' => 9]);
        $this->entry($moId, ['kind' => 'SCRAP', 'item_id' => $this->panel->id, 'qty' => 1, 'reason' => 'Gagal uji fungsi']);
        $this->postJson("/api/mrp/productions/{$moId}/finish")->assertOk()->assertJsonPath('data.status', 'TO_CLOSE');
    }

    private const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

    /**
     * The warehouse hands the components over: the MO asks with an Item Request, admin gudang verifies, Manager and
     * Director approve, the system prepares the Delivery Order from stock and the warehouse hands it over.
     */
    private function issueComponents(int $moId): array
    {
        $this->actingAsRole('admin_gudang');
        $ir = $this->postJson("/api/mrp/productions/{$moId}/request-components")->assertCreated()->json('data');
        $this->deliver($ir['id']);
        $this->actingAsRole('admin_gudang');

        return $ir;
    }

    private function deliver(int $irId): void
    {
        $this->actingAsRole('admin_gudang');
        $req = $this->getJson("/api/item-requests/{$irId}")->assertOk()->json('data');
        $this->postJson("/api/item-requests/{$irId}/process", ['lines' => collect($req['lines'])->mapWithKeys(fn ($l) => [$l['id'] => ['item_id' => $l['item_id']]])->all(),
            'npbg' => ['pelanggan' => 'PRODUKSI']])->assertOk();
        $this->actingAsRole('manager');
        $this->postJson("/api/item-requests/{$irId}/approval", ['action' => 'APPROVE'])->assertOk();
        $this->actingAsRole('direktur');
        $this->postJson("/api/item-requests/{$irId}/approval", ['action' => 'APPROVE'])->assertOk();
        $this->actingAsRole('lapangan_gudang');
        foreach ($this->getJson("/api/item-requests/{$irId}")->json('data.fulfillments') as $f) {
            if (! ($f['handed_at'] ?? null)) {
                $this->postJson("/api/item-requests/{$irId}/fulfillments/{$f['id']}/handover", ['photo' => self::PNG, 'signature' => self::PNG, 'received_by' => 'PRODUKSI'])->assertOk();
            }
        }
    }

    /** The finished goods come into the warehouse with a (manual) Receipt; returns its number. */
    private function receive(Item $item, float $qty): string
    {
        $this->actingAsRole('admin_gudang');

        return $this->postJson('/api/ri', ['divisi' => 'NA', 'kode_barang' => $item->code, 'deskripsi_barang' => $item->description, 'kuantitas' => $qty, 'photos' => [self::PNG]])
            ->assertCreated()->json('data.no_ri');
    }

    // ------------------------------------------------------------------ BoM

    public function test_bom_is_created_edited_activated_and_a_new_revision_keeps_the_old_one(): void
    {
        $this->actingAsRole('admin_gudang');
        $bom = $this->postJson('/api/mrp/boms', ['item_id' => $this->panel->id, 'lines' => $this->lines()])->assertCreated()->json('data');
        $this->assertSame(['DRAFT', 1, 4], [$bom['status'], $bom['revision'], count($bom['lines'])]);
        $this->assertMatchesRegularExpression('#^BOM/\d{2}/[IVX]+/001$#', $bom['code']);

        $this->putJson("/api/mrp/boms/{$bom['id']}", ['lines' => $this->lines([$this->cable->id => 5.25])])->assertOk()
            ->assertJsonPath('data.lines.0.qty', 5.25);
        $this->postJson("/api/mrp/boms/{$bom['id']}/activate")->assertOk()->assertJsonPath('data.status', 'ACTIVE');
        // an active BoM is not edited in place
        $this->putJson("/api/mrp/boms/{$bom['id']}", ['lines' => $this->lines()])->assertStatus(422);

        $rev2 = $this->postJson("/api/mrp/boms/{$bom['id']}/revise")->assertCreated()->json('data');
        $this->assertSame([2, 'DRAFT'], [$rev2['revision'], $rev2['status']]);
        $this->putJson("/api/mrp/boms/{$rev2['id']}", ['lines' => $this->lines([$this->cable->id => 6])])->assertOk();
        $this->postJson("/api/mrp/boms/{$rev2['id']}/activate")->assertOk();

        $old = $this->getJson("/api/mrp/boms/{$bom['id']}")->assertOk()->json('data');
        $this->assertSame('ARCHIVED', $old['status']);
        $this->assertEquals(5.25, $old['lines'][0]['qty']);
        $this->assertSame(1, DB::table('mrp_boms')->where(['item_id' => $this->panel->id, 'status' => 'ACTIVE'])->count());
    }

    public function test_a_product_cannot_contain_itself_directly_or_through_another_bom(): void
    {
        $this->actingAsRole('admin_gudang');
        $this->postJson('/api/mrp/boms', ['item_id' => $this->panel->id, 'lines' => [['item_id' => $this->panel->id, 'qty' => 1]]])->assertStatus(422);

        // panel uses cable; a BoM for cable that uses panel closes the loop
        $this->postJson('/api/mrp/boms', ['item_id' => $this->panel->id, 'lines' => $this->lines()])->assertCreated();
        $this->postJson('/api/mrp/boms', ['item_id' => $this->cable->id, 'lines' => [['item_id' => $this->panel->id, 'qty' => 1]]])
            ->assertStatus(422)->assertJsonFragment(['BoM melingkar: KBL.001 → PNL.001 → KBL.001. Produk tidak boleh menjadi komponen dirinya sendiri.']);

        // duplicate component, zero quantity and services are refused too
        $this->postJson('/api/mrp/boms', ['item_id' => $this->box->id, 'lines' => [['item_id' => $this->bolt->id, 'qty' => 1], ['item_id' => $this->bolt->id, 'qty' => 2]]])->assertStatus(422);
        $this->postJson('/api/mrp/boms', ['item_id' => $this->box->id, 'lines' => [['item_id' => $this->bolt->id, 'qty' => 0]]])->assertStatus(422);
        $this->bolt->update(['product_kind' => 'JASA']);
        $this->postJson('/api/mrp/boms', ['item_id' => $this->box->id, 'lines' => [['item_id' => $this->bolt->id, 'qty' => 1]]])->assertStatus(422);
    }

    // ------------------------------------------------------------------ MO

    public function test_mo_calculates_requirements_detects_shortage_and_keeps_its_own_bom_copy(): void
    {
        $mo = $this->mo(10);
        $this->assertMatchesRegularExpression('#^MO/\d{2}/[IVX]+/001$#', $mo['number']);
        $req = collect($mo['components'])->mapWithKeys(fn ($c) => [$c['code'] => [$c['required'], $c['shortage'], $c['status']]])->all();
        $this->assertEquals([
            'KBL.001' => [50.0, 0.0, 'OK'], 'BLT.001' => [80.0, 0.0, 'OK'],
            'TRM.001' => [40.0, 10.0, 'PARTIAL'], 'BOX.001' => [10.0, 0.0, 'OK'],
        ], $req);

        // the BoM changes after the MO was made: the MO is untouched
        $bomId = $mo['mrp_bom_id'];
        $rev2 = $this->postJson("/api/mrp/boms/{$bomId}/revise")->json('data');
        $this->putJson("/api/mrp/boms/{$rev2['id']}", ['lines' => $this->lines([$this->cable->id => 9])])->assertOk();
        $this->postJson("/api/mrp/boms/{$rev2['id']}/activate")->assertOk();
        $again = $this->getJson("/api/mrp/productions/{$mo['id']}")->json('data');
        $this->assertEquals(50.0, collect($again['components'])->firstWhere('code', 'KBL.001')['required']);
        $this->assertTrue($again['bom_changed']);
    }

    public function test_confirm_locks_the_plan_without_touching_stock_and_cancel_needs_a_reason(): void
    {
        $mo = $this->mo(10);
        $this->postJson("/api/mrp/productions/{$mo['id']}/confirm")->assertOk()->assertJsonPath('data.status', 'CONFIRMED');
        // the MO holds nothing itself: the components are asked from the warehouse (Item Request → Delivery Order)
        $this->assertSame([0.0, 0.0, 0.0, 0.0], [$this->reserved($this->cable), $this->reserved($this->bolt), $this->reserved($this->terminal), $this->reserved($this->box)]);
        $this->assertSame(200.0, $this->stock($this->cable));
        $this->postJson("/api/mrp/productions/{$mo['id']}/confirm")->assertStatus(422);

        $this->postJson("/api/mrp/productions/{$mo['id']}/cancel")->assertStatus(422); // a reason is needed once confirmed
        $this->postJson("/api/mrp/productions/{$mo['id']}/cancel", ['reason' => 'Order dibatalkan customer'])->assertOk()->assertJsonPath('data.status', 'CANCELLED');
        $this->assertSame([200.0, 100.0, 30.0, 20.0], [$this->stock($this->cable), $this->stock($this->bolt), $this->stock($this->terminal), $this->stock($this->box)]);
        $this->assertSame([], $this->mrpMoves($mo['id']));
    }

    public function test_invalid_status_changes_are_refused_by_the_backend(): void
    {
        $mo = $this->mo(10);
        $id = $mo['id'];
        $this->postJson("/api/mrp/productions/{$id}/start")->assertStatus(422);
        $this->postJson("/api/mrp/productions/{$id}/finish")->assertStatus(422);
        $this->postJson("/api/mrp/productions/{$id}/validate")->assertStatus(422);
        $this->entry($id, ['kind' => 'OUTPUT', 'qty' => 1], 422); // nothing recorded before In Progress
        $this->postJson("/api/mrp/productions/{$id}/confirm")->assertOk();
        $this->putJson("/api/mrp/productions/{$id}", ['planned_qty' => 20])->assertStatus(422); // plan locked
        $this->postJson("/api/mrp/productions/{$id}/start")->assertOk();
        $this->postJson("/api/mrp/productions/{$id}/finish")->assertStatus(422); // no output yet
        $this->postJson("/api/mrp/productions/{$id}/reverse", ['reason' => 'x'])->assertStatus(422);
    }

    // ------------------------------------------------------------------ posting

    public function test_goods_go_out_through_item_request_and_delivery_order_and_come_in_through_a_receipt(): void
    {
        $this->enoughTerminals();
        $mo = $this->mo(10);
        $this->runToClose($mo['id']);
        // nothing handed over, nothing received: the warehouse is the only door
        $this->postJson("/api/mrp/productions/{$mo['id']}/validate")->assertStatus(422)->assertJsonValidationErrors('warehouse');
        $this->assertSame(200.0, $this->stock($this->cable));

        // the components are asked with one Item Request (still in To Close: back to In Progress first)
        $this->postJson("/api/mrp/productions/{$mo['id']}/request-components")->assertStatus(422);
        $this->postJson("/api/mrp/productions/{$mo['id']}/reopen")->assertOk();
        $ir = $this->issueComponents($mo['id']);
        $lines = collect($this->getJson("/api/item-requests/{$ir['id']}")->json('data.lines'))->mapWithKeys(fn ($l) => [$l['item_id'] => (float) $l['qty']])->all();
        $this->assertEquals([$this->cable->id => 50, $this->bolt->id => 80, $this->terminal->id => 40, $this->box->id => 10], $lines);
        $this->postJson("/api/mrp/productions/{$mo['id']}/request-components")->assertStatus(422); // everything asked already
        // the stock left at the Delivery Order handover, not at the MO
        $this->assertSame([150.0, 20.0, 0.0, 10.0], [$this->stock($this->cable), $this->stock($this->bolt), $this->stock($this->terminal), $this->stock($this->box)]);
        $this->postJson("/api/mrp/productions/{$mo['id']}/finish")->assertOk();
        $this->postJson("/api/mrp/productions/{$mo['id']}/validate")->assertStatus(422)->assertJsonValidationErrors('warehouse'); // no Receipt yet

        // the 9 good panels come in with a Receipt; only that kind of Receipt may be linked, once
        $ri = $this->receive($this->panel, 9);
        $other = $this->receive($this->cable, 1);
        $this->postJson("/api/mrp/productions/{$mo['id']}/receipts", ['no_ri' => $other])->assertStatus(422)->assertJsonValidationErrors('no_ri');
        $this->postJson("/api/mrp/productions/{$mo['id']}/receipts", ['no_ri' => 'RI/TIDAK/ADA'])->assertStatus(422);
        $done = $this->postJson("/api/mrp/productions/{$mo['id']}/receipts", ['no_ri' => $ri])->assertOk()->json('data');
        $this->assertSame($ri, $done['gate']['receipts'][0]['no_ri']);
        $this->assertSame(9.0, $this->stock($this->panel));

        $done = $this->postJson("/api/mrp/productions/{$mo['id']}/validate")->assertOk()->json('data');
        $this->assertEquals(['DONE', 9.0, 3.0], [$done['status'], $done['output_qty'], $done['scrap_qty']]);
        // the MO itself moved nothing: stock is what the Delivery Order and the Receipt did
        $this->assertSame([], $this->mrpMoves($mo['id']));
        // (151: the cable Receipt above came in too, it just cannot be linked to this MO)
        $this->assertSame([151.0, 20.0, 0.0, 10.0, 9.0], [$this->stock($this->cable), $this->stock($this->bolt), $this->stock($this->terminal), $this->stock($this->box), $this->stock($this->panel)]);
        $this->postJson("/api/mrp/productions/{$mo['id']}/validate")->assertStatus(422);
        // a Receipt belongs to one document only
        $mo2 = $this->postJson('/api/mrp/productions', ['item_id' => $this->panel->id, 'planned_qty' => 1])->assertCreated()->json('data');
        $this->postJson("/api/mrp/productions/{$mo2['id']}/confirm")->assertOk();
        $this->postJson("/api/mrp/productions/{$mo2['id']}/start")->assertOk();
        $this->postJson("/api/mrp/productions/{$mo2['id']}/receipts", ['no_ri' => $ri])->assertStatus(422);
    }

    public function test_validation_is_refused_when_the_warehouse_handed_over_less_than_was_used(): void
    {
        $mo = $this->mo(10); // only 30 terminals for 40: the Delivery Order gives 30, the rest goes to a Draft Purchase Request
        $this->postJson("/api/mrp/productions/{$mo['id']}/confirm")->assertOk();
        $this->postJson("/api/mrp/productions/{$mo['id']}/start")->assertOk();
        $this->issueComponents($mo['id']);
        $this->entry($mo['id'], ['kind' => 'CONSUME', 'item_id' => $this->cable->id, 'qty' => 50]);
        $this->entry($mo['id'], ['kind' => 'CONSUME', 'item_id' => $this->terminal->id, 'qty' => 40]);
        $this->entry($mo['id'], ['kind' => 'OUTPUT', 'qty' => 10]);
        $this->postJson("/api/mrp/productions/{$mo['id']}/receipts", ['no_ri' => $this->receive($this->panel, 10)])->assertOk();
        $this->postJson("/api/mrp/productions/{$mo['id']}/finish")->assertOk();
        $this->postJson("/api/mrp/productions/{$mo['id']}/validate")->assertStatus(422)->assertSeeText('TRM.001: dipakai 40, diserahkan gudang 30');
        $this->assertSame('TO_CLOSE', MrpProduction::find($mo['id'])->status);
        $this->assertSame([], $this->mrpMoves($mo['id']));
    }

    public function test_an_mo_through_the_warehouse_is_neither_reversed_nor_marked_in_accurate(): void
    {
        $this->enoughTerminals();
        $mo = $this->mo(10);
        $this->postJson("/api/mrp/productions/{$mo['id']}/confirm")->assertOk();
        $this->postJson("/api/mrp/productions/{$mo['id']}/start")->assertOk();
        $this->issueComponents($mo['id']);
        $this->entry($mo['id'], ['kind' => 'CONSUME', 'item_id' => $this->cable->id, 'qty' => 50]);
        $this->entry($mo['id'], ['kind' => 'OUTPUT', 'qty' => 10]);
        $this->postJson("/api/mrp/productions/{$mo['id']}/receipts", ['no_ri' => $this->receive($this->panel, 10)])->assertOk();
        $this->postJson("/api/mrp/productions/{$mo['id']}/finish")->assertOk();
        $this->postJson("/api/mrp/productions/{$mo['id']}/validate")->assertOk();
        // stock moved through the Delivery Order and the Receipt, which keep their own Accurate reconciliation
        $this->assertSame([], StockwiseNet::manufacturing());
        $this->postJson("/api/mrp/productions/{$mo['id']}/reverse", ['reason' => 'Salah input'])->assertStatus(422);
        $this->postJson("/api/mrp/productions/{$mo['id']}/accurate", ['refs' => 'X'])->assertStatus(422);
    }

    // ------------------------------------------------------------------ UOM

    public function test_alternative_unit_is_converted_with_a_frozen_ratio_and_missing_or_inexact_ones_are_refused(): void
    {
        $mo = $this->mo(10);
        $this->postJson("/api/mrp/productions/{$mo['id']}/confirm")->assertOk();
        $this->postJson("/api/mrp/productions/{$mo['id']}/start")->assertOk();

        $e = $this->entry($mo['id'], ['kind' => 'CONSUME', 'item_id' => $this->cable->id, 'qty' => 0.25, 'unit' => 'ROL'])->json('data.entries.0');
        $this->assertEquals([0.25, 'ROL', 100.0, 25.0, 'MTR'], [$e['qty'], $e['unit'], $e['unit_ratio'], $e['base_qty'], $e['base_unit']]);

        // no conversion set for bolts in rolls: never guessed
        $this->entry($mo['id'], ['kind' => 'CONSUME', 'item_id' => $this->bolt->id, 'qty' => 1, 'unit' => 'ROL'], 422);
        // 0.12345 ROL = 12.345 MTR does not fit the stock's two decimals: refused, not rounded
        $this->entry($mo['id'], ['kind' => 'CONSUME', 'item_id' => $this->cable->id, 'qty' => 0.12345, 'unit' => 'ROL'], 422);

        // the master changes afterwards: the recorded entry keeps 100
        ItemUnitConversion::where('item_id', $this->cable->id)->update(['ratio' => 50]);
        $this->entry($mo['id'], ['kind' => 'CONSUME', 'item_id' => $this->cable->id, 'qty' => 0.5, 'unit' => 'ROL']); // 25 MTR at the new ratio
        $this->assertSame([25.0, 25.0], DB::table('mrp_production_entries')->where(['mrp_production_id' => $mo['id'], 'item_id' => $this->cable->id])->orderBy('id')->pluck('base_qty')->map(fn ($q) => (float) $q)->all());
        $this->assertSame(['100.000000', '50.000000'], DB::table('mrp_production_entries')->where(['mrp_production_id' => $mo['id'], 'item_id' => $this->cable->id])->orderBy('id')->pluck('unit_ratio')->map(fn ($r) => number_format((float) $r, 6, '.', ''))->all());
    }

    public function test_planned_qty_and_bom_quantities_keep_their_decimals(): void
    {
        $this->actingAsRole('admin_gudang');
        $bom = $this->postJson('/api/mrp/boms', ['item_id' => $this->panel->id, 'lines' => [['item_id' => $this->cable->id, 'qty' => '0.125']]])->assertCreated()->json('data');
        $this->postJson("/api/mrp/boms/{$bom['id']}/activate")->assertOk();
        $mo = $this->postJson('/api/mrp/productions', ['item_id' => $this->panel->id, 'planned_qty' => 3])->assertCreated()->json('data');
        $this->assertEquals(0.375, $mo['components'][0]['required']);
        $this->postJson('/api/mrp/productions', ['item_id' => $this->panel->id, 'planned_qty' => 1.005])->assertStatus(422);
        // 0.375 is asked from the warehouse as 0.38 (up to the next 0.01)
        $this->postJson("/api/mrp/productions/{$mo['id']}/confirm")->assertOk();
        $ir = $this->postJson("/api/mrp/productions/{$mo['id']}/request-components")->assertCreated()->json('data');
        $this->assertEquals(0.38, $this->getJson("/api/item-requests/{$ir['id']}")->json('data.lines.0.qty'));
    }

    // ------------------------------------------------------------------ control

    public function test_over_plan_and_extra_items_need_the_validate_permission_and_a_reason(): void
    {
        $mo = $this->mo(10);
        $this->postJson("/api/mrp/productions/{$mo['id']}/confirm")->assertOk();
        $this->postJson("/api/mrp/productions/{$mo['id']}/start")->assertOk();
        $extra = Item::factory()->create(['code' => 'TPE.001', 'unit_id' => $this->bolt->unit_id, 'is_active' => true]);

        $this->actingAsRole('lapangan_gudang');
        $this->entry($mo['id'], ['kind' => 'CONSUME', 'item_id' => $this->cable->id, 'qty' => 50]);
        $this->entry($mo['id'], ['kind' => 'CONSUME', 'item_id' => $this->cable->id, 'qty' => 1], 422);
        $this->entry($mo['id'], ['kind' => 'CONSUME', 'item_id' => $extra->id, 'qty' => 1, 'reason' => 'isolasi'], 422);
        $this->entry($mo['id'], ['kind' => 'OUTPUT', 'qty' => 11], 422);
        $this->entry($mo['id'], ['kind' => 'SCRAP', 'item_id' => $this->bolt->id, 'qty' => 1], 422); // scrap needs a reason

        $this->actingAsRole('admin_gudang');
        $this->entry($mo['id'], ['kind' => 'CONSUME', 'item_id' => $this->cable->id, 'qty' => 1], 422); // reason
        $over = $this->entry($mo['id'], ['kind' => 'CONSUME', 'item_id' => $this->cable->id, 'qty' => 1, 'reason' => 'Kabel terpotong salah'])->json('data');
        $this->assertTrue(collect($over['entries'])->last()['over_plan']);
        $withExtra = $this->entry($mo['id'], ['kind' => 'CONSUME', 'item_id' => $extra->id, 'qty' => 1, 'reason' => 'Isolasi tambahan'])->json('data');
        $this->assertTrue(collect($withExtra['components'])->firstWhere('code', 'TPE.001')['is_extra']);
    }

    public function test_the_same_client_key_records_once_and_entries_are_voided_not_deleted(): void
    {
        $mo = $this->mo(10);
        $this->postJson("/api/mrp/productions/{$mo['id']}/confirm")->assertOk();
        $this->postJson("/api/mrp/productions/{$mo['id']}/start")->assertOk();
        $owner = $this->actingAsRole('lapangan_gudang');
        $payload = ['kind' => 'CONSUME', 'item_id' => $this->bolt->id, 'qty' => 8, 'client_key' => 'form-123'];
        $this->entry($mo['id'], $payload);
        $this->entry($mo['id'], $payload);
        $this->assertSame(1, DB::table('mrp_production_entries')->where('mrp_production_id', $mo['id'])->count());
        $entryId = DB::table('mrp_production_entries')->where('mrp_production_id', $mo['id'])->value('id');

        $this->actingAsRole('lapangan_gudang'); // someone else
        $this->deleteJson("/api/mrp/productions/{$mo['id']}/entries/{$entryId}")->assertStatus(422);
        \Laravel\Sanctum\Sanctum::actingAs($owner);
        $this->deleteJson("/api/mrp/productions/{$mo['id']}/entries/{$entryId}")->assertOk();
        $this->assertNotNull(DB::table('mrp_production_entries')->where('id', $entryId)->value('voided_at'));
    }

    public function test_permissions_are_checked_on_the_backend(): void
    {
        $mo = $this->mo(10);

        $this->actingAsRole('karyawan');
        $this->getJson('/api/mrp/productions')->assertForbidden();
        $this->getJson('/api/mrp/boms')->assertForbidden();

        $this->actingAsRole('bos');
        $this->getJson("/api/mrp/productions/{$mo['id']}")->assertOk();
        $this->postJson('/api/mrp/productions', ['item_id' => $this->panel->id, 'planned_qty' => 1])->assertForbidden();

        $this->actingAsRole('lapangan_gudang');
        $this->postJson('/api/mrp/boms', ['item_id' => $this->box->id, 'lines' => [['item_id' => $this->bolt->id, 'qty' => 1]]])->assertForbidden();
        $this->postJson("/api/mrp/productions/{$mo['id']}/confirm")->assertForbidden();
        $this->postJson("/api/mrp/productions/{$mo['id']}/cancel")->assertForbidden();
        $this->postJson("/api/mrp/productions/{$mo['id']}/validate")->assertForbidden();
        $this->assertSame('DRAFT', MrpProduction::find($mo['id'])->status);
    }

    public function test_shortage_goes_to_a_draft_purchase_request_without_adding_stock(): void
    {
        $mo = $this->mo(10);
        $draft = $this->postJson("/api/mrp/productions/{$mo['id']}/shortage-request")->assertCreated()->json('data');
        $line = DB::table('ppb_draft_lines')->where('ppb_draft_id', $draft['id'])->sole();
        $this->assertSame([$this->terminal->id, 10.0], [(int) $line->item_id, (float) $line->qty]);
        $this->assertStringContainsString($mo['number'], (string) $line->basis);
        $this->assertSame(30.0, $this->stock($this->terminal));
    }
}
