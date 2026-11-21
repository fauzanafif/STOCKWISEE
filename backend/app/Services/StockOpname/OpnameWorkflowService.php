<?php

namespace App\Services\StockOpname;

use App\Models\Category;
use App\Models\Inventory;
use App\Models\Item;
use App\Models\StockAdjustment;
use App\Models\StockOpname;
use App\Models\StockOpnameCount;
use App\Models\StockOpnameEvent;
use App\Models\StockOpnameItem;
use App\Models\User;
use App\Models\Warehouse;
use App\Models\WarehouseLocation;
use App\Services\DocumentNumberService;
use App\Services\Inventory\StockLedgerService;
use App\Services\Notifications\NotificationDispatcher;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use RuntimeException;
use Throwable;

/**
 * Stock Opname — the controlled workflow (SAP-style control, Accurate-simple steps):
 *
 *   DRAFT ──confirm──► CONFIRMED ──startCounting──► COUNTING ──finishCounting──► REVIEW
 *   REVIEW ──requestRecount──► RECOUNT ──finishCounting──► REVIEW
 *   REVIEW ──requestApproval──► WAITING_APPROVAL ──approve (posts)──► POSTED ──close──► DONE
 *   WAITING_APPROVAL ──reject──► REVIEW;  any status before POSTED ──cancel──► CANCELLED
 *
 * Rules kept here (the backend is the authority, never the client):
 *  - the book quantity is frozen when counting starts (snapshot_at); the posted adjustment is the variance
 *    counted − frozen, applied to the stock as it is at posting, so goods moved meanwhile are not undone;
 *  - stock only changes through StockLedgerService (STOCK_ADJUSTMENT, referencing the opname line), all lines in
 *    one DB transaction: one failing line rolls the whole posting back;
 *  - posting is idempotent: the document row is locked, a document already posted is returned as it is, and
 *    stock_adjustments.stock_opname_item_id is unique;
 *  - counts are never overwritten: every count (and recount) is a stock_opname_counts row;
 *  - every step is a stock_opname_events row (who, when, from → to, note).
 */
class OpnameWorkflowService
{
    /** a variance smaller than this is "no difference" (quantities are stored with 2 decimals) */
    public const EPS = 0.005;

    public function __construct(
        private readonly DocumentNumberService $numbers,
        private readonly StockLedgerService $ledger,
    ) {}

    // ------------------------------------------------------------------ create / edit (DRAFT)

    /**
     * @param  array{scheduled_date:string, warehouse_id:int, warehouse_location_id?:?int, category_id?:?int,
     *   scope?:string, item_ids?:?array, count_method?:string, cycle_days?:?int, cycle_limit?:?int,
     *   responsible_id?:?int, team_ids?:?array, notes?:?string}  $data
     */
    public function create(User $user, array $data, ?StockOpname $correctionOf = null): StockOpname
    {
        $warehouse = Warehouse::findOrFail($data['warehouse_id']);
        $this->assertLocationInWarehouse($data['warehouse_location_id'] ?? null, $warehouse->id);

        return DB::transaction(function () use ($user, $data, $warehouse, $correctionOf) {
            $itemIds = $correctionOf
                ? $correctionOf->items()->pluck('item_id')->all()
                : $this->selectItems($warehouse->id, $data);
            if ($itemIds === []) {
                throw ValidationException::withMessages(['item_ids' => ['Tidak ada barang yang cocok dengan pilihan ini. Ubah gudang / lokasi / kategori / daftar barang.']]);
            }

            $scope = ($data['scope'] ?? 'SELECTED') === 'ALL' ? 'FULL' : 'PARTIAL';
            $opname = StockOpname::create([
                'number' => $this->numbers->next('SO', 'GD'),
                'warehouse_id' => $warehouse->id,
                'site_id' => $warehouse->site_id,
                'warehouse_location_id' => $data['warehouse_location_id'] ?? null,
                'category_id' => $data['category_id'] ?? null,
                'scheduled_date' => $data['scheduled_date'],
                'type' => $correctionOf ? 'PARTIAL' : $scope,
                'count_method' => ($data['count_method'] ?? 'FULL') === 'CYCLE' ? 'CYCLE' : 'FULL',
                'status' => 'DRAFT',
                'count_round' => 1,
                'responsible_id' => $data['responsible_id'] ?? null,
                'notes' => $data['notes'] ?? null,
                'created_by' => $user->id,
                'correction_of_id' => $correctionOf?->id,
            ]);
            $this->syncTeam($opname, $data['team_ids'] ?? []);
            $this->insertLines($opname, $itemIds);

            $this->event($opname, $user, 'CREATED', null, 'DRAFT', $correctionOf ? "Koreksi atas {$correctionOf->number}" : null, [
                'items' => count($itemIds), 'method' => $opname->count_method, 'scope' => $opname->type,
            ]);
            if ($correctionOf) {
                $this->event($correctionOf, $user, 'CORRECTION_CREATED', null, null, "Dokumen koreksi {$opname->number} dibuat", ['correction_id' => $opname->id]);
            }

            return $opname;
        });
    }

