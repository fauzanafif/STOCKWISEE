<?php

namespace App\Services;

use App\Models\Item;
use App\Models\Unit;
use App\Models\User;
use App\Models\Vendor;
use App\Models\VendorPrice;
use App\Models\VendorPriceHistory;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Price List: the standing purchase prices, Item × Vendor. A price is kept per purchase unit and
 * minimum quantity; every change goes to an append-only history. It stands apart from Purchase
 * Requests and Purchase Orders: it is read as a reference there and never changes a document.
 */
class PriceListService
{
    /** the fields a change is compared on (the price and status have their own history columns) */
    private const TRACKED = ['unit_id', 'unit_ratio', 'price_type', 'ppn_rate', 'vendor_ref', 'min_qty', 'lead_time_days', 'valid_from', 'valid_until', 'notes'];

    public function __construct(private UomConverter $uom) {}

    /**
     * A new price, or a change of one ($price given). Item from the Master Item, active vendor, a purchase
     * unit of the item by the UOM rules, price above zero, and not a second current price of the same
     * item, vendor, unit and minimum quantity.
     *
     * @param  array{item_id:int, vendor_id:int, unit_id:int, price:mixed, min_qty?:mixed, lead_time_days?:?int, valid_from?:?string, valid_until?:?string, status?:string, notes?:?string, change_note?:?string}  $data
     */
    public function save(User $user, array $data, ?VendorPrice $price = null): VendorPrice
    {
        $item = Item::find($data['item_id']);
        if (! $item) {
            throw ValidationException::withMessages(['item_id' => 'Item tidak ada di Master Item.']);
        }
        $vendor = Vendor::find($data['vendor_id']);
        if (! $vendor || ! $vendor->is_active) {
            throw ValidationException::withMessages(['vendor_id' => 'Vendor tidak ditemukan atau tidak aktif.']);
        }
        if (bccomp(UomConverter::dec($data['price']), '0', 2) <= 0) {
            throw ValidationException::withMessages(['price' => 'Harga harus lebih besar dari nol.']);
        }
        $minQty = UomConverter::dec($data['min_qty'] ?? 1);
        if (bccomp($minQty, '0', 2) <= 0) {
            throw ValidationException::withMessages(['min_qty' => 'Minimum quantity harus lebih besar dari nol.']);
        }
        $from = $data['valid_from'] ?? null;
        $until = $data['valid_until'] ?? null;
        if ($from && $until && $until < $from) {
            throw ValidationException::withMessages(['valid_until' => 'Valid Until tidak boleh sebelum Valid From.']);
        }
        $status = $data['status'] ?? VendorPrice::DRAFT;
        if (! in_array($status, [VendorPrice::DRAFT, VendorPrice::ACTIVE], true)) {
            throw ValidationException::withMessages(['status' => 'Status harus Draft atau Active. Arsipkan lewat tombol Deactivate.']);
        }
        $ratio = $this->unitRatio($item, (int) $data['unit_id']);
        [$type, $ppn] = self::tax($data['price_type'] ?? null, $data['ppn_rate'] ?? null);

        $values = [
            'item_id' => $item->id, 'vendor_id' => $vendor->id, 'unit_id' => (int) $data['unit_id'], 'unit_ratio' => $ratio, 'base_unit_id' => $item->unit_id,
            'price' => UomConverter::roundDec($data['price'], 2), 'min_qty' => UomConverter::roundDec($minQty, 2),
            'price_type' => $type, 'ppn_rate' => $ppn,
            'vendor_ref' => isset($data['vendor_ref']) ? (mb_substr(trim((string) $data['vendor_ref']), 0, 100) ?: null) : null,
            'lead_time_days' => isset($data['lead_time_days']) && $data['lead_time_days'] !== '' ? (int) $data['lead_time_days'] : null,
            'valid_from' => $from ?: null, 'valid_until' => $until ?: null, 'status' => $status,
            'notes' => isset($data['notes']) ? (mb_substr(trim((string) $data['notes']), 0, 500) ?: null) : null,
        ];

        // one current price per item, vendor, unit and minimum quantity (a second tier needs another minimum)
        $dupe = VendorPrice::current()->where('item_id', $item->id)->where('vendor_id', $vendor->id)->where('unit_id', $values['unit_id'])
            ->where('min_qty', $values['min_qty'])->when($price, fn ($q) => $q->whereKeyNot($price->id))->exists();
        if ($dupe) {
            throw ValidationException::withMessages(['price' => "{$vendor->name} sudah punya harga untuk item ini dengan satuan dan minimum quantity yang sama. Edit harga itu, atau isi minimum quantity lain untuk harga bertingkat."]);
        }

        $saved = DB::transaction(function () use ($user, $price, $values, $data) {
            // the PI document a price comes from: set by a draft's Set Harga, kept by an edit of the price
            $draftId = $data['price_list_draft_id'] ?? $price?->price_list_draft_id;
            $values['price_list_draft_id'] = $draftId;
            if (! $price) {
                $price = VendorPrice::create($values + ['created_by' => $user->id, 'updated_by' => $user->id]);
                $this->log($price, $user, 'CREATE', null, $price->price, null, $price->status, null, $data['change_note'] ?? null);

                return $price;
            }
            $price = VendorPrice::whereKey($price->id)->lockForUpdate()->firstOrFail();
            if ($price->item_id !== $values['item_id']) {
                throw ValidationException::withMessages(['item_id' => 'Item sebuah harga tidak bisa diganti. Buat harga baru untuk item lain.']);
            }
            $oldPrice = $price->price;
            $oldStatus = $price->status;
            $fields = [...self::TRACKED, 'vendor_id'];
            $before = collect($fields)->mapWithKeys(fn ($f) => [$f => $this->plain($price->{$f})]);
            $price->fill($values + ['updated_by' => $user->id]);
            $changes = collect($fields)
                ->mapWithKeys(fn ($f) => [$f => [$before[$f], $this->plain($price->{$f})]])
                ->filter(fn ($pair) => $this->same($pair[0], $pair[1]) === false);
            $priceChanged = bccomp(UomConverter::dec($oldPrice), UomConverter::dec($price->price), 2) !== 0;
            if (! $priceChanged && $oldStatus === $price->status && $changes->isEmpty() && ! $price->isDirty('price_list_draft_id')) {
                return $price;
            }
            $price->save();
            $action = $oldStatus === VendorPrice::ARCHIVED ? 'RESTORE' : 'UPDATE';
            $this->log($price, $user, $action, $oldPrice, $price->price, $oldStatus, $price->status, $changes->isEmpty() ? null : $changes->all(), $data['change_note'] ?? null);

            return $price;
        });
        // an Active price reaches the items still being quoted at once (only crossings with no price yet)
        if ($saved->status === VendorPrice::ACTIVE) {
            app(PoDraftService::class)->fillOpenFromPriceList($user, [$saved->item_id]);
        }

        return $saved;
    }

