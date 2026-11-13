<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** A Chatter message (seen by everyone who sees the document) or internal note (staff only) on a document. */
class DocMessage extends Model
{
    public const KINDS = ['MESSAGE', 'NOTE'];

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['edited_at' => 'datetime', 'deleted_at' => 'datetime'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function attachments(): HasMany
    {
        return $this->hasMany(DocMessageAttachment::class);
    }
}
