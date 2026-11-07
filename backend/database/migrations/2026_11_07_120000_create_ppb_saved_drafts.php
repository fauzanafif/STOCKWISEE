<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Items picked for a Purchase Request and kept for later, before anyone is asked to approve. A line in one
 * leaves the To do list; deleting the draft sends its lines back there. No document number of its own.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ppb_saved_drafts', function (Blueprint $table) {
            $table->id();
            $table->string('name', 150)->nullable();
            $table->string('no_ppb', 60)->nullable();
            $table->date('tgl_ppb')->nullable();
            $table->date('tgl_diperlukan')->nullable();
            $table->string('divisi', 30)->nullable();
            $table->text('keterangan')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });
        Schema::table('ppb_draft_lines', function (Blueprint $table) {
            $table->foreignId('saved_draft_id')->nullable()->after('ppb_draft_id')->constrained('ppb_saved_drafts')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('ppb_draft_lines', fn (Blueprint $table) => $table->dropConstrainedForeignId('saved_draft_id'));
        Schema::dropIfExists('ppb_saved_drafts');
    }
};
