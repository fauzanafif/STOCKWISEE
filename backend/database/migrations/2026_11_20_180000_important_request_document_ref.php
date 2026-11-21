<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Important Request as the place to talk about anything: a topic may point at the transaction it is about
 * (a PO, a Purchase Request, a Receipt, a Draft PI …, any DocumentRegistry type). ref_number keeps the
 * document's number as it was, so the link still reads right if the document is later renumbered or removed.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('important_requests', function (Blueprint $table) {
            $table->string('ref_type', 30)->nullable()->after('category');
            $table->unsignedBigInteger('ref_id')->nullable()->after('ref_type');
            $table->string('ref_number', 80)->nullable()->after('ref_id');
            $table->index(['ref_type', 'ref_id']);
        });
    }

    public function down(): void
    {
        Schema::table('important_requests', function (Blueprint $table) {
            $table->dropIndex(['ref_type', 'ref_id']);
            $table->dropColumn(['ref_type', 'ref_id', 'ref_number']);
        });
    }
};