    /** Header of a draft (and, still in DRAFT, its responsible / team / notes). */
    public function updateDraft(StockOpname $opname, User $user, array $data): StockOpname
    {
        $this->assertStatus($opname, ['DRAFT']);
        if (isset($data['warehouse_location_id'])) {
            $this->assertLocationInWarehouse($data['warehouse_location_id'], $opname->warehouse_id);
        }

        return DB::transaction(function () use ($opname, $user, $data) {
            $opname->fill(collect($data)->only(['scheduled_date', 'warehouse_location_id', 'category_id', 'responsible_id', 'notes', 'count_method'])->all());
            $changes = collect($opname->getDirty())->keys()->all();
            $opname->save();
            if (array_key_exists('team_ids', $data)) {
                $this->syncTeam($opname, $data['team_ids'] ?? []);
                $changes[] = 'team';
            }
            if ($changes) {
                $this->event($opname, $user, 'UPDATED', null, null, null, ['fields' => $changes]);
            }

            return $opname;
        });
    }

    /** @param list<int> $itemIds */
    public function addLines(StockOpname $opname, User $user, array $itemIds): int
    {
        $this->assertStatus($opname, ['DRAFT']);

        return DB::transaction(function () use ($opname, $user, $itemIds) {
            $have = $opname->items()->pluck('item_id')->all();
            $new = Item::whereIn('id', array_diff($itemIds, $have))->where('is_active', true)->pluck('id')->all();
            $this->insertLines($opname, $new);
            if ($new) {
                $this->event($opname, $user, 'LINES_ADDED', null, null, null, ['items' => count($new)]);
            }

            return count($new);
        });
    }

    public function removeLine(StockOpname $opname, User $user, StockOpnameItem $line): void
    {
        $this->assertStatus($opname, ['DRAFT']);
        abort_unless($line->stock_opname_id === $opname->id, 404);
        DB::transaction(function () use ($opname, $user, $line) {
            $code = $line->item?->code;
            $line->delete();
            $this->event($opname, $user, 'LINE_REMOVED', null, null, null, ['item' => $code]);
        });
    }

    // ------------------------------------------------------------------ transitions

    public function confirm(StockOpname $opname, User $user): StockOpname
    {
        $this->assertStatus($opname, ['DRAFT']);
        if (! $opname->items()->exists()) {
            throw ValidationException::withMessages(['items' => ['Tambahkan minimal 1 barang sebelum konfirmasi.']]);
        }

        return $this->transition($opname, $user, 'CONFIRMED', 'CONFIRMED', null, [
            'confirmed_by' => $user->id, 'confirmed_at' => now(),
        ], function (StockOpname $o) {
            NotificationDispatcher::toPermission('opname.count', 'opname', 'info', 'Perintah Stock Opname',
                "Opname {$o->number} dijadwalkan {$o->scheduled_date?->toDateString()} — siap dihitung.", "/stock-opnames/{$o->id}");
        });
    }

