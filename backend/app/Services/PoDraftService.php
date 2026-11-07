<?php

namespace App\Services;

use App\Models\PurchaseOrder;
use App\Models\PurchaseOrderItem;
use App\Models\PurchaseOrderQuote;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * The PO flow of an item of a STOCKWISE PPB the Direktur approved (its "Menunggu PO" line):
 *   PPB Siap PO (quote_stage null) → purchasing puts it in the Penawaran Harga (PENAWARAN), notes each
 *   vendor's price / availability / ETA → submits it to the Direktur (MENUNGGU_DIREKTUR) → the Direktur
 *   picks one vendor, tagged (DIPILIH; or returns it to PENAWARAN) → in the Draft PO purchasing picks
 *   items of one chosen vendor: ONE PO (one PO = one vendor), submitted to the Direktur.
 */
class PoDraftService
{
    public const STAGES = ['SIAP' => null, 'PENAWARAN' => 'PENAWARAN', 'MENUNGGU_DIREKTUR' => 'MENUNGGU_DIREKTUR', 'DIPILIH' => 'DIPILIH'];

    public function __construct(private DocumentNumberService $numbers) {}

    /** PPB Siap PO → Penawaran Harga */
    public function toQuotation(User $user, array $ids): int
    {
        return self::waiting()->whereIn('id', $ids)->whereNull('quote_stage')->update(['quote_stage' => 'PENAWARAN', 'quote_return_note' => null]);
    }

    /** Vendors become columns for these items; a price is entered at each crossing. Waiting items only. */
    public function planVendors(User $user, array $ids, array $vendorIds): int
    {
        $lines = self::waiting()->whereIn('id', $ids)->pluck('id');
        foreach ($lines as $line) {
            foreach (array_unique($vendorIds) as $vendor) {
                DB::table('purchase_order_item_vendors')->insertOrIgnore(['purchase_order_item_id' => $line, 'vendor_id' => $vendor, 'created_by' => $user->id, 'created_at' => now()]);
            }
        }

        return $lines->count();
    }

    /** A column goes from these items; one with a price stays until the price is removed. */
    public function dropVendor(array $ids, int $vendorId): void
    {
        if (PurchaseOrderQuote::whereIn('purchase_order_item_id', $ids)->where('vendor_id', $vendorId)->exists()) {
            throw ValidationException::withMessages(['vendor' => 'Vendor ini sudah punya harga. Kosongkan harganya dulu.']);
        }
        DB::table('purchase_order_item_vendors')->whereIn('purchase_order_item_id', $ids)->where('vendor_id', $vendorId)->delete();
    }

    /** Penawaran Harga → back to PPB Siap PO (its prices stay) */
    public function backToReady(User $user, array $ids): int
    {
        return self::waiting()->whereIn('id', $ids)->where('quote_stage', 'PENAWARAN')->update(['quote_stage' => null]);
    }

    /** Penawaran Harga → the Direktur picks the vendor; every item needs at least one vendor's price. */
    public function submitQuotation(User $user, array $ids): int
    {
        $items = self::waiting()->whereIn('id', $ids)->where('quote_stage', 'PENAWARAN')->withCount('quotes')->get();
        if ($items->isEmpty()) {
            throw ValidationException::withMessages(['line_ids' => 'Pilih barang di Penawaran Harga.']);
        }
        if ($bare = $items->firstWhere('quotes_count', 0)) {
            throw ValidationException::withMessages(['line_ids' => "Catat minimal satu harga vendor untuk {$bare->description_raw}."]);
        }
        PurchaseOrderItem::whereIn('id', $items->pluck('id'))->update(['quote_stage' => 'MENUNGGU_DIREKTUR', 'quote_submitted_at' => now(), 'quote_return_note' => null]);
        \App\Services\Notifications\NotificationDispatcher::toPermission(PurchaseOrderService::DIRECTOR, 'po', 'info', 'Penawaran harga menunggu pilihan Direktur',
            "{$user->name} mengajukan {$items->count()} barang. Pilih vendor tiap barang.", '/purchase-orders/penawaran?tab=direktur', $user->id);

        return $items->count();
    }

