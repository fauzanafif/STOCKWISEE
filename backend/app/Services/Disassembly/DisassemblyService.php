<?php

namespace App\Services\Disassembly;

use App\Models\DisassemblyActivity;
use App\Models\DisassemblyComponent;
use App\Models\DisassemblyEntry;
use App\Models\DisassemblyOrder;
use App\Models\Inventory;
use App\Models\Item;
use App\Models\MrpBom;
use App\Models\Unit;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\DocumentNumberService;
use App\Services\Inventory\StockLedgerService;
use App\Services\Mrp\BomService;
use App\Services\Mrp\MrpQty;
use App\Services\UomConverter;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Disassembly Order (unbuild): one finished product taken apart into the components of its active BoM.
 *
 *   DRAFT        editable; the BoM is copied into the order (later BoM changes never reach it)
 *   CONFIRMED    the plan is locked (refused when the source warehouse has not enough free stock); the product is
 *                asked from the warehouse with an Item Request
 *   IN_PROGRESS  what came out is recorded per component: GOOD / SCRAP / MISSING — no stock moves
 *   TO_CLOSE     taken apart: the quantity really disassembled is set, every component is accounted for
 *   DONE         validated: the product was really handed over by the warehouse (Item Request → Delivery Order)
 *                and the GOOD components really came in through Receipt(s) (RI)
 *   CANCELLED    before DONE.
 *
 * The warehouse is the only door (WarehouseGate): the order never moves stock itself. Scrapped and missing
 * components never enter stock; they stay on the order as the variance against the BoM. Orders validated before
 * this rule posted DISASSEMBLY_* movements themselves (posting_batch set) and keep their reverse / Accurate steps.
 */
class DisassemblyService
{
    /** from => allowed next statuses (validated on every transition) */
    public const TRANSITIONS = [
        'DRAFT' => ['CONFIRMED', 'CANCELLED'],
        'CONFIRMED' => ['IN_PROGRESS', 'CANCELLED'],
        'IN_PROGRESS' => ['TO_CLOSE', 'CANCELLED'],
        'TO_CLOSE' => ['DONE', 'IN_PROGRESS', 'CANCELLED'],
        'DONE' => ['CANCELLED'], // only through reverse()
        'CANCELLED' => [],
    ];

    public const MAX_ACCURATE_REFS = 10;

    public function __construct(
        private readonly DocumentNumberService $numbers,
        private readonly StockLedgerService $ledger,
        private readonly UomConverter $uom,
        private readonly \App\Services\WarehouseGate $gate,
    ) {}

    // ------------------------------------------------------------------ draft

    /**
     * @param  array{bom_id?:?int, item_id?:?int, planned_qty:mixed, source_warehouse_id:mixed, dest_warehouse_id?:mixed,
     *               responsible_id?:?int, notes?:?string}  $data
     */
    public function create(User $user, array $data): DisassemblyOrder
    {
        $bom = $this->bomFor($data);
        $product = $bom->item;
        $base = $this->baseUnit($product, 'item_id');
        $qty = $this->sourceQty($data['planned_qty'] ?? null, 'planned_qty', $base, 'Jumlah yang dibongkar');
        [$source, $dest] = $this->warehouses($data['source_warehouse_id'] ?? null, $data['dest_warehouse_id'] ?? null);

        return DB::transaction(function () use ($user, $data, $bom, $product, $base, $qty, $source, $dest) {
            $order = DisassemblyOrder::create([
                'number' => $this->numbers->nextShort('DSA'),
                'mrp_bom_id' => $bom->id, 'bom_code' => $bom->code, 'bom_revision' => $bom->revision,
                'item_id' => $product->id, 'product_code' => $product->code, 'product_name' => $product->description,
                'base_unit' => $base->code, 'planned_qty' => $qty,
                'source_warehouse_id' => $source, 'dest_warehouse_id' => $dest,
                'responsible_id' => $data['responsible_id'] ?? $user->id,
                'notes' => $this->text($data['notes'] ?? null),
                'status' => 'DRAFT', 'created_by' => $user->id,
            ]);
            $this->snapshotComponents($order, $bom, $qty);
            $this->log($order, 'CREATED', $user, null, 'DRAFT', "BoM {$bom->code} revisi {$bom->revision} · bongkar ".MrpQty::show($qty).' '.$order->base_unit);

            return $order->refresh();
        });
    }

