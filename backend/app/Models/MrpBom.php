<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** Bill of Materials: what one finished product is made of, per revision (DRAFT → ACTIVE → ARCHIVED). */
class MrpBom extends Model
{
    public const STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'];

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['revision' => 'integer', 'effective_date' => 'date', 'activated_at' => 'datetime', 'archived_at' => 'datetime'];
    }

    public function item(): BelongsTo
    {
        return $this->belongsTo(Item::class);
    }

    public function lines(): HasMany
    {
        return $this->hasMany(MrpBomLine::class)->orderBy('sort')->orderBy('id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function activator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'activated_by');
    }
}
