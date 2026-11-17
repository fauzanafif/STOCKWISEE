<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * An item's own conversion (1 BOX = 10 PCS) is a ratio to the item's base unit at the time it was set.
 * When the base unit later changes (from any source), that ratio means something else: the conversion
 * remembers the base unit it was set against and is not used until someone confirms or corrects it.
 * One nullable column; existing rows get their item's current unit.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('item_unit_conversions', function (Blueprint $table) {
            $table->foreignId('base_unit_id')->nullable()->after('ratio')->constrained('units')->nullOnDelete();
        });

        // the conversions that exist were set against the item's unit of today
        DB::table('item_unit_conversions')->orderBy('id')->chunkById(500, function ($rows) {
            $units = DB::table('items')->whereIn('id', $rows->pluck('item_id'))->pluck('unit_id', 'id');
            foreach ($rows as $row) {
                DB::table('item_unit_conversions')->where('id', $row->id)->update(['base_unit_id' => $units[$row->item_id] ?? null]);
            }
        });
    }

    public function down(): void
    {
        Schema::table('item_unit_conversions', function (Blueprint $table) {
            $table->dropConstrainedForeignId('base_unit_id');
        });
    }
};