    /** The Direktur's first pick: one vendor per item (tagged). Changing it later is changePick(). */
    public function choose(User $user, PurchaseOrderItem $item, int $quoteId): void
    {
        $this->expectWaiting($item);
        if ($item->quote_stage === 'DIPILIH') {
            throw ValidationException::withMessages(['quote_id' => 'Vendor barang ini sudah dipilih. Ubah pilihannya dari History.']);
        }
        if ($item->quote_stage !== 'MENUNGGU_DIREKTUR') {
            throw ValidationException::withMessages(['quote_id' => 'Barang ini belum diajukan ke Direktur.']);
        }
        $quote = $item->quotes()->whereKey($quoteId)->first();
        if (! $quote) {
            throw ValidationException::withMessages(['quote_id' => 'Penawaran vendor tidak ditemukan.']);
        }
        DB::transaction(function () use ($user, $item, $quote) {
            $item->quotes()->whereKeyNot($quote->id)->update(['chosen_at' => null, 'chosen_by' => null]);
            $quote->update(['chosen_at' => now(), 'chosen_by' => $user->id]);
            $item->update(['quote_stage' => 'DIPILIH']);
            $this->logPick($item, $user, 'PICK', null, $quote, null);
        });
        $by = $item->quotes()->whereNotNull('created_by')->latest('updated_at')->value('created_by');
        if ($by) {
            \App\Services\Notifications\NotificationDispatcher::toUser($by, 'po', 'success', 'Vendor dipilih Direktur',
                "{$item->description_raw}: {$quote->vendor?->name}. Siap dibuat Draft PO.", '/purchase-orders/draft', $user->id);
        }
    }

    /**
     * History: the Direktur changes a pick to another vendor that quoted, with a reason, while the item is
     * not a PO yet. Locked with the line, so it cannot cross a PO being made of it.
     */
    public function changePick(User $user, PurchaseOrderItem $item, int $quoteId, string $reason): void
    {
        $reason = $this->requireReason($reason);
        [$from, $to] = DB::transaction(function () use ($user, $item, $quoteId, $reason) {
            $line = PurchaseOrderItem::lockForUpdate()->findOrFail($item->id);
            $this->expectWaiting($line);
            if ($line->quote_stage !== 'DIPILIH') {
                throw ValidationException::withMessages(['quote_id' => 'Barang ini tidak sedang berstatus dipilih Direktur.']);
            }
            $to = $line->quotes()->with('vendor:id,name')->whereKey($quoteId)->first();
            if (! $to) {
                throw ValidationException::withMessages(['quote_id' => 'Pilih vendor yang sudah memberi penawaran untuk barang ini.']);
            }
            $from = $line->quotes()->with('vendor:id,name')->whereNotNull('chosen_at')->first();
            if ($from?->id === $to->id) {
                throw ValidationException::withMessages(['quote_id' => 'Vendor ini sudah menjadi pilihan saat ini.']);
            }
            $line->quotes()->whereKeyNot($to->id)->update(['chosen_at' => null, 'chosen_by' => null]);
            $to->update(['chosen_at' => now(), 'chosen_by' => $user->id]);
            $this->logPick($line, $user, 'CHANGE', $from, $to, $reason);

            return [$from, $to];
        });
        $by = $item->quotes()->whereNotNull('created_by')->latest('updated_at')->value('created_by');
        if ($by) {
            \App\Services\Notifications\NotificationDispatcher::toUser($by, 'po', 'warning', 'Pilihan vendor diubah Direktur',
                "{$item->description_raw}: {$from?->vendor?->name} menjadi {$to->vendor?->name}. Alasan: {$reason}", '/purchase-orders/draft', $user->id);
        }
    }

    private function requireReason(?string $reason): string
    {
        $reason = trim((string) $reason);
        if (mb_strlen($reason) < 5) {
            throw ValidationException::withMessages(['reason' => 'Tulis alasan perubahan, minimal 5 karakter.']);
        }

        return mb_substr($reason, 0, 500);
    }

    private function logPick(PurchaseOrderItem $item, User $user, string $action, ?PurchaseOrderQuote $from, ?PurchaseOrderQuote $to, ?string $reason): void
    {
        $item->pickLogs()->create([
            'action' => $action, 'from_vendor' => $from?->vendor?->name, 'from_price' => $from?->unit_price,
            'to_vendor' => $to?->vendor?->name, 'to_price' => $to?->unit_price, 'reason' => $reason,
            'user_id' => $user->id, 'user_name' => $user->name, 'created_at' => now(),
        ]);
    }

