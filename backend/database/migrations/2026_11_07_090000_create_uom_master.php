<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Master UOM: units grouped in categories, one reference unit per category.
 * units.ratio: 1 of this unit = ratio × the category's reference; null = it differs per item (a pack, a box).
 * item_unit_conversions: 1 unit = ratio × the item's own unit, for that item only.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('uom_categories', function (Blueprint $table) {
            $table->id();
            $table->string('name', 60)->unique();
            $table->timestamps();
        });
        Schema::table('units', function (Blueprint $table) {
            $table->foreignId('uom_category_id')->nullable()->after('name')->constrained('uom_categories')->nullOnDelete();
            $table->boolean('is_reference')->default(false)->after('uom_category_id');
            $table->decimal('ratio', 18, 6)->nullable()->after('is_reference');
            // a converted quantity lands on a multiple of this
            $table->decimal('rounding', 12, 6)->default(0.01)->after('ratio');
        });
        Schema::create('item_unit_conversions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('item_id')->constrained('items')->cascadeOnDelete();
            $table->foreignId('unit_id')->constrained('units')->cascadeOnDelete();
            $table->decimal('ratio', 18, 6);
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->unique(['item_id', 'unit_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('item_unit_conversions');
        Schema::table('units', function (Blueprint $table) {
            $table->dropConstrainedForeignId('uom_category_id');
            $table->dropColumn(['is_reference', 'ratio', 'rounding']);
        });
        Schema::dropIfExists('uom_categories');
    }
};
