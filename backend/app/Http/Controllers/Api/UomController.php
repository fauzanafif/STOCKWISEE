<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Category;
use App\Models\CategoryUomRule;
use App\Models\Item;
use App\Models\ItemUnitConversion;
use App\Models\Unit;
use App\Models\UomCategory;
use App\Services\Uom\CategoryUomRules;
use App\Services\UomConverter;
use App\Support\SchemaCache;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/** Master UOM: categories, their units and each unit's ratio to the category's reference, plus per-item conversions. */
class UomController extends Controller
{
    public function __construct(private UomConverter $converter) {}

    /** GET /api/uom */
    public function index(): JsonResponse
    {
        $units = Unit::withCount('items')->orderByDesc('is_reference')->orderBy('code')->get();
        $row = fn (Unit $u) => [
            'id' => $u->id, 'code' => $u->code, 'name' => $u->name, 'is_active' => (bool) $u->is_active, 'uom_category_id' => $u->uom_category_id,
            'is_reference' => (bool) $u->is_reference, 'ratio' => $u->ratio === null ? null : (float) $u->ratio, 'rounding' => (float) $u->rounding, 'items_count' => $u->items_count,
            'kind' => self::kind($u), 'factor' => self::typedFactor($u),
        ];

        return response()->json(['data' => [
            'categories' => UomCategory::orderBy('name')->get()->map(fn ($c) => ['id' => $c->id, 'name' => $c->name,
                'units' => $units->where('uom_category_id', $c->id)->map($row)->values()]),
            'uncategorized' => $units->whereNull('uom_category_id')->map($row)->values(),
        ]]);
    }

    /** REFERENCE | BIGGER | SMALLER | PER_ITEM (its size varies per item) | null (no category yet) */
    public static function kind(Unit $u): ?string
    {
        if (! $u->uom_category_id) {
            return null;
        }

        return $u->is_reference ? 'REFERENCE' : ($u->ratio === null ? 'PER_ITEM' : ((float) $u->ratio < 1 ? 'SMALLER' : 'BIGGER'));
    }

    /** What an admin typed: a Bigger unit is this many references, a Smaller one this many in one reference. */
    public static function typedFactor(Unit $u): ?float
    {
        if ($u->is_reference || $u->ratio === null) {
            return null;
        }
        $f = $u->getAttribute('factor');

        return $f !== null ? (float) $f : ((float) $u->ratio < 1 ? round(1 / (float) $u->ratio, 6) : (float) $u->ratio);
    }

    public function storeCategory(Request $request): JsonResponse
    {
        $data = $request->validate(['name' => ['required', 'string', 'max:60', 'unique:uom_categories,name']], ['name.unique' => 'Nama kategori ini sudah ada.']);

        return response()->json(['data' => UomCategory::create(['name' => trim($data['name'])])], 201);
    }

    public function updateCategory(Request $request, UomCategory $category): JsonResponse
    {
        $data = $request->validate(['name' => ['required', 'string', 'max:60', Rule::unique('uom_categories', 'name')->ignore($category->id)]], ['name.unique' => 'Nama kategori ini sudah ada.']);
        $category->update(['name' => trim($data['name'])]);

        return response()->json(['data' => $category]);
    }

    public function destroyCategory(UomCategory $category): JsonResponse
    {
        if ($category->units()->exists()) {
            throw ValidationException::withMessages(['category' => 'Kategori ini masih punya satuan. Pindahkan satuannya dulu.']);
        }
        $category->delete();

        return response()->json(['data' => ['deleted' => true]]);
    }

    public function storeUnit(Request $request): JsonResponse
    {
        $data = $this->unitInput($request);
        $code = mb_strtoupper(trim($data['code']));
        if (Unit::where('code', $code)->exists()) {
            throw ValidationException::withMessages(['code' => "Kode {$code} sudah ada."]);
        }
        $unit = DB::transaction(fn () => Unit::create(['code' => $code, 'name' => trim($data['name']), 'is_active' => $data['is_active'] ?? true, 'rounding' => $data['rounding'] ?? 0.01] + $this->placement($data, null)));

        return response()->json(['data' => $unit], 201);
    }

