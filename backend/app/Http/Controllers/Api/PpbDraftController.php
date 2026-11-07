<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Ppb;
use App\Models\PpbDraft;
use App\Models\PpbDraftLine;
use App\Services\PpbDraftService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Draft PPB (ppb.create): from the Restock button, reviewed and edited, then submitted as a PPB. */
class PpbDraftController extends Controller
{
    public function __construct(private PpbDraftService $service) {}

    public function index(Request $request): JsonResponse
    {
        $query = PpbDraft::query()->withCount('lines')->with(['creator:id,name', 'itemRequest:id,number']);
        $request->whenFilled('status', fn ($v) => $query->where('status', strtoupper((string) $v)));
        $query->orderByRaw("CASE status WHEN 'DRAFT' THEN 0 ELSE 1 END")->orderByDesc('id');
        $page = $query->paginate(min((int) $request->integer('per_page', 20), 100));

        return response()->json([
            'data' => collect($page->items())->map(fn (PpbDraft $d) => $this->present($d)),
            'meta' => ['page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage(),
                'open' => PpbDraft::where('status', 'DRAFT')->count()],
        ]);
    }

    /**
     * GET /ppb-draft-lines — the Draft PPB list: every item still to buy, with where it comes from
     * (a Request Barang and its requester, or Safety Stock / Restock). ?source=REQUEST|RESTOCK, ?search=
     */
    public function lines(Request $request): JsonResponse
    {
        // To do: what is not waiting in a saved draft
        $q = PpbDraftLine::query()->whereNull('ppb_id')->whereNull('saved_draft_id')
            ->whereHas('draft', fn ($d) => $d->where('status', 'DRAFT')->when($request->filled('source'), fn ($x) => $x->where('source', strtoupper((string) $request->input('source')))))
            ->with(['draft:id,number,source,item_request_id,divisi,tgl_diperlukan,peminta,created_at,created_by', 'draft.creator:id,name',
                'draft.itemRequest:id,number,requester_name,divisi,needed_date,urgency', 'item.snapshot:item_id,available,stock_known']);
        if ($s = $request->string('search')->trim()->value()) {
            $q->where(fn ($w) => $w->where('deskripsi_barang', 'like', "%{$s}%")->orWhere('kode_barang', 'like', "%{$s}%")
                ->orWhereHas('draft', fn ($d) => $d->where('number', 'like', "%{$s}%")->orWhere('peminta', 'like', "%{$s}%"))
                ->orWhereHas('draft.itemRequest', fn ($r) => $r->where('number', 'like', "%{$s}%")->orWhere('requester_name', 'like', "%{$s}%")));
        }
        $rows = $q->orderBy('id')->get();
        $sameItem = $rows->whereNotNull('item_id')->countBy('item_id');

        return response()->json(['data' => $rows->map(fn (PpbDraftLine $l) => [
            'id' => $l->id, 'item_id' => $l->item_id, 'kode_barang' => $l->kode_barang, 'deskripsi_barang' => $l->deskripsi_barang,
            'qty' => $l->qty, 'satuan' => $l->satuan, 'catatan' => $l->catatan, 'basis' => $l->basis,
            'available' => $l->item?->snapshot?->stock_known ? (float) $l->item->snapshot->available : null,
            // the same item is in this list more than once (worth one PPB together)
            'same_item_lines' => $l->item_id ? (int) $sameItem[$l->item_id] : 1,
            'source' => [
                'type' => $l->draft->source, 'draft_id' => $l->draft->id, 'draft_number' => $l->draft->number,
                'item_request_id' => $l->draft->item_request_id, 'item_request_number' => $l->draft->itemRequest?->number,
                'requester' => $l->draft->itemRequest?->requester_name ?? $l->draft->peminta, 'urgency' => $l->draft->itemRequest?->urgency,
                'divisi' => $l->draft->itemRequest?->divisi ?? $l->draft->divisi,
                'needed_date' => ($l->draft->itemRequest?->needed_date ?? $l->draft->tgl_diperlukan)?->toDateString(),
                'created_by' => $l->draft->creator?->name,
            ],
            'created_at' => $l->created_at?->copy()->timezone(config('app.timezone'))->toIso8601String(),
        ])->values(), 'meta' => ['total' => $rows->count(), 'by_source' => (object) $rows->countBy(fn ($l) => $l->draft->source)->all()]]);
    }

