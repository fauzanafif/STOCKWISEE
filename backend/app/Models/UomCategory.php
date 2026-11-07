<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** A kind of measurement (Weight, Length…): its units convert to each other through its one reference unit. */
class UomCategory extends Model
{
    protected $fillable = ['name'];

    public function units(): HasMany
    {
        return $this->hasMany(Unit::class);
    }
}
