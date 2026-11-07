<?php

use App\Support\ItemOptions;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Master Kategori Barang: the choices of Kategori Induk / Anak 1 / 2 / 3 of a Master Produk, kept here
 * instead of in code. Starts from the fixed lists (ItemOptions) plus the values items already carry.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('item_category_options', function (Blueprint $table) {
            $table->id();
            $table->string('level', 10); // induk, anak_1, anak_2, anak_3
            $table->string('name', 200);
            // Kategori Induk only: the item-code prefixes that mean it, comma separated (e.g. "MAA,MNA")
            $table->string('code_prefix', 60)->nullable();
            $table->unsignedInteger('sort')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->unique(['level', 'name']);
        });

        $now = now();
        $prefixes = [];
        foreach (ItemOptions::INDUK_PREFIX as $prefix => $name) {
            $prefixes[$name][] = $prefix;
        }
        foreach (ItemOptions::defaults() as $level => $names) {
            $column = 'accurate_category_'.$level;
            $used = DB::table('items')->whereNotNull($column)->where($column, '!=', '')->distinct()->orderBy($column)->pluck($column)->all();
            $seen = [];
            $rows = [];
            foreach (array_merge($names, $used) as $name) {
                $key = mb_strtoupper(trim($name));
                if ($key === '' || isset($seen[$key])) {
                    continue;
                }
                $seen[$key] = true;
                $rows[] = ['level' => $level, 'name' => trim($name), 'sort' => count($rows) + 1, 'is_active' => true,
                    'code_prefix' => $level === 'induk' && isset($prefixes[trim($name)]) ? implode(',', $prefixes[trim($name)]) : null,
                    'created_at' => $now, 'updated_at' => $now];
            }
            foreach (array_chunk($rows, 200) as $chunk) {
                DB::table('item_category_options')->insert($chunk);
            }
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('item_category_options');
    }
};