    /** POST /ppb-draft-lines/submit {line_ids, no_ppb, tgl_ppb, divisi?, tgl_diperlukan?, keterangan?} — the picked lines become ONE PPB. */
    public function submitLines(Request $request): JsonResponse
    {
        $data = $request->validate([
            'line_ids' => ['required', 'array', 'min:1', 'max:200'],
            'line_ids.*' => ['integer'],
            'no_ppb' => ['required', 'string', 'max:60'],
            'tgl_ppb' => ['required', 'date'],
            'divisi' => ['nullable', 'string', 'max:30'],
            'tgl_diperlukan' => ['nullable', 'date'],
            'keterangan' => ['nullable', 'string', 'max:2000'],
        ]);
        $made = $this->service->submitLines($request->user(), array_map('intval', $data['line_ids']), $data);

        return response()->json(['data' => ['no_ppb' => trim($data['no_ppb']), 'ppb_id' => $made[0] ?? null, 'lines' => count($made)]], 201);
    }

    /** PUT /ppb-draft-lines/{line} {qty, catatan} */
    public function updateLine(Request $request, PpbDraftLine $line): JsonResponse
    {
        $data = $request->validate(['qty' => ['sometimes', 'numeric', 'min:0.01'], 'catatan' => ['sometimes', 'nullable', 'string', 'max:255']]);
        $this->service->updateLine($line, $data);

        return response()->json(['data' => ['id' => $line->id, 'qty' => $line->qty, 'catatan' => $line->catatan]]);
    }

    /** DELETE /ppb-draft-lines/{line} — not bought after all. */
    public function removeLine(PpbDraftLine $line): JsonResponse
    {
        $this->service->removeLine($line);

        return response()->json(['data' => ['id' => $line->id, 'removed' => true]]);
    }

    /** GET /ppb-saved-drafts — items picked for a Purchase Request, kept before asking for approval. */
    public function savedIndex(): JsonResponse
    {
        $rows = \App\Models\PpbSavedDraft::with(['creator:id,name', 'openLines.item.snapshot:item_id,available,stock_known'])->whereHas('openLines')->orderByDesc('updated_at')->get();

        return response()->json(['data' => $rows->map(fn ($d) => [
            'id' => $d->id, 'name' => $d->name, 'no_ppb' => $d->no_ppb, 'tgl_ppb' => $d->tgl_ppb?->toDateString(), 'tgl_diperlukan' => $d->tgl_diperlukan?->toDateString(),
            'divisi' => $d->divisi, 'keterangan' => $d->keterangan, 'created_by' => $d->creator?->name, 'updated_at' => $d->updated_at?->copy()->timezone(config('app.timezone'))->toIso8601String(),
            'lines' => $d->openLines->map(fn (PpbDraftLine $l) => ['id' => $l->id, 'kode_barang' => $l->kode_barang, 'deskripsi_barang' => $l->deskripsi_barang, 'qty' => $l->qty, 'satuan' => $l->satuan,
                'available' => $l->item?->snapshot?->stock_known ? (float) $l->item->snapshot->available : null])->values(),
        ])->values()]);
    }

    private function savedHeader(Request $request, array $extra = []): array
    {
        return $request->validate($extra + [
            'name' => ['nullable', 'string', 'max:150'], 'no_ppb' => ['nullable', 'string', 'max:60'], 'tgl_ppb' => ['nullable', 'date'],
            'tgl_diperlukan' => ['nullable', 'date'], 'divisi' => ['nullable', 'string', 'max:30'], 'keterangan' => ['nullable', 'string', 'max:2000'],
        ]);
    }