    /** The Direktur sends an item back to the Penawaran Harga (e.g. ask another vendor), with a note. */
    public function returnQuotation(User $user, PurchaseOrderItem $item, ?string $note): void
    {
        $this->expectWaiting($item);
        if (! in_array($item->quote_stage, ['MENUNGGU_DIREKTUR', 'DIPILIH'], true)) {
            throw ValidationException::withMessages(['line' => 'Barang ini tidak menunggu pilihan Direktur.']);
        }
        // undoing a pick already made needs a reason; returning before picking does not
        if ($item->quote_stage === 'DIPILIH') {
            $note = $this->requireReason($note);
        }
        DB::transaction(function () use ($user, $item, $note) {
            $from = $item->quotes()->with('vendor:id,name')->whereNotNull('chosen_at')->first();
            $item->quotes()->update(['chosen_at' => null, 'chosen_by' => null]);
            $item->update(['quote_stage' => 'PENAWARAN', 'quote_return_note' => $note ? mb_substr(trim($note), 0, 500) : null]);
            $this->logPick($item, $user, 'RETURN', $from, null, $note ? mb_substr(trim($note), 0, 500) : null);
        });
        $by = $item->quotes()->whereNotNull('created_by')->latest('updated_at')->value('created_by');
        if ($by) {
            \App\Services\Notifications\NotificationDispatcher::toUser($by, 'po', 'warning', 'Penawaran dikembalikan Direktur',
                $item->description_raw.($note ? ": {$note}" : ''), '/purchase-orders/penawaran', $user->id);
        }
    }

    /** the items waiting for their PO (STOCKWISE PPBs only: Accurate's get their PO in Accurate) */
    public static function waiting(): Builder
    {
        $nos = DB::table('ppb')->join('purchase_order_items as i', 'i.approved_ppb_id', '=', 'ppb.id')
            ->where('i.line_status', PpbApprovalService::WAITING)->distinct()->pluck('ppb.no_ppb');
        $stockwise = PpbApprovalService::stockwiseNos($nos)->values()->all();

        return PurchaseOrderItem::query()->where('line_status', PpbApprovalService::WAITING)
            ->whereHas('purchaseOrder', fn ($p) => $p->where('status', PpbApprovalService::WAITING))
            ->whereHas('approvedPpb', fn ($p) => $p->whereIn('no_ppb', $stockwise));
    }

    /** A vendor's price for a waiting item (one per vendor: saved again = changed). */
    public function quote(PurchaseOrderItem $item, User $user, int $vendorId, float $price, ?string $note, ?string $availability = null, ?string $eta = null): PurchaseOrderQuote
    {
        $this->expectWaiting($item);
        // prices are talked over with the vendors in the Penawaran Harga only (not while the Direktur picks)
        if ($item->quote_stage !== 'PENAWARAN') {
            throw ValidationException::withMessages(['line' => 'Harga vendor dicatat di Penawaran Harga (masukkan barangnya dulu dari Item PPB Disetujui).']);
        }

        return DB::transaction(function () use ($item, $user, $vendorId, $price, $note, $availability, $eta) {
            $quote = PurchaseOrderQuote::updateOrCreate(
                ['purchase_order_item_id' => $item->id, 'vendor_id' => $vendorId],
                ['unit_price' => round($price, 2), 'note' => $note ?: null, 'availability' => $availability ?: null, 'eta' => $eta ?: null, 'created_by' => $user->id],
            );
            $this->logPrice($item, $vendorId, round($price, 2), $user->id);

            return $quote;
        });
    }

    /** One row per price update; the same price saved again the same day only moves that row's time. */
    private function logPrice(PurchaseOrderItem $item, int $vendorId, float $price, int $userId): void
    {
        $table = DB::table('purchase_order_quote_updates');
        $last = (clone $table)->where(['purchase_order_item_id' => $item->id, 'vendor_id' => $vendorId])->orderByDesc('id')->first();
        if ($last && abs((float) $last->unit_price - $price) < 0.005 && substr((string) $last->created_at, 0, 10) === now()->toDateString()) {
            (clone $table)->where('id', $last->id)->update(['created_at' => now(), 'user_id' => $userId]);

            return;
        }
        $table->insert(['purchase_order_item_id' => $item->id, 'item_id' => $item->item_id, 'vendor_id' => $vendorId, 'unit_price' => $price, 'user_id' => $userId, 'created_at' => now()]);
    }

