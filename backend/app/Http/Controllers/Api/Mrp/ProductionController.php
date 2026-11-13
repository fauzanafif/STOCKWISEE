<?php

namespace App\Http\Controllers\Api\Mrp;

use App\Http\Controllers\Controller;
use App\Models\MrpProduction;
use App\Models\MrpProductionEntry;
use App\Services\Mrp\MrpQty;
use App\Services\Mrp\ProductionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Manufacturing Orders — every step is checked again in ProductionService (status under a row lock),
 * the route permission only decides who may ask.
 */
class ProductionController extends Controller
{
    public function __construct(private readonly ProductionService $service) {}

    public function index(Request $request): JsonResponse
    {
        $q = MrpProduction::query()->with('responsible:id,name');
        $request->whenFilled('status', function ($v) use ($q) {
            $statuses = array_filter(array_map(fn ($s) => strtoupper(trim($s)), explode(',', (string) $v)));
            $q->whereIn('status', $statuses);
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
        $q->orderByRaw("CASE status WHEN 'TO_CLOSE' THEN 0 WHEN 'IN_PROGRESS' THEN 1 WHEN 'CONFIRMED' THEN 2 WHEN 'DRAFT' THEN 3 ELSE 4 END")
            ->orderByRaw("CASE priority WHEN 'URGENT' THEN 0 ELSE 1 END")->orderByDesc('id');
        $page = $q->paginate(min((int) $request->integer('per_page', 20), 100));
        $totals = $this->entryTotals(collect($page->items())->pluck('id')->all());

        return response()->json([
            'data' => collect($page->items())->map(fn (MrpProduction $mo) => $this->summary($mo, $totals[$mo->id] ?? [])),
            'meta' => ['page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()],
        ]);
    }

    public function show(MrpProduction $production): JsonResponse
    {
        $mo = $production->load(['responsible:id,name', 'creator:id,name', 'bom:id,code,revision,status']);
        $iso = fn ($t) => $t?->copy()->timezone(config('app.timezone'))->toIso8601String();
        $names = DB::table('users')->whereIn('id', array_filter([$mo->confirmed_by, $mo->started_by, $mo->finished_by, $mo->done_by,
            $mo->cancelled_by, $mo->reversed_by, $mo->accurate_recorded_by]))->pluck('name', 'id');
        $steps = [];
        foreach (['confirmed', 'started', 'finished', 'done', 'cancelled', 'reversed', 'accurate_recorded'] as $s) {
            $steps[$s] = ['at' => $iso($mo->{"{$s}_at"}), 'by' => $names[$mo->{"{$s}_by"}] ?? null];
        }
        $entries = $mo->entries()->with(['recorder:id,name', 'item:id,code,description'])->get();
        $voiders = DB::table('users')->whereIn('id', $entries->pluck('voided_by')->filter()->unique())->pluck('name', 'id');
        $movements = DB::table('stock_movements as m')->leftJoin('warehouses as w', 'w.id', '=', 'm.warehouse_id')->leftJoin('items as i', 'i.id', '=', 'm.item_id')
            ->leftJoin('users as u', 'u.id', '=', 'm.created_by')
            ->where(['m.reference_type' => $mo->getMorphClass(), 'm.reference_id' => $mo->id])->orderBy('m.id')
            ->get(['m.id', 'm.movement_type', 'm.direction', 'm.qty', 'm.actual_before', 'm.actual_after', 'm.reserved_before', 'm.reserved_after',
                'm.note', 'm.batch_uuid', 'm.created_at', 'w.code as warehouse', 'i.code as item_code', 'i.description as item_name', 'u.name as user_name']);

        return response()->json(['data' => $this->summary($mo, $this->entryTotals([$mo->id])[$mo->id] ?? []) + [
            'notes' => $mo->notes, 'mrp_bom_id' => $mo->mrp_bom_id, 'bom_status' => $mo->bom?->status,
            'bom_changed' => $mo->bom && $mo->bom->status !== 'ACTIVE',
            'created_by_name' => $mo->creator?->name, 'created_at' => $iso($mo->created_at),
            'steps' => $steps, 'cancel_reason' => $mo->cancel_reason, 'accurate_refs' => $mo->accurate_refs,
            'components' => $this->service->availability($mo),
            'entries' => $entries->map(fn (MrpProductionEntry $e) => [
                'id' => $e->id, 'kind' => $e->kind, 'item_id' => $e->item_id, 'item_code' => $e->item?->code, 'item_name' => $e->item?->description,
                'qty' => MrpQty::num($e->qty), 'unit' => $e->unit, 'unit_ratio' => MrpQty::num($e->unit_ratio),
                'base_qty' => MrpQty::num($e->base_qty), 'base_unit' => $e->base_unit,
                'entry_date' => $e->entry_date?->toDateString(), 'reason' => $e->reason, 'note' => $e->note, 'over_plan' => $e->over_plan,
                'recorded_by' => $e->recorder?->name, 'recorded_by_id' => $e->recorded_by, 'created_at' => $iso($e->created_at),
                'posted_at' => $iso($e->posted_at), 'voided_at' => $iso($e->voided_at), 'voided_by' => $voiders[$e->voided_by] ?? null,
            ]),
            'movements' => $movements->map(fn ($m) => [
                'id' => $m->id, 'type' => $m->movement_type, 'direction' => (int) $m->direction, 'qty' => (float) $m->qty,
                'item_code' => $m->item_code, 'item_name' => $m->item_name, 'warehouse' => $m->warehouse,
                'actual_before' => (float) $m->actual_before, 'actual_after' => (float) $m->actual_after,
                'reserved_before' => (float) $m->reserved_before, 'reserved_after' => (float) $m->reserved_after,
                'note' => $m->note, 'batch' => $m->batch_uuid, 'user_name' => $m->user_name,
                'created_at' => $m->created_at ? \Illuminate\Support\Carbon::parse($m->created_at)->toIso8601String() : null,
            ]),
            'activity' => BomController::activityRows('MO', $mo->id),
            // the warehouse door: the Item Requests the components were asked with, the Receipts the output came in with
            'gate' => ['requests' => app(\App\Services\WarehouseGate::class)->requests('MO', $mo->id),
                'receipts' => app(\App\Services\WarehouseGate::class)->receipts('MO', $mo->id), 'posts_stock' => (bool) $mo->posting_batch],
            'transitions' => ProductionService::TRANSITIONS[$mo->status] ?? [],
        ]]);
    }

    public function store(Request $request): JsonResponse
    {
        $mo = $this->service->create($request->user(), $this->input($request, true));

        return $this->show($mo)->setStatusCode(201);
    }

    public function update(Request $request, MrpProduction $production): JsonResponse
    {
        $this->assertOwnDraft($request, $production);

        return $this->show($this->service->update($production, $request->user(), $this->input($request, false)));
    }

    public function confirm(Request $request, MrpProduction $production): JsonResponse
    {
        return $this->show($this->service->confirm($production, $request->user()));
    }

    public function start(Request $request, MrpProduction $production): JsonResponse
    {
        return $this->show($this->service->start($production, $request->user()));
    }

    public function finish(Request $request, MrpProduction $production): JsonResponse
    {
        return $this->show($this->service->finish($production, $request->user()));
    }

    public function reopen(Request $request, MrpProduction $production): JsonResponse
    {
        $data = $request->validate(['note' => ['nullable', 'string', 'max:500']]);

        return $this->show($this->service->reopen($production, $request->user(), $data['note'] ?? null));
    }

    public function validateOrder(Request $request, MrpProduction $production): JsonResponse
    {
        return $this->show($this->service->validate($production, $request->user()));
    }

    public function cancel(Request $request, MrpProduction $production): JsonResponse
    {
        $data = $request->validate(['reason' => ['nullable', 'string', 'max:255']]);

        return $this->show($this->service->cancel($production, $request->user(), $data['reason'] ?? null));
    }

    public function reverse(Request $request, MrpProduction $production): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:255']], ['reason.required' => 'Isi alasan pembalikan.']);

        return $this->show($this->service->reverse($production, $request->user(), $data['reason']));
    }

    public function markAccurate(Request $request, MrpProduction $production): JsonResponse
    {
        $data = $request->validate(['refs' => ['required', 'string', 'max:255']], ['refs.required' => 'Isi nomor dokumen Accurate.']);

        return $this->show($this->service->markAccurate($production, $request->user(), $data['refs']));
    }

    public function storeEntry(Request $request, MrpProduction $production): JsonResponse
    {
        $data = $request->validate([
            'kind' => ['required', Rule::in(MrpProductionEntry::KINDS)],
            'item_id' => ['nullable', 'integer'],
            'qty' => ['required'],
            'unit' => ['nullable', 'string', 'max:20'],
            'entry_date' => ['nullable', 'date', 'before_or_equal:today'],
            'reason' => ['nullable', 'string', 'max:255'],
            'note' => ['nullable', 'string', 'max:2000'],
            'client_key' => ['nullable', 'string', 'max:64'],
        ]);
        $this->service->addEntry($production, $request->user(), $data);

        return $this->show($production->refresh())->setStatusCode(201);
    }

    public function voidEntry(Request $request, MrpProduction $production, MrpProductionEntry $entry): JsonResponse
    {
        abort_unless((int) $entry->mrp_production_id === (int) $production->id, 404);
        $this->service->voidEntry($entry, $request->user());

        return $this->show($production->refresh());
    }

    public function requestComponents(Request $request, MrpProduction $production): JsonResponse
    {
        $made = $this->service->requestComponents($production, $request->user());

        return response()->json(['data' => ['id' => $made->id, 'number' => $made->number]], 201);
    }

    public function linkReceipt(Request $request, MrpProduction $production): JsonResponse
    {
        $data = $request->validate(['no_ri' => ['required', 'string', 'max:60']], ['no_ri.required' => 'Isi nomor Receipt.']);

        return $this->show($this->service->linkReceipt($production, $request->user(), $data['no_ri']));
    }

    public function unlinkReceipt(Request $request, MrpProduction $production): JsonResponse
    {
        $data = $request->validate(['no_ri' => ['required', 'string', 'max:60']]);

        return $this->show($this->service->unlinkReceipt($production, $request->user(), $data['no_ri']));
    }

    public function requestShortage(Request $request, MrpProduction $production): JsonResponse
    {
        $draft = $this->service->requestShortage($production, $request->user());

        return response()->json(['data' => ['id' => $draft->id, 'number' => $draft->number, 'lines' => $draft->lines()->count(),
            'skipped' => app(\App\Services\PpbDraftService::class)->skipped]], 201);
    }

    /** A draft is changed by whoever made it or is responsible for it, or by someone who may confirm MOs. */
    private function assertOwnDraft(Request $request, MrpProduction $mo): void
    {
        $user = $request->user();
        abort_unless(in_array((int) $user->id, [(int) $mo->created_by, (int) $mo->responsible_id], true) || $user->hasPermission('mrp.confirm'), 403,
            'Hanya pembuat, penanggung jawab, atau pemegang izin konfirmasi yang bisa mengubah MO ini.');
    }

    private function input(Request $request, bool $create): array
    {
        return $request->validate([
            'bom_id' => ['nullable', 'integer'],
            'item_id' => [$create ? 'required_without:bom_id' : 'prohibited', 'nullable', 'integer'],
            'planned_qty' => [$create ? 'required' : 'sometimes'],
            'planned_start' => ['nullable', 'date'],
            'planned_finish' => ['nullable', 'date'],
            'responsible_id' => ['nullable', 'integer', 'exists:users,id'],
            'priority' => ['nullable', Rule::in(MrpProduction::PRIORITIES)],
            'notes' => ['nullable', 'string', 'max:2000'],
        ]);
    }

    /** @return array<int, array<string, string>> mo id => kind => base qty (posted or not, voided excluded) */
    private function entryTotals(array $ids): array
    {
        if ($ids === []) {
            return [];
        }
        $out = [];
        $rows = DB::table('mrp_production_entries as e')->join('mrp_productions as p', 'p.id', '=', 'e.mrp_production_id')
            ->whereIn('e.mrp_production_id', $ids)->whereNull('e.voided_at')
            ->groupBy('e.mrp_production_id', 'e.kind')
            ->selectRaw('e.mrp_production_id id, e.kind, SUM(e.base_qty) q, SUM(CASE WHEN e.item_id = p.item_id THEN e.base_qty ELSE 0 END) q_product')->get();
        foreach ($rows as $r) {
            $out[(int) $r->id][$r->kind] = MrpQty::dec($r->q);
            if ($r->kind === 'SCRAP') {
                $out[(int) $r->id]['SCRAP_PRODUCT'] = MrpQty::dec($r->q_product);
            }
        }

        return $out;
    }

    private function summary(MrpProduction $mo, array $totals): array
    {
        $date = fn ($d) => $d?->toDateString();
        $iso = fn ($t) => $t?->copy()->timezone(config('app.timezone'))->toIso8601String();

        return [
            'id' => $mo->id, 'number' => $mo->number, 'status' => $mo->status, 'priority' => $mo->priority,
            'item_id' => $mo->item_id, 'product_code' => $mo->product_code, 'product_name' => $mo->product_name, 'base_unit' => $mo->base_unit,
            'bom_code' => $mo->bom_code, 'bom_revision' => $mo->bom_revision,
            'planned_qty' => MrpQty::num($mo->planned_qty),
            'output_qty' => MrpQty::num($totals['OUTPUT'] ?? 0),
            'consumed_qty' => MrpQty::num($totals['CONSUME'] ?? 0),
            'scrap_qty' => MrpQty::num($totals['SCRAP'] ?? 0),
            'scrap_product_qty' => MrpQty::num($totals['SCRAP_PRODUCT'] ?? 0),
            'planned_start' => $date($mo->planned_start), 'planned_finish' => $date($mo->planned_finish),
            'responsible_id' => $mo->responsible_id, 'responsible_name' => $mo->responsible?->name,
            'started_at' => $iso($mo->started_at), 'done_at' => $iso($mo->done_at),
            'accurate_recorded' => (bool) $mo->accurate_recorded_at, 'reversed' => (bool) $mo->reversed_at,
            'posts_stock' => (bool) $mo->posting_batch, // only MOs validated before the warehouse-door rule moved stock themselves
        ];
    }
}