    /** Draft only. A new quantity or BoM recalculates the components from the (active) BoM. */
    public function update(DisassemblyOrder $order, User $user, array $data): DisassemblyOrder
    {
        return DB::transaction(function () use ($order, $user, $data) {
            $order = $this->locked($order, ['DRAFT'], 'Hanya dokumen draft yang bisa diubah.');
            $bom = isset($data['bom_id']) && (int) $data['bom_id'] !== (int) $order->mrp_bom_id ? $this->bomFor(['bom_id' => $data['bom_id']]) : $order->bom;
            if ((int) $bom->item_id !== (int) $order->item_id) {
                throw ValidationException::withMessages(['bom_id' => 'BoM itu untuk produk lain. Buat dokumen baru untuk produk berbeda.']);
            }
            $base = $this->baseUnit(Item::findOrFail($order->item_id), 'item_id');
            $qty = array_key_exists('planned_qty', $data)
                ? $this->sourceQty($data['planned_qty'], 'planned_qty', $base, 'Jumlah yang dibongkar') : MrpQty::dec($order->planned_qty);
            [$source, $dest] = $this->warehouses(
                array_key_exists('source_warehouse_id', $data) ? $data['source_warehouse_id'] : $order->source_warehouse_id,
                array_key_exists('dest_warehouse_id', $data) ? $data['dest_warehouse_id'] : $order->dest_warehouse_id,
            );
            $replan = (int) $bom->id !== (int) $order->mrp_bom_id || MrpQty::cmp($qty, $order->planned_qty) !== 0;
            if ($replan && $bom->status !== 'ACTIVE') {
                throw ValidationException::withMessages(['bom_id' => "BoM {$bom->code} revisi {$bom->revision} sudah tidak aktif. Pilih revisi yang aktif untuk menghitung ulang komponen."]);
            }
            $order->update([
                'mrp_bom_id' => $bom->id, 'bom_code' => $bom->code, 'bom_revision' => $bom->revision,
                'planned_qty' => $qty, 'source_warehouse_id' => $source, 'dest_warehouse_id' => $dest,
                'responsible_id' => array_key_exists('responsible_id', $data) ? ($data['responsible_id'] ?? $user->id) : $order->responsible_id,
                'notes' => array_key_exists('notes', $data) ? $this->text($data['notes']) : $order->notes,
            ]);
            if ($replan) {
                $order->components()->delete();
                $this->snapshotComponents($order, $bom, $qty);
            }
            $this->log($order, 'UPDATED', $user, null, null, $replan ? 'Komponen dihitung ulang: BoM '.$bom->code.' revisi '.$bom->revision.' × '.MrpQty::show($qty) : null);

            return $order->refresh();
        });
    }

    // ------------------------------------------------------------------ transitions

    /** Draft → Confirmed: the product to take apart is held in the source warehouse. Not enough free stock → refused, status unchanged. */
    public function confirm(DisassemblyOrder $order, User $user): DisassemblyOrder
    {
        return DB::transaction(function () use ($order, $user) {
            $order = $this->locked($order, ['DRAFT'], 'Dokumen ini sudah dikonfirmasi.');
            if ($order->components()->count() === 0) {
                throw ValidationException::withMessages(['components' => 'Dokumen tidak punya komponen.']);
            }
            $inv = Inventory::where(['item_id' => $order->item_id, 'warehouse_id' => $order->source_warehouse_id])->lockForUpdate()->first();
            if (! $inv || ! $inv->stock_known) {
                throw ValidationException::withMessages(['stock' => "Stok {$order->product_code} di gudang sumber belum diketahui. Sinkronkan stok dulu."]);
            }
            $free = MrpQty::sub($inv->actual_qty, $inv->reserved_qty);
            if (MrpQty::cmp($free, $order->planned_qty) < 0) {
                throw ValidationException::withMessages(['stock' => "Stok {$order->product_code} di gudang sumber tidak cukup: perlu ".MrpQty::show($order->planned_qty)
                    .' '.$order->base_unit.', tersedia '.MrpQty::show($free).'.']);
            }
            $note = $order->bom?->status !== 'ACTIVE' ? "Perhatian: BoM {$order->bom_code} revisi {$order->bom_revision} sudah tidak aktif; dokumen memakai salinan komponennya sendiri." : null;
            $order->update(['status' => 'CONFIRMED', 'confirmed_at' => now(), 'confirmed_by' => $user->id]);
            $this->log($order, 'CONFIRMED', $user, 'DRAFT', 'CONFIRMED', $note);

            return $order->refresh();
        });
    }

    public function start(DisassemblyOrder $order, User $user): DisassemblyOrder
    {
        return $this->move($order, $user, 'CONFIRMED', 'IN_PROGRESS', 'STARTED', fn () => ['started_at' => now(), 'started_by' => $user->id]);
    }

    /**
     * In Progress → To Close: the quantity really taken apart is set (at most the plan) and every component
     * must be accounted for: good + scrap + missing ≥ qty per unit × that quantity. Nothing is assumed.
     */
    public function finish(DisassemblyOrder $order, User $user, mixed $doneQty): DisassemblyOrder
    {
        return DB::transaction(function () use ($order, $user, $doneQty) {
            $order = $this->locked($order, ['IN_PROGRESS'], 'Dokumen harus In Progress untuk ditandai selesai.');
            $base = $this->baseUnit(Item::findOrFail($order->item_id), 'done_qty');
            $done = $doneQty === null || $doneQty === '' ? MrpQty::dec($order->planned_qty)
                : $this->sourceQty($doneQty, 'done_qty', $base, 'Jumlah yang benar-benar dibongkar');
            if (MrpQty::cmp($done, $order->planned_qty) > 0) {
                throw ValidationException::withMessages(['done_qty' => 'Jumlah yang dibongkar tidak boleh melebihi rencana '.MrpQty::show($order->planned_qty)
                    ." {$order->base_unit} (hanya itu yang dipesan dari stok). Buat dokumen baru untuk sisanya."]);
            }
            $done = bcadd($done, '0', 2);
            $short = [];
            $over = [];
            foreach ($this->results($order) as $r) {
                $expected = MrpQty::mul($r['qty_per_unit'], $done);
                if (MrpQty::cmp($r['accounted'], $expected) < 0) {
                    $short[] = "{$r['code']}: ".MrpQty::show(MrpQty::sub($expected, $r['accounted'])).' '.$r['base_unit'];
                } elseif (! $r['is_extra'] && MrpQty::cmp($r['accounted'], $expected) > 0) {
                    $over[] = "{$r['code']}: +".MrpQty::show(MrpQty::sub($r['accounted'], $expected)).' '.$r['base_unit'];
                }
            }
            if ($short !== []) {
                throw ValidationException::withMessages(['entries' => 'Belum semua komponen tercatat. Catat sisanya sebagai Good, Scrap, atau Missing: '.implode('; ', $short).'.']);
            }
            // more recovered than the BoM gives for what was really taken apart: never silently, only with the validator's right
            if ($over !== [] && ! $user->hasPermission('disassembly.validate')) {
                throw ValidationException::withMessages(['entries' => 'Hasil tercatat melebihi BoM untuk jumlah yang dibongkar: '.implode('; ', $over)
                    .'. Koreksi catatannya, atau minta pemegang izin validasi menandai selesai.']);
            }
            $order->update(['status' => 'TO_CLOSE', 'done_qty' => $done, 'finished_at' => now(), 'finished_by' => $user->id]);
            $this->log($order, 'FINISHED', $user, 'IN_PROGRESS', 'TO_CLOSE', 'Dibongkar '.MrpQty::show($done).' '.$order->base_unit
                .(MrpQty::cmp($done, $order->planned_qty) < 0 ? ' dari rencana '.MrpQty::show($order->planned_qty) : '')
                .($over !== [] ? ' · hasil melebihi BoM: '.implode('; ', $over) : ''));

            return $order->refresh();
        });
    }

