<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Admin gudang's words at the verification, seen by the approvers and the requester:
 * a note on the request (optional) and, per item, why less than asked is given (required then).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('item_requests', function (Blueprint $table) {
            $table->text('verify_note')->nullable()->after('note');
        });
        Schema::table('item_request_lines', function (Blueprint $table) {
            $table->string('short_reason', 255)->nullable()->after('note');
        });
    }

    public function down(): void
    {
        Schema::table('item_request_lines', fn (Blueprint $t) => $t->dropColumn('short_reason'));
        Schema::table('item_requests', fn (Blueprint $t) => $t->dropColumn('verify_note'));
    }
};