    /**
     * The last 3 price updates of each line + vendor, newest first: of the same master item from any PPB,
     * of that line alone for an item outside the master.
     *
     * @param  iterable<PurchaseOrderItem>  $lines
     * @return array<string, list<array{unit_price:float, at:?string, by:?string}>> keyed "line:vendor"
     */
    public static function priceUpdates(iterable $lines): array
    {
        $lines = collect($lines);
        $rows = DB::table('purchase_order_quote_updates as u')->leftJoin('users as us', 'us.id', '=', 'u.user_id')
            ->whereIn('u.vendor_id', $lines->flatMap(fn ($l) => $l->quotes->pluck('vendor_id'))->unique()->values()->all() ?: [0])
            ->where(fn ($q) => $q->whereIn('u.item_id', $lines->pluck('item_id')->filter()->unique()->values()->all() ?: [0])
                ->orWhereIn('u.purchase_order_item_id', $lines->pluck('id')->all() ?: [0]))
            ->orderByDesc('u.id')->get(['u.purchase_order_item_id', 'u.item_id', 'u.vendor_id', 'u.unit_price', 'u.created_at', 'us.name as by_name']);
        $out = [];
        foreach ($lines as $l) {
            foreach ($l->quotes as $q) {
                $out["{$l->id}:{$q->vendor_id}"] = $rows->filter(fn ($r) => (int) $r->vendor_id === (int) $q->vendor_id
                    && ($l->item_id ? (int) $r->item_id === (int) $l->item_id : (int) $r->purchase_order_item_id === (int) $l->id))
                    ->take(3)->map(fn ($r) => ['unit_price' => (float) $r->unit_price,
                        'at' => $r->created_at ? \Illuminate\Support\Carbon::parse($r->created_at)->timezone(config('app.timezone'))->toIso8601String() : null, 'by' => $r->by_name])->values()->all();
            }
        }

        return $out;
    }

    public function removeQuote(PurchaseOrderItem $item, PurchaseOrderQuote $quote): void
    {
        $this->expectWaiting($item);
        if ($item->quote_stage !== 'PENAWARAN') {
            throw ValidationException::withMessages(['line' => 'Penawaran ini sedang / sudah dipilih Direktur.']);
        }
        $quote->delete();
    }

