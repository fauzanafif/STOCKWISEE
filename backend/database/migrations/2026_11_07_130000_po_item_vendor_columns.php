<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** The vendors purchasing chose for an item, before any price: its columns in the Draft PO table. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('purchase_order_item_vendors', function (Blueprint $table) {
            $table->id();
            $table->foreignId('purchase_order_item_id')->constrained('purchase_order_items')->cascadeOnDelete();
            $table->foreignId('vendor_id')->constrained('vendors')->cascadeOnDelete();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('created_at')->nullable();
            $table->unique(['purchase_order_item_id', 'vendor_id'], 'po_item_vendor_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('purchase_order_item_vendors');
    }
};
