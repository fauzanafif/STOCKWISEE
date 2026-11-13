<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A follow-up task on a document: who has to do what, by when, and whether it was done. */
class DocActivity extends Model
{
    public const TYPES = ['TODO', 'FOLLOW_UP', 'VERIFY', 'PREPARE', 'CALL', 'DOCUMENT'];

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['due_date' => 'date', 'done_at' => 'datetime', 'cancelled_at' => 'datetime'];
    }

    public function assignee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assignee_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function doneBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'done_by');
    }
}
