<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** Items picked for a Purchase Request, kept before asking for approval. */
class PpbSavedDraft extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['tgl_ppb' => 'date', 'tgl_diperlukan' => 'date'];
    }

    /** What can still go into the Purchase Request. */
    public function openLines(): HasMany
    {
        return $this->hasMany(PpbDraftLine::class, 'saved_draft_id')->whereNull('ppb_id')->whereHas('draft', fn ($d) => $d->where('status', 'DRAFT'))->orderBy('id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
