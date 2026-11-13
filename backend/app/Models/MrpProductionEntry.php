<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * What happened in production: component used (CONSUME), good output (OUTPUT) or waste (SCRAP).
 * Keeps the typed qty + unit and the ratio frozen at that moment; stock moves only when the MO is validated.
 */
class MrpProductionEntry extends Model
{
    public const KINDS = ['CONSUME', 'OUTPUT', 'SCRAP'];

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['entry_date' => 'date', 'over_plan' => 'boolean', 'posted_at' => 'datetime', 'voided_at' => 'datetime'];
    }

    public function production(): BelongsTo
    {
        return $this->belongsTo(MrpProduction::class, 'mrp_production_id');
    }

    public function item(): BelongsTo
    {
        return $this->belongsTo(Item::class);
    }

    public function recorder(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recorded_by');
    }
}
