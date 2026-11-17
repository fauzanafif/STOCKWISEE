<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Price List: the standing purchase price of an item at a vendor (Item × Vendor), apart from any
 * Purchase Request. One item has prices at many vendors, one vendor at many items; a price is
 * kept per purchase unit and minimum quantity (a tier). Every change is written to the history,
 * which is never overwritten. New tables only: nothing existing changes, and down() drops them.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('vendor_prices', function (Blueprint $table) {
            $table->id();
            $table->foreignId('item_id')->constrained('items');
            $table->foreignId('vendor_id')->constrained('vendors');
            // the purchase unit and how many of the item's own unit it is, frozen when saved
            $table->foreignId('unit_id')->constrained('units');
            $table->decimal('unit_ratio', 18, 6)->default(1);
            // the item's own unit the ratio was taken against: when it changes, the price needs a review
            $table->foreignId('base_unit_id')->nullable()->constrained('units')->nullOnDelete();
            $table->decimal('price', 18, 2);
            $table->decimal('min_qty', 18, 2)->default(1);
            $table->unsignedSmallInteger('lead_time_days')->nullable();
            $table->date('valid_from')->nullable();
            $table->date('valid_until')->nullable();
            // DRAFT / ACTIVE / ARCHIVED; an ACTIVE price past valid_until reads as EXPIRED
            $table->string('status', 12)->default('DRAFT');
            $table->string('notes', 500)->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['item_id', 'vendor_id', 'status'], 'vendor_prices_item_vendor_status_idx');
            $table->index(['vendor_id', 'status'], 'vendor_prices_vendor_status_idx');
        });

        Schema::create('vendor_price_histories', function (Blueprint $table) {
            $table->id();
            $table->foreignId('vendor_price_id')->constrained('vendor_prices')->cascadeOnDelete();
            $table->unsignedBigInteger('item_id');
            $table->unsignedBigInteger('vendor_id');
            // CREATE / UPDATE / ARCHIVE / RESTORE
            $table->string('action', 10);
            $table->decimal('old_price', 18, 2)->nullable();
            $table->decimal('new_price', 18, 2)->nullable();
            $table->string('old_status', 12)->nullable();
            $table->string('new_status', 12)->nullable();
            // the other fields that changed: {field: [old, new]}
            $table->json('changes')->nullable();
            $table->string('note', 500)->nullable();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('user_name', 150)->nullable();
            $table->timestamp('created_at')->nullable();

            $table->index(['vendor_price_id', 'id'], 'vendor_price_histories_price_idx');
            $table->index(['item_id', 'vendor_id'], 'vendor_price_histories_item_vendor_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('vendor_price_histories');
        Schema::dropIfExists('vendor_prices');
    }
};
