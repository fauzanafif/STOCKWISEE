<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The PO flow before the Draft PO: an item of an approved PPB (PPB Siap PO) is put into the Penawaran
 * Harga, where purchasing notes each vendor's price, availability and ETA; it is submitted to the
 * Direktur, who picks one vendor (tagged), and only then it goes into a Draft PO.
 *   purchase_order_items.quote_stage: null (PPB Siap PO) / PENAWARAN / MENUNGGU_DIREKTUR / DIPILIH
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('purchase_order_items', function (Blueprint $table) {
            $table->string('quote_stage', 20)->nullable()->index();
            $table->timestamp('quote_submitted_at')->nullable();
            $table->string('quote_return_note', 500)->nullable();
        });
        Schema::table('purchase_order_quotes', function (Blueprint $table) {
            $table->string('availability', 100)->nullable();
            $table->date('eta')->nullable();
            $table->timestamp('chosen_at')->nullable();
            $table->foreignId('chosen_by')->nullable()->constrained('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('purchase_order_quotes', function (Blueprint $table) {
            $table->dropConstrainedForeignId('chosen_by');
            $table->dropColumn(['availability', 'eta', 'chosen_at']);
        });
        Schema::table('purchase_order_items', function (Blueprint $table) {
            $table->dropIndex(['quote_stage']);
            $table->dropColumn(['quote_stage', 'quote_submitted_at', 'quote_return_note']);
        });
    }
};
