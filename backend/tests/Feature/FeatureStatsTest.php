<?php

namespace Tests\Feature;

use App\Models\Item;
use Database\Seeders\RbacSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** The figures of the Dashboard's Overview cards: one set per feature, only for the features the user may open. */
class FeatureStatsTest extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected $seeder = RbacSeeder::class;

    public function test_every_feature_card_gets_its_figures_by_the_users_permissions(): void
    {
        Item::factory()->count(3)->create(['product_kind' => 'BARANG', 'is_active' => true, 'unit_id' => null]);

        $this->actingAsRole('admin_gudang');
        $d = $this->getJson('/api/dashboard/feature-stats')->assertOk()->json('data');
        $this->assertSame(['Active items', 3], [$d['/items?kind=BARANG'][0]['label'], $d['/items?kind=BARANG'][0]['value']]);
        $this->assertSame(['No unit', 3, 'warn'], array_values($d['/items?kind=BARANG'][1]));
        foreach (['/npbg', '/uom', '/stock-card', '/used-returns', '/stpp'] as $path) {
            $this->assertArrayHasKey($path, $d, $path);
        }
        // Gudang may not open Purchase Order or Purchase Information pages: their figures are not sent
        $this->assertArrayNotHasKey('/price-list', $d);
        $this->assertArrayNotHasKey('/purchase-orders/siap-po', $d);

        $this->actingAsRole('karyawan');
        $this->assertSame([], (array) $this->getJson('/api/dashboard/feature-stats')->assertOk()->json('data'));
    }
}
