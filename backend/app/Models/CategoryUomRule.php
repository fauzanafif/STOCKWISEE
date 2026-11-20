<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One unit the items of a category may use. The units are the shared master (`units`); this only says which
 * of them fit the category and which one a new item starts with. A per-item unit's suggested_ratio pre-fills
 * the item's own conversion and is never used to convert.
 */
class CategoryUomRule extends Model
{
    protected $fillable = ['category_id', 'unit_id', 'is_default', 'suggested_ratio', 'sort'];

    protected function casts(): array
    {
        return ['is_default' => 'boolean', 'suggested_ratio' => 'decimal:6', 'sort' => 'integer'];
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class);
    }

    public function unit(): BelongsTo
    {
        return $this->belongsTo(Unit::class);
    }
}