    /**
     * The tax of a price: before PPN (DPP) at 11% or 12%, or nett (no PPN on top); neither given = not recorded.
     *
     * @return array{0:?string, 1:?string}
     */
    public static function tax(?string $type, mixed $rate): array
    {
        if ($type === null || $type === '') {
            return [null, null];
        }
        if (! in_array($type, VendorPrice::PRICE_TYPES, true)) {
            throw ValidationException::withMessages(['price_type' => 'Jenis harga harus Excl. PPN atau Nett.']);
        }
        if ($type === VendorPrice::NETT) {
            return [VendorPrice::NETT, '0.00'];
        }
        $rate = $rate === null || $rate === '' ? 11 : (float) $rate;
        if (! in_array((int) round($rate), VendorPrice::PPN_RATES, true) || abs($rate - round($rate)) > 0.001) {
            throw ValidationException::withMessages(['ppn_rate' => 'PPN harus 11% atau 12%.']);
        }

        return [VendorPrice::EXCL, number_format(round($rate), 2, '.', '')];
    }

    /** How many current prices are complete (the header of Purchase Information). */
    public function completeness(): array
    {
        $total = VendorPrice::current()->count();
        $incomplete = VendorPrice::current()->incomplete()->count();

        return ['total' => $total, 'complete' => $total - $incomplete, 'incomplete' => $incomplete];
    }

    /** Deactivate: the price stays (with its history) but no longer shows as a reference. */
    public function archive(User $user, VendorPrice $price, ?string $note): VendorPrice
    {
        if ($price->status === VendorPrice::ARCHIVED) {
            throw ValidationException::withMessages(['status' => 'Harga ini sudah diarsipkan.']);
        }

        return DB::transaction(function () use ($user, $price, $note) {
            $old = $price->status;
            $price->update(['status' => VendorPrice::ARCHIVED, 'updated_by' => $user->id]);
            $this->log($price, $user, 'ARCHIVE', $price->price, $price->price, $old, VendorPrice::ARCHIVED, null, $note);

            return $price;
        });
    }

