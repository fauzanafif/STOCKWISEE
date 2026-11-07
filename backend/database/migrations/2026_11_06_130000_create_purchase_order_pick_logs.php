<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Every Director pick, change and return of a Price Quotation item: who, from what, to what, and why. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('purchase_order_pick_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('purchase_order_item_id')->constrained('purchase_order_items')->cascadeOnDelete();
            $table->string('action', 10); // PICK / CHANGE / RETURN
            // names and prices as they were at that moment
            $table->string('from_vendor')->nullable();
            $table->decimal('from_price', 18, 2)->nullable();
            $table->string('to_vendor')->nullable();
            $table->decimal('to_price', 18, 2)->nullable();
            $table->string('reason', 500)->nullable();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('user_name', 150)->nullable();
            $table->timestamp('created_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('purchase_order_pick_logs');
    }
};
