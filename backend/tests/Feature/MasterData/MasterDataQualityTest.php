<?php

namespace Tests\Feature\MasterData;

use App\Models\Department;
use App\Models\Employee;
use App\Models\Item;
use App\Models\ItemUnitConversion;
use App\Models\Unit;
use App\Models\UomCategory;
use App\Models\Vendor;
use App\Models\VendorPrice;
use Database\Seeders\RbacSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Plan step 1.1: a conversion (and a Price List price) set against an item's former base unit is not used
 * until reviewed. Step 1.4: the read-only data-quality report over STOCKWISE's own masters.
 */
class MasterDataQualityTest extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected $seeder = RbacSeeder::class;

    public function test_a_conversion_set_against_a_former_base_unit_is_not_used_until_reviewed(): void
    {
        $this->actingAsRole('super_admin');
        $pcs = Unit::factory()->create(['code' => 'PCS']);
        $box = Unit::factory()->create(['code' => 'BOX']);
        $set = Unit::factory()->create(['code' => 'SET']);
        $item = Item::factory()->create(['unit_id' => $pcs->id]);

        // 1 BOX = 10 PCS, set against PCS
        $this->postJson("/api/items/{$item->id}/unit-conversions", ['unit_id' => $box->id, 'ratio' => 10])->assertCreated();
        $conv = ItemUnitConversion::sole();
        $this->assertSame($pcs->id, $conv->base_unit_id);
        $this->getJson("/api/uom/convert?qty=2&from={$box->id}&to={$pcs->id}&item_id={$item->id}")->assertOk();

        // the base unit becomes SET (from any source): the BOX ratio means something else now
        $item->update(['unit_id' => $set->id]);
        $listed = collect($this->getJson("/api/items/{$item->id}/unit-conversions")->assertOk()->json('data.conversions'))->firstWhere('code', 'BOX');
        $this->assertTrue($listed['needs_review']);
        $this->assertSame('PCS', $listed['set_against']);
        $this->getJson("/api/uom/convert?qty=2&from={$box->id}&to={$set->id}&item_id={$item->id}")->assertStatus(422);
        $this->assertSame(1, $this->check('conversions_to_review')['count']);

        // confirmed for the new base unit: used again
        $this->postJson("/api/items/{$item->id}/unit-conversions/{$conv->id}/confirm")->assertOk();
        $this->getJson("/api/uom/convert?qty=2&from={$box->id}&to={$set->id}&item_id={$item->id}")->assertOk();
        $this->assertSame(0, $this->check('conversions_to_review')['count']);

        // or corrected: saving the ratio again reviews it too
        $item->update(['unit_id' => $pcs->id]);
        $this->postJson("/api/items/{$item->id}/unit-conversions", ['unit_id' => $box->id, 'ratio' => 12])->assertCreated();
        $this->assertSame($pcs->id, $conv->fresh()->base_unit_id);
    }

    public function test_a_price_list_price_is_flagged_when_the_items_base_unit_changes(): void
    {
        $this->actingAsRole('purchasing');
        $pcs = Unit::factory()->create(['code' => 'PCS']);
        $set = Unit::factory()->create(['code' => 'SET']);
        $item = Item::factory()->create(['unit_id' => $pcs->id]);
        $vendor = Vendor::factory()->create();
        $price = $this->postJson('/api/price-list', ['item_id' => $item->id, 'vendor_id' => $vendor->id, 'unit_id' => $pcs->id, 'price' => 1000, 'status' => 'ACTIVE'])->assertCreated()->json('data');
        $this->assertFalse($price['needs_review']);

        $item->update(['unit_id' => $set->id]);
        $row = $this->getJson('/api/price-list/matrix')->json('data.rows.0');
        $this->assertTrue($row['cells'][$vendor->id]['needs_review']);
        // not the lowest while it needs a look
        $this->assertNull($row['lowest_price_id']);
        $this->assertTrue(VendorPrice::sole()->needsReview());
    }

    public function test_the_report_lists_what_needs_a_look_from_stockwise_masters(): void
    {
        $this->actingAsRole('super_admin');
        $pcs = Unit::factory()->create(['code' => 'PCS']);
        Item::factory()->create(['code' => 'A.1', 'unit_id' => null]);
        Item::factory()->create(['code' => 'B.1', 'description' => 'BAUT M10', 'unit_id' => $pcs->id]);
        Item::factory()->create(['code' => 'B.2', 'description' => 'BAUT M10', 'unit_id' => $pcs->id]);
        Vendor::factory()->create(['name' => 'PT. TEKAD JAYA MANDIRI']);
        Vendor::factory()->create(['name' => 'CV TEKAD JAYA MANDIRI']);
        Vendor::factory()->create(['name' => 'PT LAIN SENDIRI']);
        $ops = Department::create(['name' => 'MGR OPERASIONAL']);
        Department::create(['name' => 'MGR. OPERASIONAL']);
        Employee::create(['name' => 'Budi', 'name_normalized' => 'BUDI', 'department_id' => $ops->id, 'is_active' => true]);
        Employee::create(['name' => 'Siti', 'name_normalized' => 'SITI', 'is_active' => true]);

        $this->assertSame(['A.1'], array_column($this->check('items_without_unit')['rows'], 'Code'));
        $dupes = $this->check('duplicate_item_names');
        $this->assertSame(1, $dupes['count']);
        $this->assertSame('B.1, B.2', $dupes['rows'][0]['Codes']);
        $this->assertSame(1, $this->check('similar_vendors')['count']);
        $this->assertSame(1, $this->check('similar_departments')['count']);
        $this->assertSame(['Siti'], array_column($this->check('employees_without_department')['rows'], 'Employee'));
        $this->assertSame(1, $this->check('units_without_category')['count']);
    }

    public function test_the_uom_seed_dry_run_lists_the_plan_and_changes_nothing(): void
    {
        Unit::factory()->create(['code' => 'PCS']);
        $before = Unit::count();

        $this->artisan('stockwise:seed-uom', ['--dry-run' => true])->expectsOutputToContain('Dry run: nothing was changed.')->assertSuccessful();

        $this->assertSame($before, Unit::count());
        $this->assertSame(0, UomCategory::count());
        $this->assertNull(Unit::where('code', 'PCS')->value('uom_category_id'));
    }

    public function test_each_check_follows_the_users_permissions(): void
    {
        $this->actingAsRole('purchasing');
        $keys = array_column($this->getJson('/api/master-data/quality')->assertOk()->json('data'), 'key');
        $this->assertContains('similar_vendors', $keys);
        $this->assertNotContains('similar_departments', $keys);

        $this->actingAsRole('karyawan');
        $this->getJson('/api/master-data/quality')->assertForbidden();
    }

    private function check(string $key): array
    {
        return collect($this->getJson('/api/master-data/quality')->assertOk()->json('data'))->firstWhere('key', $key);
    }
}