    /** To Close → In Progress: something still has to be recorded or corrected. */
    public function reopen(DisassemblyOrder $order, User $user, ?string $note = null): DisassemblyOrder
    {
        return $this->move($order, $user, 'TO_CLOSE', 'IN_PROGRESS', 'REOPENED', fn () => ['done_qty' => null, 'finished_at' => null, 'finished_by' => null], $note);
    }

    /**
     * To Close → Done, the only moment stock moves. One transaction under a row lock on the order, so a second
     * click / request finds it DONE and is refused: never posted twice. Anything missing → nothing posted.
     */
    public function validate(DisassemblyOrder $order, User $user): DisassemblyOrder
    {
        return DB::transaction(function () use ($order, $user) {
            $order = $this->locked($order, ['TO_CLOSE'], $order->status === 'DONE' ? 'Dokumen ini sudah divalidasi.' : 'Dokumen harus berstatus To Close sebelum divalidasi.');
            $done = MrpQty::dec($order->done_qty ?? $order->planned_qty);
            $entries = $order->entries()->whereNull('voided_at')->whereNull('posted_at')->get();
            $issued = $this->gate->issued('DSA', $order->id);
            $received = $this->gate->received('DSA', $order->id);
            $missing = [];
            // 1. the product taken apart was handed over by the warehouse (Item Request → Delivery Order)
            $got = $issued[(int) $order->item_id] ?? '0';
            if (MrpQty::cmp($done, $got) > 0) {
                $missing[] = "{$order->product_code}: dibongkar ".MrpQty::show($done).', diserahkan gudang '.MrpQty::show($got).' '.$order->base_unit;
            }
            // 2. every good component came into the warehouse with a Receipt
            foreach ($entries->where('kind', 'GOOD')->groupBy('item_id') as $itemId => $rows) {
                $good = $this->sum($rows);
                $in = $received[(int) $itemId] ?? '0';
                if (MrpQty::cmp($good, $in) > 0) {
                    $missing[] = ($rows->first()->item?->code ?? "#{$itemId}").': hasil baik '.MrpQty::show($good).', diterima lewat Receipt '.MrpQty::show($in).' '.$rows->first()->base_unit;
                }
            }
            if ($missing !== []) {
                throw ValidationException::withMessages(['warehouse' => 'Barang harus lewat gudang: produk diminta dengan Item Request dan diserahkan lewat Delivery Order, komponen hasil bongkar diterima lewat Receipt. Belum lengkap: '.implode('; ', $missing).'.']);
            }
            $this->release($order, $user, "{$order->number} · selesai, pesanan dilepas"); // an order confirmed before the rule

            DisassemblyEntry::whereIn('id', $entries->pluck('id'))->update(['posted_at' => now()]);
            $order->update(['status' => 'DONE', 'reserved_qty' => 0, 'done_at' => now(), 'done_by' => $user->id]);
            $this->log($order, 'VALIDATED', $user, 'TO_CLOSE', 'DONE', 'Dibongkar '.MrpQty::show($done).' '.$order->base_unit.' · stok lewat Delivery Order & Receipt');

            return $order->refresh();
        });
    }

    /** Ask the warehouse for the product to take apart: one Item Request (verification → approvals → Delivery Order). */
    public function requestProduct(DisassemblyOrder $order, User $user): \App\Models\ItemRequest
    {
        if (! in_array($order->status, ['CONFIRMED', 'IN_PROGRESS'], true)) {
            throw ValidationException::withMessages(['status' => 'Produk diminta setelah dokumen dikonfirmasi dan sebelum selesai.']);
        }
        $asked = $this->gate->requested('DSA', $order->id)[(int) $order->item_id] ?? '0';
        $made = $this->gate->requestItems('DSA', $order->id, $user, $order->responsible,
            [(int) $order->item_id => MrpQty::max('0', MrpQty::sub($order->planned_qty, $asked, 2))],
            "Produk untuk dibongkar, Disassembly Order {$order->number}");
        $this->log($order, 'PRODUCT_REQUESTED', $user, null, null, "Item Request {$made->number}");

        return $made;
    }

