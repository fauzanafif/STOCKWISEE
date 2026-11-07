<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Who picks a request's goods up for the requester, and the one-time code Gudang scans (QR). */
class ItemRequestProxy extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['expires_at' => 'datetime', 'used_at' => 'datetime', 'cancelled_at' => 'datetime'];
    }

    public function request(): BelongsTo
    {
        return $this->belongsTo(ItemRequest::class, 'item_request_id');
    }

    public function isActive(): bool
    {
        return ! $this->used_at && ! $this->cancelled_at && $this->expires_at->isFuture();
    }
}