    /** Counting starts: the book quantity of every line is frozen now (the variance is measured against it). */
    public function startCounting(StockOpname $opname, User $user): StockOpname
    {
        $this->assertStatus($opname, ['CONFIRMED']);
        $this->assertMayCount($opname, $user);

        return DB::transaction(function () use ($opname, $user) {
            $qty = Inventory::where('warehouse_id', $opname->warehouse_id)
                ->whereIn('item_id', $opname->items()->select('item_id'))->pluck('actual_qty', 'item_id');
            foreach ($opname->items()->get(['id', 'item_id', 'system_qty']) as $line) {
                $now = round((float) ($qty[$line->item_id] ?? 0), 2);
                if (abs($now - (float) $line->system_qty) > 1e-9) {
                    $line->update(['system_qty' => $now]);
                }
            }

            return $this->transition($opname, $user, 'COUNTING', 'COUNT_STARTED', null, [
                'started_at' => now(), 'snapshot_at' => now(), 'counted_by' => $user->id,
            ]);
        });
    }

    /**
     * Enter (or re-enter, while the round is open) the physical quantity of one line. Each call is kept as a count
     * row; in a recount only the lines asked for may be counted.
     */
    public function count(StockOpname $opname, User $user, StockOpnameItem $line, float $qty, ?string $note, string $source = 'MANUAL'): StockOpnameItem
    {
        $this->assertStatus($opname, ['COUNTING', 'RECOUNT']);
        $this->assertMayCount($opname, $user);
        abort_unless($line->stock_opname_id === $opname->id, 404);
        if ($qty < 0) {
            throw ValidationException::withMessages(['physical_qty' => ['Jumlah fisik tidak boleh negatif.']]);
        }
        if ($opname->flowStatus() === 'RECOUNT' && $line->review_status !== 'RECOUNT') {
            throw ValidationException::withMessages(['line' => ['Barang ini tidak diminta hitung ulang.']]);
        }

        return DB::transaction(function () use ($opname, $user, $line, $qty, $note, $source) {
            $round = max(1, (int) $opname->count_round);
            StockOpnameCount::create([
                'stock_opname_id' => $opname->id, 'stock_opname_item_id' => $line->id, 'round' => $round,
                'counted_qty' => round($qty, 2), 'note' => $note, 'recount_reason' => $round > 1 ? $line->recount_reason : null,
                'source' => $source === 'SCAN' ? 'SCAN' : 'MANUAL',
                'counted_by' => $user->id, 'counted_by_name' => mb_substr((string) $user->name, 0, 120), 'counted_at' => now(),
            ]);
            $line->update([
                'physical_qty' => round($qty, 2), 'note' => $note ?? $line->note, 'count_status' => 'COUNTED',
                'count_round' => $round, 'counted_by' => $user->id, 'counted_at' => now(),
            ]);

            return $line->fresh();
        });
    }

    /** Counting (or the recount) is finished: every line asked for has a quantity → REVIEW. */
    public function finishCounting(StockOpname $opname, User $user): StockOpname
    {
        $this->assertStatus($opname, ['COUNTING', 'RECOUNT']);
        $recount = $opname->flowStatus() === 'RECOUNT';
        $open = $opname->items()->when($recount, fn ($q) => $q->where('review_status', 'RECOUNT'))
            ->where('count_status', '!=', 'COUNTED')->count();
        if ($open > 0) {
            throw ValidationException::withMessages(['items' => ["Masih {$open} barang belum dihitung. Isi semua baris sebelum selesai menghitung."]]);
        }

        return DB::transaction(function () use ($opname, $user, $recount) {
            if ($recount) {
                $opname->items()->where('review_status', 'RECOUNT')->update(['review_status' => 'PENDING']);
            }

            return $this->transition($opname, $user, 'REVIEW', $recount ? 'RECOUNT_FINISHED' : 'COUNT_FINISHED', null, ['submitted_at' => now()],
                fn (StockOpname $o) => NotificationDispatcher::toPermission('opname.review', 'opname', 'info', 'Stock Opname menunggu review',
                    "Opname {$o->number} selesai dihitung, menunggu review selisih.", "/stock-opnames/{$o->id}", exceptUserId: $user->id));
        });
    }