    /** A Receipt (RI) the recovered components came into the warehouse with. */
    public function linkReceipt(DisassemblyOrder $order, User $user, string $noRi): DisassemblyOrder
    {
        if (! in_array($order->status, ['IN_PROGRESS', 'TO_CLOSE'], true)) {
            throw ValidationException::withMessages(['status' => 'Receipt dihubungkan saat dokumen In Progress atau To Close.']);
        }
        $this->gate->linkReceipt('DSA', $order->id, $user, $noRi, $order->components()->pluck('item_id')->map(fn ($v) => (int) $v)->all(), $order->created_at);
        $this->log($order, 'RECEIPT_LINKED', $user, null, null, "Receipt {$noRi}");

        return $order->refresh();
    }

    public function unlinkReceipt(DisassemblyOrder $order, User $user, string $noRi): DisassemblyOrder
    {
        if (! in_array($order->status, ['IN_PROGRESS', 'TO_CLOSE'], true)) {
            throw ValidationException::withMessages(['status' => 'Receipt hanya bisa dilepas sebelum dokumen divalidasi.']);
        }
        $this->gate->unlinkReceipt('DSA', $order->id, $noRi);
        $this->log($order, 'RECEIPT_UNLINKED', $user, null, null, "Receipt {$noRi}");

        return $order->refresh();
    }

