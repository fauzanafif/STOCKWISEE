<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Category;
use App\Models\Inventory;
use App\Models\StockAdjustment;
use App\Models\StockOpname;
use App\Models\StockOpnameCount;
use App\Models\StockOpnameEvent;
use App\Models\StockOpnameItem;
use App\Models\User;
use App\Models\Warehouse;
use App\Models\WarehouseLocation;
use App\Services\StockOpname\OpnameWorkflowService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Stock Opname — the controlled workflow's API (OpnameWorkflowService). Needs migration 2026_11_18_140000: before
 * it ran every endpoint here answers 503 and the earlier endpoints (StockOpnameController) keep working as they did.
 *
 * Blind count: system quantity and everything derived from it (variance, %, live stock, adjustments) is only sent
 * to a user with opname.review or opname.view_variance (auditor) — never to someone who only counts.
 */
class StockOpnameWorkflowController extends Controller
{
    public function __construct(private readonly OpnameWorkflowService $flow) {}

    private function ready(): void
    {
        abort_unless(StockOpname::workflowReady(), 503, 'Alur Stock Opname baru belum aktif: migration 2026_11_18_140000_stock_opname_controlled_workflow belum dijalankan.');
    }

    public static function canSeeSystem(User $user): bool
    {
        return $user->hasAnyPermission('opname.review', 'opname.view_variance');
    }

    // ================================================================== reads

    public function detail(Request $request, StockOpname $stockOpname): JsonResponse
    {
        $this->ready();

        return response()->json(['data' => $this->payload($stockOpname, $request->user())]);
    }

    /** GET /stock-opnames/{id}/events — the status history / audit trail, newest first. */
    public function events(StockOpname $stockOpname): JsonResponse
    {
        $this->ready();

        return response()->json(['data' => $stockOpname->events()->orderByDesc('id')->limit(500)->get()->map(fn (StockOpnameEvent $e) => $this->eventRow($e))]);
    }

    /** GET /stock-opnames/{id}/lines/{line}/counts — every count of the line (first count and recounts). */
    public function counts(StockOpname $stockOpname, int $line): JsonResponse
    {
        $this->ready();
        $l = $stockOpname->items()->findOrFail($line);

        return response()->json(['data' => $l->counts()->get()->map(fn (StockOpnameCount $c) => [
            'id' => $c->id, 'round' => $c->round, 'counted_qty' => $c->counted_qty, 'note' => $c->note,
            'recount_reason' => $c->recount_reason, 'source' => $c->source, 'counted_by' => $c->counted_by_name,
            'counted_at' => $c->counted_at?->toIso8601String(),
        ])]);
    }

    /** GET /stock-opnames/form-options — what the order form picks from (STOCKWISE masters only). */
    public function formOptions(): JsonResponse
    {
        $this->ready();
        $users = User::query()->where('is_active', true)->with('roles.permissions:id,slug')->orderBy('name')->get(['id', 'name', 'username'])
            ->filter(fn (User $u) => $u->hasAnyPermission('opname.count', 'opname.review', 'opname.schedule') && ! str_contains((string) $u->username, '@system'))
            ->map(fn (User $u) => ['id' => $u->id, 'name' => $u->name, 'counter' => $u->hasPermission('opname.count'),
                'reviewer' => $u->hasPermission('opname.review')])->values();

        return response()->json(['data' => [
            'warehouses' => Warehouse::where('is_active', true)->orderBy('code')->get(['id', 'code', 'name']),
            'locations' => WarehouseLocation::where('is_active', true)->orderBy('code')->get(['id', 'warehouse_id', 'code', 'description']),
            'categories' => Category::where('is_active', true)->orderBy('path')->get(['id', 'parent_id', 'name', 'level', 'path']),
            'users' => $users,
        ]]);
    }

