<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * For one item: 1 unit = ratio × the item's own unit (1 PCK = 10 PCS for this item). base_unit_id is
 * the item's unit when the ratio was set; once the item's unit is another, the conversion needs a
 * review and is not used (see UomConverter).
 */
class ItemUnitConversion extends Model
{
    protected $fillable = ['item_id', 'unit_id', 'ratio', 'base_unit_id', 'created_by'];

    protected function casts(): array
    {
        return ['ratio' => 'decimal:6'];
    }

    public function unit(): BelongsTo
    {
        return $this->belongsTo(Unit::class);
    }

    public function baseUnit(): BelongsTo
    {
        return $this->belongsTo(Unit::class, 'base_unit_id');
    }

    /** Set against another base unit than the item's of today. */
    public function isStale(?int $itemUnitId): bool
    {
        return $this->base_unit_id !== null && (int) $this->base_unit_id !== (int) $itemUnitId;
    }
}