    /**
     * The reviewer's decision per line, kept while reviewing: ACCEPT (adjust to the count), EXCLUDE (stock stays),
     * with the reason of the variance.
     *
     * @param  list<array{id:int, decision:string, note?:?string}>  $decisions
     */
    public function saveReview(StockOpname $opname, User $user, array $decisions): StockOpname
    {
        $this->assertStatus($opname, ['REVIEW']);
        $map = collect($decisions)->keyBy('id');

        return DB::transaction(function () use ($opname, $user, $map) {
            $changed = 0;
            foreach ($opname->items()->whereIn('id', $map->keys())->get() as $line) {
                $d = $map[$line->id];
                $status = match ($d['decision']) {
                    'ACCEPT', 'APPROVED' => 'APPROVED',
                    'EXCLUDE', 'REJECTED' => 'REJECTED',
                    default => throw ValidationException::withMessages(['decisions' => ["Keputusan tidak dikenal: {$d['decision']}"]]),
                };
                $note = array_key_exists('note', $d) ? (filled($d['note']) ? trim((string) $d['note']) : null) : $line->review_note;
                if ($line->review_status !== $status || $line->review_note !== $note) {
                    $line->update(['review_status' => $status, 'review_note' => $note]);
                    $changed++;
                }
            }
            if ($changed) {
                $this->event($opname, $user, 'REVIEW_SAVED', null, null, null, ['lines' => $changed]);
            }

            return $opname->fresh();
        });
    }

    /** @param list<int> $lineIds */
    public function requestRecount(StockOpname $opname, User $user, array $lineIds, ?string $reason = null): StockOpname
    {
        $this->assertStatus($opname, ['REVIEW']);
        $lines = $opname->items()->whereIn('id', $lineIds)->get();
        if ($lines->isEmpty()) {
            throw ValidationException::withMessages(['line_ids' => ['Pilih minimal 1 barang untuk dihitung ulang.']]);
        }

        return DB::transaction(function () use ($opname, $user, $lines, $reason) {
            // the earlier counts stay in stock_opname_counts; the line waits for its next count
            StockOpnameItem::whereIn('id', $lines->pluck('id'))->update([
                'review_status' => 'RECOUNT', 'recount_reason' => $reason, 'count_status' => 'PENDING',
            ]);
            $round = max(1, (int) $opname->count_round) + 1;

            return $this->transition($opname, $user, 'RECOUNT', 'RECOUNT_REQUESTED', $reason, [
                'count_round' => $round, 'reviewed_by' => $user->id, 'reviewed_at' => now(),
            ], fn (StockOpname $o) => NotificationDispatcher::toPermission('opname.count', 'opname', 'warning', 'Stock Opname perlu hitung ulang',
                "Opname {$o->number}: {$lines->count()} barang perlu dihitung ulang".($reason ? " — {$reason}" : '.'), "/stock-opnames/{$o->id}", exceptUserId: $user->id),
                ['lines' => $lines->count(), 'round' => $round, 'items' => $lines->map(fn ($l) => $l->item?->code)->filter()->take(50)->values()]);
        });
    }

