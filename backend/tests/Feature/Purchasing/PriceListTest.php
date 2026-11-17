<?php

namespace Tests\Feature\Purchasing;

use App\Models\Item;
use App\Models\ItemUnitConversion;
use App\Models\Ppb;
use App\Models\PurchaseOrder;
use App\Models\PurchaseOrderItem;
use App\Models\PurchaseOrderQuote;
use App\Models\Unit;
use App\Models\Vendor;
use App\Models\VendorPrice;
use App\Models\VendorPriceHistory;
use Database\Seeders\RbacSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** Price List: Item × Vendor standing prices, their history, and their place beside the PR / PO flow. */
class PriceListTest extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected $seeder = RbacSeeder::class;

    private Unit $pcs;

    private Unit $pck;

    protected function setUp(): void
    {
        parent::setUp();
        $this->pcs = Unit::factory()->create(['code' => 'PCS']);
        $this->pck = Unit::factory()->create(['code' => 'PCK']);
    }

    private function item(string $code): Item
    {
        $item = Item::factory()->create(['code' => $code, 'unit_id' => $this->pcs->id, 'is_active' => true]);
        // for this item: 1 PCK = 10 PCS
        ItemUnitConversion::create(['item_id' => $item->id, 'unit_id' => $this->pck->id, 'ratio' => 10]);

        return $item;
    }

    private function add(Item $item, Vendor $vendor, float $price, array $extra = []): array
    {
        return $this->postJson('/api/price-list', ['item_id' => $item->id, 'vendor_id' => $vendor->id, 'unit_id' => $this->pcs->id, 'price' => $price, 'status' => 'ACTIVE'] + $extra)
            ->assertCreated()->json('data');
    }

    public function test_one_item_many_vendors_one_vendor_many_items_and_items_without_a_price(): void
    {
        $this->actingAsRole('purchasing');
        $bearing = $this->item('BRG.6204');
        $kabel = $this->item('KBL.NYA');
        $regulator = $this->item('REG.GAS');
        [$a, $b, $c] = Vendor::factory()->count(3)->create();

        $this->add($bearing, $a, 25000);
        $cheapest = $this->add($bearing, $b, 23500);
        $this->add($kabel, $a, 150000);
        $this->add($kabel, $c, 145000);

        $m = $this->getJson('/api/price-list/matrix')->assertOk()->json('data');
        // every Master Item is a row, priced or not; the vendor columns are the ones with prices
        $this->assertSame(['BRG.6204', 'KBL.NYA', 'REG.GAS'], array_column(array_column($m['rows'], 'item'), 'code'));
        $this->assertEqualsCanonicalizing([$a->id, $b->id, $c->id], array_column($m['vendors'], 'id'));
        $row = collect($m['rows'])->firstWhere('item.code', 'BRG.6204');
        $this->assertEquals(25000, $row['cells'][$a->id]['price']);
        $this->assertEquals(23500, $row['cells'][$b->id]['price']);
        $this->assertArrayNotHasKey($c->id, $row['cells']);
        $this->assertSame($cheapest['id'], $row['lowest_price_id']);
        $this->assertSame([], (array) collect($m['rows'])->firstWhere('item.code', 'REG.GAS')['cells']);

        // the items without a price, and one vendor's items
        $none = $this->getJson('/api/price-list/matrix?status=none')->json('data.rows');
        $this->assertSame(['REG.GAS'], array_column(array_column($none, 'item'), 'code'));
        $atA = $this->getJson('/api/price-list/matrix?'.http_build_query(['vendor_ids' => [$a->id]]))->json('data');
        $this->assertSame(['BRG.6204', 'KBL.NYA'], array_column(array_column($atA['rows'], 'item'), 'code'));
        $this->assertSame([$a->id], array_column($atA['vendors'], 'id'));

        // the list: one row per price, searchable and sortable
        $list = $this->getJson('/api/price-list?search=BRG&sort=price&dir=asc')->assertOk()->json('data');
        $this->assertEquals([23500, 25000], array_column($list, 'price'));
    }

    public function test_a_price_is_checked_before_it_is_kept(): void
    {
        $this->actingAsRole('purchasing');
        $item = $this->item('BRG.1');
        $vendor = Vendor::factory()->create();
        $base = ['item_id' => $item->id, 'vendor_id' => $vendor->id, 'unit_id' => $this->pcs->id, 'price' => 1000];

        $this->postJson('/api/price-list', ['price' => 0] + $base)->assertStatus(422)->assertJsonValidationErrors('price');
        $this->postJson('/api/price-list', ['item_id' => 999999] + $base)->assertStatus(422)->assertJsonValidationErrors('item_id');
        $inactive = Vendor::factory()->create(['is_active' => false]);
        $this->postJson('/api/price-list', ['vendor_id' => $inactive->id] + $base)->assertStatus(422)->assertJsonValidationErrors('vendor_id');
        // a unit the item cannot be bought in
        $ltr = Unit::factory()->create(['code' => 'LTR']);
        $this->postJson('/api/price-list', ['unit_id' => $ltr->id] + $base)->assertStatus(422)->assertJsonValidationErrors('unit_id');
        $this->postJson('/api/price-list', ['valid_from' => '2026-12-01', 'valid_until' => '2026-11-01'] + $base)->assertStatus(422)->assertJsonValidationErrors('valid_until');

        // the pack keeps its ratio to the item's own unit
        $pack = $this->postJson('/api/price-list', ['unit_id' => $this->pck->id] + $base)->assertCreated()->json('data');
        $this->assertEquals(10, $pack['unit_ratio']);
        $this->assertSame('PCK', $pack['unit']);

        // the same item, vendor, unit and minimum twice is refused; another minimum is a tier
        $this->postJson('/api/price-list', $base)->assertCreated();
        $this->postJson('/api/price-list', ['price' => 1100] + $base)->assertStatus(422)->assertJsonValidationErrors('price');
        $this->postJson('/api/price-list', ['price' => 900, 'min_qty' => 100] + $base)->assertCreated();
        $this->assertSame(3, VendorPrice::count());
    }

    public function test_every_change_is_kept_in_the_history_and_a_deactivated_price_leaves_the_matrix(): void
    {
        $user = $this->actingAsRole('purchasing');
        $item = $this->item('BRG.2');
        $vendor = Vendor::factory()->create();
        $p = $this->add($item, $vendor, 1000, ['lead_time_days' => 7]);

        $this->putJson("/api/price-list/{$p['id']}", ['vendor_id' => $vendor->id, 'unit_id' => $this->pcs->id, 'price' => 1250, 'status' => 'ACTIVE', 'lead_time_days' => 10, 'change_note' => 'Harga naik'])->assertOk()
            ->assertJsonPath('data.price', 1250);
        // saving the same values again writes nothing
        $this->putJson("/api/price-list/{$p['id']}", ['vendor_id' => $vendor->id, 'unit_id' => $this->pcs->id, 'price' => 1250, 'status' => 'ACTIVE', 'lead_time_days' => 10])->assertOk();
        // the item of a price stays
        $this->putJson("/api/price-list/{$p['id']}", ['item_id' => $item->id, 'vendor_id' => $vendor->id, 'unit_id' => $this->pcs->id, 'price' => 1300])->assertStatus(422);

        $this->postJson("/api/price-list/{$p['id']}/archive", ['note' => 'Vendor tutup'])->assertOk()->assertJsonPath('data.status', 'ARCHIVED');
        $this->postJson("/api/price-list/{$p['id']}/archive")->assertStatus(422);

        $history = $this->getJson("/api/price-list/{$p['id']}/history")->assertOk()->json('data');
        $this->assertSame(['ARCHIVE', 'UPDATE', 'CREATE'], array_column($history, 'action'));
        $this->assertEquals([1000, 1250], [$history[1]['old_price'], $history[1]['new_price']]);
        $this->assertSame([7, 10], $history[1]['changes']['lead_time_days']);
        $this->assertSame('Harga naik', $history[1]['note']);
        $this->assertSame($user->name, $history[1]['user']);

        // archived: not a reference, not in the matrix, still in the list when asked for
        $this->assertSame([], (array) $this->getJson('/api/price-list/matrix')->json('data.rows.0.cells'));
        $this->assertSame([], $this->getJson('/api/price-list')->json('data'));
        $this->assertCount(1, $this->getJson('/api/price-list?status=ARCHIVED')->json('data'));

        // brought back: one more history row, nothing overwritten
        $this->putJson("/api/price-list/{$p['id']}", ['vendor_id' => $vendor->id, 'unit_id' => $this->pcs->id, 'price' => 1250, 'status' => 'DRAFT'])->assertOk();
        $this->assertSame(['RESTORE', 'ARCHIVE', 'UPDATE', 'CREATE'], VendorPriceHistory::orderByDesc('id')->pluck('action')->all());
    }

    public function test_an_active_price_past_its_valid_until_reads_as_expired(): void
    {
        $this->actingAsRole('purchasing');
        $item = $this->item('BRG.3');
        [$a, $b] = Vendor::factory()->count(2)->create();
        $this->add($item, $a, 1000, ['valid_until' => now()->subDay()->toDateString()]);
        $this->add($item, $b, 1100, ['valid_until' => now()->addMonth()->toDateString()]);

        $row = $this->getJson('/api/price-list/matrix')->json('data.rows.0');
        $this->assertSame('EXPIRED', $row['cells'][$a->id]['status']);
        $this->assertSame('ACTIVE', $row['cells'][$b->id]['status']);
        // the cheapest valid price is the one still valid, not the expired one
        $this->assertSame($row['cells'][$b->id]['id'], $row['lowest_price_id']);
        $this->assertCount(1, $this->getJson('/api/price-list?status=EXPIRED')->json('data'));
        $this->assertCount(1, $this->getJson('/api/price-list/matrix?status=expired')->json('data.rows'));
    }

    public function test_a_big_price_list_reads_one_page_in_a_few_queries(): void
    {
        $this->actingAsRole('purchasing');
        $vendors = Vendor::factory()->count(40)->create();
        $now = now();
        // 1 500 items, 6 000 prices
        $items = collect(range(1, 1500))->map(fn ($i) => ['code' => sprintf('BIG.%04d', $i), 'description' => "ITEM {$i}", 'description_normalized' => "ITEM {$i}", 'unit_id' => $this->pcs->id, 'is_active' => true, 'item_type' => 'CONSUMABLE', 'created_at' => $now, 'updated_at' => $now]);
        foreach ($items->chunk(500) as $chunk) {
            Item::insert($chunk->all());
        }
        $ids = Item::where('code', 'like', 'BIG.%')->pluck('id');
        $prices = [];
        foreach ($ids as $n => $id) {
            foreach ($vendors->slice($n % 37, 4) as $v) {
                $prices[] = ['item_id' => $id, 'vendor_id' => $v->id, 'unit_id' => $this->pcs->id, 'unit_ratio' => 1, 'price' => 1000 + $n, 'min_qty' => 1, 'status' => 'ACTIVE', 'created_at' => $now, 'updated_at' => $now];
            }
        }
        foreach (array_chunk($prices, 1000) as $chunk) {
            VendorPrice::insert($chunk);
        }

        DB::flushQueryLog();
        DB::enableQueryLog();
        $m = $this->getJson('/api/price-list/matrix?per_page=50&page=3')->assertOk()->json('data');
        $queries = count(DB::getQueryLog());

        $this->assertCount(50, $m['rows']);
        $this->assertSame(1500, $m['meta']['total']);
        // only this page's prices are read: never one query per row or per cell
        $this->assertLessThanOrEqual(12, $queries, "{$queries} queries");
        $this->assertSame(200, collect($m['rows'])->sum('price_count'));

        $this->getJson('/api/price-list?per_page=100&sort=price&dir=desc')->assertOk()->assertJsonPath('meta.total', 6000);
    }

    public function test_only_purchasing_manages_prices(): void
    {
        $item = $this->item('BRG.4');
        $vendor = Vendor::factory()->create();
        $body = ['item_id' => $item->id, 'vendor_id' => $vendor->id, 'unit_id' => $this->pcs->id, 'price' => 1000];

        $this->actingAsRole('karyawan');
        $this->getJson('/api/price-list/matrix')->assertForbidden();
        $this->postJson('/api/price-list', $body)->assertForbidden();
        $this->actingAsRole('manager');
        $this->getJson('/api/price-list')->assertForbidden();

        $this->actingAsRole('purchasing');
        $this->postJson('/api/price-list', $body)->assertCreated();
        $this->getJson("/api/price-list/items/{$item->id}/units")->assertOk()->assertJsonPath('data.base', 'PCS')
            ->assertJsonCount(2, 'data.units');
    }

    public function test_the_purchase_request_flow_reads_the_prices_and_a_po_keeps_its_own_price(): void
    {
        // an approved Purchase Request line, as in the Price Quotation flow
        $this->actingAsRole('super_admin');
        $item = $this->item('BRG.5');
        $this->postJson('/api/ppb', ['no_ppb' => 'PPB/PL/001', 'tgl_ppb' => now()->toDateString(), 'kode_barang' => $item->code, 'deskripsi_barang' => 'Bearing', 'kuantitas' => 5])->assertCreated();
        $ppb = Ppb::where('no_ppb', 'PPB/PL/001')->sole();
        $this->actingAsRole('manager');
        $this->postJson("/api/ppb/{$ppb->id}/approval", ['action' => 'APPROVE'])->assertOk();
        $this->actingAsRole('direktur');
        $this->postJson("/api/ppb/{$ppb->id}/approval", ['action' => 'APPROVE'])->assertOk();
        $line = PurchaseOrderItem::where('approved_ppb_id', $ppb->id)->sole();
        [$a, $b] = Vendor::factory()->count(2)->create();

        // the Price List of the item: a reference for Purchasing, with each price's status (not taken as valid)
        $this->actingAsRole('purchasing');
        $this->add($item, $a, 900);
        $this->add($item, $b, 950, ['valid_until' => now()->subDay()->toDateString()]);
        $ref = $this->getJson('/api/price-list/reference?'.http_build_query(['item_ids' => [$item->id]]))->assertOk()->json("data.{$item->id}");
        $this->assertSame([['vendor' => $a->name, 'status' => 'ACTIVE'], ['vendor' => $b->name, 'status' => 'EXPIRED']],
            array_map(fn ($r) => ['vendor' => $r['vendor'], 'status' => $r['status']], $ref));
        // no RFQ / quotation is made for the Purchase Request by the Price List
        $this->assertSame(0, PurchaseOrderQuote::count());

        // Purchasing checks and enters the price, the Director picks, the PO is made
        $this->postJson('/api/po-draft-lines/to-quotation', ['line_ids' => [$line->id], 'vendor_ids' => [$a->id]])->assertOk();
        $this->putJson("/api/po-draft-lines/{$line->id}/quotes", ['vendor_id' => $a->id, 'unit_price' => 900])->assertOk();
        $this->postJson('/api/po-draft-lines/submit-quotation', ['line_ids' => [$line->id]])->assertOk();
        $this->actingAsRole('direktur');
        $quote = $this->getJson('/api/po-draft-lines?stage=MENUNGGU_DIREKTUR')->json('data.0.quotes.0.id');
        $this->postJson("/api/po-draft-lines/{$line->id}/choose", ['quote_id' => $quote])->assertOk();
        $this->actingAsRole('purchasing');
        $po = $this->postJson('/api/po-draft-lines/submit', ['line_ids' => [$line->id], 'vendor_id' => $a->id])->assertCreated()->json('data');

        // a later Price List change leaves the PO as it was
        $price = VendorPrice::where('vendor_id', $a->id)->sole();
        $this->putJson("/api/price-list/{$price->id}", ['vendor_id' => $a->id, 'unit_id' => $this->pcs->id, 'price' => 1500, 'status' => 'ACTIVE'])->assertOk();
        $this->assertEquals(900, (float) PurchaseOrder::find($po['id'])->items()->sole()->unit_price);
    }
}
