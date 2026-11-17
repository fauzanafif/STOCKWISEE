<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A Draft Price List: items × vendors whose prices are filled, then set in the Master Price List. */
class PriceListDraft extends Model
{
    public const DRAFT = 'DRAFT';

    public const DONE = 'DONE';

    protected $fillable = ['number', 'note', 'status', 'created_by', 'done_by', 'done_at'];

    protected $casts = ['done_at' => 'datetime'];

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function finisher(): BelongsTo
    {
        return $this->belongsTo(User::class, 'done_by');
    }

    public function isOpen(): bool
    {
        return $this->status === self::DRAFT;
    }
}