    /**
     * The reviewer sends the reconciled document to the supervisor. A reason per variance is optional (kept
     * simple, 2026-11-20): a line without one is posted as "Stock Opname {number}".
     */
    public function requestApproval(StockOpname $opname, User $user, ?string $note): StockOpname
    {
        $this->assertStatus($opname, ['REVIEW']);
        $lines = $opname->items()->with('item:id,code')->get();
        // lines nobody decided on are accepted (adjusted to the count) — the reviewer saw them all
        $pending = $lines->where('review_status', 'PENDING');

        return DB::transaction(function () use ($opname, $user, $note, $pending) {
            if ($pending->isNotEmpty()) {
                StockOpnameItem::whereIn('id', $pending->pluck('id'))->update(['review_status' => 'APPROVED']);
            }

            return $this->transition($opname, $user, 'WAITING_APPROVAL', 'APPROVAL_REQUESTED', $note, [
                'approval_requested_by' => $user->id, 'approval_requested_at' => now(),
                'reviewed_by' => $user->id, 'reviewed_at' => now(), 'review_note' => $note !== null ? mb_substr($note, 0, 255) : $opname->review_note,
            ], fn (StockOpname $o) => NotificationDispatcher::toPermission('opname.approve', 'opname', 'info', 'Stock Opname menunggu approval',
                "Opname {$o->number} menunggu persetujuan & posting penyesuaian stok.", "/stock-opnames/{$o->id}", exceptUserId: $user->id),
                $this->varianceSummary($opname->fresh()));
        });
    }

    public function reject(StockOpname $opname, User $user, string $note): StockOpname
    {
        $this->assertStatus($opname, ['WAITING_APPROVAL']);

        return $this->transition($opname, $user, 'REVIEW', 'REJECTED', $note, ['approval_note' => mb_substr($note, 0, 500)],
            fn (StockOpname $o) => NotificationDispatcher::toPermission('opname.review', 'opname', 'warning', 'Stock Opname ditolak supervisor',
                "Opname {$o->number} dikembalikan ke review: {$note}", "/stock-opnames/{$o->id}", exceptUserId: $user->id));
    }

    /**
     * Approve and post: every accepted line with a variance becomes a STOCK_ADJUSTMENT movement + stock_adjustment
     * row, in one transaction. Calling it again for a posted document changes nothing and returns it.
     *
     * @return array{0: StockOpname, 1: bool} the document, and whether this call posted it
     */
    public function approveAndPost(StockOpname $opname, User $user, ?string $note): array
    {
        $this->assertInternal($opname);

        try {
            return DB::transaction(function () use ($opname, $user, $note) {
                /** @var StockOpname $o */
                $o = StockOpname::whereKey($opname->id)->lockForUpdate()->firstOrFail();
                if ($o->posting_batch !== null || in_array($o->flowStatus(), ['POSTED', 'DONE'], true)) {
                    return [$o, false]; // already posted: idempotent, nothing is posted twice
                }
                $this->assertStatus($o, ['WAITING_APPROVAL']);
                // who sent the variances for approval does not approve them (four eyes); a Super Admin may, in an emergency
                if ($o->reviewed_by !== null && (int) $o->reviewed_by === (int) $user->id && ! $user->hasRole('super_admin')) {
                    throw ValidationException::withMessages(['status' => ['Anda yang mengajukan approval ini, jadi tidak bisa menyetujuinya sendiri. Approval oleh Manager atau Direktur.']]);
                }

                $batch = (string) Str::uuid();
                $lines = $o->items()->with('item:id,code')->where('review_status', 'APPROVED')->orderBy('id')->get();
                $posted = 0;
                foreach ($lines as $line) {
                    $variance = round((float) $line->physical_qty - (float) $line->system_qty, 2);
                    if (abs($variance) < self::EPS) {
                        continue;
                    }
                    $this->postLine($o, $line, $variance, $batch, $user);
                    $posted++;
                }

                $o->update([
                    'status' => 'POSTED', 'approved_by' => $user->id, 'approved_at' => now(),
                    'approval_note' => $note !== null ? mb_substr($note, 0, 500) : $o->approval_note,
                    'posted_by' => $user->id, 'posted_at' => now(), 'posting_batch' => $batch,
                ]);
                $this->event($o, $user, 'APPROVED', 'WAITING_APPROVAL', 'WAITING_APPROVAL', $note);
                $this->event($o, $user, 'POSTED', 'WAITING_APPROVAL', 'POSTED', null, ['batch' => $batch, 'adjusted_lines' => $posted] + $this->varianceSummary($o));

                return [$o->fresh(), true];
            });
        } catch (ValidationException $e) {
            throw $e;
        } catch (Throwable $e) {
            // the whole posting was rolled back; say so instead of a bare 500
            report($e);
            throw ValidationException::withMessages(['posting' => ['Posting dibatalkan, stok tidak berubah: '.$e->getMessage()]]);
        }
    }

