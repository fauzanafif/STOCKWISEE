<?php

namespace App\Http\Controllers\Api\Disassembly;

use App\Http\Controllers\Controller;
use App\Models\DisassemblyEntry;
use App\Models\DisassemblyOrder;
use App\Models\Item;
use App\Models\MrpBom;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Disassembly\DisassemblyService;
use App\Services\Mrp\MrpQty;
use App\Services\UomConverter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Disassembly Orders — every step is checked again in DisassemblyService (status under a row lock);
 * the route permission only decides who may ask.
 */
class DisassemblyController extends Controller
{
    public function __construct(private readonly DisassemblyService $service) {}

    // ------------------------------------------------------------------ lists & detail

    public function index(Request $request): JsonResponse
    {
        $q = DisassemblyOrder::query()->with(['responsible:id,name', 'sourceWarehouse:id,code,name']);
        $request->whenFilled('status', function ($v) use ($q) {
            $q->whereIn('status', array_filter(array_map(fn ($s) => strtoupper(trim($s)), explode(',', (string) $v))));
        });
        $request->whenFilled('item_id', fn ($v) => $q->where('item_id', (int) $v));
        $request->whenFilled('from', fn ($v) => $q->whereDate('created_at', '>=', $v));
        $request->whenFilled('to', fn ($v) => $q->whereDate('created_at', '<=', $v));
        if ($request->boolean('not_in_accurate')) {
            $q->where('status', 'DONE')->whereNotNull('posting_batch')->whereNull('accurate_recorded_at');
        }
        if ($s = $request->string('search')->trim()->value()) {
            $q->where(fn ($w) => $w->where('number', 'like', "%{$s}%")->orWhere('product_code', 'like', "%{$s}%")
                ->orWhere('product_name', 'like', "%{$s}%")->orWhere('bom_code', 'like', "%{$s}%"));
        }
        $q->orderByRaw("CASE status WHEN 'TO_CLOSE' THEN 0 WHEN 'IN_PROGRESS' THEN 1 WHEN 'CONFIRMED' THEN 2 WHEN 'DRAFT' THEN 3 ELSE 4 END")->orderByDesc('id');
        $page = $q->paginate(min(max((int) $request->integer('per_page', 20), 1), 100));

        return response()->json([
            'data' => collect($page->items())->map(fn (DisassemblyOrder $o) => $this->summary($o)),
            'meta' => ['page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()],
        ]);
    }

    public function show(DisassemblyOrder $order): JsonResponse
    {
        $o = $order->load(['responsible:id,name', 'creator:id,name', 'bom:id,code,revision,status', 'sourceWarehouse:id,code,name', 'destWarehouse:id,code,name']);
        $steps = [];
        $names = DB::table('users')->whereIn('id', array_filter([$o->confirmed_by, $o->started_by, $o->finished_by, $o->done_by,
            $o->cancelled_by, $o->reversed_by, $o->accurate_recorded_by]))->pluck('name', 'id');
        foreach (['confirmed', 'started', 'finished', 'done', 'cancelled', 'reversed', 'accurate_recorded'] as $s) {
            $steps[$s] = ['at' => $this->iso($o->{"{$s}_at"}), 'by' => $names[$o->{"{$s}_by"}] ?? null];
        }
        $entries = $o->entries()->with(['recorder:id,name', 'item:id,code,description'])->get();
        $voiders = DB::table('users')->whereIn('id', $entries->pluck('voided_by')->filter()->unique())->pluck('name', 'id');
        $movements = DB::table('stock_movements as m')->leftJoin('warehouses as w', 'w.id', '=', 'm.warehouse_id')->leftJoin('items as i', 'i.id', '=', 'm.item_id')
            ->leftJoin('users as u', 'u.id', '=', 'm.created_by')
            ->where(['m.reference_type' => $o->getMorphClass(), 'm.reference_id' => $o->id])->orderBy('m.id')
            ->get(['m.id', 'm.movement_type', 'm.direction', 'm.qty', 'm.actual_before', 'm.actual_after', 'm.reserved_before', 'm.reserved_after',
                'm.note', 'm.batch_uuid', 'm.created_at', 'w.code as warehouse', 'i.code as item_code', 'i.description as item_name', 'u.name as user_name']);
        $activity = DB::table('disassembly_activities as a')->leftJoin('users as u', 'u.id', '=', 'a.user_id')
            ->where('a.disassembly_order_id', $o->id)->orderByDesc('a.id')
            ->get(['a.id', 'a.action', 'a.from_status', 'a.to_status', 'a.note', 'a.created_at', 'u.name as user_name']);

        return response()->json(['data' => $this->summary($o) + [
            'notes' => $o->notes, 'mrp_bom_id' => $o->mrp_bom_id, 'bom_status' => $o->bom?->status,
            'bom_changed' => $o->bom && $o->bom->status !== 'ACTIVE',
            'dest_warehouse_id' => $o->dest_warehouse_id, 'dest_warehouse' => $o->destWarehouse ? "{$o->destWarehouse->code} · {$o->destWarehouse->name}" : null,
            'created_by_id' => $o->created_by, 'created_by_name' => $o->creator?->name, 'created_at' => $this->iso($o->created_at),
            'steps' => $steps, 'cancel_reason' => $o->cancel_reason, 'accurate_refs' => $o->accurate_refs ?? [],
            'source_stock' => $this->service->sourceStock($o),
            'components' => array_map(function (array $r) {
                foreach (['qty_per_unit', 'planned', 'expected', 'good', 'scrap', 'missing', 'accounted', 'open', 'over', 'received'] as $k) {
                    $r[$k] = MrpQty::num($r[$k]);
                }

                return $r;
            }, $this->service->results($o)),
            'entries' => $entries->map(fn (DisassemblyEntry $e) => [
                'id' => $e->id, 'kind' => $e->kind, 'component_id' => $e->component_id, 'item_id' => $e->item_id,
                'item_code' => $e->item?->code, 'item_name' => $e->item?->description,
                'qty' => MrpQty::num($e->qty), 'unit' => $e->unit, 'unit_ratio' => MrpQty::num($e->unit_ratio),
                'base_qty' => MrpQty::num($e->base_qty), 'base_unit' => $e->base_unit,
                'entry_date' => $e->entry_date?->toDateString(), 'reason' => $e->reason, 'note' => $e->note, 'over_plan' => $e->over_plan,
                'recorded_by' => $e->recorder?->name, 'recorded_by_id' => $e->recorded_by, 'created_at' => $this->iso($e->created_at),
                'posted_at' => $this->iso($e->posted_at), 'voided_at' => $this->iso($e->voided_at), 'voided_by' => $voiders[$e->voided_by] ?? null,
            ]),
            'movements' => $movements->map(fn ($m) => [
                'id' => $m->id, 'type' => $m->movement_type, 'direction' => (int) $m->direction, 'qty' => (float) $m->qty,
                'item_code' => $m->item_code, 'item_name' => $m->item_name, 'warehouse' => $m->warehouse,
                'actual_before' => (float) $m->actual_before, 'actual_after' => (float) $m->actual_after,
                'reserved_before' => (float) $m->reserved_before, 'reserved_after' => (float) $m->reserved_after,
                'note' => $m->note, 'batch' => $m->batch_uuid, 'user_name' => $m->user_name,
                'created_at' => $m->created_at ? Carbon::parse($m->created_at)->toIso8601String() : null,
            ]),
            'activity' => $activity->map(fn ($a) => [
                'id' => $a->id, 'action' => $a->action, 'from' => $a->from_status, 'to' => $a->to_status, 'note' => $a->note,
                'user_name' => $a->user_name, 'at' => $a->created_at ? Carbon::parse($a->created_at)->toIso8601String() : null,
            ]),
            'transitions' => DisassemblyService::TRANSITIONS[$o->status] ?? [],
            'gate' => ['requests' => app(\App\Services\WarehouseGate::class)->requests('DSA', $o->id),
                'receipts' => app(\App\Services\WarehouseGate::class)->receipts('DSA', $o->id), 'posts_stock' => (bool) $o->posting_batch],
        ]]);
    }

    // ------------------------------------------------------------------ actions

    public function store(Request $request): JsonResponse
    {
        return $this->show($this->service->create($request->user(), $this->input($request, true)))->setStatusCode(201);
    }

    public function update(Request $request, DisassemblyOrder $order): JsonResponse
    {
        $user = $request->user();
        abort_unless(in_array((int) $user->id, [(int) $order->created_by, (int) $order->responsible_id], true) || $user->hasPermission('disassembly.confirm'), 403,
            'Hanya pembuat, penanggung jawab, atau pemegang izin konfirmasi yang bisa mengubah dokumen ini.');

        return $this->show($this->service->update($order, $user, $this->input($request, false)));
    }

    public function confirm(Request $request, DisassemblyOrder $order): JsonResponse
    {
        return $this->show($this->service->confirm($order, $request->user()));
    }

    public function start(Request $request, DisassemblyOrder $order): JsonResponse
    {
        return $this->show($this->service->start($order, $request->user()));
    }

    public function finish(Request $request, DisassemblyOrder $order): JsonResponse
    {
        $data = $request->validate(['done_qty' => ['nullable']]);

        return $this->show($this->service->finish($order, $request->user(), $data['done_qty'] ?? null));
    }

    public function reopen(Request $request, DisassemblyOrder $order): JsonResponse
    {
        $data = $request->validate(['note' => ['nullable', 'string', 'max:500']]);

        return $this->show($this->service->reopen($order, $request->user(), $data['note'] ?? null));
    }

    public function validateOrder(Request $request, DisassemblyOrder $order): JsonResponse
    {
        return $this->show($this->service->validate($order, $request->user()));
    }

    public function cancel(Request $request, DisassemblyOrder $order): JsonResponse
    {
        $data = $request->validate(['reason' => ['nullable', 'string', 'max:255']]);

        return $this->show($this->service->cancel($order, $request->user(), $data['reason'] ?? null));
    }

    public function reverse(Request $request, DisassemblyOrder $order): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:255']], ['reason.required' => 'Isi alasan pembalikan.']);

        return $this->show($this->service->reverse($order, $request->user(), $data['reason']));
    }

