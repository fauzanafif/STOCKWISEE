<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** The first time a user gave an alert a thumbs up. Closing it without one leaves this empty. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('update_alert_views', function (Blueprint $table) {
            $table->dateTime('thumbed_up_at')->nullable()->after('last_seen_at');
        });
    }

    public function down(): void
    {
        Schema::table('update_alert_views', fn (Blueprint $table) => $table->dropColumn('thumbed_up_at'));
    }
};
