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
    protected $signature = 'stockwise:seed-uom';

    protected $description = 'Place the units into UOM categories with their standard ratios';

    private const CATEGORIES = [
        // 1 of the unit = ratio × the first unit of the category (its reference)
        'Unit' => [['PCS', 'Pieces', 1], ['PSG', 'Pasang', 2], ['SET', 'Set', null], ['PCK', 'Pack', null], ['BOX', 'Box', null], ['DUS', 'Dus', null], ['BK', 'Buku', null],
            ['ROL', 'Roll', null], ['ROLL', 'Roll', null], ['BTG', 'Batang', null], ['BTL', 'Botol', null], ['JRG', 'Jerigen', null], ['KLG', 'Kaleng', null], ['SCK', 'Sak', null], ['TBG', 'Tabung', null]],
        'Sheet' => [['LBR', 'Lembar', 1], ['RIM', 'Rim', 500]],
        'Weight' => [['KG', 'Kilogram', 1], ['GR', 'Gram', 0.001], ['TON', 'Ton', 1000]],
        'Length' => [['MTR', 'Meter', 1], ['MM', 'Milimeter', 0.001], ['CMS', 'Centimeter', 0.01], ['CM', 'Centimeter', 0.01], ['C M', 'Centimeter', 0.01], ['KM', 'Kilometer', 1000]],
        'Area' => [['M2', 'Meter persegi', 1], ['CM2', 'Centimeter persegi', 0.0001]],
        'Volume' => [['LTR', 'Liter', 1], ['ML', 'Mililiter', 0.001], ['M3', 'Meter kubik', 1000], ['GLN', 'Galon', null]],
    ];

    /** Measured goods keep three decimals, so a gram or a millimeter still shows in KG or MTR. */
    private const ROUNDING = ['Weight' => 0.001, 'Length' => 0.001, 'Area' => 0.0001, 'Volume' => 0.001];

    public function handle(): int
    {
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
}
