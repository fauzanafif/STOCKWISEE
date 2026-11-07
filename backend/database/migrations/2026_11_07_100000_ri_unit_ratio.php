<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * An RI line keeps its document quantity in the document's unit (5 PCK); stock is kuantitas × unit_ratio of the
 * item's own unit (50 PCS), as on an NPBG. Both are kept as they were at receipt, so a later change of a ratio
 * never rewrites what was received.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ri', function (Blueprint $table) {
            $table->decimal('unit_ratio', 18, 6)->default(1)->after('satuan');
            $table->string('base_satuan', 30)->nullable()->after('unit_ratio');
        });
    }

    public function down(): void
    {
        Schema::table('ri', function (Blueprint $table) {
            $table->dropColumn(['unit_ratio', 'base_satuan']);
        });
    }
};
