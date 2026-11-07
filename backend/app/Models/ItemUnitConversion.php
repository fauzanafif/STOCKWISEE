<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** For one item: 1 unit = ratio × the item's own unit (1 PCK = 10 PCS for this item). */
class ItemUnitConversion extends Model
{
    protected $fillable = ['item_id', 'unit_id', 'ratio', 'created_by'];

    protected function casts(): array
    {
        return ['ratio' => 'decimal:6'];
    }

    public function unit(): BelongsTo
    {
        return $this->belongsTo(Unit::class);
    }
}
