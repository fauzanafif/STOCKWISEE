<?php

namespace App\Services;

use App\Models\Item;
use App\Models\PriceListDraft;
use App\Models\User;
use App\Models\Vendor;
use App\Models\VendorPrice;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Draft Price List: pick items and vendors into one draft, fill the Item × Vendor matrix (a price per
 * cell, in the item's own unit), then "Set Harga" puts every filled cell into the Master Price List
 * through PriceListService (validation and history as for any price). An item belongs to one draft only:
 * a later draft does not offer it again.
 */
class PriceListDraftService
{
    public function __construct(private PriceListService $prices, private DocumentNumberService $numbers) {}

    /** Master Items a new draft may take: active, with a unit, in no draft yet. */
    public function availableItems(?string $search, int $limit = 30): array
    {
        return Item::query()->where('is_active', true)->whereNotNull('unit_id')
            ->whereNotIn('id', DB::table('price_list_draft_items')->select('item_id'))
            ->when($search, function ($q, $s) {
                $like = '%'.trim($s).'%';
                $q->where(fn ($w) => $w->where('code', 'like', $like)->orWhere('description', 'like', $like));
            })
            ->with('unit:id,code')->orderBy('code')->limit(min(100, max(1, $limit)))
            ->get(['id', 'code', 'description', 'unit_id'])
            ->map(fn (Item $i) => ['id' => $i->id, 'code' => $i->code, 'description' => $i->description, 'unit' => $i->unit?->code])->all();
    }

    public function list(array $f): LengthAwarePaginator
    {
        $status = strtoupper((string) ($f['status'] ?? ''));

        $count = fn (string $table) => DB::table($table)->selectRaw('count(*)')->whereColumn("{$table}.price_list_draft_id", 'price_list_drafts.id');

        return PriceListDraft::query()->with('creator:id,name', 'finisher:id,name')
            ->select('price_list_drafts.*')
            ->selectSub($count('price_list_draft_items'), 'items_count')
            ->selectSub($count('price_list_draft_vendors'), 'vendors_count')
            ->selectSub($count('price_list_draft_cells'), 'cells_count')
            ->when(in_array($status, [PriceListDraft::DRAFT, PriceListDraft::DONE], true), fn ($q) => $q->where('status', $status))
            ->when($f['search'] ?? null, fn ($q, $s) => $q->where(fn ($w) => $w->where('number', 'like', "%{$s}%")->orWhere('note', 'like', "%{$s}%")))
            ->orderByDesc('id')
            ->paginate(min(100, max(10, (int) ($f['per_page'] ?? 25))), ['*'], 'page', (int) ($f['page'] ?? 1));
    }

    /**
     * @param  list<int>  $itemIds
     * @param  list<int>  $vendorIds
     */
    public function create(User $user, array $itemIds, array $vendorIds, ?string $note): PriceListDraft
    {
        if ($itemIds === []) {
            throw ValidationException::withMessages(['item_ids' => 'Pilih minimal satu item.']);
        }
        if ($vendorIds === []) {
            throw ValidationException::withMessages(['vendor_ids' => 'Pilih minimal satu vendor.']);
        }

        return DB::transaction(function () use ($user, $itemIds, $vendorIds, $note) {
            $draft = PriceListDraft::create([
                'number' => $this->numbers->nextShort('PL'), 'note' => $this->note($note), 'status' => PriceListDraft::DRAFT, 'created_by' => $user->id,
            ]);
            $this->addItems($draft, $itemIds);
            $this->addVendors($draft, $vendorIds);

            return $draft;
        });
    }

    /** @param  list<int>  $itemIds */
    public function addItems(PriceListDraft $draft, array $itemIds): void
    {
        $this->open($draft);
        $ids = array_values(array_unique(array_map('intval', $itemIds)));
        $items = Item::whereIn('id', $ids)->get(['id', 'code', 'description', 'unit_id', 'is_active'])->keyBy('id');
        foreach ($ids as $id) {
            $item = $items->get($id);
            if (! $item || ! $item->is_active) {
                throw ValidationException::withMessages(['item_ids' => 'Item tidak ditemukan atau tidak aktif di Master Item.']);
            }
            if (! $item->unit_id) {
                throw ValidationException::withMessages(['item_ids' => "{$item->code} belum punya satuan di Master Item: lengkapi satuannya dulu."]);
            }
        }
        $taken = DB::table('price_list_draft_items')->join('price_list_drafts', 'price_list_drafts.id', '=', 'price_list_draft_items.price_list_draft_id')
            ->whereIn('item_id', $ids)->where('price_list_draft_id', '!=', $draft->id)->get(['item_id', 'number']);
        if ($taken->isNotEmpty()) {
            $first = $taken->first();
            throw ValidationException::withMessages(['item_ids' => "{$items->get($first->item_id)?->code} sudah ada di {$first->number}."]);
        }
        $have = DB::table('price_list_draft_items')->where('price_list_draft_id', $draft->id)->pluck('item_id')->all();
        $now = now();
        DB::table('price_list_draft_items')->insert(array_map(fn ($id) => ['price_list_draft_id' => $draft->id, 'item_id' => $id, 'created_at' => $now], array_values(array_diff($ids, $have))));
        $draft->touch();
    }

    /** @param  list<int>  $vendorIds */
    public function addVendors(PriceListDraft $draft, array $vendorIds): void
    {
        $this->open($draft);
        $ids = array_values(array_unique(array_map('intval', $vendorIds)));
        if (Vendor::whereIn('id', $ids)->where('is_active', true)->count() !== count($ids)) {
            throw ValidationException::withMessages(['vendor_ids' => 'Vendor tidak ditemukan atau tidak aktif.']);
        }
        $have = DB::table('price_list_draft_vendors')->where('price_list_draft_id', $draft->id)->pluck('vendor_id')->all();
        $now = now();
        DB::table('price_list_draft_vendors')->insert(array_map(fn ($id) => ['price_list_draft_id' => $draft->id, 'vendor_id' => $id, 'created_at' => $now], array_values(array_diff($ids, $have))));
        $draft->touch();
    }

    /** Take an item out of the draft (its prices typed here go with it): another draft may take it then. */
    public function removeItem(PriceListDraft $draft, int $itemId): void
    {
        $this->open($draft);
        DB::transaction(function () use ($draft, $itemId) {
            DB::table('price_list_draft_cells')->where(['price_list_draft_id' => $draft->id, 'item_id' => $itemId])->delete();
            DB::table('price_list_draft_items')->where(['price_list_draft_id' => $draft->id, 'item_id' => $itemId])->delete();
        });
        $draft->touch();
    }

    public function removeVendor(PriceListDraft $draft, int $vendorId): void
    {
        $this->open($draft);
        DB::transaction(function () use ($draft, $vendorId) {
            DB::table('price_list_draft_cells')->where(['price_list_draft_id' => $draft->id, 'vendor_id' => $vendorId])->delete();
            DB::table('price_list_draft_vendors')->where(['price_list_draft_id' => $draft->id, 'vendor_id' => $vendorId])->delete();
        });
        $draft->touch();
    }

    /** One cell of the matrix: a price above zero, or empty (null) to clear it. */
    public function setCell(User $user, PriceListDraft $draft, int $itemId, int $vendorId, mixed $price): void
    {
        $this->open($draft);
        $inDraft = fn (string $table, string $col, int $id) => DB::table($table)->where(['price_list_draft_id' => $draft->id, $col => $id])->exists();
        if (! $inDraft('price_list_draft_items', 'item_id', $itemId) || ! $inDraft('price_list_draft_vendors', 'vendor_id', $vendorId)) {
            throw ValidationException::withMessages(['price' => 'Item atau vendor ini tidak ada di draft.']);
        }
        $key = ['price_list_draft_id' => $draft->id, 'item_id' => $itemId, 'vendor_id' => $vendorId];
        if ($price === null || $price === '') {
            DB::table('price_list_draft_cells')->where($key)->delete();
        } else {
            if (! is_numeric($price) || bccomp(UomConverter::dec($price), '0', 2) <= 0) {
                throw ValidationException::withMessages(['price' => 'Harga harus lebih besar dari nol.']);
            }
            DB::table('price_list_draft_cells')->updateOrInsert($key, ['price' => UomConverter::roundDec($price, 2), 'updated_by' => $user->id, 'updated_at' => now(), 'created_at' => now()]);
        }
        $draft->touch();
    }

    /**
     * "Set Harga": every filled cell becomes an Active price of the Master Price List, in the item's own
     * unit (a price already there for that item, vendor and unit is updated, its history kept). The draft
     * is then Done and read only; its items stay out of new drafts.
     */
    public function finish(User $user, PriceListDraft $draft): PriceListDraft
    {
        $this->open($draft);
        $cells = DB::table('price_list_draft_cells')->where('price_list_draft_id', $draft->id)->get();
        if ($cells->isEmpty()) {
            throw ValidationException::withMessages(['price' => 'Isi minimal satu harga di matrix sebelum Set Harga.']);
        }
        $items = Item::whereIn('id', $cells->pluck('item_id')->unique())->get(['id', 'unit_id'])->keyBy('id');

        return DB::transaction(function () use ($user, $draft, $cells, $items) {
            $draft = PriceListDraft::whereKey($draft->id)->lockForUpdate()->firstOrFail();
            $this->open($draft);
            foreach ($cells as $c) {
                $unitId = (int) $items->get($c->item_id)?->unit_id;
                $data = ['item_id' => $c->item_id, 'vendor_id' => $c->vendor_id, 'unit_id' => $unitId, 'price' => $c->price, 'min_qty' => 1,
                    'status' => VendorPrice::ACTIVE, 'change_note' => "Dari Draft Price List {$draft->number}"];
                $existing = VendorPrice::current()->where(['item_id' => $c->item_id, 'vendor_id' => $c->vendor_id, 'unit_id' => $unitId])->where('min_qty', 1)->first();
                $this->prices->save($user, $data + ($existing ? [
                    // keep what the Master price had besides its price
                    'lead_time_days' => $existing->lead_time_days, 'valid_from' => $existing->valid_from?->toDateString(),
                    'valid_until' => $existing->valid_until?->toDateString(), 'notes' => $existing->notes,
                ] : []), $existing);
            }
            $draft->update(['status' => PriceListDraft::DONE, 'done_by' => $user->id, 'done_at' => now()]);

            return $draft;
        });
    }

    /** Delete a draft not yet set: its items are free for another draft. */
    public function delete(PriceListDraft $draft): void
    {
        $this->open($draft);
        $draft->delete();
    }

    /** The draft as the matrix reads it. */
    public function show(PriceListDraft $draft): array
    {
        $draft->loadMissing('creator:id,name', 'finisher:id,name');
        $items = DB::table('price_list_draft_items')->join('items', 'items.id', '=', 'price_list_draft_items.item_id')
            ->leftJoin('units', 'units.id', '=', 'items.unit_id')
            ->where('price_list_draft_id', $draft->id)->orderBy('price_list_draft_items.id')
            ->get(['items.id', 'items.code', 'items.description', 'units.code as unit']);
        $vendors = DB::table('price_list_draft_vendors')->join('vendors', 'vendors.id', '=', 'price_list_draft_vendors.vendor_id')
            ->where('price_list_draft_id', $draft->id)->orderBy('price_list_draft_vendors.id')
            ->get(['vendors.id', 'vendors.name', 'vendors.code']);
        $cells = DB::table('price_list_draft_cells')->where('price_list_draft_id', $draft->id)->get(['item_id', 'vendor_id', 'price'])
            ->mapWithKeys(fn ($c) => ["{$c->item_id}:{$c->vendor_id}" => (float) $c->price]);

        return $this->summary($draft) + ['items' => $items, 'vendors' => $vendors, 'cells' => (object) $cells->all()];
    }

    public function summary(PriceListDraft $draft): array
    {
        return [
            'id' => $draft->id, 'number' => $draft->number, 'note' => $draft->note, 'status' => $draft->status,
            'created_by' => $draft->creator?->name, 'created_at' => $draft->created_at?->toIso8601String(),
            'updated_at' => $draft->updated_at?->toIso8601String(),
            'done_by' => $draft->finisher?->name, 'done_at' => $draft->done_at?->toIso8601String(),
            'items_count' => $draft->items_count ?? null, 'vendors_count' => $draft->vendors_count ?? null, 'cells_count' => $draft->cells_count ?? null,
        ];
    }

    private function open(PriceListDraft $draft): void
    {
        if (! $draft->isOpen()) {
            throw ValidationException::withMessages(['status' => "{$draft->number} sudah Set Harga: ubah harganya di Master Price List."]);
        }
    }

    private function note(?string $note): ?string
    {
        return $note === null ? null : (mb_substr(trim($note), 0, 500) ?: null);
    }
}
