<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PurchaseOrderItem;
use App\Models\PurchaseOrderQuote;
use App\Services\PoDraftService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Draft PO: items of approved STOCKWISE PPBs, each vendor's price, picked into one PO per vendor (PoDraftService). */
class PoDraftController extends Controller
{
    public function __construct(private PoDraftService $service) {}

    /** GET /po-draft-lines?stage=SIAP|PENAWARAN|MENUNGGU_DIREKTUR|DIPILIH&search= (+ counts per stage) */
    public function lines(Request $request): JsonResponse
    {
        $user = $request->user();
        // the Direktur (without po.create) sees what waits for their pick, and what they picked
        $purchasing = $user->hasPermission('po.create');
        $stages = $purchasing ? array_keys(PoDraftService::STAGES) : ['MENUNGGU_DIREKTUR', 'DIPILIH'];
        $q = PoDraftService::waiting()->with(self::with());
        $stage = $request->string('stage')->upper()->value();
        if ($stage !== '') {
            abort_unless(in_array($stage, $stages, true), 403);
            $stage === 'SIAP' ? $q->whereNull('quote_stage') : $q->where('quote_stage', $stage);
        } elseif (! $purchasing) {
            $q->whereIn('quote_stage', $stages);
        }
        $counts = PoDraftService::waiting()->selectRaw("COALESCE(quote_stage, 'SIAP') as s, COUNT(*) as n")->groupBy('s')->pluck('n', 's');
        $words = preg_split('/\s+/', $request->string('search')->trim()->value(), -1, PREG_SPLIT_NO_EMPTY);
        $find = function ($query) use ($words) {
            foreach ($words as $w) {
                $query->where(fn ($x) => $x->where('description_raw', 'like', "%{$w}%")
                    ->orWhereHas('item', fn ($i) => $i->where('code', 'like', "%{$w}%")->orWhere('description', 'like', "%{$w}%"))
                    ->orWhereHas('approvedPpb', fn ($p) => $p->where('no_ppb', 'like', "%{$w}%")->orWhere('peminta', 'like', "%{$w}%")->orWhere('divisi', 'like', "%{$w}%"))
                    ->orWhereHas('quotes.vendor', fn ($v) => $v->where('name', 'like', "%{$w}%")));
            }

            return $query;
        };
        $rows = $find($q)->orderBy('id')->get();
        // ?done=1: also the items that already became a PO, so they stay visible with their status
        if ($request->boolean('done')) {
            $rows = $rows->concat($find(PurchaseOrderItem::query()->with(self::with())->with('purchaseOrder:id,number,status,vendor_id')
                ->whereNotNull('approved_ppb_id')->where('line_status', '!=', \App\Services\PpbApprovalService::WAITING)->whereHas('quotes'))
                ->orderByDesc('id')->limit(300)->get());
        }
        $history = self::history($rows->pluck('item_id')->filter()->unique()->values()->all());
        $updates = PoDraftService::priceUpdates($rows);

        return response()->json(['data' => $rows->map(fn (PurchaseOrderItem $l) => $this->row($l, $history[$l->item_id] ?? [], $updates))->values(), 'meta' => [
            'total' => $rows->count(),
            'stages' => collect($stages)->mapWithKeys(fn ($s) => [$s => (int) ($counts[$s] ?? 0)]),
        ]]);
    }

    /** POST /po-draft-lines/to-quotation {line_ids} — PPB Siap PO → Penawaran Harga */
    public function toQuotation(Request $request): JsonResponse
    {
        $vendors = $request->validate(['vendor_ids' => ['nullable', 'array', 'max:50'], 'vendor_ids.*' => ['integer', 'exists:vendors,id']])['vendor_ids'] ?? [];
        $ids = $this->ids($request);
        $moved = $this->service->toQuotation($request->user(), $ids);
        if ($vendors) {
            $this->service->planVendors($request->user(), $ids, array_map('intval', $vendors));
        }

        return response()->json(['data' => ['moved' => $moved]]);
    }

