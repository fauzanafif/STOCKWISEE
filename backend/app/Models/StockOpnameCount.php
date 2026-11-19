<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** One physical count of one opname line (round 1 = first count, 2+ = recounts). Append only: a recount adds a row. */
class StockOpnameCount extends Model
{
    public $timestamps = false;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['counted_qty' => 'float', 'round' => 'integer', 'counted_at' => 'datetime'];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Hasil hitung tidak boleh diubah — hitung ulang menambah baris baru.'));
        static::deleting(fn () => throw new LogicException('Hasil hitung tidak boleh dihapus.'));
    }

    public function line(): BelongsTo
    {
        return $this->belongsTo(StockOpnameItem::class, 'stock_opname_item_id');
    }
}
