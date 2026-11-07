<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** One Director pick, change or return of a Price Quotation item. */
class PurchaseOrderPickLog extends Model
{
    public $timestamps = false;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['from_price' => 'float', 'to_price' => 'float', 'created_at' => 'datetime'];
    }
}
