<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Draft Price List: purchasing picks items and vendors into one draft, fills the Item × Vendor matrix,
 * and "Set Harga" turns its prices into the Master Price List (vendor_prices, with their history).
 * An item sits in one draft only (unique item_id), so a later draft no longer offers it.
 * New tables only: nothing existing changes, and down() drops them.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('price_list_drafts', function (Blueprint $table) {
            $table->id();
            $table->string('number', 30)->unique();
            $table->string('note', 500)->nullable();
            // DRAFT (prices being filled) / DONE (prices set in the Master Price List)
            $table->string('status', 10)->default('DRAFT');
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('done_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('done_at')->nullable();
            $table->timestamps();
            $table->index(['status', 'id']);
        });

        Schema::create('price_list_draft_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('price_list_draft_id')->constrained('price_list_drafts')->cascadeOnDelete();
            // one draft per item: the next draft does not offer it again
            $table->foreignId('item_id')->unique()->constrained('items');
            $table->timestamp('created_at')->nullable();
        });

        Schema::create('price_list_draft_vendors', function (Blueprint $table) {
            $table->id();
            $table->foreignId('price_list_draft_id')->constrained('price_list_drafts')->cascadeOnDelete();
            $table->foreignId('vendor_id')->constrained('vendors');
            $table->timestamp('created_at')->nullable();
            $table->unique(['price_list_draft_id', 'vendor_id']);
        });

        // a price typed in the matrix, in the item's own unit; it reaches vendor_prices at "Set Harga"
        Schema::create('price_list_draft_cells', function (Blueprint $table) {
            $table->id();
            $table->foreignId('price_list_draft_id')->constrained('price_list_drafts')->cascadeOnDelete();
            $table->foreignId('item_id')->constrained('items');
            $table->foreignId('vendor_id')->constrained('vendors');
            $table->decimal('price', 18, 2);
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->unique(['price_list_draft_id', 'item_id', 'vendor_id'], 'price_list_draft_cells_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('price_list_draft_cells');
        Schema::dropIfExists('price_list_draft_vendors');
        Schema::dropIfExists('price_list_draft_items');
        Schema::dropIfExists('price_list_drafts');
    }
};
