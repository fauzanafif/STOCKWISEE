<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * What came out of the disassembly for one component: GOOD (enters stock at validation), SCRAP (damaged)
 * or MISSING (not found). Kept as typed (qty + unit) with the ratio frozen at that moment.
 */
class DisassemblyEntry extends Model
{
    public const KINDS = ['GOOD', 'SCRAP', 'MISSING'];

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['entry_date' => 'date', 'over_plan' => 'boolean', 'posted_at' => 'datetime', 'voided_at' => 'datetime'];
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(DisassemblyOrder::class, 'disassembly_order_id');
    }

    public function component(): BelongsTo
    {
        return $this->belongsTo(DisassemblyComponent::class, 'component_id');
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
