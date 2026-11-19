<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** The status history / audit trail of a Stock Opname. Append only: never updated or deleted by the app. */
class StockOpnameEvent extends Model
{
    public $timestamps = false;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['meta' => 'array', 'created_at' => 'datetime'];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Riwayat Stock Opname tidak boleh diubah.'));
        static::deleting(fn () => throw new LogicException('Riwayat Stock Opname tidak boleh dihapus.'));
    }

    public function opname(): BelongsTo
    {
        return $this->belongsTo(StockOpname::class, 'stock_opname_id');
    }
}
