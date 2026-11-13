<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Manufacturing Order: DRAFT → CONFIRMED → IN_PROGRESS → TO_CLOSE → DONE, or CANCELLED.
 * The BoM is copied into its components when it is created, so a later BoM change never alters it.
 */
class MrpProduction extends Model
{
    public const STATUSES = ['DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'TO_CLOSE', 'DONE', 'CANCELLED'];

    public const PRIORITIES = ['NORMAL', 'URGENT'];

    protected $guarded = ['id'];

    protected function casts(): array
    {
        $casts = ['planned_start' => 'date', 'planned_finish' => 'date'];
        foreach (['confirmed', 'started', 'finished', 'done', 'cancelled', 'reversed', 'accurate_recorded'] as $step) {
            $casts["{$step}_at"] = 'datetime';
        }

        return $casts;
    }

    public function bom(): BelongsTo
    {
        return $this->belongsTo(MrpBom::class, 'mrp_bom_id');
    }

    public function item(): BelongsTo
    {
        return $this->belongsTo(Item::class);
    }

    public function components(): HasMany
    {
        return $this->hasMany(MrpProductionComponent::class)->orderBy('sort')->orderBy('id');
    }

    public function entries(): HasMany
    {
        return $this->hasMany(MrpProductionEntry::class)->orderBy('id');
    }

    public function responsible(): BelongsTo
    {
        return $this->belongsTo(User::class, 'responsible_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