    public function updateUnit(Request $request, Unit $unit): JsonResponse
    {
        $data = $this->unitInput($request);
        $code = mb_strtoupper(trim($data['code']));
        $used = $unit->items()->count();
        // Accurate and the documents know a unit by its code
        if ($code !== $unit->code && ($used > 0 || Unit::where('code', $code)->exists())) {
            throw ValidationException::withMessages(['code' => $used > 0 ? "Kode tidak bisa diubah: dipakai {$used} barang." : "Kode {$code} sudah ada."]);
        }
        if (array_key_exists('is_active', $data) && ! $data['is_active'] && $unit->is_active && $used > 0) {
            throw ValidationException::withMessages(['is_active' => "Satuan ini dipakai {$used} barang, jadi tidak bisa dinonaktifkan."]);
        }
        DB::transaction(function () use ($unit, $data, $code) {
            $unit->update(['code' => $code, 'name' => trim($data['name']), 'is_active' => $data['is_active'] ?? $unit->is_active, 'rounding' => $data['rounding'] ?? $unit->rounding] + $this->placement($data, $unit));
        });

        return response()->json(['data' => $unit->refresh()]);
    }

    private function unitInput(Request $request): array
    {
        return $request->validate([
            'code' => ['required', 'string', 'max:20'],
            'name' => ['required', 'string', 'max:100'],
            'is_active' => ['sometimes', 'boolean'],
            'uom_category_id' => ['nullable', 'integer', 'exists:uom_categories,id'],
            'kind' => ['required_with:uom_category_id', 'nullable', Rule::in(['REFERENCE', 'BIGGER', 'SMALLER', 'VARIES'])],
            'factor' => ['required_if:kind,BIGGER,SMALLER', 'nullable', 'numeric', 'gt:0'],
            'rounding' => ['sometimes', 'numeric', 'gte:0.000001', 'max:1000'],
        ], ['factor.required_if' => 'Isi rasionya.', 'factor.gt' => 'Rasio harus lebih dari 0.', 'rounding.gte' => 'Pembulatan harus lebih dari 0.']);
    }

    /** Where a unit sits: one reference per category, a bigger / smaller unit needs that reference to count against. */
    private function placement(array $data, ?Unit $unit): array
    {
        $categoryId = $data['uom_category_id'] ?? null;
        $kind = $data['kind'] ?? null;
        $wasReference = $unit?->is_reference && $unit->uom_category_id;
        $keepsPlace = $wasReference && $categoryId === $unit->uom_category_id && $kind === 'REFERENCE';
        // the others are counted against it
        if ($wasReference && ! $keepsPlace && Unit::where('uom_category_id', $unit->uom_category_id)->whereKeyNot($unit->id)->whereNotNull('ratio')->exists()) {
            throw ValidationException::withMessages(['kind' => "{$unit->code} adalah acuan kategorinya dan satuan lain dihitung terhadapnya, jadi tidak bisa diubah."]);
        }
        $withFactor = fn (array $row, $factor = null) => SchemaCache::hasColumn('units', 'factor') ? $row + ['factor' => $factor] : $row;
        if (! $categoryId) {
            return $withFactor(['uom_category_id' => null, 'is_reference' => false, 'ratio' => null]);
        }
        $reference = Unit::where('uom_category_id', $categoryId)->where('is_reference', true)->when($unit, fn ($q) => $q->whereKeyNot($unit->id))->first();
        if ($kind === 'REFERENCE') {
            if ($reference) {
                throw ValidationException::withMessages(['kind' => "Kategori ini sudah punya acuan: {$reference->code}."]);
            }

            return $withFactor(['uom_category_id' => $categoryId, 'is_reference' => true, 'ratio' => 1]);
        }
        if ($kind === 'VARIES') {
            return $withFactor(['uom_category_id' => $categoryId, 'is_reference' => false, 'ratio' => null]);
        }
        if (! $reference) {
            throw ValidationException::withMessages(['kind' => 'Kategori ini belum punya satuan acuan. Tetapkan acuannya dulu.']);
        }
        $factor = (float) $data['factor'];
        $ratio = round($kind === 'BIGGER' ? $factor : 1 / $factor, 6);
        if ($ratio <= 0) {
            throw ValidationException::withMessages(['factor' => 'Rasio terlalu kecil.']);
        }

        // the typed number is kept exactly: the converter counts a Smaller unit as 1/factor, not by the rounded ratio
        return $withFactor(['uom_category_id' => $categoryId, 'is_reference' => false, 'ratio' => $ratio], UomConverter::dec($data['factor']));
    }