    /** POST /ppb-saved-drafts {line_ids, name?, no_ppb?, ...} — the items leave To do and wait here. Nobody is asked yet. */
    public function savedStore(Request $request): JsonResponse
    {
        $data = $this->savedHeader($request, ['line_ids' => ['required', 'array', 'min:1', 'max:200'], 'line_ids.*' => ['integer']]);
        $ids = array_values(array_unique(array_map('intval', $data['line_ids'])));
        unset($data['line_ids']);
        $saved = \Illuminate\Support\Facades\DB::transaction(function () use ($data, $ids, $request) {
            $lines = PpbDraftLine::with('draft:id,status')->whereIn('id', $ids)->lockForUpdate()->get();
            if ($lines->count() !== count($ids) || $lines->contains(fn ($l) => $l->ppb_id !== null || $l->saved_draft_id !== null || $l->draft?->status !== 'DRAFT')) {
                throw \Illuminate\Validation\ValidationException::withMessages(['line_ids' => 'Sebagian barang sudah di draft lain, sudah diajukan, atau dibatalkan. Muat ulang daftar.']);
            }
            $saved = \App\Models\PpbSavedDraft::create($data + ['created_by' => $request->user()->id]);
            PpbDraftLine::whereIn('id', $ids)->update(['saved_draft_id' => $saved->id]);

            return $saved;
        });

        return response()->json(['data' => ['id' => $saved->id]], 201);
    }

    public function savedUpdate(Request $request, \App\Models\PpbSavedDraft $saved): JsonResponse
    {
        $saved->update($this->savedHeader($request));

        return response()->json(['data' => ['id' => $saved->id]]);
    }

    /** POST /ppb-saved-drafts/{saved}/submit {no_ppb, tgl_ppb, ...} — one Purchase Request, and the usual approval begins. */
    public function savedSubmit(Request $request, \App\Models\PpbSavedDraft $saved): JsonResponse
    {
        $data = $request->validate([
            'no_ppb' => ['required', 'string', 'max:60'], 'tgl_ppb' => ['required', 'date'], 'divisi' => ['nullable', 'string', 'max:30'],
            'tgl_diperlukan' => ['nullable', 'date'], 'keterangan' => ['nullable', 'string', 'max:2000'],
        ]);
        $ids = $saved->openLines()->pluck('id')->all();
        if ($ids === []) {
            throw \Illuminate\Validation\ValidationException::withMessages(['line_ids' => 'Draft ini sudah tidak punya barang.']);
        }
        $data += ['divisi' => $saved->divisi, 'tgl_diperlukan' => $saved->tgl_diperlukan?->toDateString(), 'keterangan' => $saved->keterangan];
        $made = $this->service->submitLines($request->user(), $ids, $data);
        $saved->delete();

        return response()->json(['data' => ['no_ppb' => trim($data['no_ppb']), 'ppb_id' => $made[0] ?? null, 'lines' => count($made)]], 201);
    }

    /** DELETE /ppb-saved-drafts/{saved} — every item back to To do; nothing is lost. */
    public function savedDestroy(\App\Models\PpbSavedDraft $saved): JsonResponse
    {
        PpbDraftLine::where('saved_draft_id', $saved->id)->update(['saved_draft_id' => null]);
        $saved->delete();

        return response()->json(['data' => ['deleted' => true]]);
    }

    /** DELETE /ppb-saved-drafts/{saved}/lines/{line} — one item back to To do; the last one takes the empty draft with it. */
    public function savedRelease(\App\Models\PpbSavedDraft $saved, PpbDraftLine $line): JsonResponse
    {
        abort_unless($line->saved_draft_id === $saved->id, 404);
        $line->update(['saved_draft_id' => null]);
        if (! $saved->openLines()->exists()) {
            $saved->delete();
        }

        return response()->json(['data' => ['released' => true]]);
    }

