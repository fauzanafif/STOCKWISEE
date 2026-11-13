<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Odoo-style document collaboration, additive only — see App\Support\Documents:
 *   doc_messages / doc_message_attachments  Chatter: messages (seen by everyone who sees the document, the requester
 *                                           too) and internal notes (staff only), with files
 *   doc_activities                          follow-up tasks on a document: who, what, due when, done or not
 *   doc_audit_logs                          what changed on a document (before → after), by whom; append only
 * A document is (res_type, res_key): the key is the id, or the document number for documents kept one row per
 * item line (Delivery Order = no_npbg, Purchase Request = no_ppb, Receipt = no_ri).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('doc_messages', function (Blueprint $table) {
            $table->id();
            $table->string('res_type', 30);
            $table->string('res_key', 80);
            $table->string('kind', 10)->default('MESSAGE'); // MESSAGE / NOTE
            $table->text('body');
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('edited_at')->nullable();
            $table->timestamp('deleted_at')->nullable();
            $table->foreignId('deleted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->index(['res_type', 'res_key'], 'doc_msg_res_idx');
        });

        Schema::create('doc_message_attachments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('doc_message_id')->constrained('doc_messages')->cascadeOnDelete();
            $table->string('original_name', 255);
            $table->string('path', 500);
            $table->string('mime', 150)->nullable();
            $table->unsignedInteger('size')->default(0);
            $table->foreignId('uploaded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('doc_activities', function (Blueprint $table) {
            $table->id();
            $table->string('res_type', 30);
            $table->string('res_key', 80);
            $table->unsignedBigInteger('res_id'); // the id the document page opens with
            $table->string('res_number', 80)->nullable();
            $table->string('activity_type', 20); // TODO / FOLLOW_UP / VERIFY / PREPARE / CALL / DOCUMENT
            $table->string('summary', 200);
            $table->text('note')->nullable();
            $table->foreignId('assignee_id')->constrained('users');
            $table->date('due_date');
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('done_at')->nullable();
            $table->foreignId('done_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('done_note', 500)->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->foreignId('cancelled_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->index(['res_type', 'res_key'], 'doc_act_res_idx');
            $table->index(['assignee_id', 'done_at', 'cancelled_at'], 'doc_act_assignee_idx');
        });

        Schema::create('doc_audit_logs', function (Blueprint $table) {
            $table->id();
            $table->string('res_type', 30);
            $table->string('res_key', 80);
            $table->string('model', 40); // e.g. ItemRequestLine
            $table->unsignedBigInteger('model_id')->nullable();
            $table->string('event', 30); // CREATED / UPDATED / DELETED / MESSAGE_EDITED / MESSAGE_DELETED / ACTIVITY_*
            $table->json('changes')->nullable(); // {field: [before, after]}
            $table->string('reason', 500)->nullable();
            $table->unsignedBigInteger('user_id')->nullable(); // no FK: the log outlives the user
            $table->string('user_name', 150)->nullable();
            $table->string('route', 120)->nullable();
            $table->string('ip', 45)->nullable();
            $table->timestamp('created_at')->useCurrent();
            $table->index(['res_type', 'res_key'], 'doc_audit_res_idx');
            $table->index('created_at', 'doc_audit_created_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('doc_audit_logs');
        Schema::dropIfExists('doc_activities');
        Schema::dropIfExists('doc_message_attachments');
        Schema::dropIfExists('doc_messages');
    }
};
