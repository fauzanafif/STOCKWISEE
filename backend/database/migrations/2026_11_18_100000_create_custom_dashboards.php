<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Custom dashboards: a user's own page of widgets, each reading an API STOCKWISE already has (with the
 * viewer's own permissions). Personal (its owner only) or Shared (everyone signed in may open it; only its
 * owner changes it). The built-in dashboards stay as they are. A new table only; down() drops it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('custom_dashboards', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('name', 100);
            $table->string('description', 500)->nullable();
            $table->string('icon', 40)->default('layout-dashboard');
            // PERSONAL / SHARED
            $table->string('visibility', 10)->default('PERSONAL');
            // the app workspace it opens from (inventory, purchase, …); null: Dashboard only
            $table->string('app_key', 30)->nullable();
            // [{id, type, source, title, w, h}] in their order on the page
            $table->json('widgets');
            $table->timestamps();
            $table->index(['visibility', 'app_key']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('custom_dashboards');
    }
};