    /**
     * The matrix: a page of Master Items (with or without prices) and the vendor columns, each crossing
     * the item's best current price at that vendor (Active first, then Draft, then Expired; the
     * smallest minimum quantity; the lowest price). Only the prices of this page are read.
     *
     * @param  array{search?:?string, category?:?string, vendor_ids?:array<int>, status?:?string, per_page?:int, page?:int}  $f
     */
    public function matrix(array $f): array
    {
        $vendorIds = array_values(array_filter(array_map('intval', $f['vendor_ids'] ?? [])));
        $items = $this->itemQuery($f, $vendorIds)->orderBy('items.code')
            ->select('items.id', 'items.code', 'items.description', 'items.unit_id', 'items.accurate_category_induk')
            ->with('unit:id,code')
            ->paginate(min(100, max(10, (int) ($f['per_page'] ?? 25))), ['*'], 'page', (int) ($f['page'] ?? 1));

        $ids = collect($items->items())->pluck('id');
        $prices = VendorPrice::current()->whereIn('item_id', $ids)->when($vendorIds, fn ($q) => $q->whereIn('vendor_id', $vendorIds))
            ->with(['unit:id,code', 'item:id,unit_id'])->get();

        $vendors = Vendor::query()->whereIn('id', $vendorIds ?: $prices->pluck('vendor_id')->unique()->all())
            ->orderBy('name')->get(['id', 'name', 'code']);

        $rank = [VendorPrice::ACTIVE => 0, VendorPrice::DRAFT => 1, VendorPrice::EXPIRED => 2];
        $rows = collect($items->items())->map(function (Item $item) use ($prices, $rank) {
            $mine = $prices->where('item_id', $item->id);
            $cells = $mine->groupBy('vendor_id')->map(function (Collection $list) use ($rank) {
                $best = $list->sortBy(fn (VendorPrice $p) => [$rank[$p->effectiveStatus()] ?? 9, (float) $p->min_qty, (float) $p->price])->first();

                return $this->cell($best) + ['tiers' => $list->count()];
            });
            // the cheapest valid (Active) price of the row, by the item's own unit
            $active = $mine->filter(fn (VendorPrice $p) => $p->effectiveStatus() === VendorPrice::ACTIVE && ! $p->needsReview());
            $lowest = $active->sortBy(fn (VendorPrice $p) => (float) $p->price / max((float) $p->unit_ratio, 0.000001))->first();

            return [
                'item' => ['id' => $item->id, 'code' => $item->code, 'description' => $item->description, 'unit' => $item->unit?->code, 'category' => $item->accurate_category_induk],
                'cells' => (object) $cells->all(),
                'lowest_price_id' => $lowest?->id,
                'price_count' => $mine->count(),
            ];
        })->values();

        return [
            'vendors' => $vendors,
            'rows' => $rows,
            'meta' => ['current_page' => $items->currentPage(), 'last_page' => $items->lastPage(), 'per_page' => $items->perPage(), 'total' => $items->total()],
            'completeness' => $this->completeness(),
        ];
    }

    /**
     * The list: one row per price.
     *
     * @param  array{search?:?string, category?:?string, vendor_id?:?int, status?:?string, sort?:?string, dir?:?string, per_page?:int, page?:int}  $f
     */
    public function list(array $f): LengthAwarePaginator
    {
        $sorts = ['item_code' => 'items.code', 'item_name' => 'items.description', 'vendor' => 'vendors.name', 'price' => 'vendor_prices.price',
            'min_qty' => 'vendor_prices.min_qty', 'lead_time_days' => 'vendor_prices.lead_time_days', 'valid_until' => 'vendor_prices.valid_until',
            'updated_at' => 'vendor_prices.updated_at', 'status' => 'vendor_prices.status'];
        $sort = $sorts[$f['sort'] ?? ''] ?? 'vendor_prices.updated_at';
        $dir = strtolower((string) ($f['dir'] ?? '')) === 'asc' ? 'asc' : 'desc';
        $status = strtoupper((string) ($f['status'] ?? ''));

        return VendorPrice::query()
            ->join('items', 'items.id', '=', 'vendor_prices.item_id')
            ->join('vendors', 'vendors.id', '=', 'vendor_prices.vendor_id')
            ->select('vendor_prices.*')
            ->with(['item:id,code,description,unit_id', 'vendor:id,name', 'unit:id,code', 'updater:id,name', 'draft:id,number'])
            ->when($f['search'] ?? null, function ($q, $s) {
                $like = '%'.trim($s).'%';
                $q->where(fn ($w) => $w->where('items.code', 'like', $like)->orWhere('items.description', 'like', $like)->orWhere('vendors.name', 'like', $like));
            })
            ->when($f['category'] ?? null, fn ($q, $c) => $q->where('items.accurate_category_induk', $c))
            ->when($f['vendor_id'] ?? null, fn ($q, $v) => $q->where('vendor_prices.vendor_id', (int) $v))
            ->when(! empty($f['incomplete']), fn ($q) => $q->incomplete())
            ->when(in_array($status, [VendorPrice::DRAFT, VendorPrice::ACTIVE, VendorPrice::EXPIRED, VendorPrice::ARCHIVED], true),
                fn ($q) => $q->effective($status), fn ($q) => $q->current())
            ->orderBy($sort, $dir)->orderBy('vendor_prices.id', 'desc')
            ->paginate(min(100, max(10, (int) ($f['per_page'] ?? 25))), ['*'], 'page', (int) ($f['page'] ?? 1));
    }