    /**
     * GET /stock-opnames/dashboard?date_from=&date_to=&warehouse_id=&status=&responsible_id= — the one Stock Opname
     * dashboard: KPIs, per warehouse, stock accuracy by month, largest variances, what waits for me, latest activity.
     * Internal documents only (the Accurate ITEMADJ mirrors are not counts made here).
     */
    public function dashboard(Request $request): JsonResponse
    {
        $this->ready();
        $request->validate([
            'date_from' => ['nullable', 'date'], 'date_to' => ['nullable', 'date'], 'warehouse_id' => ['nullable', 'integer'],
            'status' => ['nullable', Rule::in(StockOpname::FLOW)], 'responsible_id' => ['nullable', 'integer'],
        ]);
        $user = $request->user();
        $see = self::canSeeSystem($user);
        $docs = fn () => $this->filteredDocs($request);

        $byStatus = $docs()->selectRaw('status, count(*) c')->groupBy('status')->pluck('c', 'status')
            ->reduce(function ($carry, $c, $status) {
                $flow = StockOpname::LEGACY[$status] ?? $status;
                $carry[$flow] = ($carry[$flow] ?? 0) + (int) $c;

                return $carry;
            }, []);
        $n = fn (string ...$s) => array_sum(array_map(fn ($x) => $byStatus[$x] ?? 0, $s));

        $lineQuery = fn () => StockOpnameItem::query()->join('stock_opnames as so', 'so.id', '=', 'stock_opname_items.stock_opname_id')
            ->whereIn('so.id', $docs()->select('stock_opnames.id'))
            ->whereNotIn('so.status', ['CANCELLED']);
        $varianceLines = $lineQuery()->whereNotNull('stock_opname_items.physical_qty')->whereRaw('abs(stock_opname_items.difference) >= 0.005')->count();

        // accuracy: of the counted lines of finished documents, how many matched the book quantity
        $finished = [...StockOpname::statusesFor('POSTED'), ...StockOpname::statusesFor('DONE')];
        $accuracy = $lineQuery()->whereIn('so.status', $finished)->whereNotNull('stock_opname_items.physical_qty')
            ->selectRaw('substr(so.scheduled_date, 1, 7) as ym, count(*) as counted, sum(case when abs(stock_opname_items.difference) < 0.005 then 1 else 0 end) as matched')
            ->groupBy('ym')->orderBy('ym')->get()->take(-12)->values()
            ->map(fn ($r) => ['month' => $r->ym, 'counted' => (int) $r->counted, 'matched' => (int) $r->matched,
                'accuracy' => $r->counted ? round($r->matched / $r->counted * 100, 1) : null]);
        $tot = $accuracy->sum('counted');

        $byWarehouse = $docs()->join('warehouses as w', 'w.id', '=', 'stock_opnames.warehouse_id')
            ->selectRaw('w.id, w.code, w.name, count(*) as total, sum(case when stock_opnames.status in (?, ?, ?, ?) then 1 else 0 end) as finished, sum(case when stock_opnames.status = ? then 1 else 0 end) as cancelled',
                ['POSTED', 'DONE', 'COMPLETED', 'CLOSED', 'CANCELLED'])
            ->groupBy('w.id', 'w.code', 'w.name')->orderByDesc('total')->get()
            ->map(fn ($r) => ['id' => (int) $r->id, 'code' => $r->code, 'name' => $r->name, 'total' => (int) $r->total,
                'finished' => (int) $r->finished, 'open' => (int) $r->total - (int) $r->finished - (int) $r->cancelled]);

        $top = $see ? $lineQuery()->whereNotNull('stock_opname_items.physical_qty')->whereRaw('abs(stock_opname_items.difference) >= 0.005')
            ->join('items as it', 'it.id', '=', 'stock_opname_items.item_id')
            ->orderByRaw('abs(stock_opname_items.difference) desc')->limit(10)
            ->get(['stock_opname_items.id', 'stock_opname_items.system_qty', 'stock_opname_items.physical_qty', 'stock_opname_items.difference',
                'stock_opname_items.review_status', 'so.id as opname_id', 'so.number', 'so.status', 'it.code', 'it.description'])
            ->map(fn ($r) => ['line_id' => $r->id, 'opname_id' => $r->opname_id, 'number' => $r->number, 'flow_status' => StockOpname::LEGACY[$r->status] ?? $r->status,
                'item_code' => $r->code, 'description' => $r->description, 'system_qty' => (float) $r->system_qty, 'physical_qty' => (float) $r->physical_qty,
                'variance' => round((float) $r->difference, 2), 'variance_pct' => abs((float) $r->system_qty) > 1e-9 ? round((float) $r->difference / (float) $r->system_qty * 100, 1) : null,
                'review_status' => $r->review_status]) : null;

        $recent = StockOpnameEvent::query()->whereIn('stock_opname_id', $docs()->select('stock_opnames.id'))
            ->with('opname:id,number')->orderByDesc('id')->limit(15)->get()
            ->map(fn (StockOpnameEvent $e) => $this->eventRow($e) + ['opname' => $e->opname?->only('id', 'number')]);

        return response()->json(['data' => [
            'kpi' => [
                'total' => array_sum($byStatus) - ($byStatus['CANCELLED'] ?? 0),
                'draft' => $n('DRAFT'),
                'counting' => $n('CONFIRMED', 'COUNTING', 'RECOUNT'),
                'review' => $n('REVIEW'),
                'approval' => $n('WAITING_APPROVAL'),
                'done' => $n('POSTED', 'DONE'),
                'cancelled' => $n('CANCELLED'),
                'variance_lines' => $varianceLines,
                'accuracy' => $tot ? round($accuracy->sum('matched') / $tot * 100, 1) : null,
            ],
            'by_status' => $byStatus,
            'by_warehouse' => $byWarehouse,
            'accuracy' => $accuracy,
            'top_variances' => $top,
            'todo' => $this->todo($user, $request),
            'recent' => $recent,
            'can_see_system' => $see,
        ]]);
    }

