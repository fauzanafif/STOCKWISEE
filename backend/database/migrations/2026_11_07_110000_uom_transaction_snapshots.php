<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Quantity and unit as asked, and the ratio frozen on the transaction: a later change of the master rewrites
 * nothing. Only nullable columns are added, so every existing row keeps its meaning (no conversion).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('item_request_lines', function (Blueprint $table) {
            $table->decimal('requested_qty', 14, 2)->nullable()->after('satuan');
            $table->string('requested_unit', 30)->nullable()->after('requested_qty');
            $table->decimal('unit_ratio', 18, 6)->nullable()->after('requested_unit');
        });
        Schema::table('npbg', function (Blueprint $table) {
            $table->string('base_satuan', 30)->nullable()->after('unit_ratio');
        });
        Schema::table('ppb', function (Blueprint $table) {
            $table->decimal('unit_ratio', 18, 6)->nullable()->after('satuan');
            $table->string('base_satuan', 30)->nullable()->after('unit_ratio');
        });
        Schema::table('purchase_order_items', function (Blueprint $table) {
            $table->decimal('unit_ratio', 18, 6)->nullable()->after('unit_id');
            $table->string('base_unit', 30)->nullable()->after('unit_ratio');
        });
    }

    public function down(): void
    {
        Schema::table('item_request_lines', fn (Blueprint $table) => $table->dropColumn(['requested_qty', 'requested_unit', 'unit_ratio']));
        Schema::table('npbg', fn (Blueprint $table) => $table->dropColumn('base_satuan'));
        Schema::table('ppb', fn (Blueprint $table) => $table->dropColumn(['unit_ratio', 'base_satuan']));
        Schema::table('purchase_order_items', fn (Blueprint $table) => $table->dropColumn(['unit_ratio', 'base_unit']));
    }
};
