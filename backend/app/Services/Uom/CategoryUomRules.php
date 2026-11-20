<?php

namespace App\Services\Uom;

use App\Models\Category;
use App\Models\CategoryUomRule;
use App\Models\Item;
use App\Models\Unit;
use App\Support\ItemOptions;
use Closure;
use Illuminate\Http\Request;
use App\Support\SchemaCache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Which units an item may use, from its category: the rules of the nearest category up its tree that has any
 * (a sub-category with rules overrides its parent, one without inherits). An item without category_id is found
 * by its Main Category text (accurate_category_induk = a parent's name). No rules at all: the fixed list of
 * today (ItemOptions::UOM), so a category nobody configured keeps working as before.
 */
class CategoryUomRules
{
    /** @var array<int, array{id:int, parent_id:?int, name:string}>|null */
    private ?array $tree = null;

    public static function ready(): bool
    {
        return Schema::hasTable('category_uom_rules');
    }

    /**
     * @return array{category_id:?int, category:?string, configured:bool, unit_ids:list<int>, default_unit_id:?int}
     */
    public function forItem(?int $categoryId, ?string $indukText): array
    {
        $chain = $this->chain($categoryId, $indukText);
        if (self::ready() && $chain) {
            $rules = CategoryUomRule::whereIn('category_id', $chain)->orderBy('sort')->get(['category_id', 'unit_id', 'is_default']);
            foreach ($chain as $id) {
                $own = $rules->where('category_id', $id);
                if ($own->isNotEmpty()) {
                    return ['category_id' => $id, 'category' => $this->tree()[$id]['name'] ?? null, 'configured' => true,
                        'unit_ids' => $own->pluck('unit_id')->map(fn ($v) => (int) $v)->values()->all(),
                        'default_unit_id' => ($d = $own->firstWhere('is_default', true)) ? (int) $d->unit_id : null];
                }
            }
        }

        return ['category_id' => $chain[count($chain) - 1] ?? null, 'category' => null, 'configured' => false,
            'unit_ids' => DB::table('units')->whereIn('code', ItemOptions::UOM)->pluck('id')->map(fn ($v) => (int) $v)->all(), 'default_unit_id' => null];
    }

    /**
     * The item form's check of unit_id: the unit must be one its category allows. An existing item is only
     * checked when its unit or its category changes, so an item outside the rules can still be edited.
     */
    public static function itemUnitRule(Request $request, ?Item $item): Closure
    {
        return function (string $attr, mixed $value, Closure $fail) use ($request, $item) {
            if ($value === null) {
                return;
            }
            $categoryId = $request->has('category_id') ? ($request->input('category_id') ?: null) : $item?->category_id;
            $induk = $request->has('accurate_category_induk') ? $request->input('accurate_category_induk') : $item?->accurate_category_induk;
            $changed = ! $item || (int) $value !== (int) $item->unit_id || (int) $categoryId !== (int) $item->category_id || (string) $induk !== (string) $item->accurate_category_induk;
            if (! $changed) {
                return;
            }
            $rule = app(self::class)->forItem($categoryId ? (int) $categoryId : null, $induk);
            if (! in_array((int) $value, $rule['unit_ids'], true)) {
                $codes = Unit::whereIn('id', $rule['unit_ids'])->orderBy('code')->pluck('code')->join(', ');
                $fail($rule['configured']
                    ? "Satuan ini tidak diizinkan untuk kategori {$rule['category']}. Pilih salah satu: {$codes}. (Atur di Master UOM, tab Parent Category.)"
                    : 'Pilih UOM dari daftar yang tersedia.');
            }
        };
    }

    /** May an item of this category use this unit? */
    public function allows(?int $categoryId, ?string $indukText, int $unitId): bool
    {
        return in_array($unitId, $this->forItem($categoryId, $indukText)['unit_ids'], true);
    }

    /** The parent (level 1) category of a category, or of a Main Category text. */
    public function parentOf(?int $categoryId, ?string $indukText): ?int
    {
        $chain = $this->chain($categoryId, $indukText);

        return $chain ? $chain[count($chain) - 1] : null;
    }

    /** Main Category text => its parent's rules (for the item form: no round trip per choice). */
    public function byParentName(): array
    {
        if (! self::ready()) {
            return [];
        }
        $out = [];
        foreach (CategoryUomRule::query()->join('categories', 'categories.id', '=', 'category_uom_rules.category_id')->whereNull('categories.parent_id')
            ->orderBy('category_uom_rules.sort')->get(['categories.name', 'category_uom_rules.unit_id', 'category_uom_rules.is_default']) as $r) {
            $out[$r->name]['unit_ids'][] = (int) $r->unit_id;
            if ($r->is_default) {
                $out[$r->name]['default_unit_id'] = (int) $r->unit_id;
            }
        }

        return $out;
    }

    /** The category and its ancestors, nearest first; by the Main Category text when there is no category. */
    private function chain(?int $categoryId, ?string $indukText): array
    {
        $tree = $this->tree();
        $chain = [];
        for ($id = $categoryId; $id && isset($tree[$id]) && ! in_array($id, $chain, true); $id = $tree[$id]['parent_id']) {
            $chain[] = $id;
        }
        if (! $chain && filled($indukText)) {
            foreach ($tree as $c) {
                if ($c['parent_id'] === null && strcasecmp($c['name'], trim((string) $indukText)) === 0) {
                    return [$c['id']];
                }
            }
        }

        return $chain;
    }

    private function tree(): array
    {
        return $this->tree ??= Category::query()->get(['id', 'parent_id', 'name'])
            ->mapWithKeys(fn ($c) => [(int) $c->id => ['id' => (int) $c->id, 'parent_id' => $c->parent_id ? (int) $c->parent_id : null, 'name' => $c->name]])->all();
    }
}
