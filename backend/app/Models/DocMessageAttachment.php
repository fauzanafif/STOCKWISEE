<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DocMessageAttachment extends Model
{
    protected $guarded = ['id'];

    public function message(): BelongsTo
    {
        return $this->belongsTo(DocMessage::class, 'doc_message_id');
    }
}
