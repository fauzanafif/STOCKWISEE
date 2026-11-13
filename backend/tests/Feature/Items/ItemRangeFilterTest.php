<?php

namespace Tests\Feature\Items;

use App\Models\Item;
use App\Models\Warehouse;
use App\Services\Inventory\StockLedgerService;
use Database\Seeders\RbacSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

/** Master Barang from–to filters of the number columns: QTY (as shown), combinable with the other filters. */
class ItemRangeFilterTest extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected $seeder = RbacSeeder::class;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        $wh = Warehouse::factory()->create()->id;
        $wh2 = Warehouse::factory()->create()->id;
        $ledger = app(StockLedgerService::class);
        foreach (['A' => [0, 0], 'B' => [5, 0], 'C' => [12, 3], 'D' => [100, 0]] as $code => [$q1, $q2]) {
            $item = Item::factory()->create(['code' => "RNG.{$code}", 'description' => "KERTAS {$code}", 'is_active' => true]);
            $ledger->openingBalance($item->id, $wh, $q1);
            $ledger->openingBalance($item->id, $wh2, $q2);
        }
        // no stock row yet: the QTY shown is Accurate's
        Item::factory()->create(['code' => 'RNG.E', 'description' => 'KERTAS E', 'is_active' => true, 'accurate_qty_onhand' => 40]);
        $this->actingAsRole('admin_gudang');
    }

    private function codes(array $params): array
    {
        $codes = array_column($this->getJson('/api/items?'.http_build_query($params + ['per_page' => 50]))->assertOk()->json('data'), 'code');
        sort($codes);

        return $codes;
    }

    public function test_qty_range_uses_the_qty_shown_over_all_warehouses(): void
    {
        $this->assertSame(['RNG.C', 'RNG.E'], $this->codes(['qty_min' => 10, 'qty_max' => 50])); // C = 12 + 3 = 15, E = Accurate 40
        $this->assertSame(['RNG.A'], $this->codes(['qty_max' => 0]));
        $this->assertSame(['RNG.D'], $this->codes(['qty_min' => 100]));
        $this->assertSame([], $this->codes(['qty_min' => 20, 'qty_max' => 10]));            // from > to: nothing
        $this->assertSame(['RNG.B', 'RNG.C'], $this->codes(['qty_min' => 1, 'qty_max' => 15, 'search' => 'kertas']));
        $this->assertCount(5, $this->codes(['qty_min' => 'abc']));                             // not a number: ignored
        // every item on the page shows a QTY inside the range
        foreach ($this->getJson('/api/items?qty_min=10&qty_max=50')->json('data') as $row) {
            $this->assertTrue($row['stock_qty'] >= 10 && $row['stock_qty'] <= 50);
        }
    }
}
