<?php

namespace App\Console\Commands;

use App\Models\Unit;
use App\Models\UomCategory;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * The starting Master UOM: each category with its reference and fixed ratios; a null ratio differs per item.
 * Runs again safely: a unit already placed in a category is left as the user set it.
 */
class SeedUomCommand extends Command
{
    protected $signature = 'stockwise:seed-uom {--dry-run : List what would change, change nothing}';

    protected $description = 'Place the units into UOM categories with their standard ratios';

    private const CATEGORIES = [
        // 1 of the unit = ratio × the first unit of the category (its reference)
        'Unit' => [['PCS', 'Pieces', 1], ['UNIT', 'Unit', 1], ['PSG', 'Pasang', 2], ['SET', 'Set', null], ['PCK', 'Pack', null], ['BOX', 'Box', null], ['DUS', 'Dus', null], ['BK', 'Buku', null],
            ['ROL', 'Roll', null], ['ROLL', 'Roll', null], ['BTG', 'Batang', null], ['BTL', 'Botol', null], ['JRG', 'Jerigen', null], ['KLG', 'Kaleng', null], ['SCK', 'Sak', null], ['TBG', 'Tabung', null],
            ['CARTON', 'Karton', null], ['DOZEN', 'Lusin', 12], ['BAG', 'Kantong', null], ['DRUM', 'Drum', null]],
        'Sheet' => [['LBR', 'Lembar', 1], ['RIM', 'Rim', 500]],
        'Weight' => [['KG', 'Kilogram', 1], ['GR', 'Gram', 0.001], ['TON', 'Ton', 1000]],
        'Length' => [['MTR', 'Meter', 1], ['MM', 'Milimeter', 0.001], ['CMS', 'Centimeter', 0.01], ['CM', 'Centimeter', 0.01], ['C M', 'Centimeter', 0.01], ['KM', 'Kilometer', 1000]],
        'Area' => [['M2', 'Meter persegi', 1], ['CM2', 'Centimeter persegi', 0.0001]],
        'Volume' => [['LTR', 'Liter', 1], ['ML', 'Mililiter', 0.001], ['M3', 'Meter kubik', 1000], ['GLN', 'Galon', null]],
        'Time' => [['HOUR', 'Jam', 1], ['MIN', 'Menit', 0.016667], ['DAY', 'Hari', 24]],
    ];

    /** Measured goods keep three decimals, so a gram or a millimeter still shows in KG or MTR. */
    private const ROUNDING = ['Weight' => 0.001, 'Length' => 0.001, 'Area' => 0.0001, 'Volume' => 0.001, 'Time' => 0.001];

    public function handle(): int
    {
        if ($this->option('dry-run')) {
            return $this->dryRun();
        }
        DB::transaction(function () {
            foreach (self::CATEGORIES as $name => $units) {
                $category = UomCategory::firstOrCreate(['name' => $name]);
                foreach ($units as $i => [$code, $label, $ratio]) {
                    $unit = Unit::firstOrCreate(['code' => $code], ['name' => $label, 'is_active' => true]);
                    if (! $unit->uom_category_id) {
                        $unit->update(['uom_category_id' => $category->id, 'is_reference' => $i === 0, 'ratio' => $ratio, 'rounding' => self::ROUNDING[$name] ?? 0.01]);
                    }
                }
            }
        });
        $this->info('Units placed: '.Unit::whereNotNull('uom_category_id')->count().' of '.Unit::count().'.');

        return self::SUCCESS;
    }

    /** What a run would do: the categories it makes, the units it places or adds, the ones it leaves. Writes nothing. */
    private function dryRun(): int
    {
        $rows = [];
        $counts = ['categories' => 0, 'add' => 0, 'place' => 0, 'keep' => 0];
        foreach (self::CATEGORIES as $name => $units) {
            $exists = UomCategory::where('name', $name)->exists();
            if (! $exists) {
                $counts['categories']++;
            }
            foreach ($units as $i => [$code, $label, $ratio]) {
                $unit = Unit::where('code', $code)->first();
                $action = ! $unit ? 'ADD unit' : ($unit->uom_category_id ? 'keep (already placed)' : 'place');
                $counts[match ($action) { 'ADD unit' => 'add', 'place' => 'place', default => 'keep' }]++;
                $rows[] = [$exists ? $name : "{$name} (new)", $code, $unit?->name ?? $label, $i === 0 ? 'reference' : ($ratio === null ? 'per item' : "{$ratio} × ".$units[0][0]), $action];
            }
        }
        $this->table(['Category', 'Unit', 'Name', 'Ratio', 'Would'], $rows);
        $this->info(sprintf(
            'Summary: %d new categor%s, %d units to add, %d to place, %d already placed (kept).',
            $counts['categories'], $counts['categories'] === 1 ? 'y' : 'ies',
            $counts['add'], $counts['place'], $counts['keep'],
        ));

        $listed = collect(self::CATEGORIES)->flatten(1)->pluck(0)->all();
        $left = Unit::whereNull('uom_category_id')->whereNotIn('code', $listed)->pluck('code');
        if ($left->isNotEmpty()) {
            $this->warn('Left outside any category: '.$left->implode(', '));
        }
        // categories this command does not manage (e.g. leftovers of a test run): reported, never touched
        $unmanaged = UomCategory::whereNotIn('name', array_keys(self::CATEGORIES))->pluck('name');
        if ($unmanaged->isNotEmpty()) {
            $this->warn('Categories not managed by this command (left as is): '.$unmanaged->implode(', '));
        }
        $this->info('Dry run: nothing was changed.');

        return self::SUCCESS;
    }
}
