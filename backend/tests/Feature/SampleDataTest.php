<?php

namespace Tests\Feature;

use App\Models\Item;
use App\Models\User;
use App\Models\Vendor;
use App\Models\Warehouse;
use App\Services\Inventory\OnOrder;
use App\Services\Inventory\StockLedgerService;
use Database\Seeders\RbacSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class SampleDataTest extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected $seeder = RbacSeeder::class;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        $this->artisan('stockwise:seed-uom')->assertSuccessful();
        Vendor::factory()->count(3)->create();
        $this->actingAsRole('super_admin', ['username' => 'superadmin']);
    }

    public function test_every_feature_gets_data_that_shows_on_its_page_and_says_nothing_of_being_sample(): void
    {
        $this->artisan('stockwise:sample-data')->assertSuccessful();

        $this->assertSame(7, $this->getJson('/api/item-requests?per_page=50')->assertOk()->json('meta.total'));
        $this->assertSame(7, $this->getJson('/api/npbg')->assertOk()->json('meta.total'));
        $this->assertCount(5, $this->getJson('/api/ppb-draft-lines')->assertOk()->json('data'));
        $this->assertCount(1, $this->getJson('/api/ppb-saved-drafts')->assertOk()->json('data'));
        $this->getJson('/api/ppb')->assertOk();
        $stages = $this->getJson('/api/po-draft-lines?done=1')->assertOk()->json('meta.stages');
        $this->assertEquals([2, 3, 1, 1], [$stages['SIAP'], $stages['PENAWARAN'], $stages['MENUNGGU_DIREKTUR'], $stages['DIPILIH']]);
        $this->assertSame(7, $this->getJson('/api/ri')->assertOk()->json('meta.total'));
        $this->assertSame(7, $this->getJson('/api/purchase-returns')->assertOk()->json('meta.total'));
        $this->assertSame(7, $this->getJson('/api/price-list/drafts')->assertOk()->json('meta.total'));
        $this->assertSame(11, $this->getJson('/api/price-list?per_page=50')->assertOk()->json('meta.total'));
        $this->assertContains('RTR/26/XI/901', array_column($this->getJson('/api/purchase-returns')->assertOk()->json('data'), 'number'));
        $this->getJson('/api/stock-opnames')->assertOk();
        $this->assertSame(7, $this->getJson('/api/important-requests?per_page=50')->assertOk()->json('meta.total'));

        // alerts: on the page and in their history, popping up for nobody
        $alert = $this->getJson('/api/update-alerts')->assertOk()->json('data.0');
        $this->assertGreaterThanOrEqual(1, $alert['thumbs_count']);
        $this->assertSame([], $this->getJson('/api/update-alerts/due')->json('data'));
        $this->getJson("/api/update-alerts/{$alert['id']}/thumbs-up")->assertOk();

        // the detail pages open too
        $this->getJson('/api/purchase-orders?search=PO/PPB/26/XI/903')->assertOk();
        $ri = DB::table('ri')->where('no_ri', 'RI/MANUAL/26/XI/902')->value('id');
        $this->getJson("/api/ri/{$ri}")->assertOk()->assertJsonPath('data.base_satuan', 'MTR');

        // no word gives it away, anywhere it wrote
        $made = json_decode(Storage::disk('local')->get('sample-data.json'), true);
        foreach ($made as $table => $ids) {
            foreach (DB::table($table)->whereIn('id', $ids)->get() as $row) {
                $this->assertStringNotContainsStringIgnoringCase('dummy', json_encode($row), $table);
                $this->assertStringNotContainsStringIgnoringCase('sample', json_encode($row), $table);
            }
        }
    }

    public function test_real_items_are_untouched_nobody_is_notified_and_remove_leaves_no_trace(): void
    {
        $unit = \App\Models\Unit::where('code', 'PCS')->value('id');
        $real = Item::factory()->create(['code' => 'REAL.1', 'unit_id' => $unit, 'is_active' => true]);
        app(StockLedgerService::class)->openingBalance($real->id, Warehouse::factory()->create()->id, 77);
        $tables = ['price_list_drafts', 'price_list_draft_items', 'price_list_draft_cells', 'vendor_prices', 'vendor_price_histories', 'purchase_return_lines', 'items', 'item_requests', 'item_request_lines', 'npbg', 'ppb', 'ppb_drafts', 'ppb_draft_lines', 'ppb_saved_drafts', 'purchase_orders', 'purchase_order_items', 'purchase_order_quotes', 'purchase_order_item_vendors', 'ri', 'purchase_returns', 'stock_opnames', 'important_requests', 'update_alerts', 'update_alert_views', 'item_unit_conversions', 'stock_movements', 'inventory', 'vendors'];
        $before = collect($tables)->mapWithKeys(fn ($t) => [$t => DB::table($t)->count()])->all();
        $notes = DB::table('notifications')->count();

        $this->artisan('stockwise:sample-data')->assertSuccessful();
        $this->assertSame(77.0, (float) DB::table('inventory')->where('item_id', $real->id)->sum('actual_qty'));
        $this->assertArrayNotHasKey($real->id, OnOrder::byItem());
        $this->assertSame($notes, DB::table('notifications')->count(), 'nobody is told');
        $this->artisan('stockwise:sample-data')->assertFailed(); // not twice

        $this->artisan('stockwise:sample-data --remove')->assertSuccessful();
        $this->assertSame($before, collect($tables)->mapWithKeys(fn ($t) => [$t => DB::table($t)->count()])->all());
        $this->assertSame(77.0, (float) DB::table('inventory')->where('item_id', $real->id)->sum('actual_qty'));
        $this->artisan('stockwise:sample-data --remove')->assertFailed(); // nothing recorded
    }
}
