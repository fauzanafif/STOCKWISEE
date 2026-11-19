<?php

namespace App\Models;

use App\Support\SchemaCache;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class StockOpname extends Model
{
    use HasFactory;

    /**
     * The controlled workflow (App\Services\StockOpname\OpnameWorkflowService), in order:
     * DRAFT → CONFIRMED → COUNTING → REVIEW ⇄ RECOUNT → WAITING_APPROVAL → POSTED → DONE (and CANCELLED).
     */
    public const FLOW = ['DRAFT', 'CONFIRMED', 'COUNTING', 'REVIEW', 'RECOUNT', 'WAITING_APPROVAL', 'POSTED', 'DONE', 'CANCELLED'];

    /** what an internal document saved by the earlier flow is in the controlled one (its row is never rewritten) */
    public const LEGACY = [
        'SCHEDULED' => 'CONFIRMED',
        'IN_PROGRESS' => 'COUNTING',
        'PENDING_REVIEW' => 'REVIEW',
        'RECOUNT_REQUIRED' => 'RECOUNT',
        'COMPLETED' => 'DONE',
    ];

    /** stock was adjusted: nothing on it may change any more (a correction is a new opname) */
    public const LOCKED = ['POSTED', 'DONE', 'CANCELLED'];

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'scheduled_date' => 'date',
            'started_at' => 'datetime',
            'submitted_at' => 'datetime',
            'reviewed_at' => 'datetime',
            'accurate_synced_at' => 'datetime',
            'snapshot_at' => 'datetime',
            'confirmed_at' => 'datetime',
            'approval_requested_at' => 'datetime',
            'approved_at' => 'datetime',
            'posted_at' => 'datetime',
            'closed_at' => 'datetime',
            'cancelled_at' => 'datetime',
            'count_round' => 'integer',
        ];
    }

    /** whether the controlled workflow's migration (2026_11_18_140000) ran on this database */
    public static function workflowReady(): bool
    {
        return SchemaCache::hasColumn('stock_opnames', 'posting_batch')
            && SchemaCache::hasColumn('stock_opname_counts', 'counted_qty')
            && SchemaCache::hasColumn('stock_opname_events', 'event');
    }

    /** every stored status that means $flow (the new code and the earlier flow's one) — for filtering */
    public static function statusesFor(string $flow): array
    {
        return array_values(array_unique([$flow, ...array_keys(self::LEGACY, $flow, true)]));
    }

    public function isFromAccurate(): bool
    {
        return $this->accurate_itemadj_id !== null;
    }

    /** the status in the controlled workflow (an Accurate mirror keeps its own) */
    public function flowStatus(): string
    {
        return $this->isFromAccurate() ? $this->status : (self::LEGACY[$this->status] ?? $this->status);
    }

    public function items(): HasMany
    {
        return $this->hasMany(StockOpnameItem::class);
    }

    public function counts(): HasMany
    {
        return $this->hasMany(StockOpnameCount::class);
    }

    public function events(): HasMany
    {
        return $this->hasMany(StockOpnameEvent::class);
    }

    public function adjustments(): HasMany
    {
        return $this->hasMany(StockAdjustment::class);
    }

    public function team(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'stock_opname_team')->withTimestamps();
    }

    public function warehouse(): BelongsTo
    {
        return $this->belongsTo(Warehouse::class);
    }

    public function location(): BelongsTo
    {
        return $this->belongsTo(WarehouseLocation::class, 'warehouse_location_id');
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class);
    }

    public function responsible(): BelongsTo
    {
        return $this->belongsTo(User::class, 'responsible_id');
    }

    public function counter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'counted_by');
    }

    public function scheduledBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function reviewedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by');
    }

    public function approvedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by');
    }

    public function postedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'posted_by');
    }

    public function correctionOf(): BelongsTo
    {
        return $this->belongsTo(self::class, 'correction_of_id');
    }
}