    /**
     * The picked items become one PO of one vendor: their price is the one given, else that vendor's
     * quote. The emptied "Menunggu PO" entries go.
     *
     * @param  list<int>  $ids
     * @param  array{vendor_id:int, expected_date?:?string, notes?:?string, lines?:list<array{id:int, qty?:float|null, unit_price?:float|null}>}  $data
     */
    public function submit(User $user, array $ids, array $data): PurchaseOrder
    {
        $po = DB::transaction(function () use ($user, $ids, $data) {
            $items = self::waiting()->whereIn('id', $ids)->where('quote_stage', 'DIPILIH')->with('approvedPpb:id,no_ppb', 'quotes')->lockForUpdate()->orderBy('id')->get();
            if ($items->isEmpty() || $items->count() !== count(array_unique($ids))) {
                throw ValidationException::withMessages(['line_ids' => 'Sebagian barang sudah jadi PO / belum dipilih vendornya oleh Direktur — muat ulang daftar.']);
            }
            $given = collect($data['lines'] ?? [])->keyBy('id');
            $vendorId = (int) $data['vendor_id'];
            $values = [];
            $offPick = 0;
            foreach ($items as $i => $item) {
                // usually the Direktur's pick; another vendor that quoted is allowed and tagged at the approval
                $quote = $item->quotes->firstWhere('vendor_id', $vendorId);
                if (! $quote) {
                    throw ValidationException::withMessages(["lines.{$i}.vendor" => "{$item->description_raw}: vendor ini belum punya penawaran harga."]);
                }
                if ($quote->chosen_at === null) {
                    $offPick++;
                }
                $in = $given->get($item->id, []);
                $qty = round((float) ($in['qty'] ?? $item->qty), 2);
                $price = $in['unit_price'] ?? $quote->unit_price;
                if ($qty <= 0) {
                    throw ValidationException::withMessages(["lines.{$i}.qty" => "Jumlah {$item->description_raw} harus lebih dari 0."]);
                }
                if ($price === null) {
                    throw ValidationException::withMessages(["lines.{$i}.unit_price" => "Isi harga {$item->description_raw}."]);
                }
                // ordered in another unit: the price on the form is per that unit, and the item must know its size
                $unitId = $item->unit_id;
                $frozen = [$item->unit_ratio, $item->base_unit];
                if (! empty($in['unit_id']) && (int) $in['unit_id'] !== (int) $item->unit_id) {
                    if (! isset($in['unit_price'])) {
                        throw ValidationException::withMessages(["lines.{$i}.unit_price" => "Isi harga {$item->description_raw} per satuan yang dipesan."]);
                    }
                    $master = $item->item_id ? \App\Models\Item::with('unit')->find($item->item_id) : null;
                    if (! $master?->unit) {
                        throw ValidationException::withMessages(["lines.{$i}.unit_id" => "{$item->description_raw}: barang di luar master tidak bisa dipesan dengan satuan lain."]);
                    }
                    try {
                        $ratio = app(UomConverter::class)->documentRatio($master, \App\Models\Unit::findOrFail($in['unit_id']));
                        $frozen = [$ratio, UomConverter::isOne($ratio) ? null : $master->unit?->code];
                    } catch (ValidationException $e) {
                        throw ValidationException::withMessages(["lines.{$i}.unit_id" => "{$item->description_raw}: ".collect($e->errors())->flatten()->first()]);
                    }
                    $unitId = (int) $in['unit_id'];
                }
                $values[$item->id] = [$qty, round((float) $price, 2), $unitId, $frozen];
            }

            $nos = $items->pluck('approvedPpb.no_ppb')->filter()->unique()->values();
            $date = now();
            $number = $this->numbers->next('PO', 'PPB', $date);
            preg_match('/(\d+)$/', $number, $m);
            $po = PurchaseOrder::create([
                'number' => $number, 'prefix' => 'PPB', 'year' => (int) $date->format('y'), 'month' => (int) $date->format('n'), 'sequence' => (int) $m[1],
                'date' => $date->toDateString(), 'vendor_id' => $vendorId, 'site_id' => $items->first()->purchaseOrder->site_id ?? $user->site_id ?? DB::table('sites')->value('id'),
                'expected_date' => $data['expected_date'] ?? null, 'status' => 'DRAFT',
                'notes' => ($data['notes'] ?? null) ?: 'Dari Draft PO · PPB '.$nos->implode(', '),
                'from_ppb_approval' => $nos->count() === 1 ? $nos->first() : null,
                'created_by' => $user->id,
            ]);
            $entries = $items->pluck('purchase_order_id')->unique();
            foreach ($items as $item) {
                [$qty, $price, $unitId, $frozen] = $values[$item->id];
                // the line itself moves (it keeps its PPB line and its price comparison)
                $item->update(['purchase_order_id' => $po->id, 'vendor_id' => $vendorId, 'qty' => $qty, 'unit_id' => $unitId, 'unit_ratio' => $frozen[0], 'base_unit' => $frozen[1], 'unit_price' => $price,
                    'line_total' => round($qty * $price, 2), 'line_status' => 'PENDING', 'quote_stage' => null]);
            }
            $subtotal = (float) $po->items()->sum('line_total');
            $po->update(['subtotal' => $subtotal, 'tax' => 0, 'total' => $subtotal]);
            PurchaseOrder::whereIn('id', $entries)->where('status', PpbApprovalService::WAITING)->doesntHave('items')->get()->each->delete();
            DB::table(PurchaseOrderService::LOG)->insert(['purchase_order_id' => $po->id, 'action' => 'DIAJUKAN',
                'note' => 'PO dibuat dari Draft PO (PPB '.$nos->implode(', ').')'.($offPick ? " · {$offPick} barang bukan pilihan Direktur" : ''), 'user_id' => $user->id, 'user_name' => $user->name, 'created_at' => now()]);

            return $po;
        });
        PurchaseOrderService::notifyDirectorOf($po, $user);

        return $po;
    }

    /**
     * A line of a STOCKWISE PO against the Direktur's pick: PILIHAN (bought from the picked vendor) or
     * BUKAN (another vendor, or no pick at all).
     *
     * @return array{status:string, vendor:?string, unit_price:?float}
     */
    public static function directorPick(PurchaseOrderItem $line, ?int $poVendorId): array
    {
        $chosen = $line->quotes->first(fn ($q) => $q->chosen_at !== null);
        $bought = (int) ($line->vendor_id ?? $poVendorId);

        return ['status' => $chosen && (int) $chosen->vendor_id === $bought ? 'PILIHAN' : 'BUKAN',
            'vendor' => $chosen?->vendor?->name, 'unit_price' => $chosen ? (float) $chosen->unit_price : null];
    }

    public function expectWaiting(PurchaseOrderItem $item): void
    {
        if (! self::waiting()->whereKey($item->id)->exists()) {
            throw ValidationException::withMessages(['line' => 'Barang ini sudah jadi PO / tidak di Draft PO lagi.']);
        }
    }
}