    /** GET /api/uom/convert?qty=&from=&to=&item_id= */
    public function convert(Request $request): JsonResponse
    {
        $data = $request->validate([
            'qty' => ['required', 'numeric', 'min:0'],
            'from' => ['required', 'integer', 'exists:units,id'],
            'to' => ['required', 'integer', 'exists:units,id'],
            'item_id' => ['nullable', 'integer', 'exists:items,id'],
        ]);
        $item = ! empty($data['item_id']) ? Item::with('unit')->find($data['item_id']) : null;
        $to = Unit::findOrFail($data['to']);
        $factor = $this->converter->factor(Unit::findOrFail($data['from']), $to, $item);
        $result = $this->converter->roundTo($to, bcmul(UomConverter::dec($data['qty']), $factor, 8));

        return response()->json(['data' => ['factor' => (float) UomConverter::roundDec($factor, 6), 'result' => (float) $result]]);
    }

    /**
     * GET /api/uom/preview?qty=&unit=&item_id=|item_code= — what a document line makes in the item's own unit,
     * for a form to show before saving. Nothing is saved; `unit` is what was written.
     */
    public function preview(Request $request): JsonResponse
    {
        $data = $request->validate(['qty' => ['required', 'numeric', 'min:0'], 'unit' => ['nullable', 'string', 'max:30'], 'item_id' => ['nullable', 'integer'], 'item_code' => ['nullable', 'string', 'max:60']]);
        $item = ! empty($data['item_id']) ? Item::find($data['item_id']) : (filled($data['item_code'] ?? null) ? Item::where('code', $data['item_code'])->first() : null);
        try {
            $uom = $this->converter->snapshot($item, $data['unit'] ?? null, $item?->code ?? '-', 'unit');
        } catch (ValidationException $e) {
            return response()->json(['data' => ['problem' => collect($e->errors())->flatten()->first()]]);
        }
        $converts = $uom['base_satuan'] !== null;

        return response()->json(['data' => ['converts' => $converts, 'known' => $uom['known'], 'ratio' => (float) $uom['unit_ratio'], 'base_unit' => $uom['base_satuan'],
            'base_qty' => (float) UomConverter::baseQty($data['qty'], $uom['unit_ratio']), 'problem' => null]]);
    }

    /** GET /api/uom/unmapped — what cannot be converted yet; nothing here is guessed. */
    public function unmapped(): JsonResponse
    {
        return response()->json(['data' => [
            'items' => Item::whereNull('unit_id')->where('is_active', true)->orderBy('code')->limit(200)->get(['id', 'code', 'description'])->values(),
            'items_total' => Item::whereNull('unit_id')->where('is_active', true)->count(),
            'units' => Unit::whereNull('uom_category_id')->orderBy('code')->get(['id', 'code', 'name'])->values(),
            // words on Item Requests that are no unit of the master
            'requested' => DB::table('item_request_lines')->whereNotNull('requested_unit')->whereNull('unit_ratio')->whereNotNull('decision')
                ->selectRaw('requested_unit as unit, COUNT(*) as lines_count')->groupBy('requested_unit')->orderBy('requested_unit')->get(),
        ]]);
    }

