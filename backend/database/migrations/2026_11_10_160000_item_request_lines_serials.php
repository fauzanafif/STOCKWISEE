<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** The serial numbers admin gudang picks while verifying an item with serial numbers ("A ; B"), held for this request. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('item_request_lines', function (Blueprint $table) {
            $table->text('serials')->nullable()->after('approved_qty');
        });
    }

    public function down(): void
    {
        Schema::table('item_request_lines', fn (Blueprint $table) => $table->dropColumn('serials'));
    }
};
