<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Purchase Information as complete as the Excel it replaces (PURCHASE_INFORMATION.xlsx): a price says whether
 * it is before PPN (DPP) or nett, its PPN rate, the vendor's quotation number and the PI document it came from.
 * In a Draft PI these are set once per vendor column (one quotation), and "Set Harga" copies them to the prices.
 *
 * Existing prices keep price_type NULL: nobody recorded whether they included PPN, so nothing is guessed and
 * they show as incomplete. Their PI document is taken from their history ("Dari Draft Price List PL/…").
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('vendor_prices', function (Blueprint $table) {
            // EXCL = before PPN (DPP), NETT = no PPN on top; NULL = not recorded
            $table->string('price_type', 10)->nullable()->after('price');
            $table->decimal('ppn_rate', 5, 2)->nullable()->after('price_type');
            $table->string('vendor_ref', 100)->nullable()->after('ppn_rate');
            $table->foreignId('price_list_draft_id')->nullable()->after('vendor_ref')->constrained('price_list_drafts')->nullOnDelete();
        });
        Schema::table('price_list_draft_vendors', function (Blueprint $table) {
            $table->string('price_type', 10)->default('EXCL');
            $table->decimal('ppn_rate', 5, 2)->default(11);
            $table->string('vendor_ref', 100)->nullable();
        });

        // the PI document of a price set from a draft, read from its history note
        $drafts = DB::table('price_list_drafts')->pluck('id', 'number');
        foreach (DB::table('vendor_price_histories')->where('note', 'like', 'Dari Draft Price List %')->orderBy('id')->get(['vendor_price_id', 'note']) as $h) {
            $number = trim(substr($h->note, strlen('Dari Draft Price List ')));
            if (isset($drafts[$number])) {
                DB::table('vendor_prices')->where('id', $h->vendor_price_id)->update(['price_list_draft_id' => $drafts[$number]]);
            }
        }
    }

    public function down(): void
    {
        Schema::table('vendor_prices', function (Blueprint $table) {
            $table->dropConstrainedForeignId('price_list_draft_id');
            $table->dropColumn(['price_type', 'ppn_rate', 'vendor_ref']);
        });
        Schema::table('price_list_draft_vendors', function (Blueprint $table) {
            $table->dropColumn(['price_type', 'ppn_rate', 'vendor_ref']);
        });
    }
};
