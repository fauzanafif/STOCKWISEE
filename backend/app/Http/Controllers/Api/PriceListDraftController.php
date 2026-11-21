<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PriceListDraft;
use App\Services\PriceListDraftService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;

/**
 * Draft Price List (see PriceListDraftService). Reading needs rfq.view; making and filling a draft and
 * "Set Harga" rfq.create. Until its migration has run, every call says so instead of failing.
 */
class PriceListDraftController extends Controller
{
    public function __construct(private PriceListDraftService $service) {}

    /** the production server runs this code before its migration is approved: say so instead of failing */
    private function ready(): void
    {
        if (! Schema::hasTable('price_list_drafts')) {
            abort(response()->json(['message' => 'Draft Price List belum aktif: migration belum dijalankan.'], 503));
        }
    }

    private function draft(int $id): PriceListDraft
    {
        $this->ready();

        return PriceListDraft::findOrFail($id);
    }

    /** GET /price-list/drafts?status=&search=&page= */
    public function index(Request $request): JsonResponse
    {
        $f = $request->validate([
            'status' => ['nullable', 'string', 'max:10'], 'search' => ['nullable', 'string', 'max:100'],
            'page' => ['nullable', 'integer', 'min:1'], 'per_page' => ['nullable', 'integer', 'min:10', 'max:100'],
        ]);
        $this->ready();
        $page = $this->service->list($f);

        return response()->json([
            'data' => collect($page->items())->map(fn (PriceListDraft $d) => $this->service->summary($d))->values(),
            'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'per_page' => $page->perPage(), 'total' => $page->total()],
        ]);
    }

    /** GET /price-list/drafts/available-items?search= — items in no draft yet */
    public function availableItems(Request $request): JsonResponse
    {
        $f = $request->validate(['search' => ['nullable', 'string', 'max:100'], 'limit' => ['nullable', 'integer', 'min:1', 'max:100']]);
        $this->ready();

        return response()->json(['data' => $this->service->availableItems($f['search'] ?? null, (int) ($f['limit'] ?? 30))]);
    }

    public function show(int $id): JsonResponse
    {
        return response()->json(['data' => $this->service->show($this->draft($id))]);
    }

    /** POST /price-list/drafts {item_ids[], vendor_ids[], note?} */
    public function store(Request $request): JsonResponse
    {
        $f = $request->validate([
            'item_ids' => ['required', 'array', 'min:1', 'max:500'], 'item_ids.*' => ['integer'],
            'vendor_ids' => ['required', 'array', 'min:1', 'max:30'], 'vendor_ids.*' => ['integer'],
            'note' => ['nullable', 'string', 'max:500'],
        ]);
        $this->ready();
        $draft = $this->service->create($request->user(), $f['item_ids'], $f['vendor_ids'], $f['note'] ?? null);

        return response()->json(['data' => $this->service->show($draft)], 201);
    }

    /** POST /price-list/drafts/{draft}/items {item_ids[]} */
    public function addItems(Request $request, int $id): JsonResponse
    {
        $draft = $this->draft($id);
        $f = $request->validate(['item_ids' => ['required', 'array', 'min:1', 'max:500'], 'item_ids.*' => ['integer']]);
        $this->service->addItems($draft, $f['item_ids']);

        return response()->json(['data' => $this->service->show($draft->refresh())]);
    }

    /** POST /price-list/drafts/{draft}/vendors {vendor_ids[]} */
    public function addVendors(Request $request, int $id): JsonResponse
    {
        $draft = $this->draft($id);
        $f = $request->validate(['vendor_ids' => ['required', 'array', 'min:1', 'max:30'], 'vendor_ids.*' => ['integer']]);
        $this->service->addVendors($draft, $f['vendor_ids']);

        return response()->json(['data' => $this->service->show($draft->refresh())]);
    }

    public function removeItem(int $id, int $item): JsonResponse
    {
        $draft = $this->draft($id);
        $this->service->removeItem($draft, $item);

        return response()->json(['data' => $this->service->show($draft->refresh())]);
    }

    public function removeVendor(int $id, int $vendor): JsonResponse
    {
        $draft = $this->draft($id);
        $this->service->removeVendor($draft, $vendor);

        return response()->json(['data' => $this->service->show($draft->refresh())]);
    }

    /** PUT /price-list/drafts/{draft}/cells {item_id, vendor_id, price|null} */
    public function setCell(Request $request, int $id): JsonResponse
    {
        $draft = $this->draft($id);
        $f = $request->validate(['item_id' => ['required', 'integer'], 'vendor_id' => ['required', 'integer'], 'price' => ['nullable', 'numeric', 'max:9999999999999999']]);
        $this->service->setCell($request->user(), $draft, (int) $f['item_id'], (int) $f['vendor_id'], $f['price'] ?? null);

        return response()->json(['data' => ['ok' => true]]);
    }

    /** PUT /price-list/drafts/{draft}/vendors/{vendor} {price_type, ppn_rate?, vendor_ref?} — the vendor column's quotation terms */
    public function setVendorTerms(Request $request, int $id, int $vendor): JsonResponse
    {
        $draft = $this->draft($id);
        $f = $request->validate([
            'price_type' => ['required', 'string', 'in:EXCL,NETT'],
            'ppn_rate' => ['nullable', 'numeric', 'in:11,12'],
            'vendor_ref' => ['nullable', 'string', 'max:100'],
        ]);
        $this->service->setVendorTerms($draft, $vendor, $f['price_type'], $f['ppn_rate'] ?? null, $f['vendor_ref'] ?? null);

        return response()->json(['data' => $this->service->show($draft->refresh())]);
    }

    /** POST /price-list/drafts/{draft}/finish — "Set Harga" */
    public function finish(Request $request, int $id): JsonResponse
    {
        $draft = $this->draft($id);
        $note = $request->validate(['note' => ['nullable', 'string', 'max:500']])['note'] ?? null;
        $draft = $this->service->finish($request->user(), $draft, $note);

        return response()->json(['data' => $this->service->show($draft)]);
    }

    public function destroy(int $id): JsonResponse
    {
        $draft = $this->draft($id);
        $this->service->delete($draft);

        return response()->json(['data' => ['ok' => true]]);
    }
}
