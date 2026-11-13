<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Who did what and when, to the second: logins, pages opened, every change sent to the API. Apart from the ERP tables. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('user_activity_logs', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id')->nullable();
            $table->string('user_name', 120)->nullable();
            // LOGIN · LOGIN_FAILED · LOGOUT · PAGE_VIEW · CREATE · UPDATE · DELETE · ACTION
            $table->string('event', 20);
            $table->string('module', 80)->nullable();
            $table->string('description', 255)->nullable();
            $table->string('subject', 160)->nullable();
            $table->string('method', 8)->nullable();
            $table->string('path', 255)->nullable();
            $table->string('route', 120)->nullable();
            $table->unsignedSmallInteger('status')->nullable();
            $table->string('ip', 45)->nullable();
            $table->string('user_agent', 255)->nullable();
            $table->json('details')->nullable();
            $table->timestamp('created_at')->useCurrent();
            $table->index('created_at', 'ual_created_idx');
            $table->index(['user_id', 'created_at'], 'ual_user_created_idx');
            $table->index(['event', 'created_at'], 'ual_event_created_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_activity_logs');
    }
};
