<?php

namespace App\Services;

use App\Models\User;
use App\Support\SchemaCache;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Master data that needs a person's look, read from STOCKWISE's own master tables only (no Accurate
 * mirror tables). Nothing is changed or merged here: each check lists what to fix and where.
 * A check is shown only to the users who may open that master.
 */
class MasterDataQualityService
{
    private const SAMPLE = 100;

    /** @return list<array{key:string, title:string, hint:string, count:int, columns:list<string>, rows:list<array<string, mixed>>, fix:?string}> */
    public function checks(User $user): array
    {
        $out = [];
        if ($user->hasPermission('item.view')) {
            $out[] = $this->itemsWithoutUnit();
            $out[] = $this->duplicateItemNames();
        }
        if ($user->hasPermission('master.unit.view')) {
            $out[] = $this->unitsWithoutCategory();
            if (SchemaCache::hasColumn('item_unit_conversions', 'base_unit_id')) {
                $out[] = $this->conversionsToReview();
            }
        }
        if ($user->hasPermission('master.vendor.view')) {
            $out[] = $this->similarNames('vendors', 'similar_vendors', 'Vendors with similar names', 'May be one vendor entered twice (PT / CV, dots, spaces). Check before merging: their documents point to each one.', '/vendors', ['PT', 'CV', 'UD', 'TOKO', 'TB', 'PD', 'KOPERASI']);
            $out[] = $this->vendorsWithoutCode();
        }
        if ($user->hasPermission('master.employee.view')) {
            $out[] = $this->similarNames('departments', 'similar_departments', 'Departments with similar names', 'e.g. "MGR OPERASIONAL" and "MGR. OPERASIONAL". Keep one and move the employees to it.', '/employees', []);
            $out[] = $this->employeesWithoutDepartment();
        }
        if ($user->hasPermission('rfq.view') && SchemaCache::hasColumn('vendor_prices', 'base_unit_id')) {
            $out[] = $this->pricesToReview();
        }

        return $out;
    }

    private function check(string $key, string $title, string $hint, int $count, array $columns, Collection $rows, ?string $fix): array
    {
        return ['key' => $key, 'title' => $title, 'hint' => $hint, 'count' => $count, 'columns' => $columns, 'rows' => $rows->take(self::SAMPLE)->values()->all(), 'fix' => $fix];
    }

    private function itemsWithoutUnit(): array
    {
        $q = DB::table('items')->whereNull('deleted_at')->whereNull('unit_id');

        return $this->check('items_without_unit', 'Items without a base unit', 'Without a unit an item cannot get unit conversions or a Price List price. Set it in UOM → Per item.',
            (clone $q)->count(), ['Code', 'Description'],
            $q->orderBy('code')->limit(self::SAMPLE)->get(['code', 'description'])->map(fn ($r) => ['Code' => $r->code, 'Description' => $r->description]), '/uom');
    }

    private function duplicateItemNames(): array
    {
        $groups = DB::table('items')->whereNull('deleted_at')->select('description_normalized', DB::raw('COUNT(*) as n'))
            ->groupBy('description_normalized')->havingRaw('COUNT(*) > 1')->orderByDesc('n')->get();
        $codes = DB::table('items')->whereNull('deleted_at')->whereIn('description_normalized', $groups->take(self::SAMPLE)->pluck('description_normalized'))
            ->orderBy('code')->get(['code', 'description', 'description_normalized'])->groupBy('description_normalized');

        return $this->check('duplicate_item_names', 'Items with the same name', 'Different codes, same description: maybe one item twice. Never merged automatically: the item owner decides.',
            $groups->count(), ['Description', 'Items', 'Codes'],
            $groups->take(self::SAMPLE)->map(fn ($g) => ['Description' => $codes[$g->description_normalized][0]->description ?? $g->description_normalized, 'Items' => (int) $g->n,
                'Codes' => ($codes[$g->description_normalized] ?? collect())->pluck('code')->implode(', ')]), '/items');
    }

    private function unitsWithoutCategory(): array
    {
        $used = DB::table('items')->whereNull('deleted_at')->whereNotNull('unit_id')->select('unit_id', DB::raw('COUNT(*) as n'))->groupBy('unit_id')->pluck('n', 'unit_id');
        $rows = DB::table('units')->whereNull('uom_category_id')->orderBy('code')->get(['id', 'code', 'name']);

        return $this->check('units_without_category', 'Units without a UOM category', 'A unit outside a category cannot be converted (1 BOX = 10 PCS needs both in one category, or a per-item ratio).',
            $rows->count(), ['Code', 'Name', 'Items using it'],
            $rows->map(fn ($u) => ['Code' => $u->code, 'Name' => $u->name, 'Items using it' => (int) ($used[$u->id] ?? 0)]), '/uom');
    }