    /** PUT /api/items/{item}/base-unit {unit_id} — only for an item with none: stock is counted in a base unit already set. */
    public function setBaseUnit(Request $request, Item $item): JsonResponse
    {
        $data = $request->validate(['unit_id' => ['required', 'integer', 'exists:units,id']]);
        if ($item->unit_id) {
            throw ValidationException::withMessages(['unit_id' => 'Barang ini sudah punya Base UOM. Stoknya dihitung dalam satuan itu, jadi tidak diubah di sini.']);
        }
        $item->update(['unit_id' => $data['unit_id']]);

        return response()->json(['data' => ['id' => $item->id, 'unit_id' => $item->unit_id]]);
    }

    /** GET /api/items/{item}/unit-conversions */
    public function itemConversions(Item $item): JsonResponse
    {
        $item->load('unit:id,code,name');
        // with the ones set against an older base unit, marked needs_review (not used until reviewed)
        $conversions = $this->converter->itemConversions($item, true)->map(fn ($c) => collect($c)->except('ratio_decimal')->all())->values();

        return response()->json(['data' => [
            'item' => ['id' => $item->id, 'code' => $item->code, 'description' => $item->description, 'unit_id' => $item->unit_id, 'unit' => $item->unit?->code],
            'conversions' => $conversions,
        ]]);
    }

    /** POST /api/items/{item}/unit-conversions {unit_id, ratio}: 1 unit = ratio × the item's own unit; saved again = changed. */
    public function saveItemConversion(Request $request, Item $item): JsonResponse
    {
        $data = $request->validate(['unit_id' => ['required', 'integer', 'exists:units,id'], 'ratio' => ['required', 'numeric', 'gte:0.000001', 'max:999999999']], ['ratio.gte' => 'Rasio harus lebih dari 0.']);
        if (! $item->unit_id) {
            throw ValidationException::withMessages(['unit_id' => 'Barang ini belum punya satuan utama.']);
        }
        if ((int) $data['unit_id'] === (int) $item->unit_id) {
            throw ValidationException::withMessages(['unit_id' => 'Ini sudah satuan utama barangnya.']);
        }
        $unit = Unit::findOrFail($data['unit_id']);
        $base = Unit::find($item->unit_id);
        if ($base && ! UomConverter::perItemAllowed($unit, $base)) {
            throw ValidationException::withMessages(['unit_id' => "{$unit->code} dan {$base->code} mengukur hal yang berbeda (mis. berat dan volume), jadi tidak bisa diberi rasio per barang."]);
        }
        if ($base && $unit->uom_category_id && $unit->uom_category_id === $base->uom_category_id && $unit->ratio !== null && $base->ratio !== null) {
            throw ValidationException::withMessages(['unit_id' => "{$unit->code} sudah punya rasio tetap terhadap {$base->code} di Master UOM, jadi tidak perlu rasio per barang."]);
        }
        if (($this->converter->itemConversions($item)[$unit->code]['source'] ?? null) === 'ACCURATE') {
            throw ValidationException::withMessages(['unit_id' => "Rasio {$unit->code} barang ini berasal dari Accurate. Ubah di Accurate."]);
        }
        // saved (again) against the item's unit of today: a conversion that needed a review is reviewed
        $row = ItemUnitConversion::updateOrCreate(['item_id' => $item->id, 'unit_id' => $unit->id], ['ratio' => UomConverter::roundDec($data['ratio'], 6), 'created_by' => $request->user()->id]
            + (SchemaCache::hasColumn('item_unit_conversions', 'base_unit_id') ? ['base_unit_id' => $item->unit_id] : []));

        return response()->json(['data' => ['id' => $row->id]], 201);
    }

