<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Support\ItemOptions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Master Kategori Barang: the choices of Kategori Induk / Anak 1 / 2 / 3 of a Master Produk
 * (item_category_options). A rename carries over to the items that use it; one in use can't be deleted.
 */
class ItemCategoryController extends Controller
{
    private const TABLE = 'item_category_options';

    /** GET /api/item-categories?level= — the entries with how many items use each, and the values items use that aren't listed. */
    public function index(Request $request): JsonResponse
    {
        $level = $this->level($request->query('level', 'induk'));
        $column = 'accurate_category_'.$level;
        $used = DB::table('items')->whereNotNull($column)->where($column, '!=', '')->select($column.' as name')->selectRaw('count(*) as n')->groupBy($column)->pluck('n', 'name');
        $usedUpper = [];
        foreach ($used as $name => $n) {
            $usedUpper[mb_strtoupper($name)] = ($usedUpper[mb_strtoupper($name)] ?? 0) + $n;
        }
        $rows = DB::table(self::TABLE)->where('level', $level)->orderBy('sort')->orderBy('name')->get();
        $listed = [];
        $data = $rows->map(function ($r) use ($usedUpper, &$listed) {
            $listed[mb_strtoupper($r->name)] = true;

            return ['id' => $r->id, 'name' => $r->name, 'code_prefix' => $r->code_prefix, 'is_active' => (bool) $r->is_active, 'items_count' => (int) ($usedUpper[mb_strtoupper($r->name)] ?? 0)];
        })->values();
        $unlisted = collect($used)->filter(fn ($n, $name) => ! isset($listed[mb_strtoupper($name)]))->map(fn ($n, $name) => ['name' => $name, 'items_count' => (int) $n])->values();

        return response()->json(['data' => $data, 'unlisted' => $unlisted]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'level' => ['required', Rule::in(ItemOptions::LEVELS)],
            'name' => ['required', 'string', 'max:200'],
            'code_prefix' => ['nullable', 'string', 'max:60'],
        ]);
        $name = $this->clean($data['name']);
        $this->unique($data['level'], $name);
        $id = DB::table(self::TABLE)->insertGetId([
            'level' => $data['level'], 'name' => $name, 'is_active' => true,
            'code_prefix' => $data['level'] === 'induk' ? $this->prefixes($data['code_prefix'] ?? null, null) : null,
            'sort' => (int) DB::table(self::TABLE)->where('level', $data['level'])->max('sort') + 1,
            'created_at' => now(), 'updated_at' => now(),
        ]);

        return response()->json(['data' => DB::table(self::TABLE)->find($id)], 201);
    }

    /** PUT /api/item-categories/{id} {name?, code_prefix?, is_active?} — a new name is carried over to the items that use the old one. */
    public function update(Request $request, int $id): JsonResponse
    {
        $row = DB::table(self::TABLE)->find($id);
        abort_unless($row, 404);
        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:200'],
            'code_prefix' => ['sometimes', 'nullable', 'string', 'max:60'],
            'is_active' => ['sometimes', 'boolean'],
        ]);
        $moved = 0;
        DB::transaction(function () use ($row, $data, &$moved) {
            $set = ['updated_at' => now()];
            if (array_key_exists('name', $data) && ($name = $this->clean($data['name'])) !== $row->name) {
                $this->unique($row->level, $name, $row->id);
                $set['name'] = $name;
                $moved = DB::table('items')->where('accurate_category_'.$row->level, $row->name)->update(['accurate_category_'.$row->level => $name, 'updated_at' => now()]);
            }
            if ($row->level === 'induk' && array_key_exists('code_prefix', $data)) {
                $set['code_prefix'] = $this->prefixes($data['code_prefix'], $row->id);
            }
            if (array_key_exists('is_active', $data)) {
                $set['is_active'] = $data['is_active'];
            }
            DB::table(self::TABLE)->where('id', $row->id)->update($set);
        });

        return response()->json(['data' => DB::table(self::TABLE)->find($id), 'items_moved' => $moved]);
    }

    public function destroy(int $id): JsonResponse
    {
        $row = DB::table(self::TABLE)->find($id);
        abort_unless($row, 404);
        $n = DB::table('items')->where('accurate_category_'.$row->level, $row->name)->count();
        if ($n > 0) {
            throw ValidationException::withMessages(['name' => "Dipakai {$n} barang, tidak bisa dihapus. Nonaktifkan saja."]);
        }
        DB::table(self::TABLE)->where('id', $id)->delete();

        return response()->json(['data' => null]);
    }

    private function level(mixed $level): string
    {
        abort_unless(in_array($level, ItemOptions::LEVELS, true), 422, 'Level kategori tidak dikenal.');

        return $level;
    }

    private function clean(string $name): string
    {
        $name = preg_replace('/\s+/u', ' ', trim($name));
        if ($name === '') {
            throw ValidationException::withMessages(['name' => 'Nama kategori wajib diisi.']);
        }

        return $name;
    }

    private function unique(string $level, string $name, ?int $except = null): void
    {
        $taken = DB::table(self::TABLE)->where('level', $level)->whereRaw('UPPER(name) = ?', [mb_strtoupper($name)])
            ->when($except, fn ($q) => $q->where('id', '!=', $except))->exists();
        if ($taken) {
            throw ValidationException::withMessages(['name' => 'Kategori dengan nama ini sudah ada.']);
        }
    }

    /** "mna, maa" -> "MNA,MAA"; each prefix is 3 letters/digits and belongs to one Kategori Induk only */
    private function prefixes(?string $raw, ?int $self): ?string
    {
        $list = array_values(array_unique(array_filter(array_map(fn ($p) => mb_strtoupper(trim($p)), preg_split('/[\s,;]+/', (string) $raw)))));
        if ($list === []) {
            return null;
        }
        foreach ($list as $p) {
            if (! preg_match('/^[A-Z0-9]{3}$/', $p)) {
                throw ValidationException::withMessages(['code_prefix' => "Prefix \"{$p}\" harus 3 huruf/angka (mis. MNA)."]);
            }
        }
        foreach (DB::table(self::TABLE)->where('level', 'induk')->whereNotNull('code_prefix')->when($self, fn ($q) => $q->where('id', '!=', $self))->get(['name', 'code_prefix']) as $other) {
            $clash = array_intersect($list, array_map('trim', explode(',', $other->code_prefix)));
            if ($clash) {
                throw ValidationException::withMessages(['code_prefix' => 'Prefix '.implode(', ', $clash)." sudah dipakai {$other->name}."]);
            }
        }

        return implode(',', $list);
    }
}
