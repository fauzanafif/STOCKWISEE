<?php

namespace Tests\Feature;

use App\Models\Item;
use App\Models\Unit;
use App\Models\UomCategory;
use Database\Seeders\RbacSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class UomTest extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected $seeder = RbacSeeder::class;

    private function unit(string $code): Unit
    {
        return Unit::where('code', $code)->firstOrFail();
    }

    private function convert(float $qty, string $from, string $to, ?int $item = null)
    {
        return $this->getJson('/api/uom/convert?'.http_build_query(['qty' => $qty, 'from' => $this->unit($from)->id, 'to' => $this->unit($to)->id, 'item_id' => $item]));
    }

    public function test_units_convert_only_inside_their_category_and_a_pack_needs_its_item(): void
    {
        $this->artisan('stockwise:seed-uom')->assertSuccessful();
        $this->artisan('stockwise:seed-uom')->assertSuccessful(); // safe to run again
        $this->actingAsRole('super_admin');

        $tree = collect($this->getJson('/api/uom')->assertOk()->json('data.categories'))->keyBy('name');
        $this->assertSame(['Area', 'Length', 'Sheet', 'Time', 'Unit', 'Volume', 'Weight'], $tree->keys()->sort()->values()->all());
        foreach ($tree as $name => $c) {
            $this->assertCount(1, array_filter($c['units'], fn ($u) => $u['is_reference']), "{$name}: one reference");
        }

        $this->assertEquals(2500, $this->convert(2.5, 'KG', 'GR')->assertOk()->json('data.result'));
        $this->assertEquals(150, $this->convert(1.5, 'MTR', 'CM')->assertOk()->json('data.result'));
        $this->assertEquals(0.5, $this->convert(250, 'LBR', 'RIM')->assertOk()->json('data.result'));
        $this->assertEquals(6, $this->convert(3, 'PSG', 'PCS')->assertOk()->json('data.result'));
        // measured goods keep small amounts; the target unit's rounding decides where a result lands
        $this->assertEquals(0.001, $this->convert(1, 'GR', 'KG')->assertOk()->json('data.result'));
        $this->assertEquals(0.5, $this->convert(1, 'PCS', 'PSG')->assertOk()->json('data.result'));
        $psg = $this->unit('PSG');
        $this->putJson("/api/uom/units/{$psg->id}", ['code' => 'PSG', 'name' => 'Pasang', 'uom_category_id' => $psg->uom_category_id, 'kind' => 'BIGGER', 'factor' => 2, 'rounding' => 1])->assertOk();
        $this->assertEquals(1, $this->convert(1, 'PCS', 'PSG')->assertOk()->json('data.result'));
        $this->assertEquals(2, $this->convert(3.2, 'PCS', 'PSG')->assertOk()->json('data.result'));
        $this->putJson("/api/uom/units/{$psg->id}", ['code' => 'PSG', 'name' => 'Pasang', 'uom_category_id' => $psg->uom_category_id, 'kind' => 'BIGGER', 'factor' => 2, 'rounding' => 0])->assertStatus(422)->assertJsonValidationErrors('rounding');
        // another category, or a pack with nothing to say how big it is
        $this->convert(1, 'KG', 'MTR')->assertStatus(422)->assertJsonValidationErrors('to');
        $this->convert(1, 'PCK', 'PCS')->assertStatus(422)->assertJsonValidationErrors('to');

        // for this item a pack is 10 pieces; for another item it still is not known
        $a = Item::factory()->create(['code' => 'UOM.A', 'unit_id' => $this->unit('PCS')->id]);
        $b = Item::factory()->create(['code' => 'UOM.B', 'unit_id' => $this->unit('PCS')->id]);
        $this->postJson("/api/items/{$a->id}/unit-conversions", ['unit_id' => $this->unit('PCK')->id, 'ratio' => 0])->assertStatus(422);
        $this->postJson("/api/items/{$a->id}/unit-conversions", ['unit_id' => $this->unit('PCS')->id, 'ratio' => 5])->assertStatus(422)->assertJsonValidationErrors('unit_id');
        $saved = $this->postJson("/api/items/{$a->id}/unit-conversions", ['unit_id' => $this->unit('PCK')->id, 'ratio' => 10])->assertCreated()->json('data.id');
        $this->assertEquals(30, $this->convert(3, 'PCK', 'PCS', $a->id)->assertOk()->json('data.result'));
        $this->assertEquals(0.5, $this->convert(5, 'PCS', 'PCK', $a->id)->assertOk()->json('data.result'));
        $this->convert(1, 'PCK', 'PCS', $b->id)->assertStatus(422);
        // a roll of this item can be counted in meters, an item's own fact across categories
        $this->postJson("/api/items/{$a->id}/unit-conversions", ['unit_id' => $this->unit('MTR')->id, 'ratio' => 0.5])->assertCreated();
        $this->assertEquals(20, $this->convert(1, 'PCK', 'MTR', $a->id)->assertOk()->json('data.result'));

        $this->deleteJson("/api/items/{$b->id}/unit-conversions/{$saved}")->assertNotFound();
        $this->deleteJson("/api/items/{$a->id}/unit-conversions/{$saved}")->assertOk();
        $this->convert(1, 'PCK', 'PCS', $a->id)->assertStatus(422);
    }

    public function test_accurate_ratios_show_for_the_item_and_are_read_only(): void
    {
        $this->artisan('stockwise:seed-uom')->assertSuccessful();
        if (! Schema::hasTable('accurate_item')) {
            Schema::create('accurate_item', function ($t) {
                $t->string('ITEMNO');
                $t->string('UNIT2')->nullable();
                $t->string('UNIT3')->nullable();
                $t->decimal('RATIO2', 18, 4)->nullable();
                $t->decimal('RATIO3', 18, 4)->nullable();
            });
        }
        DB::table('accurate_item')->insert(['ITEMNO' => 'AUT.0209', 'UNIT2' => 'SET', 'RATIO2' => 9]);
        $this->actingAsRole('super_admin');
        $item = Item::factory()->create(['code' => 'AUT.0209', 'unit_id' => $this->unit('PCS')->id]);

        $shown = $this->getJson("/api/items/{$item->id}/unit-conversions")->assertOk()->json('data');
        $this->assertSame(['PCS', 'SET', 9.0, 'ACCURATE'], [$shown['item']['unit'], $shown['conversions'][0]['code'], (float) $shown['conversions'][0]['ratio'], $shown['conversions'][0]['source']]);
        $this->assertEquals(18, $this->convert(2, 'SET', 'PCS', $item->id)->assertOk()->json('data.result'));
        $this->postJson("/api/items/{$item->id}/unit-conversions", ['unit_id' => $this->unit('SET')->id, 'ratio' => 3])->assertStatus(422)->assertJsonValidationErrors('unit_id');
    }

    public function test_the_master_keeps_one_reference_and_protects_units_in_use(): void
    {
        $this->artisan('stockwise:seed-uom')->assertSuccessful();
        $this->actingAsRole('super_admin');
        $weight = UomCategory::where('name', 'Weight')->first();

        // bigger and smaller, the way Odoo enters them
        $this->postJson('/api/uom/units', ['code' => 'kwintal', 'name' => 'Kwintal', 'uom_category_id' => $weight->id, 'kind' => 'BIGGER', 'factor' => 100])->assertCreated()->assertJsonPath('data.code', 'KWINTAL');
        $this->postJson('/api/uom/units', ['code' => 'ons', 'name' => 'Ons', 'uom_category_id' => $weight->id, 'kind' => 'SMALLER', 'factor' => 10])->assertCreated();
        $this->assertEquals(10, $this->convert(1, 'KG', 'ONS')->assertOk()->json('data.result'));
        $this->assertEquals(1000, $this->convert(1, 'KWINTAL', 'ONS')->assertOk()->json('data.result'));

        $this->postJson('/api/uom/units', ['code' => 'X1', 'name' => 'X', 'uom_category_id' => $weight->id, 'kind' => 'REFERENCE'])->assertStatus(422)->assertJsonValidationErrors('kind');
        $this->postJson('/api/uom/units', ['code' => 'KG', 'name' => 'dup'])->assertStatus(422)->assertJsonValidationErrors('code');
        $this->postJson('/api/uom/units', ['code' => 'X2', 'name' => 'X', 'uom_category_id' => $weight->id, 'kind' => 'BIGGER'])->assertStatus(422)->assertJsonValidationErrors('factor');

        // a new category needs its reference before ratios mean anything
        $new = $this->postJson('/api/uom/categories', ['name' => 'Shift'])->assertCreated()->json('data.id');
        $this->postJson('/api/uom/units', ['code' => 'JAM', 'name' => 'Jam', 'uom_category_id' => $new, 'kind' => 'BIGGER', 'factor' => 60])->assertStatus(422)->assertJsonValidationErrors('kind');
        $this->postJson('/api/uom/units', ['code' => 'MNT', 'name' => 'Menit', 'uom_category_id' => $new, 'kind' => 'REFERENCE'])->assertCreated();
        $this->deleteJson("/api/uom/categories/{$new}")->assertStatus(422);

        // the reference the others count against stays; a unit in use keeps its code and stays active
        $kg = $this->unit('KG');
        $this->putJson("/api/uom/units/{$kg->id}", ['code' => 'KG', 'name' => 'Kilogram', 'uom_category_id' => $weight->id, 'kind' => 'BIGGER', 'factor' => 2])->assertStatus(422)->assertJsonValidationErrors('kind');
        $this->putJson("/api/uom/units/{$kg->id}", ['code' => 'KG', 'name' => 'Kilo', 'uom_category_id' => $weight->id, 'kind' => 'REFERENCE'])->assertOk()->assertJsonPath('data.name', 'Kilo');
        Item::factory()->create(['code' => 'UOM.K', 'unit_id' => $kg->id]);
        $this->putJson("/api/uom/units/{$kg->id}", ['code' => 'KGS', 'name' => 'Kilo', 'uom_category_id' => $weight->id, 'kind' => 'REFERENCE'])->assertStatus(422)->assertJsonValidationErrors('code');
        $this->putJson("/api/uom/units/{$kg->id}", ['code' => 'KG', 'name' => 'Kilo', 'uom_category_id' => $weight->id, 'kind' => 'REFERENCE', 'is_active' => false])->assertStatus(422)->assertJsonValidationErrors('is_active');
    }

    public function test_only_who_manages_units_changes_them(): void
    {
        $this->artisan('stockwise:seed-uom')->assertSuccessful();
        $this->actingAsRole('karyawan');
        $this->getJson('/api/uom')->assertForbidden();
        $this->postJson('/api/uom/categories', ['name' => 'Nope'])->assertForbidden();
    }
}
