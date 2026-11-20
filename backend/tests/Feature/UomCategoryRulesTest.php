<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\CategoryUomRule;
use App\Models\Item;
use App\Models\Unit;
use App\Services\Uom\CategoryUomRules;
use App\Services\UomConverter;
use Database\Seeders\RbacSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** UOM per parent item category (docs/audit/uom-parent-category-analysis.md) and the exact conversions. */
class UomCategoryRulesTest extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected $seeder = RbacSeeder::class;

    private Category $electrical;

    private Category $cable;

    private Category $chemical;

    protected function setUp(): void
    {
        parent::setUp();
        $this->artisan('stockwise:seed-uom')->assertSuccessful();
        $this->electrical = Category::create(['name' => 'Electronics & Electricals', 'level' => 1, 'path' => 'Electronics & Electricals', 'is_active' => true]);
        $this->cable = Category::create(['parent_id' => $this->electrical->id, 'name' => 'Cable', 'level' => 2, 'path' => 'Electronics & Electricals > Cable', 'is_active' => true]);
        $this->chemical = Category::create(['name' => 'Chemical', 'level' => 1, 'path' => 'Chemical', 'is_active' => true]);
    }

    private function unit(string $code): Unit
    {
        return Unit::where('code', $code)->firstOrFail();
    }

    private function rules(Category $c, array $codes, string $default): void
    {
        $this->putJson("/api/uom/category-rules/{$c->id}", ['units' => array_map(fn ($code) => ['unit_id' => $this->unit($code)->id, 'is_default' => $code === $default], $codes)])->assertOk();
    }

    private function convert(float $qty, string $from, string $to, ?int $item = null)
    {
        return $this->getJson('/api/uom/convert?'.http_build_query(['qty' => $qty, 'from' => $this->unit($from)->id, 'to' => $this->unit($to)->id, 'item_id' => $item]));
    }

    public function test_standard_conversions_are_exact_including_smaller_units(): void
    {
        $this->actingAsRole('super_admin');
        $c = app(UomConverter::class);
        $factor = fn ($a, $b) => rtrim(rtrim($c->factor($this->unit($a), $this->unit($b)), '0'), '.');

        // 0.016667 used to give 59.9988 MIN per HOUR
        $this->assertSame('60', $factor('HOUR', 'MIN'));
        $this->assertSame('1440', $factor('DAY', 'MIN'));
        $this->assertEquals(1.5, $this->convert(90, 'MIN', 'HOUR')->assertOk()->json('data.result'));
        foreach ([['KG', 'GR', '1000'], ['TON', 'KG', '1000'], ['MTR', 'CMS', '100'], ['MTR', 'MM', '1000'], ['LTR', 'ML', '1000'], ['M3', 'LTR', '1000'],
            ['RIM', 'LBR', '500'], ['DOZEN', 'PCS', '12'], ['PSG', 'PCS', '2'], ['M2', 'CM2', '10000']] as [$a, $b, $want]) {
            $this->assertSame($want, $factor($a, $b), "1 {$a} = {$want} {$b}");
        }
        // two different measures never convert
        $this->convert(1, 'KG', 'LTR')->assertStatus(422)->assertJsonValidationErrors('to');

        // a Smaller unit entered by an admin keeps its typed factor
        $time = $this->unit('HOUR')->uom_category_id;
        $this->postJson('/api/uom/units', ['code' => 'DTK', 'name' => 'Detik', 'uom_category_id' => $time, 'kind' => 'SMALLER', 'factor' => 3600])->assertCreated();
        $this->assertSame('3600', $factor('HOUR', 'DTK'));
        $this->assertSame('SMALLER', collect($this->getJson('/api/uom')->json('data.categories'))->firstWhere('name', 'Time')['units'][3]['kind'] ?? 'SMALLER');
    }

    public function test_a_parent_category_gets_its_own_units_and_default_and_is_validated(): void
    {
        $this->actingAsRole('super_admin');
        $this->rules($this->electrical, ['PCS', 'BOX', 'SET', 'ROL', 'MTR'], 'PCS');
        $this->rules($this->chemical, ['LTR', 'ML', 'JRG', 'DRUM'], 'LTR');

        $list = collect($this->getJson('/api/uom/category-rules')->assertOk()->json('data'))->keyBy('name');
        $this->assertSame(['PCS', 'BOX', 'SET', 'ROL', 'MTR'], collect($list['Electronics & Electricals']['units'])->pluck('code')->all());
        $this->assertSame('LTR', collect($list['Chemical']['units'])->firstWhere('is_default', true)['code']);
        $this->assertSame('SMALLER', collect($list['Chemical']['units'])->firstWhere('code', 'ML')['kind']);
        $this->assertSame('PER_ITEM', collect($list['Chemical']['units'])->firstWhere('code', 'JRG')['kind']);

        $ids = fn (array $codes) => array_map(fn ($c) => ['unit_id' => $this->unit($c)->id], $codes);
        // exactly one default
        $this->putJson("/api/uom/category-rules/{$this->chemical->id}", ['units' => $ids(['LTR', 'ML'])])->assertStatus(422)->assertJsonValidationErrors('units');
        // a derived unit (ML is 1/1000 LTR) is not a base for new items
        $this->putJson("/api/uom/category-rules/{$this->chemical->id}", ['units' => [['unit_id' => $this->unit('ML')->id, 'is_default' => true]]])->assertStatus(422)->assertJsonValidationErrors('units.0.is_default');
        // a suggested ratio only for a per-item unit
        $this->putJson("/api/uom/category-rules/{$this->chemical->id}", ['units' => [['unit_id' => $this->unit('LTR')->id, 'is_default' => true], ['unit_id' => $this->unit('ML')->id, 'suggested_ratio' => 5]]])
            ->assertStatus(422)->assertJsonValidationErrors('units.1.suggested_ratio');
        $this->putJson("/api/uom/category-rules/{$this->chemical->id}", ['units' => [['unit_id' => $this->unit('LTR')->id, 'is_default' => true], ['unit_id' => $this->unit('JRG')->id, 'suggested_ratio' => 20]]])->assertOk();
        $this->assertEquals(20, CategoryUomRule::where('category_id', $this->chemical->id)->where('unit_id', $this->unit('JRG')->id)->value('suggested_ratio'));

        // only who manages units
        $this->actingAsRole('karyawan');
        $this->putJson("/api/uom/category-rules/{$this->chemical->id}", ['units' => []])->assertForbidden();
    }

    public function test_an_item_may_only_use_the_units_of_its_parent_and_a_sub_category_inherits_or_overrides(): void
    {
        $this->actingAsRole('super_admin');
        $this->rules($this->electrical, ['PCS', 'BOX', 'SET'], 'PCS');
        $rules = app(CategoryUomRules::class);

        // by category_id: a sub-category without rules inherits its parent's
        $this->assertSame($this->electrical->id, $rules->forItem($this->cable->id, null)['category_id']);
        $this->assertTrue($rules->allows($this->cable->id, null, $this->unit('BOX')->id));
        $this->assertFalse($rules->allows($this->cable->id, null, $this->unit('MTR')->id));
        // a sub-category with its own rules overrides (cable is sold by the metre)
        $this->rules($this->cable, ['MTR', 'ROL'], 'MTR');
        $this->assertTrue($rules->allows($this->cable->id, null, $this->unit('MTR')->id));
        $this->assertFalse(app(CategoryUomRules::class)->allows($this->cable->id, null, $this->unit('BOX')->id));
        // by the Main Category text (the item form), when there is no category_id
        $this->assertTrue($rules->allows(null, 'Electronics & Electricals', $this->unit('SET')->id));

        $new = fn (array $over) => $this->postJson('/api/items', $over + ['code' => 'ELK.'.random_int(1000, 9999), 'description' => 'Lampu LED', 'accurate_category_induk' => 'Electronics & Electricals', 'unit_id' => $this->unit('PCS')->id]);
        $new([])->assertCreated();
        $new(['unit_id' => $this->unit('KG')->id])->assertStatus(422)->assertJsonValidationErrors('unit_id');
        $this->postJson('/api/items', ['code' => 'ELK.7777', 'description' => 'Kabel NYA', 'category_id' => $this->cable->id, 'unit_id' => $this->unit('MTR')->id])->assertCreated();
        // no category (or one nobody configured) keeps the fixed list of before
        $this->postJson('/api/items', ['code' => 'XXX.0001', 'description' => 'Other', 'unit_id' => $this->unit('LTR')->id])->assertCreated();
    }

    public function test_an_existing_item_outside_the_rules_stays_editable_until_its_unit_or_category_changes(): void
    {
        $this->actingAsRole('super_admin');
        $item = Item::factory()->create(['category_id' => $this->electrical->id, 'unit_id' => $this->unit('KG')->id, 'accurate_category_induk' => 'Electronics & Electricals']);
        $this->rules($this->electrical, ['PCS', 'BOX'], 'PCS');

        $this->putJson("/api/items/{$item->id}", ['description' => 'renamed', 'unit_id' => $this->unit('KG')->id])->assertOk();
        $this->putJson("/api/items/{$item->id}", ['unit_id' => $this->unit('LTR')->id])->assertStatus(422)->assertJsonValidationErrors('unit_id');
        $this->putJson("/api/items/{$item->id}", ['unit_id' => $this->unit('BOX')->id])->assertOk();

        $status = collect($this->getJson('/api/uom/category-rules')->json('data'))->firstWhere('name', 'Electronics & Electricals');
        $this->assertSame('COMPLETE', $status['status']);
    }

    public function test_per_item_ratios_differ_per_item_and_two_measures_are_refused(): void
    {
        $this->actingAsRole('super_admin');
        $lamp = Item::factory()->create(['unit_id' => $this->unit('PCS')->id]);
        $fuse = Item::factory()->create(['unit_id' => $this->unit('PCS')->id]);
        $cable = Item::factory()->create(['unit_id' => $this->unit('MTR')->id]);
        $oil = Item::factory()->create(['unit_id' => $this->unit('KG')->id]);
        $save = fn (Item $i, string $code, float $ratio) => $this->postJson("/api/items/{$i->id}/unit-conversions", ['unit_id' => $this->unit($code)->id, 'ratio' => $ratio]);

        $save($lamp, 'BOX', 12)->assertCreated();
        $save($fuse, 'BOX', 24)->assertCreated();
        $save($cable, 'ROL', 100)->assertCreated();
        $this->assertEquals(24, $this->convert(2, 'BOX', 'PCS', $lamp->id)->assertOk()->json('data.result'));
        $this->assertEquals(48, $this->convert(2, 'BOX', 'PCS', $fuse->id)->assertOk()->json('data.result'));
        $this->assertEquals(250, $this->convert(2.5, 'ROL', 'MTR', $cable->id)->assertOk()->json('data.result'));
        // without the item a BOX says nothing
        $this->convert(1, 'BOX', 'PCS')->assertStatus(422);

        // KG and LTR measure different things; a fixed unit of the same category needs no per-item ratio
        $save($oil, 'LTR', 1.1)->assertStatus(422)->assertJsonValidationErrors('unit_id');
        $save($oil, 'GR', 1000)->assertStatus(422)->assertJsonValidationErrors('unit_id');

        // changing a ratio later does not touch what a document froze
        $frozen = app(UomConverter::class)->documentRatio($lamp->fresh(), $this->unit('BOX'));
        $save($lamp, 'BOX', 10)->assertCreated();
        $this->assertSame('12.000000', $frozen);
        $this->assertSame('10.000000', app(UomConverter::class)->documentRatio($lamp->fresh(), $this->unit('BOX')));
    }

    public function test_the_item_form_options_carry_each_parent_s_units(): void
    {
        $this->actingAsRole('super_admin');
        $this->rules($this->electrical, ['PCS', 'BOX', 'LBR'], 'PCS');
        $data = $this->getJson('/api/items/options')->assertOk()->json('data');
        $this->assertSame([$this->unit('PCS')->id, $this->unit('BOX')->id, $this->unit('LBR')->id], $data['uom_rules']['Electronics & Electricals']['unit_ids']);
        $this->assertSame($this->unit('PCS')->id, $data['uom_rules']['Electronics & Electricals']['default_unit_id']);
        // a unit outside the old fixed list (LBR) is offered because a category allows it
        $this->assertContains('LBR', collect($data['uom'])->pluck('code')->all());
    }
}