    public function close(StockOpname $opname, User $user, ?string $note): StockOpname
    {
        $this->assertStatus($opname, ['POSTED']);

        return $this->transition($opname, $user, 'DONE', 'CLOSED', $note, ['closed_by' => $user->id, 'closed_at' => now()]);
    }

    public function cancel(StockOpname $opname, User $user, string $reason): StockOpname
    {
        $this->assertStatus($opname, ['DRAFT', 'CONFIRMED', 'COUNTING', 'REVIEW', 'RECOUNT', 'WAITING_APPROVAL']);

        return $this->transition($opname, $user, 'CANCELLED', 'CANCELLED', $reason, [
            'cancelled_by' => $user->id, 'cancelled_at' => now(), 'cancel_reason' => mb_substr($reason, 0, 500),
        ]);
    }

    /** A posted document is never edited: a correction is a new opname of the same items, through the whole workflow. */
    public function createCorrection(StockOpname $opname, User $user, ?string $note): StockOpname
    {
        $this->assertStatus($opname, ['POSTED', 'DONE']);

        return $this->create($user, [
            'scheduled_date' => now()->toDateString(), 'warehouse_id' => $opname->warehouse_id,
            'warehouse_location_id' => $opname->warehouse_location_id, 'category_id' => $opname->category_id,
            'count_method' => $opname->count_method ?? 'FULL', 'responsible_id' => $opname->responsible_id,
            'notes' => trim("Koreksi atas {$opname->number}. ".($note ?? '')),
        ], $opname);
    }

    // ------------------------------------------------------------------ posting

    private function postLine(StockOpname $o, StockOpnameItem $line, float $variance, string $batch, User $user): void
    {
        if (StockAdjustment::where('stock_opname_item_id', $line->id)->exists()) {
            return; // this line was adjusted already (never twice)
        }
        // the stock as it is now, locked until the end of the posting
        $current = (float) (Inventory::where(['item_id' => $line->item_id, 'warehouse_id' => $line->warehouse_id])->lockForUpdate()->value('actual_qty') ?? 0);
        $target = round($current + $variance, 2);
        $code = $line->item?->code ?? "#{$line->item_id}";
        if ($target < -1e-6) {
            throw ValidationException::withMessages(['posting' => ["Posting dibatalkan, stok tidak berubah: stok {$code} sekarang {$current}, selisih opname {$variance} membuatnya negatif. Barang ini keluar setelah stok dibekukan — hitung ulang atau kecualikan."]]);
        }

        try {
            $movement = $this->ledger->record([
                'type' => 'STOCK_ADJUSTMENT',
                'item_id' => $line->item_id,
                'warehouse_id' => $line->warehouse_id,
                'absolute' => $target,
                'reference' => $line,
                'batch_uuid' => $batch,
                'created_by' => $user->id,
                'note' => mb_substr("Stock Opname {$o->number}: ".($line->review_note ?: $line->note ?: 'penyesuaian hasil opname'), 0, 255),
            ]);
        } catch (RuntimeException $e) {
            throw ValidationException::withMessages(['posting' => ["Posting dibatalkan, stok tidak berubah: {$code} — {$e->getMessage()}"]]);
        }

        StockAdjustment::create([
            'stock_opname_id' => $o->id,
            'stock_opname_item_id' => $line->id,
            'item_id' => $line->item_id,
            'warehouse_id' => $line->warehouse_id,
            'qty_before' => $movement->actual_before,
            'qty_after' => $movement->actual_after,
            'difference' => $movement->actual_after - $movement->actual_before,
            'reason' => mb_substr($line->review_note ?: $line->note ?: "Stock Opname {$o->number}", 0, 255),
            'stock_movement_id' => $movement->id,
            'approved_by' => $user->id,
            'approved_at' => now(),
            'created_by' => $user->id,
        ]);
    }

