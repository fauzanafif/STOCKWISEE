<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Disassembly Order (unbuild): DRAFT → CONFIRMED → IN_PROGRESS → TO_CLOSE → DONE, or CANCELLED.
 * The BoM is copied into its components when it is created, so a later BoM change never alters it.
 */
class DisassemblyOrder extends Model
{
    public const STATUSES = ['DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'TO_CLOSE', 'DONE', 'CANCELLED'];

    protected $guarded = ['id'];

    protected function casts(): array
    {
        $casts = ['accurate_refs' => 'array'];
        foreach (['confirmed', 'started', 'finished', 'done', 'cancelled', 'reversed', 'accurate_recorded'] as $step) {
            $casts["{$step}_at"] = 'datetime';
        }

        return $casts;
    }

    public function bom(): BelongsTo
    {
        return $this->belongsTo(MrpBom::class, 'mrp_bom_id');
    }

    public function item(): BelongsTo
    {
        return $this->belongsTo(Item::class);
    }

    public function sourceWarehouse(): BelongsTo
    {
        return $this->belongsTo(Warehouse::class, 'source_warehouse_id');
    }

    public function destWarehouse(): BelongsTo
    {
        return $this->belongsTo(Warehouse::class, 'dest_warehouse_id');
    }

    public function components(): HasMany
    {
        return $this->hasMany(DisassemblyComponent::class)->orderBy('sort')->orderBy('id');
    }

    public function entries(): HasMany
    {
        return $this->hasMany(DisassemblyEntry::class)->orderBy('id');
    }

    public function responsible(): BelongsTo
    {
        return $this->belongsTo(User::class, 'responsible_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /** Where the recovered components go: the destination warehouse, or the source one. */
    public function componentWarehouseId(): int
    {
        return (int) ($this->dest_warehouse_id ?: $this->source_warehouse_id);
    }
}
