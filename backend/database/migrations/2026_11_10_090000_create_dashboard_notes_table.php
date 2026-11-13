<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** The main dashboard's sticky notes: private to the user who wrote them, apart from every ERP table. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('dashboard_notes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users', 'id', 'dashboard_notes_user_fk')->cascadeOnDelete();
            $table->string('title', 120)->nullable();
            $table->text('body')->nullable();
            $table->json('checklist')->nullable();
            $table->string('color', 16)->default('yellow');
            $table->boolean('pinned')->default(false);
            $table->timestamp('done_at')->nullable();
            $table->dateTime('remind_at')->nullable();
            $table->timestamps();
            $table->index(['user_id', 'pinned'], 'dashboard_notes_user_pinned_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('dashboard_notes');
    }
};
