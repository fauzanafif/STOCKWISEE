<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A component of one MO: the BoM line frozen at creation, with what is required and held for it. */
class MrpProductionComponent extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['is_extra' => 'boolean'];
    }

    public function production(): BelongsTo
    {
        return $this->belongsTo(MrpProduction::class, 'mrp_production_id');
    }

    public function item(): BelongsTo
    {
        return $this->belongsTo(Item::class);
    }
}
