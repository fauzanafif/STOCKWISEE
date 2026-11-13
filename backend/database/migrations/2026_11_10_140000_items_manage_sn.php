<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Accurate's "manage serial number" flag on the Master Barang (Item.MANAGESN), filled from the Accurate mirror already synced. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('items', function (Blueprint $table) {
            $table->boolean('manage_sn')->default(false)->after('needs_blueprint');
        });
        if (Schema::hasTable('accurate_item') && Schema::hasColumn('accurate_item', 'MANAGESN')) {
            $codes = DB::table('accurate_item')->where('MANAGESN', 1)->pluck('ITEMNO')->filter()->values();
            foreach ($codes->chunk(500) as $chunk) {
                DB::table('items')->whereIn('code', $chunk->all())->update(['manage_sn' => true]);
            }
        }
    }

    public function down(): void
    {
        Schema::table('items', fn (Blueprint $table) => $table->dropColumn('manage_sn'));
    }
};
