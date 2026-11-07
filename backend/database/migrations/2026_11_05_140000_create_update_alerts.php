<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Update Alert (Super Admin): a warning or new-feature notice shown as a popup to every user,
 * once / at each login / every N minutes. update_alert_views: when each user last closed it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('update_alerts', function (Blueprint $table) {
            $table->id();
            $table->string('title', 120);
            $table->text('message');
            $table->string('type', 20); // feature, warning, info
            $table->string('display_mode', 20); // once, login, interval
            $table->unsignedInteger('interval_minutes')->nullable(); // display_mode = interval
            $table->dateTime('starts_at')->nullable();
            $table->dateTime('ends_at')->nullable();
            $table->boolean('is_active')->default(true);
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('update_alert_views', function (Blueprint $table) {
            $table->id();
            $table->foreignId('update_alert_id')->constrained('update_alerts')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->dateTime('last_seen_at');
            $table->unique(['user_id', 'update_alert_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('update_alert_views');
        Schema::dropIfExists('update_alerts');
    }
};
