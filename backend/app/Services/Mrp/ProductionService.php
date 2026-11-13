<?php

namespace App\Services\Mrp;

use App\Models\Inventory;
use App\Models\Item;
use App\Models\MrpBom;
use App\Models\MrpProduction;
use App\Models\MrpProductionComponent;
use App\Models\MrpProductionEntry;
use App\Models\Unit;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\DocumentNumberService;
use App\Services\Inventory\StockLedgerService;
use App\Services\UomConverter;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Manufacturing Order.
 *
 *   DRAFT        editable; BoM copied into the MO's components (later BoM changes never reach it)
 *   CONFIRMED    plan locked; the components are asked from the warehouse with an Item Request
 *   IN_PROGRESS  consumption / output / scrap are recorded — no stock moves
 *   TO_CLOSE     production physically finished, waiting for validation
 *   DONE         validated: what was consumed / scrapped was really handed over by the warehouse (Item Request →
 *                Delivery Order) and the good output really came in through a Receipt (RI)
 *   CANCELLED    before DONE.
 *
 * The warehouse is the only door (WarehouseGate): the MO never moves stock itself. Components leave the stock at
 * the Delivery Order handover, finished goods enter it with the Receipt. MOs validated before this rule posted
 * MRP_* movements themselves (posting_batch set); those keep their reverse / "entered in Accurate" steps.
 */