    public function markAccurate(Request $request, DisassemblyOrder $order): JsonResponse
    {
        $data = $request->validate(['refs' => ['required']], ['refs.required' => 'Isi nomor dokumen Accurate.']);

        return $this->show($this->service->markAccurate($order, $request->user(), is_array($data['refs']) ? $data['refs'] : (string) $data['refs']));
    }

    public function requestProduct(Request $request, DisassemblyOrder $order): JsonResponse
    {
        $made = $this->service->requestProduct($order, $request->user());

        return response()->json(['data' => ['id' => $made->id, 'number' => $made->number]], 201);
    }

    public function linkReceipt(Request $request, DisassemblyOrder $order): JsonResponse
    {
        $data = $request->validate(['no_ri' => ['required', 'string', 'max:60']], ['no_ri.required' => 'Isi nomor Receipt.']);

        return $this->show($this->service->linkReceipt($order, $request->user(), $data['no_ri']));
    }

    public function unlinkReceipt(Request $request, DisassemblyOrder $order): JsonResponse
    {
        $data = $request->validate(['no_ri' => ['required', 'string', 'max:60']]);

        return $this->show($this->service->unlinkReceipt($order, $request->user(), $data['no_ri']));
    }

    public function storeEntry(Request $request, DisassemblyOrder $order): JsonResponse
    {
        $data = $request->validate([
            'kind' => ['required', Rule::in(DisassemblyEntry::KINDS)],
            'item_id' => ['required', 'integer'],
            'qty' => ['required'],
            'unit' => ['nullable', 'string', 'max:20'],
            'entry_date' => ['nullable', 'date', 'before_or_equal:today'],
            'reason' => ['nullable', 'string', 'max:255'],
            'note' => ['nullable', 'string', 'max:2000'],
            'client_key' => ['nullable', 'string', 'max:64'],
        ]);
        $this->service->addEntry($order, $request->user(), $data);

        return $this->show($order->refresh())->setStatusCode(201);
    }