    // ------------------------------------------------------------------ helpers

    /** @return array{lines:int, counted:int, variance_lines:int, plus_qty:float, minus_qty:float} */
    public function varianceSummary(StockOpname $o): array
    {
        $lines = $o->items()->get(['physical_qty', 'system_qty', 'review_status']);
        $diff = $lines->filter(fn ($l) => $l->physical_qty !== null && $l->review_status !== 'REJECTED')
            ->map(fn ($l) => round((float) $l->physical_qty - (float) $l->system_qty, 2))->filter(fn ($d) => abs($d) >= self::EPS);

        return [
            'lines' => $lines->count(), 'counted' => $lines->whereNotNull('physical_qty')->count(), 'variance_lines' => $diff->count(),
            'plus_qty' => round($diff->filter(fn ($d) => $d > 0)->sum(), 2), 'minus_qty' => round($diff->filter(fn ($d) => $d < 0)->sum(), 2),
        ];
    }

    public function event(StockOpname $o, ?User $user, string $event, ?string $from, ?string $to, ?string $note = null, array $meta = [], ?int $lineId = null): void
    {
        StockOpnameEvent::create([
            'stock_opname_id' => $o->id, 'stock_opname_item_id' => $lineId, 'event' => $event,
            'from_status' => $from, 'to_status' => $to, 'note' => $note !== null ? mb_substr($note, 0, 500) : null,
            'meta' => $meta ?: null, 'user_id' => $user?->id, 'user_name' => $user ? mb_substr((string) $user->name, 0, 120) : null,
            'ip' => request()?->ip(), 'created_at' => now(),
        ]);
    }

    private function transition(StockOpname $opname, User $user, string $to, string $event, ?string $note, array $attrs = [], ?\Closure $after = null, array $meta = []): StockOpname
    {
        return DB::transaction(function () use ($opname, $user, $to, $event, $note, $attrs, $after, $meta) {
            $locked = StockOpname::whereKey($opname->id)->lockForUpdate()->firstOrFail();
            $from = $locked->flowStatus();
            // somebody else moved it meanwhile
            if ($from !== $opname->flowStatus()) {
                throw ValidationException::withMessages(['status' => ["Status opname sudah berubah menjadi {$from}. Muat ulang halaman."]]);
            }
            $locked->update(['status' => $to] + $attrs);
            $this->event($locked, $user, $event, $from, $to, $note, $meta);
            if ($after) {
                rescue(fn () => $after($locked), null, true); // a notification never stops the step
            }
            $opname->setRawAttributes($locked->getAttributes(), true);

            return $opname;
        });
    }

    /** @param list<string> $allowed */
    public function assertStatus(StockOpname $opname, array $allowed): void
    {
        $this->assertInternal($opname);
        if (! in_array($opname->flowStatus(), $allowed, true)) {
            throw ValidationException::withMessages(['status' => ["Aksi ini tidak bisa dilakukan pada status {$opname->flowStatus()}."]]);
        }
    }

    private function assertInternal(StockOpname $opname): void
    {
        abort_if($opname->isFromAccurate(), 422, 'Stock Opname ini berasal dari Accurate — dokumen final, tidak melalui alur internal.');
    }

    /** With a counting team set, only the team, the person in charge or a reviewer may count. */
    public function assertMayCount(StockOpname $opname, User $user): void
    {
        if ($user->hasPermission('opname.review') || $opname->responsible_id === $user->id) {
            return;
        }
        $team = $opname->team()->pluck('users.id');
        if ($team->isNotEmpty() && ! $team->contains($user->id)) {
            abort(403, 'Anda tidak termasuk tim penghitung opname ini.');
        }
    }

    private function assertLocationInWarehouse(?int $locationId, int $warehouseId): void
    {
        if ($locationId && ! WarehouseLocation::whereKey($locationId)->where('warehouse_id', $warehouseId)->exists()) {
            throw ValidationException::withMessages(['warehouse_location_id' => ['Lokasi ini bukan milik gudang yang dipilih.']]);
        }
    }