    /**
     * For a Purchase Request: the current prices of these items, each with its effective status. A
     * reference to check with the vendor, not a price taken as valid.
     *
     * @param  array<int>  $itemIds
     * @return array<int, list<array<string, mixed>>>
     */
    public function reference(array $itemIds): array
    {
        return VendorPrice::current()->whereIn('item_id', array_slice(array_map('intval', $itemIds), 0, 500))
            ->with(['vendor:id,name', 'unit:id,code', 'item:id,unit_id'])->orderBy('price')->get()
            ->groupBy('item_id')->map(fn (Collection $list) => $list->map(fn (VendorPrice $p) => $this->cell($p) + ['vendor_id' => $p->vendor_id, 'vendor' => $p->vendor?->name])->values()->all())
            ->all();
    }

    /** A price as the screens read it. */
    public function row(VendorPrice $p): array
    {
        $p->loadMissing(['item:id,code,description,unit_id', 'item.unit:id,code', 'vendor:id,name', 'unit:id,code', 'updater:id,name', 'draft:id,number']);

        return $this->cell($p) + [
            'item_id' => $p->item_id, 'item_code' => $p->item?->code, 'item_name' => $p->item?->description, 'base_unit' => $p->item?->unit?->code,
            'vendor_id' => $p->vendor_id, 'vendor' => $p->vendor?->name, 'unit_id' => $p->unit_id, 'unit_ratio' => (float) $p->unit_ratio,
            'valid_from' => $p->valid_from?->toDateString(), 'stored_status' => $p->status, 'notes' => $p->notes,
            'updated_at' => $p->updated_at?->toIso8601String(), 'updated_by' => $p->updater?->name,
            'vendor_ref' => $p->vendor_ref,
            // the PI document the price came from (Draft Purchase Information)
            'pi' => $p->price_list_draft_id ? ['id' => $p->price_list_draft_id, 'number' => $p->draft?->number] : null,
        ];
    }

    /** The units an item can be bought in (its own, the ones set for it, the fixed ones of its category). */
    public function units(Item $item): array
    {
        return $this->uom->orderUnits($item);
    }

    private function cell(VendorPrice $p): array
    {
        return [
            'id' => $p->id, 'price' => (float) $p->price, 'unit' => $p->unit?->code, 'min_qty' => (float) $p->min_qty,
            'lead_time_days' => $p->lead_time_days, 'valid_until' => $p->valid_until?->toDateString(), 'status' => $p->effectiveStatus(),
            'price_type' => $p->price_type, 'ppn_rate' => $p->ppn_rate === null ? null : (float) $p->ppn_rate, 'final_price' => $p->finalPrice(),
            'missing' => $p->missing(),
            // the item's base unit changed since the price was kept: its unit ratio needs a look
            'needs_review' => $p->needsReview(),
        ];
    }

