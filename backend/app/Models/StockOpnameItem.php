<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class StockOpnameItem extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'system_qty' => 'float',
            'physical_qty' => 'float',
            'difference' => 'float',
            'count_round' => 'integer',
            'counted_at' => 'datetime',
        ];
    }

    public function opname(): BelongsTo
    {
        return $this->belongsTo(StockOpname::class, 'stock_opname_id');
    }

    public function item(): BelongsTo
    {
        return $this->belongsTo(Item::class);
    }

    public function location(): BelongsTo
    {
        return $this->belongsTo(WarehouseLocation::class, 'warehouse_location_id');
    }

    public function countedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'counted_by');
    }

    /** every count of this line, oldest first (the last one is physical_qty) */
    public function counts(): HasMany
    {
        return $this->hasMany(StockOpnameCount::class)->orderBy('round')->orderBy('id');
    }

    public function adjustment(): HasOne
    {
        return $this->hasOne(StockAdjustment::class);
    }

    /** physical − system, in % of system (null when there is no system qty to compare with, or not counted) */
    public function variancePct(): ?float
    {
        if ($this->physical_qty === null || abs((float) $this->system_qty) < 1e-9) {
            return null;
        }

        return round(((float) $this->physical_qty - (float) $this->system_qty) / (float) $this->system_qty * 100, 2);
    }
}