    /** @param list<int> $userIds */
    private function syncTeam(StockOpname $opname, array $userIds): void
    {
        $opname->team()->sync(User::whereIn('id', $userIds)->where('is_active', true)->pluck('id'));
    }

    /**
     * The items of a new order, from STOCKWISE's own masters (items, categories, locations, inventory):
     * SELECTED = the item_ids given; ALL = every active item of the warehouse (or not assigned to one), narrowed by
     * location / category; CYCLE method = of those, the ones not counted for `cycle_days`, oldest count first,
     * at most `cycle_limit`.
     *
     * @return list<int>
     */
    private function selectItems(int $warehouseId, array $data): array
    {
        $scopeAll = ($data['scope'] ?? 'SELECTED') === 'ALL';
        $q = Item::query()->where('items.is_active', true);
        if (! $scopeAll) {
            $q->whereIn('items.id', $data['item_ids'] ?? []);
        } else {
            $q->where(fn ($w) => $w->where('items.default_warehouse_id', $warehouseId)->orWhereNull('items.default_warehouse_id'));
            if (! empty($data['warehouse_location_id'])) {
                $q->where('items.default_location_id', $data['warehouse_location_id']);
            }
            if (! empty($data['category_id'])) {
                $q->whereIn('items.category_id', $this->categoryWithChildren((int) $data['category_id']));
            }
        }

        if (($data['count_method'] ?? 'FULL') === 'CYCLE') {
            $days = max(1, (int) ($data['cycle_days'] ?? 90));
            $limit = min(2000, max(1, (int) ($data['cycle_limit'] ?? 50)));
            $q->leftJoin('inventory as inv', fn ($j) => $j->on('inv.item_id', '=', 'items.id')->where('inv.warehouse_id', $warehouseId))
                ->where(fn ($w) => $w->whereNull('inv.last_counted_at')->orWhere('inv.last_counted_at', '<', now()->subDays($days)))
                ->orderByRaw('inv.last_counted_at IS NOT NULL')->orderBy('inv.last_counted_at')->orderBy('items.code')
                ->limit($limit);
        } else {
            $q->orderBy('items.code');
        }

        return $q->pluck('items.id')->map(fn ($id) => (int) $id)->unique()->values()->all();
    }

    /** @return list<int> */
    private function categoryWithChildren(int $id): array
    {
        $byParent = Category::query()->get(['id', 'parent_id'])->groupBy('parent_id');
        $out = [$id];
        for ($i = 0; $i < count($out); $i++) {
            foreach ($byParent[$out[$i]] ?? [] as $c) {
                $out[] = (int) $c->id;
            }
        }

        return $out;
    }

    /** @param list<int> $itemIds */
    private function insertLines(StockOpname $opname, array $itemIds): void
    {
        if ($itemIds === []) {
            return;
        }
        $now = now();
        foreach (array_chunk($itemIds, 500) as $chunk) {
            $qty = Inventory::where('warehouse_id', $opname->warehouse_id)->whereIn('item_id', $chunk)->pluck('actual_qty', 'item_id');
            $loc = Item::whereIn('items.id', $chunk)
                ->leftJoin('warehouse_locations as wl', fn ($j) => $j->on('wl.id', '=', 'items.default_location_id')->where('wl.warehouse_id', $opname->warehouse_id))
                ->get(['items.id as item_id', 'wl.id as location_id'])->pluck('location_id', 'item_id');
            DB::table('stock_opname_items')->insert(array_map(fn ($id) => [
                'stock_opname_id' => $opname->id, 'item_id' => $id, 'warehouse_id' => $opname->warehouse_id,
                'warehouse_location_id' => $loc[$id] ?? null, 'system_qty' => round((float) ($qty[$id] ?? 0), 2),
                'count_status' => 'PENDING', 'review_status' => 'PENDING', 'count_round' => 0,
                'created_at' => $now, 'updated_at' => $now,
            ], $chunk));
        }
    }
}