    /**
     * POST /api/items/{item}/unit-conversions/{conversion}/confirm: the ratio set against the item's former
     * base unit is still right for its new one (e.g. a base unit renamed, not resized). Used again from now.
     */
    public function confirmItemConversion(Request $request, Item $item, ItemUnitConversion $conversion): JsonResponse
    {
        abort_unless($conversion->item_id === $item->id, 404);
        abort_unless(SchemaCache::hasColumn('item_unit_conversions', 'base_unit_id'), 409, 'Migration belum dijalankan.');
        if (! $item->unit_id) {
            throw ValidationException::withMessages(['unit_id' => 'Barang ini belum punya satuan utama.']);
        }
        if ((int) $conversion->unit_id === (int) $item->unit_id) {
            throw ValidationException::withMessages(['unit_id' => 'Satuan konversi ini sekarang satuan utama barangnya. Hapus konversinya.']);
        }
        $conversion->update(['base_unit_id' => $item->unit_id]);

        return response()->json(['data' => ['id' => $conversion->id]]);
    }

    public function destroyItemConversion(Item $item, ItemUnitConversion $conversion): JsonResponse
    {
        abort_unless($conversion->item_id === $item->id, 404);
        $code = $conversion->unit?->code;
        $used = DB::table('item_request_lines')->where('item_id', $item->id)->where('requested_unit', $code)->exists()
            || DB::table('purchase_order_items')->where('item_id', $item->id)->where('unit_id', $conversion->unit_id)->exists()
            || DB::table('npbg')->where('kode_barang', $item->code)->where('satuan', $code)->exists()
            || DB::table('ppb')->where('kode_barang', $item->code)->where('satuan', $code)->exists()
            || DB::table('ri')->where('kode_barang', $item->code)->where('satuan', $code)->exists();
        if ($used) {
            throw ValidationException::withMessages(['unit' => "{$code} sudah dipakai transaksi barang ini, jadi tidak bisa dihapus. Ubah rasionya kalau perlu: transaksi lama tetap memakai rasionya sendiri."]);
        }
        $conversion->delete();

        return response()->json(['data' => ['deleted' => true]]);
    }

    /**
     * GET /api/uom/category-rules — every parent category (and a sub-category with its own rules): its items,
     * its units (type, factor, items using each) and whether it is set up.
     */
    public function categoryRules(): JsonResponse
    {
        abort_unless(CategoryUomRules::ready(), 409, 'Migration UOM per kategori belum dijalankan.');
        $cats = Category::query()->get(['id', 'parent_id', 'name', 'path', 'level']);
        $rules = CategoryUomRule::with('unit')->orderBy('sort')->get()->groupBy('category_id');
        $roots = $cats->whereNull('parent_id')->sortBy('name');
        $shown = $roots->merge($cats->whereNotNull('parent_id')->filter(fn ($c) => $rules->has($c->id)));
        // items per parent and unit: by category_id, or the Main Category text when an item has none
        $rootIdByName = $roots->mapWithKeys(fn ($c) => [mb_strtolower($c->name) => $c->id]);
        $rootOf = $cats->mapWithKeys(fn ($c) => [$c->id => $rootIdByName[mb_strtolower(explode(' > ', (string) $c->path)[0])] ?? null]);
        $usage = [];
        foreach (DB::table('items')->whereNull('deleted_at')->selectRaw('category_id, accurate_category_induk, unit_id, COUNT(*) as n')->groupBy('category_id', 'accurate_category_induk', 'unit_id')->get() as $row) {
            $root = $row->category_id ? ($rootOf[$row->category_id] ?? null) : ($rootIdByName[mb_strtolower(trim((string) $row->accurate_category_induk))] ?? null);
            if ($root) {
                $usage[$root][(int) $row->unit_id] = ($usage[$root][(int) $row->unit_id] ?? 0) + (int) $row->n;
            }
        }
        $units = Unit::all()->keyBy('id');
        $referenceOf = fn (Unit $u) => $u->uom_category_id ? $units->first(fn ($x) => $x->is_reference && $x->uom_category_id === $u->uom_category_id)?->code : null;

        $data = $shown->map(function (Category $c) use ($rules, $usage, $units, $referenceOf) {
            $own = $rules->get($c->id, collect());
            $use = $c->parent_id ? [] : ($usage[$c->id] ?? []);
            unset($use[0]); // items without a unit: listed under Item Usage
            $outside = collect($use)->except($own->pluck('unit_id')->all());

            return [
                'id' => $c->id, 'name' => $c->name, 'path' => $c->path, 'parent_id' => $c->parent_id, 'level' => $c->level,
                'items_count' => array_sum($use),
                'status' => $own->isEmpty() ? 'NOT_SET' : (! $own->contains('is_default', true) || $outside->isNotEmpty() ? 'PARTIAL' : 'COMPLETE'),
                'units' => $own->map(fn (CategoryUomRule $r) => [
                    'unit_id' => $r->unit_id, 'code' => $r->unit?->code, 'name' => $r->unit?->name, 'is_default' => $r->is_default,
                    'kind' => $r->unit ? self::kind($r->unit) : null, 'factor' => $r->unit ? self::typedFactor($r->unit) : null,
                    'reference' => $r->unit ? $referenceOf($r->unit) : null,
                    'suggested_ratio' => $r->suggested_ratio === null ? null : (float) $r->suggested_ratio,
                    'items_count' => $use[$r->unit_id] ?? 0, 'is_active' => (bool) $r->unit?->is_active,
                ])->values(),
                // units its items use that the rules do not list: those items are shown, not blocked
                'outside' => $outside->map(fn ($n, $id) => ['unit_id' => (int) $id, 'code' => $units[$id]->code ?? '?', 'items_count' => $n])->values(),
            ];
        })->values();

        return response()->json(['data' => $data]);
    }

