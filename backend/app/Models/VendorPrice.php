<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Price List: an item's standing purchase price at a vendor, per purchase unit and minimum
 * quantity. Stored status is DRAFT / ACTIVE / ARCHIVED; an ACTIVE price whose valid_until has
 * passed reads as EXPIRED (no job needed to flip it). A price is a reference only: Purchasing still
 * checks it with the vendor when a Purchase Request comes.
 */
class VendorPrice extends Model
{
    public const DRAFT = 'DRAFT';

    public const ACTIVE = 'ACTIVE';

    public const EXPIRED = 'EXPIRED';

    public const ARCHIVED = 'ARCHIVED';

    /** what can be stored (EXPIRED is read from the dates) */
    public const STORED = [self::DRAFT, self::ACTIVE, self::ARCHIVED];

    protected $fillable = [
        'item_id', 'vendor_id', 'unit_id', 'unit_ratio', 'base_unit_id', 'price', 'min_qty', 'lead_time_days',
        'valid_from', 'valid_until', 'status', 'notes', 'created_by', 'updated_by',
    ];

    protected function casts(): array
    {
        return [
            'price' => 'decimal:2', 'min_qty' => 'decimal:2', 'unit_ratio' => 'decimal:6',
            'lead_time_days' => 'integer', 'valid_from' => 'date', 'valid_until' => 'date',
        ];
    }

    public function item(): BelongsTo
    {
        return $this->belongsTo(Item::class);
    }

    public function vendor(): BelongsTo
    {
        return $this->belongsTo(Vendor::class);
    }

    public function unit(): BelongsTo
    {
        return $this->belongsTo(Unit::class);
    }

    public function updater(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by');
    }

    public function histories(): HasMany
    {
        return $this->hasMany(VendorPriceHistory::class)->orderByDesc('id');
    }

    /** What the user sees: ACTIVE past its valid_until is EXPIRED. */
    public function effectiveStatus(): string
    {
        if ($this->status === self::ACTIVE && $this->valid_until && $this->valid_until->lt(today())) {
            return self::EXPIRED;
        }

        return $this->status;
    }

    /**
     * The item's base unit is no longer the one the unit ratio was taken against (changed from any source):
     * the price shows, but is not the "lowest" and Purchasing should save it again.
     */
    public function needsReview(): bool
    {
        if ($this->base_unit_id === null) {
            return false;
        }
        $itemUnit = $this->relationLoaded('item') ? $this->item?->unit_id : Item::whereKey($this->item_id)->value('unit_id');

        return (int) $this->base_unit_id !== (int) $itemUnit;
    }

    /** Prices of this effective status (EXPIRED / ACTIVE read the dates). */
    public function scopeEffective(Builder $q, string $status): Builder
    {
        $today = today()->toDateString();

        return match ($status) {
            self::EXPIRED => $q->where('vendor_prices.status', self::ACTIVE)->whereNotNull('vendor_prices.valid_until')->where('vendor_prices.valid_until', '<', $today),
            self::ACTIVE => $q->where('vendor_prices.status', self::ACTIVE)->where(fn ($w) => $w->whereNull('vendor_prices.valid_until')->orWhere('vendor_prices.valid_until', '>=', $today)),
            default => $q->where('vendor_prices.status', $status),
        };
    }

    /** Not archived: the prices the matrix and the Purchase Request reference show. */
    public function scopeCurrent(Builder $q): Builder
    {
        return $q->where('vendor_prices.status', '!=', self::ARCHIVED);
    }
}
