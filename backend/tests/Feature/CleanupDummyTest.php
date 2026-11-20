<?php

namespace Tests\Feature;

use App\Models\Item;
use App\Models\Vendor;
use Database\Seeders\RbacSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * stockwise:cleanup-dummy reads the foreign keys from MySQL's information_schema, so this runs with
 * `composer test:mysql` (database stockwise_test) and is skipped on SQLite.
 */
class CleanupDummyTest extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected $seeder = RbacSeeder::class;

    protected function setUp(): void
    {
        parent::setUp();
        if (DB::getDriverName() !== 'mysql') {
            $this->markTestSkipped('needs MySQL (information_schema)');
        }
    }

    public function test_the_dry_run_deletes_nothing_and_execute_deletes_only_the_sample_set(): void
    {
        $sample = Item::factory()->create(['code' => 'ELK.9001', 'source' => null]);
        $real = Item::factory()->create(['code' => 'ELK.0001', 'source' => 'accurate']);
        Vendor::create(['name' => 'Demo vendor', 'is_active' => true, 'source' => 'demo']);
        $realVendor = Vendor::create(['name' => 'Real vendor', 'is_active' => true, 'source' => 'accurate']);

        $this->artisan('stockwise:cleanup-dummy')->assertSuccessful();
        $this->assertDatabaseHas('items', ['id' => $sample->id]);

        $this->artisan('stockwise:cleanup-dummy --execute')->assertSuccessful();
        $this->assertDatabaseMissing('items', ['id' => $sample->id]);
        $this->assertDatabaseHas('items', ['id' => $real->id]);
        $this->assertDatabaseHas('vendors', ['id' => $realVendor->id]);
        $this->assertSame(0, Vendor::where('source', 'demo')->count());
    }

    public function test_it_refuses_when_a_real_document_hangs_on_a_sample_row(): void
    {
        $vendor = Vendor::create(['name' => 'Demo vendor', 'is_active' => true, 'source' => 'demo']);
        // a real PO (not numbered 9xx) of a demo vendor: purchase_orders.vendor_id cascades, so deleting the vendor would delete it
        DB::table('purchase_orders')->insert(['number' => 'PO/PPB/26/XI/050', 'vendor_id' => $vendor->id, 'status' => 'DRAFT', 'created_at' => now(), 'updated_at' => now()]);

        $this->artisan('stockwise:cleanup-dummy --execute')->assertFailed();
        $this->assertDatabaseHas('vendors', ['id' => $vendor->id]);
        $this->assertDatabaseHas('purchase_orders', ['number' => 'PO/PPB/26/XI/050']);
    }
}
