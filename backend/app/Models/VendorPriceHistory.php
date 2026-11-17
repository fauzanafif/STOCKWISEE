<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** One change of a Price List price (append only: a row is never updated or deleted). */
class VendorPriceHistory extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = [
        'vendor_price_id', 'item_id', 'vendor_id', 'action', 'old_price', 'new_price',
        'old_status', 'new_status', 'changes', 'note', 'user_id', 'user_name',
    ];

    protected function casts(): array
    {
        return ['old_price' => 'decimal:2', 'new_price' => 'decimal:2', 'changes' => 'array'];
    }
}
