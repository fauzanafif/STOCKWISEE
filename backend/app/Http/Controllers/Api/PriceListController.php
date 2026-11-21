<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Item;
use App\Models\VendorPrice;
use App\Services\PriceListService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Price List (Item × Vendor). Reading needs rfq.view; adding rfq.create; changing and
 * deactivating rfq.update (the permissions purchasing already holds). See PriceListService.
 */
class PriceListController extends Controller
{
    public function __construct(private PriceListService $service) {}

    /** GET /price-list/matrix?search=&category=&vendor_ids[]=&status=none|priced|active|expired|draft&page=&per_page= */
    public function matrix(Request $request): JsonResponse
    {
        $f = $request->validate([
            'search' => ['nullable', 'string', 'max:100'], 'category' => ['nullable', 'string', 'max:100'],
            'vendor_ids' => ['nullable', 'array', 'max:30'], 'vendor_ids.*' => ['integer'],
            'status' => ['nullable', 'string', 'in:none,priced,active,expired,draft,incomplete,NONE,PRICED,ACTIVE,EXPIRED,DRAFT,INCOMPLETE'],
            'page' => ['nullable', 'integer', 'min:1'], 'per_page' => ['nullable', 'integer', 'min:10', 'max:100'],
        ]);

        return response()->json(['data' => $this->service->matrix($f)]);
    }

    /** GET /price-list?search=&category=&vendor_id=&status=&sort=&dir=&page=&per_page= — one row per price */
    public function index(Request $request): JsonResponse
    {
        $f = $request->validate([
            'search' => ['nullable', 'string', 'max:100'], 'category' => ['nullable', 'string', 'max:100'],
            'vendor_id' => ['nullable', 'integer'], 'status' => ['nullable', 'string', 'max:12'], 'incomplete' => ['nullable', 'boolean'],
            'sort' => ['nullable', 'string', 'max:20'], 'dir' => ['nullable', 'in:asc,desc'],
            'page' => ['nullable', 'integer', 'min:1'], 'per_page' => ['nullable', 'integer', 'min:10', 'max:100'],
        ]);
        $page = $this->service->list($f);

        return response()->json([
            'data' => collect($page->items())->map(fn (VendorPrice $p) => $this->service->row($p))->values(),
            'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'per_page' => $page->perPage(), 'total' => $page->total(),
                'completeness' => $this->service->completeness()],
        ]);
    }

    /** GET /price-list/{price} */
    public function show(VendorPrice $price): JsonResponse
    {
        return response()->json(['data' => $this->service->row($price)]);
    }

    /** POST /price-list — Add Price */
    public function store(Request $request): JsonResponse
    {
        $price = $this->service->save($request->user(), $this->fields($request));

        return response()->json(['data' => $this->service->row($price)], 201);
    }

    /** PUT /price-list/{price} — Edit Price (every change goes to the history) */
    public function update(Request $request, VendorPrice $price): JsonResponse
    {
        $data = $this->fields($request) + ['item_id' => $price->item_id];
        $price = $this->service->save($request->user(), $data, $price);

        return response()->json(['data' => $this->service->row($price->fresh())]);
    }

    /** POST /price-list/{price}/archive {note?} — Deactivate Price */
    public function archive(Request $request, VendorPrice $price): JsonResponse
    {
        $note = $request->validate(['note' => ['nullable', 'string', 'max:500']])['note'] ?? null;

        return response()->json(['data' => $this->service->row($this->service->archive($request->user(), $price, $note)->fresh())]);
    }

    /** GET /price-list/{price}/history — newest first */
    public function history(VendorPrice $price): JsonResponse
    {
        return response()->json(['data' => $price->histories()->limit(200)->get()->map(fn ($h) => [
            'id' => $h->id, 'action' => $h->action, 'old_price' => $h->old_price !== null ? (float) $h->old_price : null,
            'new_price' => $h->new_price !== null ? (float) $h->new_price : null, 'old_status' => $h->old_status, 'new_status' => $h->new_status,
            'changes' => $h->changes, 'note' => $h->note, 'user' => $h->user_name, 'at' => $h->created_at?->toIso8601String(),
        ])]);
    }

    /** GET /price-list/items/{item}/units — the purchase units allowed for the item, by the UOM rules */
    public function units(Item $item): JsonResponse
    {
        $item->loadMissing('unit:id,code');

        return response()->json(['data' => ['base' => $item->unit?->code, 'units' => $this->service->units($item)]]);
    }

    /** GET /price-list/reference?item_ids[]= — for a Purchase Request: the current prices of these items, a reference to check */
    public function reference(Request $request): JsonResponse
    {
        $ids = $request->validate(['item_ids' => ['required', 'array', 'max:500'], 'item_ids.*' => ['integer']])['item_ids'];

        return response()->json(['data' => (object) $this->service->reference($ids)]);
    }

    private function fields(Request $request): array
    {
        return $request->validate([
            'item_id' => [$request->isMethod('post') ? 'required' : 'prohibited', 'integer'],
            'vendor_id' => ['required', 'integer'],
            'unit_id' => ['required', 'integer', 'exists:units,id'],
            'price' => ['required', 'numeric'],
            'price_type' => ['nullable', 'string', 'in:EXCL,NETT'],
            'ppn_rate' => ['nullable', 'numeric', 'in:11,12'],
            'vendor_ref' => ['nullable', 'string', 'max:100'],
            'min_qty' => ['nullable', 'numeric'],
            'lead_time_days' => ['nullable', 'integer', 'min:0', 'max:3650'],
            'valid_from' => ['nullable', 'date'],
            'valid_until' => ['nullable', 'date'],
            'status' => ['nullable', 'string', 'in:DRAFT,ACTIVE'],
            'notes' => ['nullable', 'string', 'max:500'],
            'change_note' => ['nullable', 'string', 'max:500'],
        ]);
    }
}
