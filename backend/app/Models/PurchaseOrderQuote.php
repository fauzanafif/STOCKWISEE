<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A vendor's price for a Draft PO item (the price comparison). */
class PurchaseOrderQuote extends Model
{
    protected $fillable = ['purchase_order_item_id', 'vendor_id', 'unit_price', 'note', 'availability', 'eta', 'chosen_at', 'chosen_by', 'created_by'];

    protected function casts(): array
    {
        return ['unit_price' => 'float', 'eta' => 'date', 'chosen_at' => 'datetime'];
    }

    public function chooser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'chosen_by');
    }

    public function item(): BelongsTo
    {
        return $this->belongsTo(PurchaseOrderItem::class, 'purchase_order_item_id');
    }

    public function vendor(): BelongsTo
    {
        return $this->belongsTo(Vendor::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
