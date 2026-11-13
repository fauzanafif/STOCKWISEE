<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One component of a BoM: qty per 1 finished product, in the component's Base UOM (decimal string). */
class MrpBomLine extends Model
{
    protected $guarded = ['id'];

    public function bom(): BelongsTo
    {
        return $this->belongsTo(MrpBom::class, 'mrp_bom_id');
    }

    public function item(): BelongsTo
    {
        return $this->belongsTo(Item::class);
    }
}