    public function voidEntry(Request $request, DisassemblyOrder $order, DisassemblyEntry $entry): JsonResponse
    {
        abort_unless((int) $entry->disassembly_order_id === (int) $order->id, 404);
        $this->service->voidEntry($entry, $request->user());

        return $this->show($order->refresh());
    }

    // ------------------------------------------------------------------ lookups & reports

    /** GET /disassembly/dashboard — counts per status, Done not yet in Accurate, and what waits for action. */
    public function dashboard(Request $request): JsonResponse
    {
        $counts = DisassemblyOrder::query()->groupBy('status')->selectRaw('status, COUNT(*) n')->pluck('n', 'status');
        $user = $request->user();
        $waiting = [];
        $want = array_filter([
            $user->hasPermission('disassembly.confirm') ? 'DRAFT' : null,
            $user->hasPermission('disassembly.record') ? 'CONFIRMED' : null,
            $user->hasPermission('disassembly.record') ? 'IN_PROGRESS' : null,
            $user->hasPermission('disassembly.validate') ? 'TO_CLOSE' : null,
        ]);
        if ($want !== []) {
            $waiting = DisassemblyOrder::with(['responsible:id,name', 'sourceWarehouse:id,code,name'])->whereIn('status', $want)
                ->orderByRaw("CASE status WHEN 'TO_CLOSE' THEN 0 WHEN 'IN_PROGRESS' THEN 1 WHEN 'CONFIRMED' THEN 2 ELSE 3 END")->orderBy('id')
                ->limit(15)->get()->map(fn ($o) => $this->summary($o))->all();
        }
        $notInAccurate = $user->hasPermission('disassembly.validate')
            ? DisassemblyOrder::with(['responsible:id,name', 'sourceWarehouse:id,code,name'])->where('status', 'DONE')->whereNotNull('posting_batch')->whereNull('accurate_recorded_at')
                ->orderBy('done_at')->limit(15)->get()->map(fn ($o) => $this->summary($o))->all()
            : [];

        return response()->json(['data' => [
            'counts' => collect(DisassemblyOrder::STATUSES)->mapWithKeys(fn ($s) => [$s => (int) ($counts[$s] ?? 0)])->all(),
            'total' => (int) $counts->sum(),
            'not_in_accurate' => DisassemblyOrder::where('status', 'DONE')->whereNotNull('posting_batch')->whereNull('accurate_recorded_at')->count(),
            'waiting' => $waiting,
            'not_in_accurate_list' => $notInAccurate,
        ]]);
    }