    /** GET /stock-opnames/adjustments — the stock adjustments posted by opname (report). */
    public function adjustments(Request $request): JsonResponse
    {
        $this->ready();
        $q = StockAdjustment::query()->whereNotNull('stock_adjustments.stock_opname_item_id')
            ->with(['item:id,code,description,unit_id', 'item.unit:id,code', 'warehouse:id,code', 'opnameItem:id,stock_opname_id', 'opnameItem.opname:id,number', 'approvedBy:id,name'])
            ->orderByDesc('stock_adjustments.id');
        $request->whenFilled('opname_id', fn ($v) => $q->whereIn('stock_opname_item_id', StockOpnameItem::where('stock_opname_id', $v)->select('id')));
        $request->whenFilled('warehouse_id', fn ($v) => $q->where('warehouse_id', $v));
        $request->whenFilled('date_from', fn ($v) => $q->whereDate('approved_at', '>=', $v));
        $request->whenFilled('date_to', fn ($v) => $q->whereDate('approved_at', '<=', $v));
        $request->whenFilled('search', fn ($v) => $q->whereHas('item', fn ($i) => $i->where('code', 'like', '%'.trim((string) $v).'%')->orWhere('description', 'like', '%'.trim((string) $v).'%')));
        $page = $q->paginate(min((int) $request->integer('per_page', 50), 200))->withQueryString();

        return response()->json([
            'data' => collect($page->items())->map(fn (StockAdjustment $a) => [
                'id' => $a->id, 'item_code' => $a->item?->code, 'description' => $a->item?->description, 'unit' => $a->item?->unit?->code,
                'warehouse' => $a->warehouse?->code, 'qty_before' => $a->qty_before, 'qty_after' => $a->qty_after, 'difference' => $a->difference,
                'reason' => $a->reason, 'movement_id' => $a->stock_movement_id, 'approved_by' => $a->approvedBy?->name,
                'approved_at' => $a->approved_at?->toIso8601String(),
                'opname' => ['id' => $a->opnameItem?->stock_opname_id, 'number' => $a->opnameItem?->opname?->number],
            ]),
            'meta' => ['page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()],
        ]);
    }

    // ================================================================== writes

    public function store(Request $request): JsonResponse
    {
        $this->ready();
        $data = $request->validate($this->orderRules(true));
        $o = $this->flow->create($request->user(), $data);

        return response()->json(['data' => $this->payload($o, $request->user())], 201);
    }

    public function updateDraft(Request $request, StockOpname $stockOpname): JsonResponse
    {
        $this->ready();
        $data = $request->validate($this->orderRules(false));
        $this->flow->updateDraft($stockOpname, $request->user(), $data);

        return $this->respond($request, $stockOpname);
    }

    public function addLines(Request $request, StockOpname $stockOpname): JsonResponse
    {
        $this->ready();
        $data = $request->validate(['item_ids' => ['required', 'array', 'min:1', 'max:5000'], 'item_ids.*' => ['integer']]);
        $this->flow->addLines($stockOpname, $request->user(), $data['item_ids']);

        return $this->respond($request, $stockOpname);
    }

    public function removeLine(Request $request, StockOpname $stockOpname, int $line): JsonResponse
    {
        $this->ready();
        $this->flow->removeLine($stockOpname, $request->user(), $stockOpname->items()->findOrFail($line));

        return $this->respond($request, $stockOpname);
    }

    public function confirm(Request $request, StockOpname $stockOpname): JsonResponse
    {
        $this->ready();
        $this->flow->confirm($stockOpname, $request->user());

        return $this->respond($request, $stockOpname);
    }

    public function startCounting(Request $request, StockOpname $stockOpname): JsonResponse
    {
        $this->ready();
        $this->flow->startCounting($stockOpname, $request->user());

        return $this->respond($request, $stockOpname);
    }

    /** POST /stock-opnames/{id}/lines/{line}/count — answers with the line only (counting is many small saves). */
    public function count(Request $request, StockOpname $stockOpname, int $line): JsonResponse
    {
        $this->ready();
        $data = $request->validate([
            'physical_qty' => ['required', 'numeric', 'min:0', 'max:999999999'],
            'note' => ['nullable', 'string', 'max:255'],
            'source' => ['nullable', Rule::in(['MANUAL', 'SCAN'])],
        ]);
        $l = $this->flow->count($stockOpname, $request->user(), $stockOpname->items()->findOrFail($line), (float) $data['physical_qty'], $data['note'] ?? null, $data['source'] ?? 'MANUAL');
        $l->load(['item:id,code,description,unit_id', 'item.unit:id,code', 'location:id,code', 'countedBy:id,name'])->loadCount('counts');

        return response()->json(['data' => $this->lineRow($l, self::canSeeSystem($request->user()), collect(), collect())]);
    }

    public function finishCounting(Request $request, StockOpname $stockOpname): JsonResponse
    {
        $this->ready();
        $this->flow->finishCounting($stockOpname, $request->user());

        return $this->respond($request, $stockOpname);
    }

    public function reviewDecisions(Request $request, StockOpname $stockOpname): JsonResponse
    {
        $this->ready();
        $data = $request->validate([
            'decisions' => ['required', 'array', 'min:1'],
            'decisions.*.id' => ['required', 'integer'],
            'decisions.*.decision' => ['required', Rule::in(['ACCEPT', 'EXCLUDE'])],
            'decisions.*.note' => ['nullable', 'string', 'max:255'],
        ]);
        $this->flow->saveReview($stockOpname, $request->user(), $data['decisions']);

        return $this->respond($request, $stockOpname);
    }

    public function recount(Request $request, StockOpname $stockOpname): JsonResponse
    {
        $this->ready();
        // the reason is optional: picking the lines is enough
        $data = $request->validate(['line_ids' => ['required', 'array', 'min:1'], 'line_ids.*' => ['integer'], 'reason' => ['nullable', 'string', 'max:255']]);
        $this->flow->requestRecount($stockOpname, $request->user(), $data['line_ids'], filled($data['reason'] ?? null) ? trim($data['reason']) : null);

        return $this->respond($request, $stockOpname);
    }

    public function requestApproval(Request $request, StockOpname $stockOpname): JsonResponse
    {
        $this->ready();
        $data = $request->validate(['note' => ['nullable', 'string', 'max:255']]);
        $this->flow->requestApproval($stockOpname, $request->user(), $data['note'] ?? null);

        return $this->respond($request, $stockOpname);
    }

    /** POST /stock-opnames/{id}/approve — approve and post to the Stock Ledger (idempotent: a second call posts nothing). */
    public function approve(Request $request, StockOpname $stockOpname): JsonResponse
    {
        $this->ready();
        $data = $request->validate(['note' => ['nullable', 'string', 'max:500']]);
        [$o, $posted] = $this->flow->approveAndPost($stockOpname, $request->user(), $data['note'] ?? null);

        return response()->json(['data' => $this->payload($o, $request->user()), 'meta' => ['posted' => $posted, 'already_posted' => ! $posted]]);
    }

    public function reject(Request $request, StockOpname $stockOpname): JsonResponse
    {
        $this->ready();
        $data = $request->validate(['note' => ['required', 'string', 'min:3', 'max:500']]);
        $this->flow->reject($stockOpname, $request->user(), trim($data['note']));

        return $this->respond($request, $stockOpname);
    }

    public function close(Request $request, StockOpname $stockOpname): JsonResponse
    {
        $this->ready();
        $data = $request->validate(['note' => ['nullable', 'string', 'max:500']]);
        $this->flow->close($stockOpname, $request->user(), $data['note'] ?? null);

        return $this->respond($request, $stockOpname);
    }

    public function cancel(Request $request, StockOpname $stockOpname): JsonResponse
    {
        $this->ready();
        $data = $request->validate(['reason' => ['required', 'string', 'min:3', 'max:500']]);
        $this->flow->cancel($stockOpname, $request->user(), trim($data['reason']));

        return $this->respond($request, $stockOpname);
    }

    public function correction(Request $request, StockOpname $stockOpname): JsonResponse
    {
        $this->ready();
        $data = $request->validate(['note' => ['nullable', 'string', 'max:255']]);
        $new = $this->flow->createCorrection($stockOpname, $request->user(), $data['note'] ?? null);

        return response()->json(['data' => $this->payload($new, $request->user())], 201);
    }

    // ================================================================== building blocks

    private function respond(Request $request, StockOpname $o): JsonResponse
    {
        return response()->json(['data' => $this->payload($o->fresh(), $request->user())]);
    }

    private function orderRules(bool $creating): array
    {
        $req = $creating ? 'required' : 'sometimes';

        return [
            'scheduled_date' => [$req, 'date'],
            'warehouse_id' => $creating ? ['required', 'integer', 'exists:warehouses,id'] : ['prohibited'],
            'warehouse_location_id' => ['nullable', 'integer', 'exists:warehouse_locations,id'],
            'category_id' => ['nullable', 'integer', 'exists:categories,id'],
            'scope' => $creating ? ['required', Rule::in(['ALL', 'SELECTED'])] : ['prohibited'],
            'item_ids' => $creating ? ['required_if:scope,SELECTED', 'array', 'max:5000'] : ['prohibited'],
            'item_ids.*' => ['integer'],
            'count_method' => ['sometimes', Rule::in(['FULL', 'CYCLE'])],
            'cycle_days' => ['nullable', 'integer', 'min:1', 'max:3650'],
            'cycle_limit' => ['nullable', 'integer', 'min:1', 'max:2000'],
            'responsible_id' => ['nullable', 'integer', 'exists:users,id'],
            'team_ids' => ['nullable', 'array', 'max:50'],
            'team_ids.*' => ['integer', 'exists:users,id'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ];
    }

    private function filteredDocs(Request $request): Builder
    {
        $q = StockOpname::query()->whereNull('stock_opnames.accurate_itemadj_id');
        $request->whenFilled('date_from', fn ($v) => $q->whereDate('stock_opnames.scheduled_date', '>=', $v));
        $request->whenFilled('date_to', fn ($v) => $q->whereDate('stock_opnames.scheduled_date', '<=', $v));
        $request->whenFilled('warehouse_id', fn ($v) => $q->where('stock_opnames.warehouse_id', $v));
        $request->whenFilled('responsible_id', fn ($v) => $q->where('stock_opnames.responsible_id', $v));
        $request->whenFilled('status', fn ($v) => $q->whereIn('stock_opnames.status', StockOpname::statusesFor((string) $v)));

        return $q;
    }

    /** the documents waiting for this user's step, by what the user may do */
    private function todo(User $user, Request $request): array
    {
        $steps = [
            ['CONFIRMED', 'opname.count', 'Mulai hitung'], ['COUNTING', 'opname.count', 'Hitung fisik'], ['RECOUNT', 'opname.count', 'Hitung ulang'],
            ['DRAFT', 'opname.schedule', 'Lengkapi & konfirmasi'], ['REVIEW', 'opname.review', 'Review selisih'],
            ['WAITING_APPROVAL', 'opname.approve', 'Approve & posting'], ['POSTED', 'opname.review', 'Tutup dokumen'],
        ];
        $out = [];
        foreach ($steps as [$status, $perm, $action]) {
            if (! $user->hasPermission($perm)) {
                continue;
            }
            $this->filteredDocs($request)->whereIn('status', StockOpname::statusesFor($status))->with('warehouse:id,code')->withCount('items')
                ->orderBy('scheduled_date')->limit(20)->get()
                ->each(function (StockOpname $o) use (&$out, $status, $action) {
                    $out[] = ['id' => $o->id, 'number' => $o->number, 'flow_status' => $status, 'action' => $action,
                        'warehouse' => $o->warehouse?->code, 'scheduled_date' => $o->scheduled_date?->toDateString(),
                        'items_count' => $o->items_count, 'late' => $o->scheduled_date?->lt(today()) && in_array($status, ['CONFIRMED', 'COUNTING', 'RECOUNT', 'DRAFT'], true)];
                });
        }

        return $out;
    }

    /** what this user may do on the document now — the screen shows exactly these buttons */
    public function actions(StockOpname $o, User $u): array
    {
        if ($o->isFromAccurate()) {
            return [];
        }
        $s = $o->flowStatus();
        $can = fn (string $p) => $u->hasPermission($p);
        $a = [];
        if ($s === 'DRAFT' && $can('opname.schedule')) {
            array_push($a, 'edit', 'confirm');
        }
        if ($s === 'CONFIRMED' && $can('opname.count')) {
            $a[] = 'start_counting';
        }
        if (in_array($s, ['COUNTING', 'RECOUNT'], true) && $can('opname.count')) {
            $a[] = 'count';
        }
        if (in_array($s, ['COUNTING', 'RECOUNT'], true) && $can('opname.submit')) {
            $a[] = 'finish_counting';
        }
        if ($s === 'REVIEW' && $can('opname.review')) {
            array_push($a, 'review', 'request_approval');
        }
        if ($s === 'REVIEW' && $can('opname.request_recount')) {
            $a[] = 'recount';
        }
        if ($s === 'WAITING_APPROVAL' && $can('opname.approve')) {
            $a[] = 'approve';
        }
        if ($s === 'WAITING_APPROVAL' && $can('opname.reject')) {
            $a[] = 'reject';
        }
        if ($s === 'POSTED' && $can('opname.review')) {
            $a[] = 'close';
        }
        if (! in_array($s, StockOpname::LOCKED, true) && $can('opname.schedule')) {
            $a[] = 'cancel';
        }
        if (in_array($s, ['POSTED', 'DONE'], true) && $can('opname.schedule')) {
            $a[] = 'correction';
        }

        return $a;
    }

    private function payload(StockOpname $o, User $user): array
    {
        $see = self::canSeeSystem($user);
        $o->load(['warehouse:id,code,name', 'location:id,code', 'category:id,name,path', 'responsible:id,name', 'team:id,name',
            'scheduledBy:id,name', 'counter:id,name', 'reviewedBy:id,name', 'approvedBy:id,name', 'postedBy:id,name', 'correctionOf:id,number']);
        $lines = $o->items()->with(['item:id,code,description,unit_id', 'item.unit:id,code', 'location:id,code', 'countedBy:id,name'])
            ->withCount('counts')->orderBy('id')->get();

        $live = collect();
        $adjustments = collect();
        if ($see) {
            $live = Inventory::where('warehouse_id', $o->warehouse_id)->whereIn('item_id', $lines->pluck('item_id'))->pluck('actual_qty', 'item_id');
            $adjustments = StockAdjustment::whereIn('stock_opname_item_id', $lines->pluck('id'))->get()->keyBy('stock_opname_item_id');
        }
        $flow = $o->flowStatus();
        $summary = ['lines' => $lines->count(), 'counted' => $lines->where('count_status', 'COUNTED')->count(),
            'recount_open' => $lines->where('review_status', 'RECOUNT')->where('count_status', '!=', 'COUNTED')->count(),
            'recount' => $lines->where('review_status', 'RECOUNT')->count()];
        $summary['uncounted'] = $summary['lines'] - $summary['counted'];
        if ($see) {
            $summary += $this->flow->varianceSummary($o);
            $counted = $lines->whereNotNull('physical_qty');
            $summary['accuracy'] = $counted->count() ? round($counted->filter(fn ($l) => abs((float) $l->physical_qty - (float) $l->system_qty) < OpnameWorkflowService::EPS)->count() / $counted->count() * 100, 1) : null;
            $summary['excluded'] = $lines->where('review_status', 'REJECTED')->count();
            $summary['adjusted'] = $adjustments->count();
        }

        return [
            'id' => $o->id, 'number' => $o->number, 'status' => $o->status, 'flow_status' => $flow,
            'from_accurate' => $o->isFromAccurate(), 'accurate_itemadj_id' => $o->accurate_itemadj_id,
            'scope' => $o->type === 'FULL' ? 'ALL' : ($o->type === 'OPENING' ? 'OPENING' : 'SELECTED'),
            'count_method' => $o->count_method ?? 'FULL', 'count_round' => $o->count_round ?? 1,
            'warehouse' => $o->warehouse?->only('id', 'code', 'name'), 'location' => $o->location?->only('id', 'code'),
            'category' => $o->category?->only('id', 'name', 'path'),
            'scheduled_date' => $o->scheduled_date?->toDateString(), 'notes' => $o->notes,
            'responsible' => $o->responsible?->only('id', 'name'), 'team' => $o->team->map->only('id', 'name')->values(),
            'created_by' => $o->scheduledBy?->name, 'created_at' => $o->created_at?->toIso8601String(),
            'confirmed_at' => $o->confirmed_at?->toIso8601String(),
            'started_at' => $o->started_at?->toIso8601String(), 'counter' => $o->counter?->name, 'snapshot_at' => $o->snapshot_at?->toIso8601String(),
            'submitted_at' => $o->submitted_at?->toIso8601String(),
            'reviewed_at' => $o->reviewed_at?->toIso8601String(), 'reviewer' => $o->reviewedBy?->name, 'review_note' => $o->review_note,
            'approval_requested_at' => $o->approval_requested_at?->toIso8601String(),
            'approved_at' => $o->approved_at?->toIso8601String(), 'approver' => $o->approvedBy?->name, 'approval_note' => $o->approval_note,
            'posted_at' => $o->posted_at?->toIso8601String(), 'poster' => $o->postedBy?->name, 'posting_batch' => $see ? $o->posting_batch : null,
            'closed_at' => $o->closed_at?->toIso8601String(),
            'cancelled_at' => $o->cancelled_at?->toIso8601String(), 'cancel_reason' => $o->cancel_reason,
            'correction_of' => $o->correctionOf?->only('id', 'number'),
            'corrections' => StockOpname::where('correction_of_id', $o->id)->get(['id', 'number', 'status'])
                ->map(fn ($c) => ['id' => $c->id, 'number' => $c->number, 'flow_status' => $c->flowStatus()]),
            'can_see_system' => $see,
            'actions' => $this->actions($o, $user),
            'summary' => $summary,
            'lines' => $lines->map(fn (StockOpnameItem $l) => $this->lineRow($l, $see, $live, $adjustments, $o)),
        ];
    }

    private function lineRow(StockOpnameItem $l, bool $see, $live, $adjustments, ?StockOpname $o = null): array
    {
        $row = [
            'id' => $l->id, 'item_id' => $l->item_id, 'item_code' => $l->item?->code, 'description' => $l->item?->description,
            'uom' => $l->item?->unit?->code, 'location' => $l->location?->code,
            'physical_qty' => $l->physical_qty, 'note' => $l->note, 'count_status' => $l->count_status,
            'review_status' => $l->review_status, 'review_note' => $l->review_note, 'recount_reason' => $l->recount_reason,
            'count_round' => $l->count_round, 'counted_by' => $l->countedBy?->name, 'counted_at' => $l->counted_at?->toIso8601String(),
            'counts_count' => $l->counts_count ?? null,
        ];
        if (! $see) {
            return $row;
        }
        $counted = $l->physical_qty !== null;
        $variance = $counted ? round((float) $l->physical_qty - (float) $l->system_qty, 2) : null;
        $current = $live->has($l->item_id) ? round((float) $live[$l->item_id], 2) : ($live->isEmpty() ? null : 0.0);
        $adj = $adjustments[$l->id] ?? null;

        return $row + [
            'system_qty' => $l->system_qty,
            'variance' => $variance,
            'variance_pct' => $l->variancePct(),
            'variance_kind' => $variance === null ? null : (abs($variance) < OpnameWorkflowService::EPS ? 'MATCH' : ($variance > 0 ? 'PLUS' : 'MINUS')),
            'current_qty' => $current,
            // goods moved after the book quantity was frozen (only meaningful before posting)
            'moved_since_snapshot' => $current !== null && $o && ! in_array($o->flowStatus(), ['POSTED', 'DONE'], true) ? round($current - (float) $l->system_qty, 2) : null,
            'adjustment' => $adj ? ['qty_before' => $adj->qty_before, 'qty_after' => $adj->qty_after, 'difference' => $adj->difference, 'movement_id' => $adj->stock_movement_id] : null,
        ];
    }

    private function eventRow(StockOpnameEvent $e): array
    {
        return ['id' => $e->id, 'event' => $e->event, 'from_status' => $e->from_status, 'to_status' => $e->to_status,
            'note' => $e->note, 'meta' => $e->meta, 'user' => $e->user_name, 'line_id' => $e->stock_opname_item_id,
            'at' => $e->created_at?->toIso8601String()];
    }
}