    private function conversionsToReview(): array
    {
        $q = DB::table('item_unit_conversions as c')->join('items as i', 'i.id', '=', 'c.item_id')
            ->leftJoin('units as u', 'u.id', '=', 'c.unit_id')->leftJoin('units as was', 'was.id', '=', 'c.base_unit_id')->leftJoin('units as now', 'now.id', '=', 'i.unit_id')
            ->whereNotNull('c.base_unit_id')->where(fn ($w) => $w->whereNull('i.unit_id')->orWhereColumn('c.base_unit_id', '<>', 'i.unit_id'));

        return $this->check('conversions_to_review', 'Unit conversions to review', "The item's base unit changed after the ratio was set, so the conversion is not used until it is confirmed or corrected.",
            (clone $q)->count(), ['Item', 'Conversion', 'Set against', 'Base unit now'],
            $q->orderBy('i.code')->limit(self::SAMPLE)->get(['i.code', 'u.code as unit', 'c.ratio', 'was.code as was', 'now.code as now'])
                ->map(fn ($r) => ['Item' => $r->code, 'Conversion' => "1 {$r->unit} = ".rtrim(rtrim((string) $r->ratio, '0'), '.')." {$r->was}", 'Set against' => $r->was, 'Base unit now' => $r->now ?? '—']), '/uom');
    }

    /** Names alike once case, dots, commas, extra spaces and company prefixes (PT, CV…) are left out. */
    private function similarNames(string $table, string $key, string $title, string $hint, string $fix, array $prefixes): array
    {
        $norm = function (string $name) use ($prefixes): string {
            $s = preg_replace('/[^A-Z0-9 ]+/', ' ', mb_strtoupper($name)) ?? '';
            $words = array_values(array_filter(explode(' ', $s), fn ($w) => $w !== '' && ! in_array($w, $prefixes, true)));

            return implode(' ', $words);
        };
        $groups = DB::table($table)->get(['id', 'name'])->groupBy(fn ($r) => $norm((string) $r->name))->filter(fn ($g, $k) => $k !== '' && $g->count() > 1);

        return $this->check($key, $title, $hint, $groups->count(), ['Names'],
            $groups->map(fn ($g) => ['Names' => $g->pluck('name')->implode('  ·  ')])->values(), $fix);
    }

    private function vendorsWithoutCode(): array
    {
        $q = DB::table('vendors')->where('is_active', true)->where(fn ($w) => $w->whereNull('code')->orWhere('code', ''));

        return $this->check('vendors_without_code', 'Active vendors without a code', 'Vendors are told apart by name only; a code keeps them apart if a name is written differently.',
            (clone $q)->count(), ['Vendor'], $q->orderBy('name')->limit(self::SAMPLE)->get(['name'])->map(fn ($r) => ['Vendor' => $r->name]), '/vendors');
    }

    private function employeesWithoutDepartment(): array
    {
        $q = DB::table('employees')->where('is_active', true)->whereNull('department_id');

        return $this->check('employees_without_department', 'Active employees without a department', 'Requests and reports per department leave these people out.',
            (clone $q)->count(), ['Employee', 'Position'], $q->orderBy('name')->limit(self::SAMPLE)->get(['name', 'position'])->map(fn ($r) => ['Employee' => $r->name, 'Position' => $r->position ?? '—']), '/employees');
    }

    private function pricesToReview(): array
    {
        $q = DB::table('vendor_prices as p')->join('items as i', 'i.id', '=', 'p.item_id')->join('vendors as v', 'v.id', '=', 'p.vendor_id')
            ->where('p.status', '!=', 'ARCHIVED')->whereNotNull('p.base_unit_id')
            ->where(fn ($w) => $w->whereNull('i.unit_id')->orWhereColumn('p.base_unit_id', '<>', 'i.unit_id'));

        return $this->check('prices_to_review', 'Price List prices to review', "The item's base unit changed after the price was kept. Open the price and save it again with the right unit.",
            (clone $q)->count(), ['Item', 'Vendor'], $q->orderBy('i.code')->limit(self::SAMPLE)->get(['i.code', 'v.name'])->map(fn ($r) => ['Item' => $r->code, 'Vendor' => $r->name]), '/price-list');
    }
}