    /**
     * GET /disassembly/history — per validated order and component: good, scrap, missing (Base UOM).
     * Filters: from / to (validation date), item_id (the product or a component), search.
     */
    public function history(Request $request): JsonResponse
    {
        $from = $request->date('from') ?? now()->subDays(90)->startOfDay();
        $to = ($request->date('to') ?? now())->copy()->endOfDay();
        $q = DisassemblyOrder::query()->whereNotNull('done_at')->whereBetween('done_at', [$from, $to])->with(['components', 'sourceWarehouse:id,code,name']);
        $request->whenFilled('item_id', fn ($v) => $q->where(fn ($w) => $w->where('item_id', (int) $v)
            ->orWhereHas('components', fn ($c) => $c->where('item_id', (int) $v))));
        if ($s = $request->string('search')->trim()->value()) {
            $q->where(fn ($w) => $w->where('number', 'like', "%{$s}%")->orWhere('product_code', 'like', "%{$s}%")->orWhere('product_name', 'like', "%{$s}%"));
        }
        $orders = $q->orderByDesc('done_at')->limit(500)->get();
        $totals = DB::table('disassembly_entries')->whereIn('disassembly_order_id', $orders->pluck('id'))->whereNull('voided_at')
            ->groupBy('component_id', 'kind')->selectRaw('component_id, kind, SUM(base_qty) q')->get()
            ->groupBy('component_id');

        return response()->json(['data' => $orders->map(fn (DisassemblyOrder $o) => $this->summary($o) + [
            'components' => $o->components->map(function ($c) use ($totals) {
                $t = ($totals[$c->id] ?? collect())->pluck('q', 'kind');

                return ['item_id' => $c->item_id, 'code' => $c->product_code, 'description' => $c->description, 'base_unit' => $c->base_unit,
                    'good' => (float) ($t['GOOD'] ?? 0), 'scrap' => (float) ($t['SCRAP'] ?? 0), 'missing' => (float) ($t['MISSING'] ?? 0), 'is_extra' => $c->is_extra];
            })->values(),
        ])->values(), 'meta' => ['from' => $from->toDateString(), 'to' => $to->toDateString(), 'count' => $orders->count()]]);
    }