    /** PUT /api/uom/category-rules/{category} {units: [{unit_id, is_default, suggested_ratio?}]} — the whole set, in this order. */
    public function saveCategoryRules(Request $request, Category $category): JsonResponse
    {
        abort_unless(CategoryUomRules::ready(), 409, 'Migration UOM per kategori belum dijalankan.');
        $data = $request->validate([
            'units' => ['present', 'array', 'max:40'],
            'units.*.unit_id' => ['required', 'integer', 'distinct', 'exists:units,id'],
            'units.*.is_default' => ['sometimes', 'boolean'],
            'units.*.suggested_ratio' => ['nullable', 'numeric', 'gt:0', 'max:999999999'],
        ], ['units.*.unit_id.distinct' => 'Satuan yang sama dipilih dua kali.']);
        $rows = collect($data['units'])->values();
        $units = Unit::whereIn('id', $rows->pluck('unit_id'))->get()->keyBy('id');
        if ($rows->isNotEmpty() && $rows->filter(fn ($r) => ! empty($r['is_default']))->count() !== 1) {
            throw ValidationException::withMessages(['units' => 'Pilih tepat satu satuan default (satuan utama barang baru).']);
        }
        foreach ($rows as $i => $row) {
            $u = $units[$row['unit_id']];
            if (! $u->is_active) {
                throw ValidationException::withMessages(["units.{$i}.unit_id" => "{$u->code} tidak aktif."]);
            }
            if (! empty($row['is_default']) && ! in_array(self::kind($u), [null, 'REFERENCE', 'PER_ITEM'], true)) {
                throw ValidationException::withMessages(["units.{$i}.is_default" => "{$u->code} adalah turunan dari acuannya. Pilih acuan (mis. PCS, MTR, KG, LTR) atau satuan per barang sebagai default."]);
            }
            if (($row['suggested_ratio'] ?? null) !== null && self::kind($u) !== 'PER_ITEM') {
                throw ValidationException::withMessages(["units.{$i}.suggested_ratio" => "{$u->code} punya rasio tetap di Master UOM. Saran rasio hanya untuk satuan per barang."]);
            }
        }
        DB::transaction(function () use ($category, $rows) {
            CategoryUomRule::where('category_id', $category->id)->delete();
            foreach ($rows as $i => $row) {
                CategoryUomRule::create(['category_id' => $category->id, 'unit_id' => $row['unit_id'], 'is_default' => ! empty($row['is_default']),
                    'suggested_ratio' => $row['suggested_ratio'] ?? null, 'sort' => $i]);
            }
        });

        return response()->json(['data' => ['saved' => $rows->count()]]);
    }
}
