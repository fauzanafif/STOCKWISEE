<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * An item may be priced again in a later Draft PI once the earlier one is set (a new quotation, a new price).
 * The rule "one item in one open draft" lives in PriceListDraftService; the database only keeps an item once
 * per draft. The plain index stays for the foreign key on item_id (MySQL needs one before the unique goes).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('price_list_draft_items', function (Blueprint $table) {
            $table->index('item_id', 'price_list_draft_items_item_id_index');
            $table->unique(['price_list_draft_id', 'item_id'], 'price_list_draft_items_draft_item_unique');
        });
        Schema::table('price_list_draft_items', function (Blueprint $table) {
            $table->dropUnique('price_list_draft_items_item_id_unique');
        });
    }

    public function down(): void
    {
        Schema::table('price_list_draft_items', function (Blueprint $table) {
            $table->unique('item_id', 'price_list_draft_items_item_id_unique');
        });
        Schema::table('price_list_draft_items', function (Blueprint $table) {
            $table->dropUnique('price_list_draft_items_draft_item_unique');
            $table->dropIndex('price_list_draft_items_item_id_index');
        });
    }
};