    /** POST /ppb-drafts {items: [{item_id, qty?}]} — Restock: a new draft from the picked items. */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'items' => ['required', 'array', 'min:1', 'max:200'],
            'items.*.item_id' => ['required', 'integer', 'exists:items,id'],
            'items.*.qty' => ['nullable', 'numeric', 'min:0'],
        ]);

        $draft = $this->service->restock($request->user(), $data['items']);
        $res = $this->show($draft);

        // what Restock left out (already in a draft / already ordered) — the page tells the user
        return $res->setData($res->getData(true) + ['skipped' => $this->service->skipped])->setStatusCode(201);
    }

    public function show(PpbDraft $ppbDraft): JsonResponse
    {
        $d = $ppbDraft->load(['lines.item.snapshot:item_id,available,stock_known', 'creator:id,name', 'submitter:id,name', 'itemRequest:id,number']);

        return response()->json(['data' => $this->present($d) + [
            'divisi' => $d->divisi, 'tgl_diperlukan' => $d->tgl_diperlukan?->toDateString(), 'peminta' => $d->peminta, 'keterangan' => $d->keterangan,
            'submitted_at' => $d->submitted_at?->copy()->timezone(config('app.timezone'))->toIso8601String(), 'submitted_by_name' => $d->submitter?->name,
            'ppb_id' => $d->no_ppb ? Ppb::where('no_ppb', $d->no_ppb)->orderBy('id')->value('id') : null,
            'lines' => $d->lines->map(fn (PpbDraftLine $l) => [
                'id' => $l->id, 'item_id' => $l->item_id, 'kode_barang' => $l->kode_barang, 'deskripsi_barang' => $l->deskripsi_barang,
                'qty' => $l->qty, 'satuan' => $l->satuan, 'catatan' => $l->catatan, 'basis' => $l->basis, 'ppb_id' => $l->ppb_id,
                'available' => $l->item?->snapshot?->stock_known ? (float) $l->item->snapshot->available : null,
            ]),
        ]]);
    }

    public function update(Request $request, PpbDraft $ppbDraft): JsonResponse
    {
        $data = $request->validate([
            'divisi' => ['nullable', 'string', 'max:30'],
            'tgl_diperlukan' => ['nullable', 'date'],
            'peminta' => ['nullable', 'string', 'max:150'],
            'keterangan' => ['nullable', 'string', 'max:2000'],
            'lines' => ['sometimes', 'array', 'max:200'],
            'lines.*.id' => ['nullable', 'integer'],
            'lines.*.item_id' => ['nullable', 'integer', 'exists:items,id'],
            'lines.*.kode_barang' => ['nullable', 'string', 'max:60'],
            'lines.*.deskripsi_barang' => ['required_without:lines.*.item_id', 'nullable', 'string', 'max:400'],
            'lines.*.qty' => ['required', 'numeric', 'min:0.01'],
            'lines.*.satuan' => ['nullable', 'string', 'max:30'],
            'lines.*.catatan' => ['nullable', 'string', 'max:255'],
        ]);
        $this->service->update($ppbDraft, $data);

        return $this->show($ppbDraft->refresh());
    }

    /** POST /ppb-drafts/{id}/submit {no_ppb, tgl_ppb, …} — becomes a PPB (then PPB approval). */
    public function submit(Request $request, PpbDraft $ppbDraft): JsonResponse
    {
        $data = $request->validate([
            'no_ppb' => ['required', 'string', 'max:60'],
            'tgl_ppb' => ['required', 'date'],
            'divisi' => ['nullable', 'string', 'max:30'],
            'tgl_diperlukan' => ['nullable', 'date'],
            'peminta' => ['nullable', 'string', 'max:150'],
            'keterangan' => ['nullable', 'string', 'max:2000'],
        ]);
        $this->service->submit($ppbDraft, $request->user(), $data);

        return $this->show($ppbDraft->refresh());
    }

    public function destroy(PpbDraft $ppbDraft): JsonResponse
    {
        $this->service->cancel($ppbDraft);

        return $this->show($ppbDraft->refresh());
    }

    private function present(PpbDraft $d): array
    {
        return [
            'id' => $d->id, 'number' => $d->number, 'status' => $d->status, 'source' => $d->source, 'no_ppb' => $d->no_ppb,
            // RESTOCK (Safety Stock) or REQUEST (the PPB lines of a Request Barang)
            'item_request_id' => $d->item_request_id, 'item_request_number' => $d->itemRequest?->number,
            'lines_count' => $d->lines_count ?? $d->lines->count(),
            'created_by_name' => $d->creator?->name,
            'created_at' => $d->created_at?->copy()->timezone(config('app.timezone'))->toIso8601String(),
        ];
    }
}
