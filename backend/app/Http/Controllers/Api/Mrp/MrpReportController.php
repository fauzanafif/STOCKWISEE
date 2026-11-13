<?php

namespace App\Http\Controllers\Api\Mrp;

use App\Http\Controllers\Controller;
use App\Models\Item;
use App\Models\MrpBom;
use App\Models\MrpProduction;
use App\Models\User;
use App\Services\Mrp\MrpQty;
use App\Services\UomConverter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Manufacturing overview, reports and the lookups of its forms (mrp.view). Quantities are Base UOM.
 * No production cost: STOCKWISE has no reliable item cost to multiply by.
 */
class MrpReportController extends Controller
{
    public function dashboard(): JsonResponse
    {
        $counts = MrpProduction::query()->groupBy('status')->selectRaw('status, COUNT(*) c')->pluck('c', 'status');
        $since = now()->subDays(30)->startOfDay();
        $output = DB::table('mrp_production_entries as e')->join('mrp_productions as p', 'p.id', '=', 'e.mrp_production_id')
            ->where('p.status', 'DONE')->where('p.done_at', '>=', $since)->whereNull('e.voided_at')->where('e.kind', 'OUTPUT')->sum('e.base_qty');

        return response()->json(['data' => [
            'counts' => collect(MrpProduction::STATUSES)->mapWithKeys(fn ($s) => [$s => (int) ($counts[$s] ?? 0)]),
            'boms' => ['active' => MrpBom::where('status', 'ACTIVE')->count(), 'draft' => MrpBom::where('status', 'DRAFT')->count()],
            'done_30d' => MrpProduction::where('status', 'DONE')->where('done_at', '>=', $since)->count(),
            'output_30d' => MrpQty::num($output),
            'not_in_accurate' => MrpProduction::where('status', 'DONE')->whereNotNull('posting_batch')->whereNull('accurate_recorded_at')->count(),
            'urgent_open' => MrpProduction::whereIn('status', ['DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'TO_CLOSE'])->where('priority', 'URGENT')->count(),
        ]]);
    }

    /**
     * GET /mrp/reports?type=summary|consumption|output|scrap|trace&from&to&item_id
     *   summary      one row per MO created in the period
     *   consumption  per component: required vs consumed vs scrapped (MOs Done in the period)
     *   output       per product: planned vs good output vs rejected (MOs Done in the period)
     *   scrap        every scrap entry (posted MOs) with its reason
     *   trace        an item: the MOs that produced or used it and the stock movements they posted
     */
    public function report(Request $request): JsonResponse
    {
        $data = $request->validate([
            'type' => ['required', 'in:summary,consumption,output,scrap,trace'],
            'from' => ['nullable', 'date'], 'to' => ['nullable', 'date'], 'item_id' => ['nullable', 'integer'],
        ]);
        $from = $data['from'] ?? now()->subDays(90)->toDateString();
        $to = $data['to'] ?? now()->toDateString();
        $done = fn ($q) => $q->where('p.status', 'DONE')->whereDate('p.done_at', '>=', $from)->whereDate('p.done_at', '<=', $to);

        $rows = match ($data['type']) {
            'summary' => DB::table('mrp_productions as p')->leftJoin('users as u', 'u.id', '=', 'p.responsible_id')
                ->whereDate('p.created_at', '>=', $from)->whereDate('p.created_at', '<=', $to)->orderByDesc('p.id')->limit(1000)
                ->get(['p.id', 'p.number', 'p.status', 'p.product_code', 'p.product_name', 'p.base_unit', 'p.planned_qty', 'p.started_at', 'p.done_at', 'p.accurate_recorded_at', 'u.name as responsible'])
                ->map(function ($r) {
                    $t = DB::table('mrp_production_entries')->where('mrp_production_id', $r->id)->whereNull('voided_at')->groupBy('kind')->selectRaw('kind, SUM(base_qty) q')->pluck('q', 'kind');

                    return (array) $r + ['planned_qty' => (float) $r->planned_qty, 'output_qty' => (float) ($t['OUTPUT'] ?? 0),
                        'consumed_qty' => (float) ($t['CONSUME'] ?? 0), 'scrap_qty' => (float) ($t['SCRAP'] ?? 0)];
                }),
            'consumption' => $done(DB::table('mrp_production_components as c')->join('mrp_productions as p', 'p.id', '=', 'c.mrp_production_id'))
                ->groupBy('c.item_id', 'c.product_code', 'c.description', 'c.base_unit')
                ->selectRaw('c.item_id, c.product_code code, c.description, c.base_unit, SUM(c.required_qty) required, COUNT(DISTINCT p.id) orders,
                    (SELECT COALESCE(SUM(e.base_qty),0) FROM mrp_production_entries e JOIN mrp_productions p2 ON p2.id = e.mrp_production_id
                      WHERE e.item_id = c.item_id AND e.kind = \'CONSUME\' AND e.voided_at IS NULL AND p2.status = \'DONE\' AND DATE(p2.done_at) BETWEEN ? AND ?) consumed,
                    (SELECT COALESCE(SUM(e.base_qty),0) FROM mrp_production_entries e JOIN mrp_productions p2 ON p2.id = e.mrp_production_id
                      WHERE e.item_id = c.item_id AND e.kind = \'SCRAP\' AND e.voided_at IS NULL AND p2.status = \'DONE\' AND DATE(p2.done_at) BETWEEN ? AND ?) scrapped', [$from, $to, $from, $to])
                ->orderBy('c.product_code')->get()
                ->map(fn ($r) => (array) $r + ['required' => (float) $r->required, 'consumed' => (float) $r->consumed, 'scrapped' => (float) $r->scrapped,
                    'variance' => round((float) $r->consumed + (float) $r->scrapped - (float) $r->required, 6)]),
            'output' => $done(DB::table('mrp_productions as p'))
                ->groupBy('p.item_id', 'p.product_code', 'p.product_name', 'p.base_unit')
                ->selectRaw('p.item_id, p.product_code code, p.product_name description, p.base_unit, COUNT(*) orders, SUM(p.planned_qty) planned,
                    (SELECT COALESCE(SUM(e.base_qty),0) FROM mrp_production_entries e JOIN mrp_productions p2 ON p2.id = e.mrp_production_id
                      WHERE p2.item_id = p.item_id AND e.kind = \'OUTPUT\' AND e.voided_at IS NULL AND p2.status = \'DONE\' AND DATE(p2.done_at) BETWEEN ? AND ?) output,
                    (SELECT COALESCE(SUM(e.base_qty),0) FROM mrp_production_entries e JOIN mrp_productions p2 ON p2.id = e.mrp_production_id
                      WHERE p2.item_id = p.item_id AND e.item_id = p2.item_id AND e.kind = \'SCRAP\' AND e.voided_at IS NULL AND p2.status = \'DONE\' AND DATE(p2.done_at) BETWEEN ? AND ?) rejected', [$from, $to, $from, $to])
                ->orderBy('p.product_code')->get()
                ->map(fn ($r) => (array) $r + ['planned' => (float) $r->planned, 'output' => (float) $r->output, 'rejected' => (float) $r->rejected]),
            'scrap' => DB::table('mrp_production_entries as e')->join('mrp_productions as p', 'p.id', '=', 'e.mrp_production_id')
                ->join('items as i', 'i.id', '=', 'e.item_id')->leftJoin('users as u', 'u.id', '=', 'e.recorded_by')
                ->where('e.kind', 'SCRAP')->whereNull('e.voided_at')->whereDate('e.entry_date', '>=', $from)->whereDate('e.entry_date', '<=', $to)
                ->whereNotIn('p.status', ['CANCELLED'])->orderByDesc('e.entry_date')->limit(1000)
                ->get(['e.id', 'p.id as mo_id', 'p.number', 'p.status', 'i.code', 'i.description', 'e.qty', 'e.unit', 'e.base_qty', 'e.base_unit', 'e.reason', 'e.entry_date',
                    DB::raw('CASE WHEN e.item_id = p.item_id THEN 1 ELSE 0 END as is_product'), 'u.name as recorded_by', 'e.posted_at'])
                ->map(fn ($r) => (array) $r + ['qty' => (float) $r->qty, 'base_qty' => (float) $r->base_qty, 'is_product' => (bool) $r->is_product]),
            'trace' => $this->trace((int) ($data['item_id'] ?? 0)),
        };

        return response()->json(['data' => $rows, 'meta' => ['type' => $data['type'], 'from' => $from, 'to' => $to]]);
    }

    /** Finished product → MO → consumed components → the stock movements posted (and the reverse: where an item was used). */
    private function trace(int $itemId): array
    {
        if (! $itemId) {
            return [];
        }
        $mos = MrpProduction::query()->where(fn ($q) => $q->where('item_id', $itemId)
            ->orWhereIn('id', DB::table('mrp_production_entries')->where('item_id', $itemId)->whereNull('voided_at')->select('mrp_production_id')))
            ->orderByDesc('id')->limit(200)->get();

        return $mos->map(function (MrpProduction $mo) use ($itemId) {
            $moves = DB::table('stock_movements as m')->leftJoin('items as i', 'i.id', '=', 'm.item_id')->leftJoin('warehouses as w', 'w.id', '=', 'm.warehouse_id')
                ->where(['m.reference_type' => $mo->getMorphClass(), 'm.reference_id' => $mo->id])
                ->whereNotIn('m.movement_type', ['RESERVATION', 'RELEASE_RESERVATION'])->orderBy('m.id')
                ->get(['m.id', 'm.movement_type', 'm.direction', 'm.qty', 'm.created_at', 'i.code', 'i.description', 'w.code as warehouse']);

            return [
                'id' => $mo->id, 'number' => $mo->number, 'status' => $mo->status, 'role' => (int) $mo->item_id === $itemId ? 'PRODUCED' : 'USED',
                'product_code' => $mo->product_code, 'product_name' => $mo->product_name, 'done_at' => $mo->done_at?->toIso8601String(),
                'accurate_refs' => $mo->accurate_refs,
                'movements' => $moves->map(fn ($m) => ['id' => $m->id, 'type' => $m->movement_type, 'direction' => (int) $m->direction, 'qty' => (float) $m->qty,
                    'code' => $m->code, 'description' => $m->description, 'warehouse' => $m->warehouse, 'created_at' => $m->created_at])->all(),
            ];
        })->all();
    }

    /** GET /mrp/items?q=&for=product|component — active stock items with a Base UOM. */
    public function items(Request $request): JsonResponse
    {
        $q = trim((string) $request->query('q', ''));
        $rows = Item::query()->with('unit:id,code')->where('is_active', true)->where('product_kind', '!=', 'JASA')->whereNotNull('unit_id')
            ->when($q !== '', fn ($w) => $w->where(fn ($x) => $x->where('code', 'like', "%{$q}%")->orWhere('description', 'like', "%{$q}%")))
            ->orderBy('code')->limit(20)->get(['id', 'code', 'description', 'unit_id']);
        $stock = DB::table('inventory')->whereIn('item_id', $rows->pluck('id'))->groupBy('item_id')
            ->selectRaw('item_id, SUM(actual_qty) a, SUM(reserved_qty) r, MAX(stock_known) k')->get()->keyBy('item_id');
        $active = MrpBom::whereIn('item_id', $rows->pluck('id'))->where('status', 'ACTIVE')->pluck('id', 'item_id');

        return response()->json(['data' => $rows->map(fn (Item $i) => [
            'id' => $i->id, 'code' => $i->code, 'description' => $i->description, 'unit' => $i->unit?->code,
            'available' => isset($stock[$i->id]) ? round((float) $stock[$i->id]->a - (float) $stock[$i->id]->r, 2) : 0.0,
            'stock_known' => (bool) ($stock[$i->id]->k ?? false), 'active_bom_id' => $active[$i->id] ?? null,
        ])]);
    }

    /** GET /mrp/items/{item}/units — the units this item can be recorded in, with how much Base UOM each is. */
    public function units(Item $item, UomConverter $uom): JsonResponse
    {
        return response()->json(['data' => $uom->orderUnits($item)]);
    }

    /** GET /mrp/users — who can be made responsible: people with an MRP permission. */
    public function users(): JsonResponse
    {
        $users = User::query()->where('is_active', true)->orderBy('name')->get(['id', 'name'])
            ->filter(fn (User $u) => $u->hasPermission('mrp.record') || $u->hasPermission('mrp.confirm'))->values();

        return response()->json(['data' => $users->map(fn ($u) => ['id' => $u->id, 'name' => $u->name])]);
    }
}
