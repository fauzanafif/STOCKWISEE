<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Sticky notes stuck on an app overview card: `anchor` says which card ("inventory:/npbg"), `layout` where the
 * note floats on the screen ({x, y, w, h, open}). Both nullable: a note without an anchor stays a plain note.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('dashboard_notes', function (Blueprint $table) {
            $table->string('anchor', 160)->nullable()->after('user_id');
            $table->json('layout')->nullable()->after('anchor');
            $table->index(['user_id', 'anchor'], 'dashboard_notes_user_anchor_idx');
        });
    }

    public function down(): void
    {
        Schema::table('dashboard_notes', function (Blueprint $table) {
            $table->dropIndex('dashboard_notes_user_anchor_idx');
            $table->dropColumn(['anchor', 'layout']);
        });
    }
};