    /** POST /po-draft-lines/vendors {line_ids, vendor_ids} — more vendor columns for these items */
    public function addVendors(Request $request): JsonResponse
    {
        $vendors = $request->validate(['vendor_ids' => ['required', 'array', 'min:1', 'max:50'], 'vendor_ids.*' => ['integer', 'exists:vendors,id']])['vendor_ids'];

        return response()->json(['data' => ['lines' => $this->service->planVendors($request->user(), $this->ids($request), array_map('intval', $vendors))]]);
    }

    /** DELETE /po-draft-lines/vendors/{vendor} {line_ids} — a column with no price goes */
    public function dropVendor(Request $request, \App\Models\Vendor $vendor): JsonResponse
    {
        $this->service->dropVendor($this->ids($request), $vendor->id);

        return response()->json(['data' => ['removed' => true]]);
    }

    /** POST /po-draft-lines/back-to-ready {line_ids} — Penawaran Harga → PPB Siap PO */
    public function backToReady(Request $request): JsonResponse
    {
        return response()->json(['data' => ['moved' => $this->service->backToReady($request->user(), $this->ids($request))]]);
    }

    /** POST /po-draft-lines/submit-quotation {line_ids} — to the Direktur to pick the vendors */
    public function submitQuotation(Request $request): JsonResponse
    {
        return response()->json(['data' => ['moved' => $this->service->submitQuotation($request->user(), $this->ids($request))]]);
    }

    /** POST /po-draft-lines/{item}/choose {quote_id} — the Direktur's pick (tagged) */
    public function choose(Request $request, PurchaseOrderItem $item): JsonResponse
    {
        $data = $request->validate(['quote_id' => ['required', 'integer']]);
        $this->service->choose($request->user(), $item, (int) $data['quote_id']);

        return response()->json(['data' => $this->row($this->fresh($item))]);
    }

    /** POST /po-draft-lines/{item}/change-pick {quote_id, reason} — History: another vendor that quoted, until it is a PO */
    public function changePick(Request $request, PurchaseOrderItem $item): JsonResponse
    {
        $data = $request->validate(['quote_id' => ['required', 'integer'], 'reason' => ['required', 'string', 'max:500']], ['reason.required' => 'Tulis alasan perubahan.']);
        $this->service->changePick($request->user(), $item, (int) $data['quote_id'], $data['reason']);

        return response()->json(['data' => $this->row($this->fresh($item))]);
    }

    /** POST /po-draft-lines/{item}/return {note?} — the Direktur sends it back to the Penawaran Harga */
    public function returnQuotation(Request $request, PurchaseOrderItem $item): JsonResponse
    {
        $data = $request->validate(['note' => ['nullable', 'string', 'max:500']]);
        $this->service->returnQuotation($request->user(), $item, $data['note'] ?? null);

        return response()->json(['data' => $this->row($this->fresh($item))]);
    }

    /** PUT /po-draft-lines/{item} — update description, qty, unit of a waiting item. */
    public function updateItem(Request $request, PurchaseOrderItem $item): JsonResponse
    {
        $data = $request->validate([
            'description' => ['sometimes', 'string', 'max:400'],
            'qty' => ['sometimes', 'numeric', 'min:0.01'],
            'unit_id' => ['sometimes', 'nullable', 'integer', 'exists:units,id'],
        ]);
        $this->service->updateItem($request->user(), $item, $data);

        return response()->json(['data' => $this->row($this->fresh($item))]);
    }

    /** DELETE /po-draft-lines/{item} — remove an item from the draft. */
    public function removeItem(PurchaseOrderItem $item): JsonResponse
    {
        $this->service->removeItem($item);

        return response()->json(['data' => ['removed' => true]]);
    }

    private function ids(Request $request): array
    {
        $data = $request->validate(['line_ids' => ['required', 'array', 'min:1', 'max:200'], 'line_ids.*' => ['integer']]);

        return array_map('intval', $data['line_ids']);
    }

    /** PO statuses whose price counts as a purchase price (approved or further) */
    private const BOUGHT = ['APPROVED', 'SENT', 'DIBELI', 'PARTIAL_RECEIVED', 'RECEIVED', 'CLOSED'];