class ProductionService
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

    public function __construct(
        private readonly DocumentNumberService $numbers,
        private readonly StockLedgerService $ledger,
        private readonly UomConverter $uom,
        private readonly \App\Services\WarehouseGate $gate,
    ) {}

    // ------------------------------------------------------------------ draft

    /**
     * @param  array{bom_id?:?int, item_id?:?int, planned_qty:mixed, planned_start?:?string, planned_finish?:?string,
     *               responsible_id?:?int, priority?:?string, notes?:?string}  $data
     */
    public function create(User $user, array $data): MrpProduction
    {
        $bom = $this->bomFor($data);
        $qty = MrpQty::positive($data['planned_qty'] ?? null, 'planned_qty', 2, 'Jumlah rencana produksi');
        $this->assertDates($data['planned_start'] ?? null, $data['planned_finish'] ?? null);

        return DB::transaction(function () use ($user, $data, $bom, $qty) {
            $product = $bom->item;
            $mo = MrpProduction::create([
                'number' => $this->numbers->nextShort('MO'),
                'mrp_bom_id' => $bom->id, 'bom_code' => $bom->code, 'bom_revision' => $bom->revision,
                'item_id' => $product->id, 'product_code' => $product->code, 'product_name' => $product->description,
                'base_unit' => Unit::whereKey($product->unit_id)->value('code'),
                'planned_qty' => $qty,
                'planned_start' => $data['planned_start'] ?? null, 'planned_finish' => $data['planned_finish'] ?? null,
                'responsible_id' => $data['responsible_id'] ?? $user->id,
                'priority' => $data['priority'] ?? 'NORMAL',
                'notes' => $this->text($data['notes'] ?? null),
                'status' => 'DRAFT', 'created_by' => $user->id,
            ]);
            $this->snapshotComponents($mo, $bom, $qty);
            MrpLog::write($mo, 'CREATED', $user, null, 'DRAFT', "BoM {$bom->code} revisi {$bom->revision} · rencana ".MrpQty::show($qty).' '.$mo->base_unit);

            return $mo->refresh();
        });
    }

    /** Draft only. A new quantity or BoM recalculates the components from the (active) BoM. */
    public function update(MrpProduction $mo, User $user, array $data): MrpProduction
    {
        return DB::transaction(function () use ($mo, $user, $data) {
            $mo = $this->locked($mo, ['DRAFT'], 'Hanya MO draft yang bisa diubah.');
            $bom = isset($data['bom_id']) && (int) $data['bom_id'] !== $mo->mrp_bom_id ? $this->bomFor(['bom_id' => $data['bom_id']]) : $mo->bom;
            if ((int) $bom->item_id !== (int) $mo->item_id) {
                throw ValidationException::withMessages(['bom_id' => 'BoM itu untuk produk lain. Buat MO baru untuk produk berbeda.']);
            }
            $qty = array_key_exists('planned_qty', $data) ? MrpQty::positive($data['planned_qty'], 'planned_qty', 2, 'Jumlah rencana produksi') : MrpQty::dec($mo->planned_qty);
            $start = array_key_exists('planned_start', $data) ? $data['planned_start'] : $mo->planned_start?->toDateString();
            $finish = array_key_exists('planned_finish', $data) ? $data['planned_finish'] : $mo->planned_finish?->toDateString();
            $this->assertDates($start, $finish);
            $replan = $bom->id !== $mo->mrp_bom_id || MrpQty::cmp($qty, $mo->planned_qty) !== 0;
            if ($replan && $bom->status !== 'ACTIVE') {
                throw ValidationException::withMessages(['bom_id' => "BoM {$bom->code} revisi {$bom->revision} sudah tidak aktif. Pilih revisi yang aktif untuk menghitung ulang komponen."]);
            }
            $mo->update([
                'mrp_bom_id' => $bom->id, 'bom_code' => $bom->code, 'bom_revision' => $bom->revision,
                'planned_qty' => $qty, 'planned_start' => $start, 'planned_finish' => $finish,
                'responsible_id' => array_key_exists('responsible_id', $data) ? ($data['responsible_id'] ?? $user->id) : $mo->responsible_id,
                'priority' => $data['priority'] ?? $mo->priority,
                'notes' => array_key_exists('notes', $data) ? $this->text($data['notes']) : $mo->notes,
            ]);
            if ($replan) {
                $mo->components()->delete();
                $this->snapshotComponents($mo, $bom, $qty);
            }
            MrpLog::write($mo, 'UPDATED', $user, null, null, $replan ? 'Komponen dihitung ulang: BoM '.$bom->code.' revisi '.$bom->revision.' × '.MrpQty::show($qty) : null);

            return $mo->refresh();
        });
    }

    // ------------------------------------------------------------------ transitions

    /** Draft → Confirmed: the plan is locked and each component's free stock is held for this MO (as much as there is). */
    public function confirm(MrpProduction $mo, User $user): MrpProduction
    {
        return DB::transaction(function () use ($mo, $user) {
            $mo = $this->locked($mo, ['DRAFT'], 'MO ini sudah dikonfirmasi.');
            if ($mo->bom?->status === 'ARCHIVED') {
                // the MO keeps its own copy, but the user should know the BoM moved on
                $note = "Perhatian: BoM {$mo->bom_code} revisi {$mo->bom_revision} sudah diarsipkan; MO memakai salinan komponennya sendiri.";
            }
            if ($mo->components()->count() === 0) {
                throw ValidationException::withMessages(['components' => 'MO tidak punya komponen.']);
            }
            $mo->update(['status' => 'CONFIRMED', 'confirmed_at' => now(), 'confirmed_by' => $user->id]);
            MrpLog::write($mo, 'CONFIRMED', $user, 'DRAFT', 'CONFIRMED', $note ?? null);

            return $mo->refresh();
        });
    }

    public function start(MrpProduction $mo, User $user): MrpProduction
    {
        return $this->move($mo, $user, 'CONFIRMED', 'IN_PROGRESS', 'STARTED', fn () => ['started_at' => now(), 'started_by' => $user->id]);
    }

    /** In Progress → To Close: physically finished; needs a recorded result (good output, or the product scrapped). */
    public function finish(MrpProduction $mo, User $user): MrpProduction
    {
        return $this->move($mo, $user, 'IN_PROGRESS', 'TO_CLOSE', 'FINISHED', function (MrpProduction $mo) use ($user) {
            $hasResult = $mo->entries()->whereNull('voided_at')->where(fn ($q) => $q->where('kind', 'OUTPUT')
                ->orWhere(fn ($s) => $s->where('kind', 'SCRAP')->where('item_id', $mo->item_id)))->exists();
            if (! $hasResult) {
                throw ValidationException::withMessages(['entries' => 'Catat dulu hasil produksi (Finished Output) sebelum menandai selesai.']);
            }

            return ['finished_at' => now(), 'finished_by' => $user->id];
        });
    }

    /** To Close → In Progress: something still has to be recorded or corrected. */
    public function reopen(MrpProduction $mo, User $user, ?string $note = null): MrpProduction
    {
        return $this->move($mo, $user, 'TO_CLOSE', 'IN_PROGRESS', 'REOPENED', fn () => ['finished_at' => null, 'finished_by' => null], $note);
    }

    /**
     * To Close → Done, the only moment stock moves. One transaction under a row lock on the MO, so a second
     * click / request finds it DONE and is refused: never posted twice.
     */
    public function validate(MrpProduction $mo, User $user): MrpProduction
    {
        return DB::transaction(function () use ($mo, $user) {
            $mo = $this->locked($mo, ['TO_CLOSE'], $mo->status === 'DONE' ? 'MO ini sudah divalidasi.' : 'MO harus berstatus To Close sebelum divalidasi.');
            $entries = $mo->entries()->whereNull('voided_at')->whereNull('posted_at')->get();
            $issued = $this->gate->issued('MO', $mo->id);
            $received = $this->gate->received('MO', $mo->id);
            $missing = [];
            // 1. every component used / scrapped was handed over by the warehouse (Item Request → Delivery Order)
            foreach ($mo->components()->get() as $c) {
                $used = MrpQty::add($this->sum($entries->where('kind', 'CONSUME')->where('item_id', $c->item_id)), $this->sum($entries->where('kind', 'SCRAP')->where('item_id', $c->item_id)), 2);
                $got = $issued[(int) $c->item_id] ?? '0';
                if (MrpQty::cmp($used, $got) > 0) {
                    $missing[] = "{$c->product_code}: dipakai ".MrpQty::show($used).', diserahkan gudang '.MrpQty::show($got).' '.$c->base_unit;
                }
            }
            // 2. the good output came into the warehouse with a Receipt
            $output = $this->sum($entries->where('kind', 'OUTPUT'));
            $in = $received[(int) $mo->item_id] ?? '0';
            if (MrpQty::cmp($output, $in) > 0) {
                $missing[] = "{$mo->product_code}: hasil ".MrpQty::show($output).', diterima lewat Receipt '.MrpQty::show($in).' '.$mo->base_unit;
            }
            if ($missing !== []) {
                throw ValidationException::withMessages(['warehouse' => 'Barang harus lewat gudang: komponen diminta dengan Item Request dan diserahkan lewat Delivery Order, hasil diterima lewat Receipt. Belum lengkap: '.implode('; ', $missing).'.']);
            }
            // components still held by an MO confirmed before the rule
            foreach ($mo->components()->get() as $c) {
                $this->releaseAll($mo, (int) $c->item_id, $user, "{$mo->number} · selesai, pesanan dilepas");
                $c->update(['reserved_qty' => 0]);
            }

            MrpProductionEntry::whereIn('id', $entries->pluck('id'))->update(['posted_at' => now()]);
            $mo->update(['status' => 'DONE', 'done_at' => now(), 'done_by' => $user->id]);
            MrpLog::write($mo, 'VALIDATED', $user, 'TO_CLOSE', 'DONE', 'Hasil '.MrpQty::show($output).' '.$mo->base_unit.' · stok lewat Delivery Order & Receipt');

            return $mo->refresh();
        });
    }

    /** Ask the warehouse for the components still to get: one Item Request (verification → approvals → Delivery Order). */
    public function requestComponents(MrpProduction $mo, User $user): \App\Models\ItemRequest
    {
        if (! in_array($mo->status, ['CONFIRMED', 'IN_PROGRESS'], true)) {
            throw ValidationException::withMessages(['status' => 'Komponen diminta setelah MO dikonfirmasi dan sebelum selesai.']);
        }
        $asked = $this->gate->requested('MO', $mo->id);
        $lines = [];
        foreach ($mo->components()->where('is_extra', false)->get() as $c) {
            $lines[(int) $c->item_id] = MrpQty::max('0', MrpQty::sub(MrpQty::ceil2($c->required_qty), $asked[(int) $c->item_id] ?? '0', 2));
        }
        $made = $this->gate->requestItems('MO', $mo->id, $user, $mo->responsible, $lines, "Komponen untuk Manufacturing Order {$mo->number} ({$mo->product_code})");
        MrpLog::write($mo, 'COMPONENTS_REQUESTED', $user, null, null, "Item Request {$made->number}");

        return $made;
    }

    /** The Receipt (RI) the finished goods came into the warehouse with. */
    public function linkReceipt(MrpProduction $mo, User $user, string $noRi): MrpProduction
    {
        if (! in_array($mo->status, ['IN_PROGRESS', 'TO_CLOSE'], true)) {
            throw ValidationException::withMessages(['status' => 'Receipt dihubungkan saat MO In Progress atau To Close.']);
        }
        $this->gate->linkReceipt('MO', $mo->id, $user, $noRi, [(int) $mo->item_id], $mo->created_at);
        MrpLog::write($mo, 'RECEIPT_LINKED', $user, null, null, "Receipt {$noRi}");

        return $mo->refresh();
    }

    public function unlinkReceipt(MrpProduction $mo, User $user, string $noRi): MrpProduction
    {
        if (! in_array($mo->status, ['IN_PROGRESS', 'TO_CLOSE'], true)) {
            throw ValidationException::withMessages(['status' => 'Receipt hanya bisa dilepas sebelum MO divalidasi.']);
        }
        $this->gate->unlinkReceipt('MO', $mo->id, $noRi);
        MrpLog::write($mo, 'RECEIPT_UNLINKED', $user, null, null, "Receipt {$noRi}");

        return $mo->refresh();
    }

    /** Before Done: release what is held, void what was recorded (kept, marked), nothing was posted. */
    public function cancel(MrpProduction $mo, User $user, ?string $reason): MrpProduction
    {
        return DB::transaction(function () use ($mo, $user, $reason) {
            $mo = $this->locked($mo, ['DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'TO_CLOSE'],
                $mo->status === 'DONE' ? 'MO yang sudah Done tidak dibatalkan — gunakan Reverse.' : 'MO ini sudah dibatalkan.');
            $reason = $this->text($reason, 255);
            if ($mo->status !== 'DRAFT' && $reason === null) {
                throw ValidationException::withMessages(['reason' => 'Isi alasan pembatalan.']);
            }
            $from = $mo->status;
            foreach ($mo->components()->get() as $c) {
                $this->releaseAll($mo, $c->item_id, $user, "{$mo->number} · dibatalkan, pesanan dilepas");
                $c->update(['reserved_qty' => 0]);
            }
            $mo->entries()->whereNull('voided_at')->update(['voided_at' => now(), 'voided_by' => $user->id]);
            $mo->update(['status' => 'CANCELLED', 'cancelled_at' => now(), 'cancelled_by' => $user->id, 'cancel_reason' => $reason]);
            MrpLog::write($mo, 'CANCELLED', $user, $from, 'CANCELLED', $reason);

            return $mo->refresh();
        });
    }

    /**
     * Done → Cancelled by posting the exact opposite of every movement the MO made (MRP_REVERSE_IN / _OUT, same
     * warehouse, same qty). Refused once the MO is marked as entered in Accurate (reverse it there), and when the
     * finished goods are no longer in stock.
     */
    public function reverse(MrpProduction $mo, User $user, ?string $reason): MrpProduction
    {
        return DB::transaction(function () use ($mo, $user, $reason) {
            $mo = $this->locked($mo, ['DONE'], 'Hanya MO Done yang bisa dibalik.');
            if (! $mo->posting_batch) {
                throw ValidationException::withMessages(['status' => 'Stok MO ini bergerak lewat Delivery Order dan Receipt. Koreksi lewat dokumen gudang (Item Request / Receipt), bukan dari MO.']);
            }
            if ($mo->accurate_recorded_at) {
                throw ValidationException::withMessages(['status' => 'MO ini sudah ditandai tercatat di Accurate. Balik transaksinya di Accurate.']);
            }
            $reason = $this->text($reason, 255);
            if ($reason === null) {
                throw ValidationException::withMessages(['reason' => 'Isi alasan pembalikan.']);
            }
            $batch = (string) Str::uuid();
            $moves = DB::table('stock_movements')->where(['reference_type' => $mo->getMorphClass(), 'reference_id' => $mo->id])
                ->whereIn('movement_type', ['MRP_CONSUME', 'MRP_SCRAP', 'MRP_PRODUCE'])->orderBy('id')->get();
            // finished goods first: if they were used already, nothing is reversed at all
            foreach ($moves->where('movement_type', 'MRP_PRODUCE') as $m) {
                $inv = Inventory::where(['item_id' => $m->item_id, 'warehouse_id' => $m->warehouse_id])->lockForUpdate()->first();
                $free = MrpQty::sub($inv?->actual_qty ?? 0, $inv?->reserved_qty ?? 0);
                if (MrpQty::cmp($free, $m->qty) < 0) {
                    throw ValidationException::withMessages(['status' => "Hasil produksi {$mo->product_code} tinggal ".MrpQty::show($free).' di gudang (perlu '.MrpQty::show($m->qty).'). Tidak bisa dibalik.']);
                }
                $this->ledger->record(['type' => 'MRP_REVERSE_OUT', 'item_id' => $m->item_id, 'warehouse_id' => $m->warehouse_id, 'qty' => (float) $m->qty,
                    'reference' => $mo, 'note' => "{$mo->number} · balik hasil produksi", 'created_by' => $user->id, 'batch_uuid' => $batch]);
            }
            foreach ($moves->whereIn('movement_type', ['MRP_CONSUME', 'MRP_SCRAP']) as $m) {
                $this->ledger->record(['type' => 'MRP_REVERSE_IN', 'item_id' => $m->item_id, 'warehouse_id' => $m->warehouse_id, 'qty' => (float) $m->qty,
                    'reference' => $mo, 'note' => "{$mo->number} · balik ".($m->movement_type === 'MRP_SCRAP' ? 'scrap' : 'pemakaian'), 'created_by' => $user->id, 'batch_uuid' => $batch]);
            }
            $mo->update(['status' => 'CANCELLED', 'reversed_at' => now(), 'reversed_by' => $user->id, 'cancelled_at' => now(), 'cancelled_by' => $user->id, 'cancel_reason' => $reason]);
            MrpLog::write($mo, 'REVERSED', $user, 'DONE', 'CANCELLED', $reason);

            return $mo->refresh();
        });
    }

    /**
     * The production was entered in Accurate too (e.g. Delivery Order for the components, Receipt / item
     * adjustment for the product): from now on Accurate's qty carries it and StockwiseNet stops adding it.
     */
    public function markAccurate(MrpProduction $mo, User $user, ?string $refs): MrpProduction
    {
        return DB::transaction(function () use ($mo, $user, $refs) {
            $mo = $this->locked($mo, ['DONE'], 'Hanya MO Done yang bisa ditandai tercatat di Accurate.');
            if (! $mo->posting_batch) {
                throw ValidationException::withMessages(['status' => 'MO ini tidak memposting stok sendiri (lewat Delivery Order & Receipt); tidak perlu ditandai.']);
            }
            if ($mo->accurate_recorded_at) {
                throw ValidationException::withMessages(['status' => 'MO ini sudah ditandai tercatat di Accurate.']);
            }
            $refs = $this->text($refs, 255);
            if ($refs === null) {
                throw ValidationException::withMessages(['refs' => 'Isi nomor dokumen Accurate (mis. NPBG dan RI / penyesuaian).']);
            }
            $mo->update(['accurate_recorded_at' => now(), 'accurate_recorded_by' => $user->id, 'accurate_refs' => $refs]);
            MrpLog::write($mo, 'ACCURATE_RECORDED', $user, null, null, $refs);

            return $mo->refresh();
        });
    }

    // ------------------------------------------------------------------ entries

    /**
     * Record consumption / output / scrap while In Progress. Converted to Base UOM with the item's ratio of
     * this moment (frozen on the entry). Beyond the plan, or an item outside the BoM, only with mrp.validate
     * and a reason. The same client_key twice returns the first entry (a resent form is not recorded twice).
     *
     * @param  array{kind:string, item_id?:?int, qty:mixed, unit?:?string, entry_date?:?string, reason?:?string, note?:?string, client_key?:?string}  $data
     */
    public function addEntry(MrpProduction $mo, User $user, array $data): MrpProductionEntry
    {
        $key = $this->text($data['client_key'] ?? null, 64);
        if ($key && ($dup = MrpProductionEntry::where('client_key', $key)->first())) {
            if ((int) $dup->mrp_production_id !== (int) $mo->id) {
                throw ValidationException::withMessages(['client_key' => 'Kunci entri sudah dipakai.']);
            }

            return $dup;
        }

        return DB::transaction(function () use ($mo, $user, $data, $key) {
            $mo = $this->locked($mo, ['IN_PROGRESS'], 'Pencatatan hanya saat MO In Progress.');
            $kind = strtoupper((string) ($data['kind'] ?? ''));
            if (! in_array($kind, MrpProductionEntry::KINDS, true)) {
                throw ValidationException::withMessages(['kind' => 'Jenis catatan tidak dikenal.']);
            }
            $itemId = $kind === 'OUTPUT' ? (int) $mo->item_id : (int) ($data['item_id'] ?? 0);
            $item = Item::find($itemId);
            if (! $item) {
                throw ValidationException::withMessages(['item_id' => 'Pilih barangnya.']);
            }
            if (! $item->unit_id) {
                throw ValidationException::withMessages(['item_id' => "{$item->code} belum punya Base UOM."]);
            }
            $base = Unit::find($item->unit_id);
            $item->setRelation('unit', $base);

            // what was typed → Base UOM, with the ratio of now (never guessed: no ratio, no entry)
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

            $component = null;
            $overPlan = false;
            $reason = $this->text($data['reason'] ?? null, 255);
            $canOverride = $user->hasPermission('mrp.validate');
            $planned = $mo->components()->where('item_id', $itemId)->first();

            if ($kind === 'CONSUME') {
                if ($itemId === (int) $mo->item_id) {
                    throw ValidationException::withMessages(['item_id' => 'Produk jadi tidak bisa dicatat sebagai pemakaian komponen.']);
                }
                if (! $planned) {
                    $this->assertOverride($canOverride, $reason, "{$item->code} tidak ada di BoM MO ini");
                    $planned = $mo->components()->create([
                        'item_id' => $item->id, 'product_code' => $item->code, 'description' => $item->description, 'base_unit' => $base->code,
                        'qty_per_unit' => 0, 'required_qty' => 0, 'reserved_qty' => 0, 'is_extra' => true,
                        'sort' => (int) $mo->components()->max('sort') + 1,
                    ]);
                    $overPlan = true;
                } else {
                    $after = MrpQty::add($this->recorded($mo, 'CONSUME', $itemId), $baseQty);
                    if (MrpQty::cmp($after, $planned->required_qty) > 0) {
                        $this->assertOverride($canOverride, $reason, "Pemakaian {$item->code} menjadi ".MrpQty::show($after).' '.$base->code.', melebihi kebutuhan '.MrpQty::show($planned->required_qty));
                        $overPlan = true;
                    }
                }
                $component = $planned;
            } elseif ($kind === 'OUTPUT') {
                $after = MrpQty::add($this->recorded($mo, 'OUTPUT', $itemId), $baseQty);
                if (MrpQty::cmp($after, $mo->planned_qty) > 0) {
                    $this->assertOverride($canOverride, $reason, 'Hasil menjadi '.MrpQty::show($after).' '.$base->code.', melebihi rencana '.MrpQty::show($mo->planned_qty));
                    $overPlan = true;
                }
            } else { // SCRAP: a component (leaves stock at validation) or the finished product (rejected output, never entered stock)
                if ($reason === null) {
                    throw ValidationException::withMessages(['reason' => 'Isi alasan scrap.']);
                }
                if ($itemId !== (int) $mo->item_id) {
                    if (! $planned) {
                        $this->assertOverride($canOverride, $reason, "{$item->code} tidak ada di BoM MO ini");
                        $planned = $mo->components()->create([
                            'item_id' => $item->id, 'product_code' => $item->code, 'description' => $item->description, 'base_unit' => $base->code,
                            'qty_per_unit' => 0, 'required_qty' => 0, 'reserved_qty' => 0, 'is_extra' => true,
                            'sort' => (int) $mo->components()->max('sort') + 1,
                        ]);
                        $overPlan = true;
                    }
                    $component = $planned;
                }
            }

            $entry = $mo->entries()->create([
                'kind' => $kind, 'item_id' => $item->id, 'component_id' => $component?->id,
                'qty' => $qty, 'unit' => $unit->code, 'unit_ratio' => $ratio, 'base_qty' => $baseQty, 'base_unit' => $base->code,
                'entry_date' => isset($data['entry_date']) ? Carbon::parse($data['entry_date'])->toDateString() : now()->toDateString(),
                'reason' => $reason, 'note' => $this->text($data['note'] ?? null),
                'over_plan' => $overPlan, 'client_key' => $key, 'recorded_by' => $user->id,
            ]);
            $label = ['CONSUME' => 'Pemakaian', 'OUTPUT' => 'Hasil', 'SCRAP' => 'Scrap'][$kind];
            MrpLog::write($mo, "ENTRY_{$kind}", $user, null, null, "{$label} {$item->code} ".MrpQty::show($qty)." {$unit->code}"
                .($unit->id !== $base->id ? ' = '.MrpQty::show($baseQty)." {$base->code}" : '').($overPlan ? ' · di luar rencana' : '').($reason ? " · {$reason}" : ''));

            return $entry;
        });
    }

    /** A mistyped entry, before it is posted: voided (kept for audit), not deleted. */
    public function voidEntry(MrpProductionEntry $entry, User $user): MrpProductionEntry
    {
        return DB::transaction(function () use ($entry, $user) {
            $mo = $this->locked($entry->production, ['IN_PROGRESS'], 'Catatan hanya bisa dibatalkan saat MO In Progress.');
            $entry = MrpProductionEntry::lockForUpdate()->findOrFail($entry->id);
            if ($entry->posted_at || $entry->voided_at) {
                throw ValidationException::withMessages(['entry' => 'Catatan ini sudah diposting atau dibatalkan.']);
            }
            if ((int) $entry->recorded_by !== (int) $user->id && ! $user->hasPermission('mrp.validate')) {
                throw ValidationException::withMessages(['entry' => 'Hanya pencatat atau pemegang izin validasi yang bisa membatalkan catatan ini.']);
            }
            $entry->update(['voided_at' => now(), 'voided_by' => $user->id]);
            MrpLog::write($mo, 'ENTRY_VOIDED', $user, null, null, "{$entry->kind} #{$entry->id} ".MrpQty::show($entry->qty)." {$entry->unit}");

            return $entry->refresh();
        });
    }

    // ------------------------------------------------------------------ availability

    /**
     * Per component: required, on hand, held for this MO, held for others, free, shortage — all from
     * STOCKWISE's inventory (which follows Accurate's qty at every sync), in Base UOM.
     *
     * @return list<array<string, mixed>>
     */
    public function availability(MrpProduction $mo): array
    {
        $components = $mo->components()->get();
        $ids = $components->pluck('item_id')->all();
        $inv = Inventory::whereIn('item_id', $ids)->groupBy('item_id')
            ->selectRaw('item_id, SUM(actual_qty) actual, SUM(reserved_qty) reserved, MAX(stock_known) known')->get()->keyBy('item_id');
        $items = Item::whereIn('id', $ids)->get(['id', 'accurate_qty_onhand', 'accurate_synced_at', 'manage_sn'])->keyBy('id');
        $entries = $mo->entries()->whereNull('voided_at')->get();
        $open = in_array($mo->status, ['DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'TO_CLOSE'], true);
        $issued = $this->gate->issued('MO', $mo->id);
        $asked = $this->gate->requested('MO', $mo->id);

        return $components->map(function (MrpProductionComponent $c) use ($inv, $items, $mo, $entries, $open, $issued, $asked) {
            $row = $inv->get($c->item_id);
            $actual = MrpQty::dec($row->actual ?? 0);
            $reservedAll = MrpQty::dec($row->reserved ?? 0);
            $mine = array_reduce($this->held($mo, $c->item_id), fn ($s, $q) => MrpQty::add($s, $q), '0');
            $free = MrpQty::sub($actual, $reservedAll);
            $usable = MrpQty::add($free, $mine);
            $consumed = $this->sum($entries->where('kind', 'CONSUME')->where('item_id', $c->item_id));
            $scrapped = $this->sum($entries->where('kind', 'SCRAP')->where('item_id', $c->item_id));
            // what the MO still needs from the warehouse: the plan (or what was recorded, if more) minus what was handed over
            $got = $issued[(int) $c->item_id] ?? '0';
            $need = MrpQty::max('0', MrpQty::sub(MrpQty::max($c->required_qty, MrpQty::add($consumed, $scrapped)), $got));
            $shortage = $open ? MrpQty::max('0', MrpQty::sub($need, $usable)) : '0';
            $known = (bool) ($row->known ?? false);

            return [
                'component_id' => $c->id, 'item_id' => $c->item_id, 'code' => $c->product_code, 'description' => $c->description,
                'base_unit' => $c->base_unit, 'qty_per_unit' => MrpQty::num($c->qty_per_unit), 'required' => MrpQty::num($c->required_qty),
                'on_hand' => MrpQty::num($actual), 'reserved_for_mo' => MrpQty::num($mine), 'reserved_other' => MrpQty::num(MrpQty::sub($reservedAll, $mine)),
                'free' => MrpQty::num($free), 'available_for_mo' => MrpQty::num($usable),
                'consumed' => MrpQty::num($consumed), 'scrapped' => MrpQty::num($scrapped),
                'shortage' => MrpQty::num($shortage), 'is_extra' => $c->is_extra,
                'issued' => MrpQty::num($got), 'requested' => MrpQty::num($asked[(int) $c->item_id] ?? '0'),
                'stock_known' => $known,
                'status' => ! $open ? 'CLOSED' : (! $known ? 'UNKNOWN' : (MrpQty::cmp($shortage, '0') > 0 ? (MrpQty::cmp($usable, '0') > 0 ? 'PARTIAL' : 'SHORT') : 'OK')),
                'accurate_qty' => isset($items[$c->item_id]) ? MrpQty::num($items[$c->item_id]->accurate_qty_onhand ?? 0) : null,
                'accurate_synced_at' => ($at = $items[$c->item_id]?->accurate_synced_at) ? Carbon::parse($at)->toIso8601String() : null,
            ];
        })->values()->all();
    }

    /**
     * The shortage goes to the normal purchasing flow: one Draft Purchase Request (PpbDraftService::restock), then
     * Purchase Request approval → PO → Receipt as usual. Nothing is added to stock here.
     */
    public function requestShortage(MrpProduction $mo, User $user): \App\Models\PpbDraft
    {
        if (! in_array($mo->status, ['DRAFT', 'CONFIRMED', 'IN_PROGRESS'], true)) {
            throw ValidationException::withMessages(['status' => 'Kekurangan hanya bisa diajukan untuk MO yang masih berjalan.']);
        }
        $picked = collect($this->availability($mo))->filter(fn ($r) => $r['shortage'] > 0)
            ->map(fn ($r) => ['item_id' => $r['item_id'], 'qty' => (float) MrpQty::ceil2($r['shortage'])])->values()->all();
        if ($picked === []) {
            throw ValidationException::withMessages(['components' => 'Tidak ada komponen yang kurang.']);
        }
        $draft = app(\App\Services\PpbDraftService::class)->restock($user, $picked);
        $draft->update(['keterangan' => "Kekurangan komponen {$mo->number} ({$mo->product_code})"]);
        foreach ($draft->lines()->get() as $line) {
            $line->update(['basis' => "Kekurangan untuk {$mo->number}: ".MrpQty::show($line->qty).' '.$line->satuan]);
        }
        MrpLog::write($mo, 'SHORTAGE_REQUESTED', $user, null, null, "Draft Purchase Request {$draft->number}");

        return $draft->refresh();
    }

    // ------------------------------------------------------------------ internals

    private function bomFor(array $data): MrpBom
    {
        $bom = ! empty($data['bom_id']) ? MrpBom::find((int) $data['bom_id'])
            : (! empty($data['item_id']) ? BomService::activeFor((int) $data['item_id']) : null);
        if (! $bom) {
            throw ValidationException::withMessages(['bom_id' => 'Produk ini belum punya BoM aktif.']);
        }
        if ($bom->status !== 'ACTIVE') {
            throw ValidationException::withMessages(['bom_id' => "BoM {$bom->code} berstatus {$bom->status}; MO hanya dari BoM aktif."]);
        }
        $bom->load('item');

        return $bom;
    }

    private function snapshotComponents(MrpProduction $mo, MrpBom $bom, string $qty): void
    {
        $lines = $bom->lines()->with('item:id,code,description,unit_id')->get();
        $units = Unit::whereIn('id', $lines->pluck('item.unit_id')->filter()->all())->pluck('code', 'id');
        foreach ($lines as $i => $l) {
            $mo->components()->create([
                'item_id' => $l->item_id, 'product_code' => $l->item?->code, 'description' => $l->item?->description,
                'base_unit' => $units[$l->item?->unit_id] ?? $l->base_unit,
                'qty_per_unit' => MrpQty::dec($l->qty), 'required_qty' => MrpQty::mul($l->qty, $qty),
                'reserved_qty' => 0, 'is_extra' => false, 'sort' => $i,
            ]);
        }
    }

    /** Re-reads the MO under a row lock and checks its status: the backend guard of every transition. */
    private function locked(MrpProduction $mo, array $allowed, string $message): MrpProduction
    {
        $fresh = MrpProduction::lockForUpdate()->findOrFail($mo->id);
        if (! in_array($fresh->status, $allowed, true)) {
            throw ValidationException::withMessages(['status' => $message]);
        }

        return $fresh;
    }

    private function move(MrpProduction $mo, User $user, string $from, string $to, string $action, callable $fields, ?string $note = null): MrpProduction
    {
        if (! in_array($to, self::TRANSITIONS[$from] ?? [], true)) {
            throw ValidationException::withMessages(['status' => "Perpindahan {$from} → {$to} tidak diizinkan."]);
        }

        return DB::transaction(function () use ($mo, $user, $from, $to, $action, $fields, $note) {
            $mo = $this->locked($mo, [$from], "MO harus berstatus {$from} untuk langkah ini (sekarang {$mo->fresh()->status}).");
            $mo->update(['status' => $to] + $fields($mo));
            MrpLog::write($mo, $action, $user, $from, $to, $this->text($note, 500));

            return $mo->refresh();
        });
    }

    /** Hold up to the component's requirement (rounded up to 0.01) from the free stock, most free warehouse first. */
    private function reserve(MrpProduction $mo, MrpProductionComponent $c, User $user): void
    {
        $left = MrpQty::sub(MrpQty::ceil2($c->required_qty), $c->reserved_qty);
        $held = MrpQty::dec($c->reserved_qty);
        if (MrpQty::cmp($left, '0') <= 0) {
            return;
        }
        $rows = Inventory::where('item_id', $c->item_id)->lockForUpdate()->get()
            ->sortByDesc(fn ($inv) => (float) $inv->actual_qty - (float) $inv->reserved_qty);
        foreach ($rows as $inv) {
            $take = MrpQty::floor2(MrpQty::min($left, MrpQty::sub($inv->actual_qty, $inv->reserved_qty)));
            if (MrpQty::cmp($take, '0') <= 0) {
                continue;
            }
            $this->ledger->record(['type' => 'RESERVATION', 'item_id' => $c->item_id, 'warehouse_id' => $inv->warehouse_id,
                'qty' => (float) $take, 'reserve_delta' => (float) $take, 'reference' => $mo, 'note' => "{$mo->number} · komponen dipesan", 'created_by' => $user->id]);
            $held = MrpQty::add($held, $take, 2);
            $left = MrpQty::sub($left, $take, 2);
            if (MrpQty::cmp($left, '0') <= 0) {
                break;
            }
        }
        $c->update(['reserved_qty' => $held]);
    }

    /** @return array<int, string> warehouse id => qty still held for this MO */
    private function held(MrpProduction $mo, int $itemId): array
    {
        return DB::table('stock_movements')->where(['reference_type' => $mo->getMorphClass(), 'reference_id' => $mo->id, 'item_id' => $itemId])
            ->whereIn('movement_type', ['RESERVATION', 'RELEASE_RESERVATION'])->groupBy('warehouse_id')
            ->selectRaw("warehouse_id, SUM(CASE WHEN movement_type = 'RESERVATION' THEN qty ELSE -qty END) q")->get()
            ->filter(fn ($r) => (float) $r->q > 0.000001)->mapWithKeys(fn ($r) => [(int) $r->warehouse_id => MrpQty::dec($r->q)])->all();
    }

    private function releaseAll(MrpProduction $mo, int $itemId, User $user, string $note, ?string $batch = null): void
    {
        foreach ($this->held($mo, $itemId) as $wh => $q) {
            $inv = Inventory::where(['item_id' => $itemId, 'warehouse_id' => $wh])->lockForUpdate()->first();
            // never more than the warehouse still holds (an Accurate sync may have lowered it)
            $rel = MrpQty::floor2(MrpQty::min($q, $inv?->reserved_qty ?? 0));
            if (MrpQty::cmp($rel, '0') > 0) {
                $this->ledger->record(['type' => 'RELEASE_RESERVATION', 'item_id' => $itemId, 'warehouse_id' => $wh, 'qty' => (float) $rel,
                    'reserve_delta' => -(float) $rel, 'reference' => $mo, 'note' => $note, 'created_by' => $user->id, 'batch_uuid' => $batch]);
            }
        }
    }

    /** qty leaves the stock: the warehouses that held it first, then the most free one. Refused if it is not all there. */
    private function takeOut(MrpProduction $mo, int $itemId, string $qty, string $type, array $prefer, User $user, string $note, string $batch, ?string $code): void
    {
        $rows = Inventory::where('item_id', $itemId)->lockForUpdate()->get()
            ->sortByDesc(fn ($inv) => [in_array((int) $inv->warehouse_id, $prefer, true) ? 1 : 0, (float) $inv->actual_qty - (float) $inv->reserved_qty]);
        $free = $rows->reduce(fn ($s, $inv) => MrpQty::add($s, MrpQty::max('0', MrpQty::sub($inv->actual_qty, $inv->reserved_qty))), '0');
        if (MrpQty::cmp($free, $qty) < 0) {
            throw ValidationException::withMessages(['stock' => "Stok {$code} tidak cukup: perlu ".MrpQty::show($qty).', tersedia '.MrpQty::show($free).'. Tidak ada yang diposting.']);
        }
        $left = MrpQty::dec($qty);
        foreach ($rows as $inv) {
            $take = MrpQty::floor2(MrpQty::min($left, MrpQty::sub($inv->actual_qty, $inv->reserved_qty)));
            if (MrpQty::cmp($take, '0') <= 0) {
                continue;
            }
            $this->ledger->record(['type' => $type, 'item_id' => $itemId, 'warehouse_id' => $inv->warehouse_id, 'qty' => (float) $take,
                'reference' => $mo, 'note' => $note, 'created_by' => $user->id, 'batch_uuid' => $batch]);
            $left = MrpQty::sub($left, $take, 2);
            if (MrpQty::cmp($left, '0') <= 0) {
                return;
            }
        }
    }

    private function outputWarehouse(Item $product): int
    {
        $id = $product->default_warehouse_id ?: Warehouse::query()->orderBy('id')->value('id');
        if (! $id) {
            throw ValidationException::withMessages(['stock' => 'Belum ada gudang untuk menerima hasil produksi.']);
        }

        return (int) $id;
    }

    private function recorded(MrpProduction $mo, string $kind, int $itemId): string
    {
        return $this->sum($mo->entries()->whereNull('voided_at')->where('kind', $kind)->where('item_id', $itemId)->get());
    }

    private function sum(Collection $entries): string
    {
        return $entries->reduce(fn ($s, $e) => MrpQty::add($s, $e->base_qty, 2), '0');
    }

    private function assertOverride(bool $canOverride, ?string $reason, string $what): void
    {
        if (! $canOverride) {
            throw ValidationException::withMessages(['qty' => "{$what}. Perlu persetujuan pemegang izin validasi (mrp.validate)."]);
        }
        if ($reason === null) {
            throw ValidationException::withMessages(['reason' => "{$what}. Isi alasannya."]);
        }
    }

    private function assertDates(?string $start, ?string $finish): void
    {
        if ($start && $finish && Carbon::parse($finish)->lt(Carbon::parse($start))) {
            throw ValidationException::withMessages(['planned_finish' => 'Tanggal selesai tidak boleh sebelum tanggal mulai.']);
        }
    }

    private function text(mixed $v, int $max = 2000): ?string
    {
        $s = trim((string) ($v ?? ''));

        return $s === '' ? null : mb_substr($s, 0, $max);
    }
}
