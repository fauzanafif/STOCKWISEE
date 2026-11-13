<?php

namespace App\Http\Controllers\Api\Mrp;

use App\Http\Controllers\Controller;
use App\Models\MrpActivity;
use App\Models\MrpBom;
use App\Models\MrpProduction;
use App\Services\Mrp\BomService;
use App\Services\Mrp\MrpQty;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** Bills of Materials (mrp.view / mrp.bom.manage) — see BomService. */
class BomController extends Controller
{
    public function __construct(private readonly BomService $service) {}

    public function index(Request $request): JsonResponse
    {
        $q = MrpBom::query()->with('item:id,code,description')->withCount('lines');
        $request->whenFilled('status', fn ($v) => $q->where('status', strtoupper((string) $v)));
        $request->whenFilled('item_id', fn ($v) => $q->where('item_id', (int) $v));
        if ($s = $request->string('search')->trim()->value()) {
            $q->where(fn ($w) => $w->where('code', 'like', "%{$s}%")->orWhere('name', 'like', "%{$s}%")
                ->orWhereHas('item', fn ($i) => $i->where('code', 'like', "%{$s}%")->orWhere('description', 'like', "%{$s}%")));
        }
        $q->orderByRaw("CASE status WHEN 'ACTIVE' THEN 0 WHEN 'DRAFT' THEN 1 ELSE 2 END")->orderByDesc('id');
        $page = $q->paginate(min((int) $request->integer('per_page', 20), 100));

        return response()->json([
            'data' => collect($page->items())->map(fn (MrpBom $b) => $this->summary($b)),
            'meta' => ['page' => $page->currentPage(), 'per_page' => $page->perPage(), 'total' => $page->total(), 'last_page' => $page->lastPage()],
        ]);
    }

    public function show(MrpBom $bom): JsonResponse
    {
        $bom->load(['item:id,code,description,unit_id', 'lines.item:id,code,description,is_active,product_kind', 'creator:id,name', 'activator:id,name']);
        $revisions = MrpBom::where('item_id', $bom->item_id)->orderByDesc('revision')->get(['id', 'code', 'revision', 'status', 'activated_at', 'archived_at']);
        $iso = fn ($t) => $t?->copy()->timezone(config('app.timezone'))->toIso8601String();

        return response()->json(['data' => $this->summary($bom) + [
            'notes' => $bom->notes,
            'created_by_name' => $bom->creator?->name, 'created_at' => $iso($bom->created_at),
            'activated_by_name' => $bom->activator?->name, 'activated_at' => $iso($bom->activated_at), 'archived_at' => $iso($bom->archived_at),
            'lines' => $bom->lines->map(fn ($l) => [
                'id' => $l->id, 'item_id' => $l->item_id, 'code' => $l->item?->code, 'description' => $l->item?->description,
                'qty' => MrpQty::num($l->qty), 'qty_text' => MrpQty::show($l->qty), 'base_unit' => $l->base_unit, 'note' => $l->note,
                'item_active' => (bool) $l->item?->is_active,
            ]),
            'revisions' => $revisions->map(fn ($r) => ['id' => $r->id, 'code' => $r->code, 'revision' => $r->revision, 'status' => $r->status,
                'activated_at' => $iso($r->activated_at), 'archived_at' => $iso($r->archived_at)]),
            'used_by' => MrpProduction::where('mrp_bom_id', $bom->id)->count(),
            'activity' => $this->activity('BOM', $bom->id),
        ]]);
    }

    public function store(Request $request): JsonResponse
    {
        $bom = $this->service->create($request->user(), $this->input($request, true));

        return $this->show($bom)->setStatusCode(201);
    }

    public function update(Request $request, MrpBom $bom): JsonResponse
    {
        return $this->show($this->service->update($bom, $request->user(), $this->input($request, false)));
    }

    public function activate(Request $request, MrpBom $bom): JsonResponse
    {
        return $this->show($this->service->activate($bom, $request->user()));
    }

    public function archive(Request $request, MrpBom $bom): JsonResponse
    {
        return $this->show($this->service->archive($bom, $request->user()));
    }

    public function revise(Request $request, MrpBom $bom): JsonResponse
    {
        return $this->show($this->service->revise($bom, $request->user()))->setStatusCode(201);
    }

    public function destroy(Request $request, MrpBom $bom): JsonResponse
    {
        $this->service->delete($bom, $request->user());

        return response()->json(['message' => 'BoM dihapus.']);
    }

    private function input(Request $request, bool $create): array
    {
        return $request->validate([
            'item_id' => [$create ? 'required' : 'prohibited', 'integer'],
            'name' => ['nullable', 'string', 'max:200'],
            'effective_date' => ['nullable', 'date'],
            'notes' => ['nullable', 'string', 'max:2000'],
            'lines' => [$create ? 'required' : 'sometimes', 'array', 'min:1', 'max:'.BomService::MAX_LINES],
            'lines.*.item_id' => ['required', 'integer'],
            'lines.*.qty' => ['required'],
            'lines.*.note' => ['nullable', 'string', 'max:255'],
        ]);
    }

    private function summary(MrpBom $b): array
    {
        return [
            'id' => $b->id, 'code' => $b->code, 'revision' => $b->revision, 'name' => $b->name, 'status' => $b->status,
            'item_id' => $b->item_id, 'product_code' => $b->item?->code, 'product_name' => $b->item?->description,
            'base_unit' => $b->base_unit, 'effective_date' => $b->effective_date?->toDateString(),
            'lines_count' => $b->lines_count ?? $b->lines()->count(),
        ];
    }

    public static function activityRows(string $type, int $id): array
    {
        return MrpActivity::with('user:id,name')->where(['subject_type' => $type, 'subject_id' => $id])->orderBy('id')->get()
            ->map(fn (MrpActivity $a) => ['id' => $a->id, 'action' => $a->action, 'from_status' => $a->from_status, 'to_status' => $a->to_status,
                'note' => $a->note, 'user_name' => $a->user?->name, 'at' => $a->created_at?->copy()->timezone(config('app.timezone'))->toIso8601String()])->all();
    }

    private function activity(string $type, int $id): array
    {
        return self::activityRows($type, $id);
    }
}