    /**
     * The last 3 prices each item was bought at (STOCKWISE and Accurate POs), newest first — to compare
     * with the vendors' offers now.
     *
     * @return array<int, list<array{po:string, date:?string, vendor:?string, unit_price:float}>>
     */
    public static function history(array $itemIds): array
    {
        if ($itemIds === []) {
            return [];
        }
        $out = [];
        $rows = \Illuminate\Support\Facades\DB::table('purchase_order_items as l')->join('purchase_orders as o', 'o.id', '=', 'l.purchase_order_id')
            ->leftJoin('vendors as v', 'v.id', '=', 'o.vendor_id')
            ->whereIn('l.item_id', $itemIds)->where('l.unit_price', '>', 0)->whereIn('o.status', self::BOUGHT)
            ->orderByDesc('o.date')->orderByDesc('l.id')
            ->get(['l.item_id', 'o.number', 'o.date', 'v.name as vendor', 'l.unit_price']);
        foreach ($rows as $r) {
            if (count($out[$r->item_id] ?? []) < 3) {
                $out[$r->item_id][] = ['po' => $r->number, 'date' => $r->date ? substr((string) $r->date, 0, 10) : null, 'vendor' => $r->vendor, 'unit_price' => (float) $r->unit_price];
            }
        }

        return $out;
    }

    private static function with(): array
    {
        return ['approvedPpb:id,no_ppb,tgl_ppb,divisi,peminta,tgl_diperlukan', 'item:id,code,description', 'unit:id,code',
            'quotes' => fn ($x) => $x->orderBy('unit_price')->orderBy('id'), 'quotes.vendor:id,name', 'quotes.creator:id,name', 'quotes.chooser:id,name', 'pickLogs', 'draftVendors:vendors.id,vendors.name'];
    }

    /** PUT /po-draft-lines/{item}/quotes {vendor_id, unit_price, note?} — a vendor's price (saved again = changed). */
    public function quote(Request $request, PurchaseOrderItem $item): JsonResponse
    {
        $data = $request->validate([
            'vendor_id' => ['required', 'integer', 'exists:vendors,id'],
            'unit_price' => ['required', 'numeric', 'min:0'],
            'note' => ['nullable', 'string', 'max:255'],
            'availability' => ['nullable', 'string', 'max:100'],
            'eta' => ['nullable', 'date'],
        ]);
        $this->service->quote($item, $request->user(), (int) $data['vendor_id'], (float) $data['unit_price'], $data['note'] ?? null, $data['availability'] ?? null, $data['eta'] ?? null);

        return response()->json(['data' => $this->row($this->fresh($item))]);
    }

    /** DELETE /po-draft-lines/{item}/quotes/{quote} */
    public function removeQuote(PurchaseOrderItem $item, PurchaseOrderQuote $quote): JsonResponse
    {
        abort_unless($quote->purchase_order_item_id === $item->id, 404);
        $this->service->removeQuote($item, $quote);

        return response()->json(['data' => $this->row($this->fresh($item))]);
    }

    /** GET /po-draft-lines/{item}/units — the units this line can be ordered in, each with its size in the item's own unit. */
    public function orderUnits(PurchaseOrderItem $item): JsonResponse
    {
        $master = $item->item_id ? \App\Models\Item::with('unit')->find($item->item_id) : null;

        return response()->json(['data' => [
            'base' => $master?->unit?->code,
            'units' => $master ? app(\App\Services\UomConverter::class)->orderUnits($master) : [],
        ]]);
    }

    /** POST /po-draft-lines/submit {line_ids, vendor_id, expected_date?, notes?, lines?: [{id, qty?, unit_price?}]} — one PO of one vendor. */
    public function submit(Request $request): JsonResponse
    {
        $data = $request->validate([
            'line_ids' => ['required', 'array', 'min:1', 'max:200'],
            'line_ids.*' => ['integer'],
            'vendor_id' => ['required', 'integer', 'exists:vendors,id'],
            'expected_date' => ['nullable', 'date'],
            'notes' => ['nullable', 'string', 'max:2000'],
            'lines' => ['nullable', 'array'],
            'lines.*.id' => ['required', 'integer'],
            'lines.*.qty' => ['nullable', 'numeric', 'min:0.01'],
            'lines.*.unit_price' => ['nullable', 'numeric', 'min:0'],
            'lines.*.unit_id' => ['nullable', 'integer', 'exists:units,id'],
        ]);
        $po = $this->service->submit($request->user(), array_map('intval', $data['line_ids']), $data);

        return response()->json(['data' => ['id' => $po->id, 'number' => $po->number, 'total' => (float) $po->total, 'lines' => $po->items()->count()]], 201);
    }

