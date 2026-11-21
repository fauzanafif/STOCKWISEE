<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** The note given at "Set Harga" of a Draft Purchase Information (shown on the draft, copied to the prices' history). */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('price_list_drafts', function (Blueprint $table) {
            $table->string('done_note', 500)->nullable()->after('done_at');
        });
    }

    public function down(): void
    {
        Schema::table('price_list_drafts', function (Blueprint $table) {
            $table->dropColumn('done_note');
        });
    }
};
