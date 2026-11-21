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

    /** the price is before PPN (DPP: PPN comes on top) or nett (no PPN on top) */
    public const EXCL = 'EXCL';

    public const NETT = 'NETT';

    public const PRICE_TYPES = [self::EXCL, self::NETT];

    /** the PPN rates a price before PPN may carry (a choice, not typed: the Excel had 1.11 / 2.11 typos) */
    public const PPN_RATES = [11, 12];

    protected $fillable = [
        'item_id', 'vendor_id', 'unit_id', 'unit_ratio', 'base_unit_id', 'price', 'price_type', 'ppn_rate', 'vendor_ref', 'price_list_draft_id',
        'min_qty', 'lead_time_days', 'valid_from', 'valid_until', 'status', 'notes', 'created_by', 'updated_by',
    ];

    protected function casts(): array
    {
        return [
            'price' => 'decimal:2', 'min_qty' => 'decimal:2', 'unit_ratio' => 'decimal:6', 'ppn_rate' => 'decimal:2',
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

    public function draft(): BelongsTo
    {
        return $this->belongsTo(PriceListDraft::class, 'price_list_draft_id');
    }

    /** What is paid per purchase unit: before PPN plus its PPN, or the nett price; null when the type was not recorded. */
    public function finalPrice(): ?float
    {
        return match ($this->price_type) {
            self::EXCL => round((float) $this->price * (1 + (float) $this->ppn_rate / 100), 2),
            self::NETT => (float) $this->price,
            default => null,
        };
    }

    /**
     * What a complete price still lacks, as the Excel Purchase Information has it: whether PPN is included,
     * and where it came from (a PI document or the vendor's quotation number).
     *
     * @return list<string>
     */
    public function missing(): array
    {
        return array_values(array_filter([
            $this->price_type === null ? 'tax' : null,
            $this->price_list_draft_id === null && blank($this->vendor_ref) ? 'source' : null,
        ]));
    }

    /** Prices that still lack something (see missing()). */
    public function scopeIncomplete(Builder $q): Builder
    {
        return $q->where(fn ($w) => $w->whereNull('vendor_prices.price_type')
            ->orWhere(fn ($s) => $s->whereNull('vendor_prices.price_list_draft_id')->where(fn ($r) => $r->whereNull('vendor_prices.vendor_ref')->orWhere('vendor_prices.vendor_ref', ''))));
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
