<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Pickup by a representative: the requester names who picks the goods up and gets a one-time code (QR);
 * Gudang scans it at the serah terima. One active code per request.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('item_request_proxies', function (Blueprint $table) {
            $table->id();
            $table->foreignId('item_request_id')->constrained('item_requests')->cascadeOnDelete();
            $table->string('name', 150);
            $table->string('code', 6)->index();
            $table->timestamp('expires_at');
            $table->timestamp('used_at')->nullable();
            $table->foreignId('used_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('item_request_fulfillment_id')->nullable()->constrained('item_request_fulfillments')->nullOnDelete();
            $table->timestamp('cancelled_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('item_request_proxies');
    }
};
