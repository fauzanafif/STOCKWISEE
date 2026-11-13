<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One component a Disassembly Order expects to recover (BoM snapshot), in the component's Base UOM. */
class DisassemblyComponent extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['is_extra' => 'boolean'];
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(DisassemblyOrder::class, 'disassembly_order_id');
    }

    public function item(): BelongsTo
    {
        return $this->belongsTo(Item::class);
    }
}
