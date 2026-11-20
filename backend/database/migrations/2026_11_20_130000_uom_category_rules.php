<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * UOM per parent item category (docs/audit/uom-parent-category-analysis.md):
 *  - category_uom_rules: which shared units the items of a category may use, and the default one. Units are
 *    not copied per category; per-item ratios stay in item_unit_conversions.
 *  - units.factor: the number an admin typed for a Bigger / Smaller unit, kept exactly (60 MIN in 1 HOUR),
 *    so a Smaller unit no longer loses precision in `ratio` (0.016667 gave 59.9988 MIN per HOUR).
 *  - data fixes approved on 2026-11-20: the 2 ROLL items move to ROL (the same roll, quantities unchanged),
 *    the unused duplicates ROLL / C M / CM / UNIT are deactivated (kept), the empty UOM category "testing" goes.
 *  - each parent category starts with the units its items already use (default: the most used one).
 * Nothing in a document, the ledger or stock changes: document lines keep their frozen unit_ratio.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('category_uom_rules', function (Blueprint $table) {
            $table->id();
            $table->foreignId('category_id')->constrained('categories')->cascadeOnDelete();
            $table->foreignId('unit_id')->constrained('units');
            $table->boolean('is_default')->default(false);
            // a per-item unit only: pre-fills an item's own conversion, never used to convert
            $table->decimal('suggested_ratio', 18, 6)->nullable();
            $table->unsignedInteger('sort')->default(0);
            $table->timestamps();
            $table->unique(['category_id', 'unit_id']);
        });

        Schema::table('units', function (Blueprint $table) {
            $table->decimal('factor', 24, 12)->nullable()->after('ratio');
        });

        DB::transaction(function () {
            $now = now();

            // factor from the stored ratio: a Bigger unit is ratio references, a Smaller one 1/ratio (a clean whole number when it is one)
            foreach (DB::table('units')->whereNotNull('ratio')->where('is_reference', false)->get() as $u) {
                $r = (float) $u->ratio;
                if ($r <= 0) {
                    continue;
                }
                $f = $r >= 1 ? $r : 1 / $r;
                $whole = round($f);
                DB::table('units')->where('id', $u->id)->update(['factor' => abs($f - $whole) / $whole < 0.0005 ? $whole : round($f, 12)]);
            }

            // ROL / ROLL: ROL is the one the form and the documents use
            $rol = DB::table('units')->where('code', 'ROL')->value('id');
            $roll = DB::table('units')->where('code', 'ROLL')->value('id');
            if ($rol && $roll) {
                DB::table('items')->where('unit_id', $roll)->update(['unit_id' => $rol, 'updated_at' => $now]);
            }
            // unused duplicates: kept, no longer offered
            foreach (['ROLL', 'C M', 'CM', 'UNIT'] as $code) {
                $id = DB::table('units')->where('code', $code)->value('id');
                if ($id && ! DB::table('items')->where('unit_id', $id)->exists()) {
                    DB::table('units')->where('id', $id)->update(['is_active' => false, 'updated_at' => $now]);
                }
            }
            $testing = DB::table('uom_categories')->where('name', 'testing')->value('id');
            if ($testing && ! DB::table('units')->where('uom_category_id', $testing)->exists()) {
                DB::table('uom_categories')->where('id', $testing)->delete();
            }

            // starting rules: per parent, the units its items use today (by category_id, or the Main Category text)
            foreach (DB::table('categories')->whereNull('parent_id')->get(['id', 'name', 'path']) as $parent) {
                $ids = DB::table('categories')->where('path', $parent->path)->orWhere('path', 'like', $parent->path.' > %')->pluck('id');
                $counts = DB::table('items')->whereNull('deleted_at')->whereNotNull('unit_id')
                    ->where(fn ($q) => $q->whereIn('category_id', $ids)->orWhere(fn ($t) => $t->whereNull('category_id')->where('accurate_category_induk', $parent->name)))
                    ->selectRaw('unit_id, COUNT(*) as n')->groupBy('unit_id')->orderByDesc('n')->pluck('n', 'unit_id');
                $active = DB::table('units')->whereIn('id', $counts->keys())->where('is_active', true)->pluck('id')->flip();
                $sort = 0;
                foreach ($counts as $unitId => $n) {
                    if (! isset($active[$unitId])) {
                        continue;
                    }
                    DB::table('category_uom_rules')->insert(['category_id' => $parent->id, 'unit_id' => $unitId, 'is_default' => $sort === 0,
                        'sort' => $sort++, 'created_at' => $now, 'updated_at' => $now]);
                }
            }
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('category_uom_rules');
        Schema::table('units', function (Blueprint $table) {
            $table->dropColumn('factor');
        });
        // the data fixes (ROLL items, deactivated duplicates, "testing") are not undone: restore from the backup
    }
};