    /** Before Done: release the hold, void what was recorded (kept, marked); nothing was posted. */
    public function cancel(DisassemblyOrder $order, User $user, ?string $reason): DisassemblyOrder
    {
        return DB::transaction(function () use ($order, $user, $reason) {
            $order = $this->locked($order, ['DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'TO_CLOSE'],
                $order->status === 'DONE' ? 'Dokumen yang sudah Done tidak dibatalkan — gunakan Reverse.' : 'Dokumen ini sudah dibatalkan.');
            $reason = $this->text($reason, 255);
            if ($order->status !== 'DRAFT' && $reason === null) {
                throw ValidationException::withMessages(['reason' => 'Isi alasan pembatalan.']);
            }
            $from = $order->status;
            $this->release($order, $user, "{$order->number} · dibatalkan, pesanan dilepas");
            $order->entries()->whereNull('voided_at')->update(['voided_at' => now(), 'voided_by' => $user->id]);
            $order->update(['status' => 'CANCELLED', 'reserved_qty' => 0, 'cancelled_at' => now(), 'cancelled_by' => $user->id, 'cancel_reason' => $reason]);
            $this->log($order, 'CANCELLED', $user, $from, 'CANCELLED', $reason);

            return $order->refresh();
        });
    }

    /**
     * Done → Cancelled by posting the exact opposite of every movement (same warehouse, same qty). Refused once
     * marked as entered in Accurate, and when a recovered component is no longer free in its warehouse
     * (checked for all before anything is posted).
     */
    public function reverse(DisassemblyOrder $order, User $user, ?string $reason): DisassemblyOrder
    {
        return DB::transaction(function () use ($order, $user, $reason) {
            $order = $this->locked($order, ['DONE'], 'Hanya dokumen Done yang bisa dibalik.');
            if (! $order->posting_batch) {
                throw ValidationException::withMessages(['status' => 'Stok dokumen ini bergerak lewat Delivery Order dan Receipt. Koreksi lewat dokumen gudang (Item Request / Receipt).']);
            }
            if ($order->accurate_recorded_at) {
                throw ValidationException::withMessages(['status' => 'Dokumen ini sudah ditandai tercatat di Accurate. Balik transaksinya di Accurate.']);
            }
            $reason = $this->text($reason, 255);
            if ($reason === null) {
                throw ValidationException::withMessages(['reason' => 'Isi alasan pembalikan.']);
            }
            $batch = (string) Str::uuid();
            $moves = DB::table('stock_movements')->where(['reference_type' => $order->getMorphClass(), 'reference_id' => $order->id])
                ->whereIn('movement_type', ['DISASSEMBLY_OUT', 'DISASSEMBLY_IN'])->orderBy('id')->get();
            $ins = $moves->where('movement_type', 'DISASSEMBLY_IN');
            $codes = Item::whereIn('id', $ins->pluck('item_id')->all())->pluck('code', 'id');
            $gone = [];
            foreach ($ins as $m) {
                $inv = Inventory::where(['item_id' => $m->item_id, 'warehouse_id' => $m->warehouse_id])->lockForUpdate()->first();
                $free = MrpQty::sub($inv?->actual_qty ?? 0, $inv?->reserved_qty ?? 0);
                if (MrpQty::cmp($free, $m->qty) < 0) {
                    $gone[] = ($codes[$m->item_id] ?? "#{$m->item_id}").' tinggal '.MrpQty::show($free).' (perlu '.MrpQty::show($m->qty).')';
                }
            }
            if ($gone !== []) {
                throw ValidationException::withMessages(['status' => 'Komponen hasil bongkar sudah terpakai: '.implode('; ', $gone).'. Tidak bisa dibalik.']);
            }
            foreach ($ins as $m) {
                $this->ledger->record(['type' => 'DISASSEMBLY_REVERSE_OUT', 'item_id' => $m->item_id, 'warehouse_id' => $m->warehouse_id, 'qty' => (float) $m->qty,
                    'reference' => $order, 'note' => "{$order->number} · balik hasil bongkar", 'created_by' => $user->id, 'batch_uuid' => $batch]);
            }
            foreach ($moves->where('movement_type', 'DISASSEMBLY_OUT') as $m) {
                $this->ledger->record(['type' => 'DISASSEMBLY_REVERSE_IN', 'item_id' => $m->item_id, 'warehouse_id' => $m->warehouse_id, 'qty' => (float) $m->qty,
                    'reference' => $order, 'note' => "{$order->number} · produk dikembalikan", 'created_by' => $user->id, 'batch_uuid' => $batch]);
            }
            $order->update(['status' => 'CANCELLED', 'reversed_at' => now(), 'reversed_by' => $user->id, 'cancelled_at' => now(), 'cancelled_by' => $user->id, 'cancel_reason' => $reason]);
            $this->log($order, 'REVERSED', $user, 'DONE', 'CANCELLED', $reason);

            return $order->refresh();
        });
    }

    /**
     * The disassembly was entered in Accurate too, possibly with several documents: from now on Accurate's qty
     * carries it and StockwiseNet stops adding it. Never automatic; at most once.
     *
     * @param  list<string>|string|null  $refs
     */
    public function markAccurate(DisassemblyOrder $order, User $user, array|string|null $refs): DisassemblyOrder
    {
        $list = collect(is_array($refs) ? $refs : preg_split('/[\n,;]+/', (string) $refs))
            ->map(fn ($r) => trim((string) $r))->filter()->unique(fn ($r) => mb_strtoupper($r))->values();
        if ($list->isEmpty()) {
            throw ValidationException::withMessages(['refs' => 'Isi nomor dokumen Accurate (boleh lebih dari satu).']);
        }
        if ($list->count() > self::MAX_ACCURATE_REFS) {
            throw ValidationException::withMessages(['refs' => 'Paling banyak '.self::MAX_ACCURATE_REFS.' nomor dokumen.']);
        }
        foreach ($list as $r) {
            if (mb_strlen($r) > 60 || ! preg_match('/[A-Za-z0-9]/', $r)) {
                throw ValidationException::withMessages(['refs' => "Nomor dokumen \"{$r}\" tidak valid."]);
            }
        }

        return DB::transaction(function () use ($order, $user, $list) {
            $order = $this->locked($order, ['DONE'], 'Hanya dokumen Done yang bisa ditandai tercatat di Accurate.');
            if (! $order->posting_batch) {
                throw ValidationException::withMessages(['status' => 'Dokumen ini tidak memposting stok sendiri (lewat Delivery Order & Receipt); tidak perlu ditandai.']);
            }
            if ($order->accurate_recorded_at) {
                throw ValidationException::withMessages(['status' => 'Dokumen ini sudah ditandai tercatat di Accurate.']);
            }
            $order->update(['accurate_recorded_at' => now(), 'accurate_recorded_by' => $user->id, 'accurate_refs' => $list->all()]);
            $this->log($order, 'ACCURATE_RECORDED', $user, null, null, $list->implode(', '));

            return $order->refresh();
        });
    }

    // ------------------------------------------------------------------ entries

    /**
     * Record what came out for a component while In Progress: GOOD, SCRAP (reason) or MISSING (reason).
     * Converted to Base UOM with the item's ratio of this moment (frozen). More than the plan, or an item outside
     * the BoM (GOOD only), needs disassembly.validate and a reason. The same client_key twice returns the first entry.
     *
     * @param  array{kind:string, item_id:mixed, qty:mixed, unit?:?string, entry_date?:?string, reason?:?string, note?:?string, client_key?:?string}  $data
     */
    public function addEntry(DisassemblyOrder $order, User $user, array $data): DisassemblyEntry
    {
        $key = $this->text($data['client_key'] ?? null, 64);
        if ($key && ($dup = DisassemblyEntry::where('client_key', $key)->first())) {
            if ((int) $dup->disassembly_order_id !== (int) $order->id) {
                throw ValidationException::withMessages(['client_key' => 'Kunci entri sudah dipakai.']);
            }

            return $dup;
        }

        return DB::transaction(function () use ($order, $user, $data, $key) {
            $order = $this->locked($order, ['IN_PROGRESS'], 'Pencatatan hanya saat dokumen In Progress.');
            $kind = strtoupper((string) ($data['kind'] ?? ''));
            if (! in_array($kind, DisassemblyEntry::KINDS, true)) {
                throw ValidationException::withMessages(['kind' => 'Jenis catatan tidak dikenal.']);
            }
            $itemId = (int) ($data['item_id'] ?? 0);
            $item = Item::find($itemId);
            if (! $item) {
                throw ValidationException::withMessages(['item_id' => 'Pilih komponennya.']);
            }
            if ($itemId === (int) $order->item_id) {
                throw ValidationException::withMessages(['item_id' => 'Produk yang dibongkar tidak bisa dicatat sebagai hasil bongkar.']);
            }
            if ($item->product_kind === 'JASA') {
                throw ValidationException::withMessages(['item_id' => "{$item->code} adalah jasa (tanpa stok)."]);
            }
            $base = $this->baseUnit($item, 'item_id');
            $item->setRelation('unit', $base);

            $qty = MrpQty::positive($data['qty'] ?? null, 'qty', MrpQty::SCALE, 'Jumlah');
            $unitCode = mb_strtoupper(trim((string) ($data['unit'] ?? ''))) ?: $base->code;
            $unit = Unit::where('code', $unitCode)->first();
            if (! $unit) {
                throw ValidationException::withMessages(['unit' => "Satuan {$unitCode} tidak ada di Master UOM."]);
            }
            try {
                $ratio = $this->uom->documentRatio($item, $unit);
            } catch (ValidationException $e) {
                throw ValidationException::withMessages(['unit' => "{$item->code}: ".collect($e->errors())->flatten()->first().' Atur di menu UOM, tab Per item.']);
            }
            $baseQty = MrpQty::mul($qty, $ratio, 8);
            if (! MrpQty::fitsStock($baseQty)) {
                throw ValidationException::withMessages(['qty' => MrpQty::show($qty)." {$unit->code} = ".MrpQty::show($baseQty)." {$base->code}; stok dicatat dengan 2 desimal. Sesuaikan jumlahnya."]);
            }
            $baseQty = MrpQty::floor2($baseQty);
            if ($kind === 'GOOD' && ! $this->onStep($baseQty, $base)) {
                throw ValidationException::withMessages(['qty' => MrpQty::show($baseQty)." {$base->code} tidak bisa dipecah (kelipatan ".MrpQty::show($base->rounding)." {$base->code})."]);
            }

            $reason = $this->text($data['reason'] ?? null, 255);
            if ($kind !== 'GOOD' && $reason === null) {
                throw ValidationException::withMessages(['reason' => $kind === 'SCRAP' ? 'Isi alasan scrap (mis. rusak, cacat).' : 'Isi alasan komponen hilang / tidak ditemukan.']);
            }
            $canOverride = $user->hasPermission('disassembly.validate');
            $overPlan = false;
            $component = $order->components()->where('item_id', $itemId)->first();
            if (! $component) {
                if ($kind !== 'GOOD') {
                    throw ValidationException::withMessages(['item_id' => "{$item->code} tidak ada di BoM dokumen ini; scrap / hilang hanya untuk komponen BoM."]);
                }
                $this->assertOverride($canOverride, $reason, "{$item->code} tidak ada di BoM dokumen ini");
                $component = $order->components()->create([
                    'item_id' => $item->id, 'product_code' => $item->code, 'description' => $item->description, 'base_unit' => $base->code,
                    'qty_per_unit' => 0, 'planned_qty' => 0, 'is_extra' => true, 'sort' => (int) $order->components()->max('sort') + 1,
                ]);
                $overPlan = true;
            } elseif (! $component->is_extra) {
                $after = MrpQty::add($this->accounted($order, $itemId), $baseQty);
                if (MrpQty::cmp($after, $component->planned_qty) > 0) {
                    $this->assertOverride($canOverride, $reason, "{$item->code} tercatat ".MrpQty::show($after).' '.$base->code.', melebihi rencana '.MrpQty::show($component->planned_qty));
                    $overPlan = true;
                }
            } else {
                $overPlan = true;
            }

            $entry = $order->entries()->create([
                'kind' => $kind, 'item_id' => $item->id, 'component_id' => $component->id,
                'qty' => $qty, 'unit' => $unit->code, 'unit_ratio' => $ratio, 'base_qty' => $baseQty, 'base_unit' => $base->code,
                'entry_date' => isset($data['entry_date']) ? Carbon::parse($data['entry_date'])->toDateString() : now()->toDateString(),
                'reason' => $reason, 'note' => $this->text($data['note'] ?? null),
                'over_plan' => $overPlan, 'client_key' => $key, 'recorded_by' => $user->id,
            ]);
            $label = ['GOOD' => 'Hasil baik', 'SCRAP' => 'Scrap', 'MISSING' => 'Hilang'][$kind];
            $this->log($order, "ENTRY_{$kind}", $user, null, null, "{$label} {$item->code} ".MrpQty::show($qty)." {$unit->code}"
                .((int) $unit->id !== (int) $base->id ? ' = '.MrpQty::show($baseQty)." {$base->code}" : '').($overPlan ? ' · di luar rencana' : '').($reason ? " · {$reason}" : ''));

            return $entry;
        });
    }

    /** A mistyped entry, before it is posted: voided (kept for audit), not deleted. */
    public function voidEntry(DisassemblyEntry $entry, User $user): DisassemblyEntry
    {
        return DB::transaction(function () use ($entry, $user) {
            $order = $this->locked($entry->order, ['IN_PROGRESS'], 'Catatan hanya bisa dibatalkan saat dokumen In Progress.');
            $entry = DisassemblyEntry::lockForUpdate()->findOrFail($entry->id);
            if ($entry->posted_at || $entry->voided_at) {
                throw ValidationException::withMessages(['entry' => 'Catatan ini sudah diposting atau dibatalkan.']);
            }
            if ((int) $entry->recorded_by !== (int) $user->id && ! $user->hasPermission('disassembly.validate')) {
                throw ValidationException::withMessages(['entry' => 'Hanya pencatat atau pemegang izin validasi yang bisa membatalkan catatan ini.']);
            }
            $entry->update(['voided_at' => now(), 'voided_by' => $user->id]);
            $this->log($order, 'ENTRY_VOIDED', $user, null, null, "{$entry->kind} #{$entry->id} ".MrpQty::show($entry->qty)." {$entry->unit}");

            return $entry->refresh();
        });
    }

    // ------------------------------------------------------------------ reading

    /**
     * Per component: plan, expected for the quantity disassembled (or the plan before that), good / scrap /
     * missing recorded, accounted, unaccounted and over — all in Base UOM, from the entries (voided excluded).
     *
     * @return list<array<string, mixed>>
     */
    public function results(DisassemblyOrder $order): array
    {
        $entries = $order->entries()->whereNull('voided_at')->get();
        $basis = MrpQty::dec($order->done_qty ?? $order->planned_qty);
        $received = $this->gate->received('DSA', $order->id);

        return $order->components()->get()->map(function (DisassemblyComponent $c) use ($entries, $basis, $received) {
            $mine = $entries->where('component_id', $c->id);
            $good = $this->sum($mine->where('kind', 'GOOD'));
            $scrap = $this->sum($mine->where('kind', 'SCRAP'));
            $missing = $this->sum($mine->where('kind', 'MISSING'));
            $accounted = MrpQty::add(MrpQty::add($good, $scrap), $missing);
            $expected = MrpQty::mul($c->qty_per_unit, $basis);

            return [
                'component_id' => $c->id, 'item_id' => (int) $c->item_id, 'code' => $c->product_code, 'description' => $c->description,
                'base_unit' => $c->base_unit, 'qty_per_unit' => MrpQty::dec($c->qty_per_unit), 'planned' => MrpQty::dec($c->planned_qty),
                'expected' => $expected, 'good' => $good, 'scrap' => $scrap, 'missing' => $missing, 'accounted' => $accounted,
                'open' => MrpQty::max('0', MrpQty::sub($expected, $accounted)), 'over' => MrpQty::max('0', MrpQty::sub($accounted, $expected)),
                'is_extra' => (bool) $c->is_extra, 'received' => $received[(int) $c->item_id] ?? '0',
            ];
        })->values()->all();
    }

    /** The product's stock in the source warehouse (actual, reserved, held for this order, free). */
    public function sourceStock(DisassemblyOrder $order): array
    {
        $inv = Inventory::where(['item_id' => $order->item_id, 'warehouse_id' => $order->source_warehouse_id])->first();
        $held = $this->held($order);
        $actual = MrpQty::dec($inv?->actual_qty ?? 0);
        $reserved = MrpQty::dec($inv?->reserved_qty ?? 0);
        $free = MrpQty::sub($actual, $reserved);
        $open = in_array($order->status, ['DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'TO_CLOSE'], true);
        $need = MrpQty::dec($order->done_qty ?? $order->planned_qty);
        $usable = MrpQty::add($free, $held);

        return [
            'stock_known' => (bool) ($inv?->stock_known ?? false), 'on_hand' => MrpQty::num($actual), 'reserved_all' => MrpQty::num($reserved),
            'held_for_order' => MrpQty::num($held), 'free' => MrpQty::num($free), 'available_for_order' => MrpQty::num($usable),
            'shortage' => $open ? MrpQty::num(MrpQty::max('0', MrpQty::sub($need, $usable))) : 0.0,
            'issued' => MrpQty::num($this->gate->issued('DSA', $order->id)[(int) $order->item_id] ?? '0'),
            'requested' => MrpQty::num($this->gate->requested('DSA', $order->id)[(int) $order->item_id] ?? '0'),
        ];
    }

    // ------------------------------------------------------------------ internals

    private function bomFor(array $data): MrpBom
    {
        $bom = ! empty($data['bom_id']) ? MrpBom::find((int) $data['bom_id'])
            : (! empty($data['item_id']) ? BomService::activeFor((int) $data['item_id']) : null);
        if (! $bom) {
            throw ValidationException::withMessages(['bom_id' => 'Produk ini belum punya BoM aktif. Buat dan aktifkan BoM-nya di menu Bills of Materials.']);
        }
        if ($bom->status !== 'ACTIVE') {
            throw ValidationException::withMessages(['bom_id' => "BoM {$bom->code} berstatus {$bom->status}; pembongkaran hanya dari BoM aktif."]);
        }
        $bom->load('item');
        $product = $bom->item;
        if (! $product || ! $product->is_active) {
            throw ValidationException::withMessages(['item_id' => 'Produk tidak ditemukan atau tidak aktif.']);
        }
        if ($product->product_kind === 'JASA') {
            throw ValidationException::withMessages(['item_id' => 'Jasa tidak punya stok, jadi tidak bisa dibongkar.']);
        }
        if ($bom->lines()->count() === 0) {
            throw ValidationException::withMessages(['bom_id' => "BoM {$bom->code} tidak punya komponen."]);
        }

        return $bom;
    }

    private function baseUnit(Item $item, string $field): Unit
    {
        $unit = $item->unit_id ? Unit::find($item->unit_id) : null;
        if (! $unit) {
            throw ValidationException::withMessages([$field => "{$item->code} belum punya Base UOM. Atur dulu di menu UOM."]);
        }

        return $unit;
    }

    /** The product quantity: positive, 2 decimals at most, and on the unit's rounding (a unit that cannot be split refuses fractions). */
    private function sourceQty(mixed $v, string $field, Unit $base, string $label): string
    {
        $qty = MrpQty::positive($v, $field, 2, $label);
        if (! $this->onStep($qty, $base)) {
            throw ValidationException::withMessages([$field => "{$label} ".MrpQty::show($qty)." {$base->code}: satuan {$base->code} hanya bisa kelipatan ".MrpQty::show($base->rounding).'.']);
        }

        return $qty;
    }

    /** Whether $qty is a whole multiple of the unit's rounding (Master UOM); no rounding set = any 2-decimal qty. */
    private function onStep(string $qty, Unit $unit): bool
    {
        $step = MrpQty::dec($unit->rounding ?? 0);
        if (MrpQty::cmp($step, '0.01') <= 0) {
            return true;
        }
        $steps = bcdiv($qty, $step, 0);

        return bccomp(bcmul($steps, $step, 6), $qty, 6) === 0;
    }

    /** @return array{0:int, 1:?int} */
    private function warehouses(mixed $source, mixed $dest): array
    {
        $src = $source ? Warehouse::find((int) $source) : null;
        if (! $src || ! $src->is_active) {
            throw ValidationException::withMessages(['source_warehouse_id' => 'Pilih gudang sumber yang aktif.']);
        }
        $dst = null;
        if ($dest && (int) $dest !== (int) $src->id) {
            $d = Warehouse::find((int) $dest);
            if (! $d || ! $d->is_active) {
                throw ValidationException::withMessages(['dest_warehouse_id' => 'Gudang tujuan tidak ditemukan atau tidak aktif.']);
            }
            $dst = (int) $d->id;
        }

        return [(int) $src->id, $dst];
    }

    private function snapshotComponents(DisassemblyOrder $order, MrpBom $bom, string $qty): void
    {
        $lines = $bom->lines()->with('item:id,code,description,unit_id,product_kind,is_active')->get();
        $units = Unit::whereIn('id', $lines->pluck('item.unit_id')->filter()->all())->pluck('code', 'id');
        foreach ($lines as $i => $l) {
            if (! $l->item || ! $l->item->unit_id || $l->item->product_kind === 'JASA') {
                throw ValidationException::withMessages(['bom_id' => 'Komponen '.($l->item?->code ?? "#{$l->item_id}").' di BoM tidak bisa menerima stok (jasa atau tanpa Base UOM).']);
            }
            $order->components()->create([
                'item_id' => $l->item_id, 'product_code' => $l->item->code, 'description' => $l->item->description,
                'base_unit' => $units[$l->item->unit_id] ?? $l->base_unit,
                'qty_per_unit' => MrpQty::dec($l->qty), 'planned_qty' => MrpQty::mul($l->qty, $qty),
                'is_extra' => false, 'sort' => $i,
            ]);
        }
    }

    /** Re-reads the order under a row lock and checks its status: the backend guard of every transition. */
    private function locked(DisassemblyOrder $order, array $allowed, string $message): DisassemblyOrder
    {
        $fresh = DisassemblyOrder::lockForUpdate()->findOrFail($order->id);
        if (! in_array($fresh->status, $allowed, true)) {
            throw ValidationException::withMessages(['status' => $message]);
        }

        return $fresh;
    }

    private function move(DisassemblyOrder $order, User $user, string $from, string $to, string $action, callable $fields, ?string $note = null): DisassemblyOrder
    {
        if (! in_array($to, self::TRANSITIONS[$from] ?? [], true)) {
            throw ValidationException::withMessages(['status' => "Perpindahan {$from} → {$to} tidak diizinkan."]);
        }

        return DB::transaction(function () use ($order, $user, $from, $to, $action, $fields, $note) {
            $order = $this->locked($order, [$from], "Dokumen harus berstatus {$from} untuk langkah ini (sekarang {$order->fresh()->status}).");
            $order->update(['status' => $to] + $fields($order));
            $this->log($order, $action, $user, $from, $to, $this->text($note, 500));

            return $order->refresh();
        });
    }

    /** What is still held for this order in the source warehouse (reservations minus releases). */
    private function held(DisassemblyOrder $order): string
    {
        $q = DB::table('stock_movements')->where(['reference_type' => $order->getMorphClass(), 'reference_id' => $order->id, 'item_id' => $order->item_id])
            ->whereIn('movement_type', ['RESERVATION', 'RELEASE_RESERVATION'])
            ->selectRaw("SUM(CASE WHEN movement_type = 'RESERVATION' THEN qty ELSE -qty END) q")->value('q');

        return MrpQty::max('0', MrpQty::dec($q ?? 0));
    }

    private function release(DisassemblyOrder $order, User $user, string $note, ?string $batch = null): void
    {
        $held = $this->held($order);
        if (MrpQty::cmp($held, '0') <= 0) {
            return;
        }
        $inv = Inventory::where(['item_id' => $order->item_id, 'warehouse_id' => $order->source_warehouse_id])->lockForUpdate()->first();
        // never more than the warehouse still holds (an Accurate sync may have lowered it)
        $rel = MrpQty::floor2(MrpQty::min($held, $inv?->reserved_qty ?? 0));
        if (MrpQty::cmp($rel, '0') > 0) {
            $this->ledger->record(['type' => 'RELEASE_RESERVATION', 'item_id' => $order->item_id, 'warehouse_id' => $order->source_warehouse_id,
                'qty' => (float) $rel, 'reserve_delta' => -(float) $rel, 'reference' => $order, 'note' => $note, 'created_by' => $user->id, 'batch_uuid' => $batch]);
        }
    }

    private function accounted(DisassemblyOrder $order, int $itemId): string
    {
        return $this->sum($order->entries()->whereNull('voided_at')->where('item_id', $itemId)->get());
    }

    private function sum(Collection $entries): string
    {
        return $entries->reduce(fn ($s, $e) => MrpQty::add($s, $e->base_qty, 2), '0');
    }

    private function assertOverride(bool $canOverride, ?string $reason, string $what): void
    {
        if (! $canOverride) {
            throw ValidationException::withMessages(['qty' => "{$what}. Perlu persetujuan pemegang izin validasi (disassembly.validate)."]);
        }
        if ($reason === null) {
            throw ValidationException::withMessages(['reason' => "{$what}. Isi alasannya."]);
        }
    }

    private function log(DisassemblyOrder $order, string $action, ?User $user, ?string $from = null, ?string $to = null, ?string $note = null): void
    {
        DisassemblyActivity::create([
            'disassembly_order_id' => $order->id, 'action' => $action, 'from_status' => $from, 'to_status' => $to,
            'note' => $note, 'user_id' => $user?->id, 'created_at' => now(),
        ]);
    }

    private function text(mixed $v, int $max = 2000): ?string
    {
        $s = trim((string) ($v ?? ''));

        return $s === '' ? null : mb_substr($s, 0, $max);
    }
}