    /** GET /disassembly/items — products that can be taken apart: active, with stock, with an active BoM. */
    public function items(Request $request): JsonResponse
    {
        $q = trim((string) $request->query('q', ''));
        $boms = MrpBom::where('status', 'ACTIVE')->pluck('id', 'item_id');
        $rows = Item::query()->with('unit:id,code,rounding')->where('is_active', true)->where('product_kind', '!=', 'JASA')->whereNotNull('unit_id')
            ->whereIn('id', $boms->keys())
            ->when($q !== '', fn ($w) => $w->where(fn ($x) => $x->where('code', 'like', "%{$q}%")->orWhere('description', 'like', "%{$q}%")))
            ->orderBy('code')->limit(20)->get(['id', 'code', 'description', 'unit_id', 'default_warehouse_id']);
        $stock = DB::table('inventory')->whereIn('item_id', $rows->pluck('id'))->groupBy('item_id')
            ->selectRaw('item_id, SUM(actual_qty) a, SUM(reserved_qty) r')->get()->keyBy('item_id');

        return response()->json(['data' => $rows->map(fn (Item $i) => [
            'id' => $i->id, 'code' => $i->code, 'description' => $i->description, 'unit' => $i->unit?->code,
            'rounding' => $i->unit ? (float) $i->unit->rounding : null, 'default_warehouse_id' => $i->default_warehouse_id,
            'available' => isset($stock[$i->id]) ? round((float) $stock[$i->id]->a - (float) $stock[$i->id]->r, 2) : 0.0,
            'active_bom_id' => $boms[$i->id] ?? null,
        ])]);
    }

    /** GET /disassembly/items/{item}/bom — the active BoM of a product with its components (what a disassembly gives back). */
    public function bom(Item $item): JsonResponse
    {
        $bom = MrpBom::where('item_id', $item->id)->where('status', 'ACTIVE')->orderByDesc('revision')->with('lines.item:id,code,description')->first();

        return response()->json(['data' => $bom ? [
            'id' => $bom->id, 'code' => $bom->code, 'revision' => $bom->revision, 'base_unit' => $bom->base_unit,
            'lines' => $bom->lines->map(fn ($l) => ['item_id' => $l->item_id, 'code' => $l->item?->code, 'description' => $l->item?->description,
                'qty' => MrpQty::num($l->qty), 'base_unit' => $l->base_unit])->values(),
        ] : null]);
    }