    private function fresh(PurchaseOrderItem $item): PurchaseOrderItem
    {
        return $item->fresh(self::with());
    }

    private function row(PurchaseOrderItem $l, ?array $history = null, ?array $updates = null): array
    {
        $p = $l->approvedPpb;
        $history ??= $l->item_id ? (self::history([$l->item_id])[$l->item_id] ?? []) : [];
        $updates ??= PoDraftService::priceUpdates([$l]);

        return [
            // the last 3 purchase prices of this item, to compare with the offers now
            'price_history' => $history,
            'id' => $l->id, 'item_id' => $l->item_id, 'item_code' => $l->item?->code, 'description' => $l->description_raw,
            'qty' => (float) $l->qty, 'unit' => $l->unit?->code, 'unit_id' => $l->unit_id,
            // in the item's own unit, when it is ordered in another
            'unit_ratio' => $l->unit_ratio === null ? null : (float) $l->unit_ratio, 'base_unit' => $l->base_unit,
            'stage' => $l->line_status === \App\Services\PpbApprovalService::WAITING ? ($l->quote_stage ?? 'SIAP') : 'PO',
            'po' => $l->line_status === \App\Services\PpbApprovalService::WAITING ? null : ['id' => $l->purchase_order_id, 'number' => $l->purchaseOrder?->number, 'status' => $l->purchaseOrder?->status, 'vendor_id' => $l->vendor_id ?? $l->purchaseOrder?->vendor_id],
            'submitted_at' => $l->quote_submitted_at, 'return_note' => $l->quote_return_note,
            'chosen_quote_id' => $l->quotes->first(fn ($q) => $q->chosen_at !== null)?->id,
            'ppb' => $p ? ['id' => $p->id, 'no_ppb' => $p->no_ppb, 'divisi' => $p->divisi, 'peminta' => $p->peminta,
                'tgl_ppb' => $p->tgl_ppb?->toDateString(), 'tgl_diperlukan' => $p->tgl_diperlukan?->toDateString()] : null,
            'draft_vendors' => $l->draftVendors->map(fn ($v) => ['id' => $v->id, 'name' => $v->name])->values(),
            'pick_log' => $l->pickLogs->map(fn ($g) => [
                'id' => $g->id, 'action' => $g->action, 'from_vendor' => $g->from_vendor, 'from_price' => $g->from_price, 'to_vendor' => $g->to_vendor, 'to_price' => $g->to_price,
                'reason' => $g->reason, 'by' => $g->user_name, 'at' => $g->created_at?->copy()->timezone(config('app.timezone'))->toIso8601String(),
            ])->values(),
            // sorted cheapest first: the first is the cheapest
            'quotes' => $l->quotes->map(fn (PurchaseOrderQuote $q) => [
                'id' => $q->id, 'vendor_id' => $q->vendor_id, 'vendor_name' => $q->vendor?->name, 'unit_price' => (float) $q->unit_price,
                'note' => $q->note, 'availability' => $q->availability, 'eta' => $q->eta?->toDateString(), 'by' => $q->creator?->name,
                'chosen' => $q->chosen_at !== null, 'chosen_by' => $q->chooser?->name, 'chosen_at' => $q->chosen_at, 'updated_at' => $q->updated_at?->copy()->timezone(config('app.timezone'))->toIso8601String(),
                // purchasing's last 3 price updates of this vendor, newest first
                'updates' => $updates["{$l->id}:{$q->vendor_id}"] ?? [],
            ])->values(),
        ];
    }
}
