<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Item;
use App\Models\ItemUnitConversion;
use App\Models\Unit;
use App\Models\UomCategory;
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
        ];

        return response()->json(['data' => [
            'categories' => UomCategory::orderBy('name')->get()->map(fn ($c) => ['id' => $c->id, 'name' => $c->name,
                'units' => $units->where('uom_category_id', $c->id)->map($row)->values()]),
            'uncategorized' => $units->whereNull('uom_category_id')->map($row)->values(),
        ]]);
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
        if (! $categoryId) {
            return ['uom_category_id' => null, 'is_reference' => false, 'ratio' => null];
        }
        $reference = Unit::where('uom_category_id', $categoryId)->where('is_reference', true)->when($unit, fn ($q) => $q->whereKeyNot($unit->id))->first();
        if ($kind === 'REFERENCE') {
            if ($reference) {
                throw ValidationException::withMessages(['kind' => "Kategori ini sudah punya acuan: {$reference->code}."]);
            }

            return ['uom_category_id' => $categoryId, 'is_reference' => true, 'ratio' => 1];
        }
        if ($kind === 'VARIES') {
            return ['uom_category_id' => $categoryId, 'is_reference' => false, 'ratio' => null];
        }
        if (! $reference) {
            throw ValidationException::withMessages(['kind' => 'Kategori ini belum punya satuan acuan. Tetapkan acuannya dulu.']);
        }
        $factor = (float) $data['factor'];
        $ratio = round($kind === 'BIGGER' ? $factor : 1 / $factor, 6);
        if ($ratio <= 0) {
            throw ValidationException::withMessages(['factor' => 'Rasio terlalu kecil.']);
        }

        return ['uom_category_id' => $categoryId, 'is_reference' => false, 'ratio' => $ratio];
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
}