    /** GET /disassembly/items/{item}/stock — free stock of the product per active warehouse. */
    public function stock(Item $item): JsonResponse
    {
        $inv = DB::table('inventory')->where('item_id', $item->id)->get()->keyBy('warehouse_id');

        return response()->json(['data' => Warehouse::where('is_active', true)->orderBy('code')->get(['id', 'code', 'name'])
            ->map(fn ($w) => ['id' => $w->id, 'code' => $w->code, 'name' => $w->name,
                'free' => isset($inv[$w->id]) ? round((float) $inv[$w->id]->actual_qty - (float) $inv[$w->id]->reserved_qty, 2) : 0.0,
                'stock_known' => (bool) ($inv[$w->id]->stock_known ?? false)])->values()]);
    }

    /** GET /disassembly/items/{item}/units — the units a component can be recorded in. */
    public function units(Item $item, UomConverter $uom): JsonResponse
    {
        return response()->json(['data' => $uom->orderUnits($item)]);
    }

    /** GET /disassembly/warehouses — active warehouses (destination choice). */
    public function warehouses(): JsonResponse
    {
        return response()->json(['data' => Warehouse::where('is_active', true)->orderBy('code')->get(['id', 'code', 'name'])]);
    }

    /** GET /disassembly/users — who can be made responsible: people with a Disassembly working permission. */
    public function users(): JsonResponse
    {
        $users = User::query()->where('is_active', true)->orderBy('name')->get(['id', 'name'])
            ->filter(fn (User $u) => $u->hasPermission('disassembly.record') || $u->hasPermission('disassembly.confirm'))->values();

        return response()->json(['data' => $users->map(fn ($u) => ['id' => $u->id, 'name' => $u->name])]);
    }

    // ------------------------------------------------------------------ helpers

    private function input(Request $request, bool $create): array
    {
        return $request->validate([
            'bom_id' => ['nullable', 'integer'],
            'item_id' => [$create ? 'required_without:bom_id' : 'prohibited', 'nullable', 'integer'],
            'planned_qty' => [$create ? 'required' : 'sometimes'],
            'source_warehouse_id' => [$create ? 'required' : 'sometimes', 'integer'],
            'dest_warehouse_id' => ['nullable', 'integer'],
            'responsible_id' => ['nullable', 'integer', 'exists:users,id'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ], ['source_warehouse_id.required' => 'Pilih gudang sumber.', 'planned_qty.required' => 'Isi jumlah yang dibongkar.']);
    }

    private function summary(DisassemblyOrder $o): array
    {
        return [
            'id' => $o->id, 'number' => $o->number, 'status' => $o->status,
            'item_id' => $o->item_id, 'product_code' => $o->product_code, 'product_name' => $o->product_name, 'base_unit' => $o->base_unit,
            'bom_code' => $o->bom_code, 'bom_revision' => $o->bom_revision,
            'planned_qty' => MrpQty::num($o->planned_qty), 'done_qty' => $o->done_qty === null ? null : MrpQty::num($o->done_qty),
            'reserved_qty' => MrpQty::num($o->reserved_qty),
            'source_warehouse_id' => $o->source_warehouse_id,
            'source_warehouse' => $o->sourceWarehouse ? "{$o->sourceWarehouse->code} · {$o->sourceWarehouse->name}" : null,
            'responsible_id' => $o->responsible_id, 'responsible_name' => $o->responsible?->name,
            'created_at' => $this->iso($o->created_at), 'done_at' => $this->iso($o->done_at),
            'accurate_recorded' => (bool) $o->accurate_recorded_at, 'reversed' => (bool) $o->reversed_at,
            'posts_stock' => (bool) $o->posting_batch, // only orders validated before the warehouse-door rule moved stock themselves
        ];
    }

    private function iso(mixed $t): ?string
    {
        return $t ? Carbon::parse($t)->timezone(config('app.timezone'))->toIso8601String() : null;
    }
}
