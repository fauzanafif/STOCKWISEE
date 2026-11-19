<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Stock Opname — the controlled workflow (Draft → Confirmed → Counting → Review ⇄ Recount → Waiting Approval →
 * Posted → Done). Only adds: no existing column, row or status is changed, so the 2.500+ Accurate ITEMADJ mirrors
 * and the internal documents already there keep working (old statuses are read as their new equivalent, see
 * StockOpname::flowStatus()).
 *
 *  - stock_opnames: what the order asks for (method, location, category, person in charge, notes), who did each
 *    step and when, the frozen book quantity time, the posting batch (idempotency) and a correction link.
 *  - stock_opname_team: the counting team.
 *  - stock_opname_counts: every count of every line, round 1 = first count, 2+ = recounts. Never updated or
 *    deleted — a recount adds a row, the line keeps only the latest as physical_qty.
 *  - stock_opname_events: append-only status history / audit trail of the document.
 *  - stock_adjustments.stock_opname_id + unique(stock_opname_item_id): one adjustment per line, ever.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('stock_opnames', function (Blueprint $table) {
            $table->string('count_method', 10)->default('FULL')->after('type');            // FULL / CYCLE
            $table->foreignId('warehouse_location_id')->nullable()->after('warehouse_id')->constrained('warehouse_locations')->nullOnDelete();
            $table->foreignId('category_id')->nullable()->after('warehouse_location_id')->constrained('categories')->nullOnDelete();
            $table->foreignId('responsible_id')->nullable()->after('category_id')->constrained('users')->nullOnDelete();
            $table->text('notes')->nullable()->after('review_note');
            $table->unsignedSmallInteger('count_round')->default(1)->after('status');
            $table->timestamp('snapshot_at')->nullable()->after('started_at');
            $table->foreignId('confirmed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('confirmed_at')->nullable();
            $table->foreignId('approval_requested_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('approval_requested_at')->nullable();
            $table->foreignId('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('approved_at')->nullable();
            $table->string('approval_note', 500)->nullable();
            $table->foreignId('posted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('posted_at')->nullable();
            $table->uuid('posting_batch')->nullable()->unique();
            $table->foreignId('closed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('closed_at')->nullable();
            $table->foreignId('cancelled_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('cancelled_at')->nullable();
            $table->string('cancel_reason', 500)->nullable();
            $table->foreignId('correction_of_id')->nullable()->constrained('stock_opnames')->nullOnDelete();
        });

        Schema::table('stock_opname_items', function (Blueprint $table) {
            $table->unsignedSmallInteger('count_round')->default(0)->after('count_status');  // 0 = not counted yet
            $table->foreignId('counted_by')->nullable()->after('count_round')->constrained('users')->nullOnDelete();
            $table->timestamp('counted_at')->nullable()->after('counted_by');
            $table->string('recount_reason', 255)->nullable()->after('review_status');
            $table->string('review_note', 255)->nullable()->after('recount_reason');
        });

        Schema::create('stock_opname_team', function (Blueprint $table) {
            $table->id();
            $table->foreignId('stock_opname_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->timestamps();
            $table->unique(['stock_opname_id', 'user_id']);
        });

        Schema::create('stock_opname_counts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('stock_opname_id')->constrained()->cascadeOnDelete();
            $table->foreignId('stock_opname_item_id')->constrained()->cascadeOnDelete();
            $table->unsignedSmallInteger('round');
            $table->decimal('counted_qty', 14, 2);
            $table->string('note', 255)->nullable();
            $table->string('recount_reason', 255)->nullable();
            $table->string('source', 10)->default('MANUAL');   // MANUAL / SCAN
            $table->foreignId('counted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('counted_by_name', 120)->nullable();
            $table->timestamp('counted_at');
            $table->index(['stock_opname_item_id', 'round']);
        });

        Schema::create('stock_opname_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('stock_opname_id')->constrained()->cascadeOnDelete();
            $table->foreignId('stock_opname_item_id')->nullable()->constrained()->nullOnDelete();
            $table->string('event', 30);
            $table->string('from_status', 20)->nullable();
            $table->string('to_status', 20)->nullable();
            $table->string('note', 500)->nullable();
            $table->json('meta')->nullable();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('user_name', 120)->nullable();
            $table->string('ip', 45)->nullable();
            $table->timestamp('created_at');
            $table->index(['stock_opname_id', 'id']);
            $table->index('created_at');
        });

        Schema::table('stock_adjustments', function (Blueprint $table) {
            $table->foreignId('stock_opname_id')->nullable()->after('id')->constrained()->nullOnDelete();
            $table->unique('stock_opname_item_id');
        });
    }

    public function down(): void
    {
        Schema::table('stock_adjustments', function (Blueprint $table) {
            $table->dropUnique(['stock_opname_item_id']);
            $table->dropConstrainedForeignId('stock_opname_id');
        });
        Schema::dropIfExists('stock_opname_events');
        Schema::dropIfExists('stock_opname_counts');
        Schema::dropIfExists('stock_opname_team');
        Schema::table('stock_opname_items', function (Blueprint $table) {
            $table->dropConstrainedForeignId('counted_by');
            $table->dropColumn(['count_round', 'counted_at', 'recount_reason', 'review_note']);
        });
        Schema::table('stock_opnames', function (Blueprint $table) {
            foreach (['warehouse_location_id', 'category_id', 'responsible_id', 'confirmed_by', 'approval_requested_by', 'approved_by', 'posted_by', 'closed_by', 'cancelled_by', 'correction_of_id'] as $fk) {
                $table->dropConstrainedForeignId($fk);
            }
            $table->dropUnique(['posting_batch']);
            $table->dropColumn(['count_method', 'notes', 'count_round', 'snapshot_at', 'confirmed_at', 'approval_requested_at', 'approved_at',
                'approval_note', 'posted_at', 'posting_batch', 'closed_at', 'cancelled_at', 'cancel_reason']);
        });
    }
};
