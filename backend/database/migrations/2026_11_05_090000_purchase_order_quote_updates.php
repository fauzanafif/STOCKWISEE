<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Every price purchasing saved for a vendor: a quote keeps only the latest, this keeps when it changed and by whom. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('purchase_order_quote_updates', function (Blueprint $table) {
            $table->id();
            $table->foreignId('purchase_order_item_id')->constrained('purchase_order_items', 'id', 'po_quote_updates_line_fk')->cascadeOnDelete();
            $table->unsignedBigInteger('item_id')->nullable();
            $table->foreignId('vendor_id')->constrained('vendors', 'id', 'po_quote_updates_vendor_fk')->cascadeOnDelete();
            $table->decimal('unit_price', 18, 2);
            $table->foreignId('user_id')->nullable()->constrained('users', 'id', 'po_quote_updates_user_fk')->nullOnDelete();
            $table->timestamp('created_at')->nullable();

            $table->index(['item_id', 'vendor_id', 'id'], 'po_quote_updates_item_vendor_idx');
            $table->index(['purchase_order_item_id', 'vendor_id', 'id'], 'po_quote_updates_line_vendor_idx');
        });

        // the prices already saved start the history
        DB::statement('INSERT INTO purchase_order_quote_updates (purchase_order_item_id, item_id, vendor_id, unit_price, user_id, created_at)
            SELECT q.purchase_order_item_id, l.item_id, q.vendor_id, q.unit_price, q.created_by, q.updated_at
            FROM purchase_order_quotes q JOIN purchase_order_items l ON l.id = q.purchase_order_item_id ORDER BY q.updated_at, q.id');
    }

    public function down(): void
    {
        Schema::dropIfExists('purchase_order_quote_updates');
    }
};
