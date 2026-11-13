<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The warehouse is the only door (additive):
 *   goods out  → Item Request → Delivery Order (NPBG) → handover
 *   goods in   → Receipt (RI)
 * item_requests.entered_by    who typed the request when it is made for someone else (admin gudang "on behalf")
 * warehouse_gate_links        a Manufacturing / Disassembly Order's Item Requests (its goods out) and Receipts
 *                             (its goods in); an RI belongs to one order at most.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('item_requests', function (Blueprint $table) {
            $table->foreignId('entered_by')->nullable()->after('requester_location')->constrained('users')->nullOnDelete();
        });

        Schema::create('warehouse_gate_links', function (Blueprint $table) {
            $table->id();
            $table->string('owner_type', 4); // MO / DSA
            $table->unsignedBigInteger('owner_id');
            $table->foreignId('item_request_id')->nullable()->constrained('item_requests')->nullOnDelete();
            $table->string('no_ri', 60)->nullable()->unique();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->index(['owner_type', 'owner_id'], 'wgl_owner_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('warehouse_gate_links');
        Schema::table('item_requests', fn (Blueprint $table) => $table->dropConstrainedForeignId('entered_by'));
    }
};