    /** The Master Items of the matrix, with the filters; the status filter reads the prices (at the chosen vendors). */
    private function itemQuery(array $f, array $vendorIds): Builder
    {
        $priced = fn (?string $status) => function ($q) use ($status, $vendorIds) {
            $q->selectRaw('1')->from('vendor_prices')->whereColumn('vendor_prices.item_id', 'items.id')
                ->when($vendorIds, fn ($w) => $w->whereIn('vendor_prices.vendor_id', $vendorIds));
            $today = today()->toDateString();
            match ($status) {
                VendorPrice::EXPIRED => $q->where('vendor_prices.status', VendorPrice::ACTIVE)->whereNotNull('vendor_prices.valid_until')->where('vendor_prices.valid_until', '<', $today),
                VendorPrice::ACTIVE => $q->where('vendor_prices.status', VendorPrice::ACTIVE)->where(fn ($w) => $w->whereNull('vendor_prices.valid_until')->orWhere('vendor_prices.valid_until', '>=', $today)),
                VendorPrice::DRAFT => $q->where('vendor_prices.status', VendorPrice::DRAFT),
                // the same rule as VendorPrice::missing(): PPN not recorded, or no PI document nor vendor quotation no.
                'INCOMPLETE' => $q->where('vendor_prices.status', '!=', VendorPrice::ARCHIVED)->where(fn ($w) => $w->whereNull('vendor_prices.price_type')
                    ->orWhere(fn ($s) => $s->whereNull('vendor_prices.price_list_draft_id')->where(fn ($r) => $r->whereNull('vendor_prices.vendor_ref')->orWhere('vendor_prices.vendor_ref', '')))),
                default => $q->where('vendor_prices.status', '!=', VendorPrice::ARCHIVED),
            };
        };
        $status = strtoupper((string) ($f['status'] ?? ''));

        return Item::query()->where('items.is_active', true)
            ->when($f['search'] ?? null, function ($q, $s) {
                $like = '%'.trim($s).'%';
                $q->where(fn ($w) => $w->where('items.code', 'like', $like)->orWhere('items.description', 'like', $like));
            })
            ->when($f['category'] ?? null, fn ($q, $c) => $q->where('items.accurate_category_induk', $c))
            ->when($status === 'NONE', fn ($q) => $q->whereNotExists($priced(null)))
            ->when($status === 'PRICED', fn ($q) => $q->whereExists($priced(null)))
            ->when(in_array($status, [VendorPrice::ACTIVE, VendorPrice::EXPIRED, VendorPrice::DRAFT, 'INCOMPLETE'], true), fn ($q) => $q->whereExists($priced($status)))
            // the vendors chosen without a status: the items priced at them
            ->when($vendorIds && $status === '', fn ($q) => $q->whereExists($priced(null)));
    }

    /** The ratio of this purchase unit to the item's own unit, by the UOM rules; a unit outside them is refused. */
    private function unitRatio(Item $item, int $unitId): string
    {
        if (! $item->unit_id) {
            throw ValidationException::withMessages(['unit_id' => 'Item ini belum punya satuan dasar. Atur satuannya di menu UOM dulu.']);
        }
        $unit = collect($this->uom->orderUnits($item))->firstWhere('unit_id', $unitId);
        if (! $unit) {
            $code = Unit::whereKey($unitId)->value('code') ?? 'Satuan ini';
            throw ValidationException::withMessages(['unit_id' => "{$code} bukan satuan beli item ini. Pilih satuan yang ada, atau tambahkan konversinya di menu UOM."]);
        }

        return UomConverter::roundDec($unit['ratio'], 6);
    }

    private function log(VendorPrice $p, User $user, string $action, mixed $oldPrice, mixed $newPrice, ?string $oldStatus, ?string $newStatus, ?array $changes, ?string $note): void
    {
        VendorPriceHistory::create([
            'vendor_price_id' => $p->id, 'item_id' => $p->item_id, 'vendor_id' => $p->vendor_id, 'action' => $action,
            'old_price' => $oldPrice, 'new_price' => $newPrice, 'old_status' => $oldStatus, 'new_status' => $newStatus,
            'changes' => $changes, 'note' => $note ? mb_substr(trim($note), 0, 500) : null,
            'user_id' => $user->id, 'user_name' => $user->name,
        ]);
    }

    private function plain(mixed $v): mixed
    {
        return $v instanceof \DateTimeInterface ? $v->format('Y-m-d') : $v;
    }

    /** "2.00" and 2, null and null: the same value (numbers compared as numbers) */
    private function same(mixed $a, mixed $b): bool
    {
        if ($a === null || $b === null) {
            return $a === $b;
        }

        return is_numeric($a) && is_numeric($b) ? bccomp(UomConverter::dec($a), UomConverter::dec($b), 6) === 0 : (string) $a === (string) $b;
    }
}
