<?php

namespace App\Services;

use App\Http\Controllers\Api\PublicItemRequestController;
use App\Models\Item;
use App\Models\ItemRequest;
use App\Models\Unit;
use App\Models\User;
use App\Services\Mrp\MrpQty;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * The warehouse is the only door for goods:
 *   out  Item Request → (verification, approvals) → Delivery Order (NPBG) → handover  — the stock leaves there
 *   in   Receipt (RI)                                                              — the stock enters there
 * A Manufacturing / Disassembly Order never moves stock itself: it asks for its goods through an Item Request and
 * points at the Receipt(s) its output came in with. This keeps those links (warehouse_gate_links) and reads what
 * was really handed over / received.
 */
final class WarehouseGate
{
    public const OWNERS = ['MO', 'DSA'];

    public function __construct(private readonly ItemRequestService $requests) {}

    /** Until the warehouse_gate_links migration has run, an order simply has no links (pages keep working). */
    private static function ready(): bool
    {
        static $ready = null;

        return $ready ??= \Illuminate\Support\Facades\Schema::hasTable('warehouse_gate_links');
    }

    /**
     * One Item Request for the goods an order needs from the warehouse, made for the order's responsible person
     * and typed by $user; it then follows the normal Item Request flow.
     *
     * @param  array<int, string>  $lines  item id => qty in the item's Base UOM
     */
    public function requestItems(string $owner, int $ownerId, User $user, ?User $requester, array $lines, string $note): ItemRequest
    {
        $lines = array_filter($lines, fn ($q) => MrpQty::cmp($q, '0') > 0);
        if ($lines === []) {
            throw ValidationException::withMessages(['lines' => 'Tidak ada barang yang perlu diminta lagi.']);
        }
        $items = Item::whereIn('id', array_keys($lines))->get()->keyBy('id');
        $units = Unit::whereIn('id', $items->pluck('unit_id')->filter()->all())->pluck('code', 'id');
        $person = $requester ?? $user;
        $profile = PublicItemRequestController::profile($person);

        return DB::transaction(function () use ($owner, $ownerId, $user, $person, $profile, $lines, $items, $units, $note) {
            $made = $this->requests->create(
                ['id' => $person->id, 'name' => $profile['name'] ?: $person->name, 'contact' => $profile['contact'], 'ip' => request()?->ip()],
                ['divisi' => $profile['divisi'], 'note' => $note, 'lines' => collect($lines)->map(fn ($q, $id) => [
                    'item_id' => (int) $id, 'deskripsi_barang' => $items[$id]->description ?? $items[$id]->code ?? "#{$id}",
                    'qty' => MrpQty::show($q), 'satuan' => $units[$items[$id]->unit_id ?? 0] ?? null,
                ])->values()->all()],
            );
            if ((int) $person->id !== (int) $user->id) {
                $made->update(['entered_by' => $user->id]);
            }
            DB::table('warehouse_gate_links')->insert(['owner_type' => $owner, 'owner_id' => $ownerId, 'item_request_id' => $made->id,
                'created_by' => $user->id, 'created_at' => now(), 'updated_at' => now()]);

            return $made;
        });
    }

    /** @return array<int, string> item id => qty handed over through the order's Item Requests (Base UOM) */
    public function issued(string $owner, int $ownerId): array
    {
        return $this->lineSums($owner, $ownerId, 'COALESCE(l.fulfilled_qty, 0)');
    }

    /** @return array<int, string> item id => qty asked in the order's Item Requests still alive (not rejected / cancelled) */
    public function requested(string $owner, int $ownerId): array
    {
        return $this->lineSums($owner, $ownerId, 'l.qty', true);
    }

    /** @return list<array{id:int, number:string, status:string}> */
    public function requests(string $owner, int $ownerId): array
    {
        if (! self::ready()) {
            return [];
        }
        return DB::table('warehouse_gate_links as g')->join('item_requests as r', 'r.id', '=', 'g.item_request_id')
            ->where(['g.owner_type' => $owner, 'g.owner_id' => $ownerId])->orderBy('r.id')
            ->get(['r.id', 'r.number', 'r.status'])->map(fn ($r) => ['id' => (int) $r->id, 'number' => $r->number, 'status' => $r->status])->all();
    }

    /**
     * Point the order at a Receipt its goods came in with: a STOCKWISE RI (not a purchase / Accurate one), made
     * after the order, of the order's items only, not used by another order.
     *
     * @param  list<int>  $itemIds  the items the order may receive
     */
    public function linkReceipt(string $owner, int $ownerId, User $user, string $noRi, array $itemIds, Carbon $since): void
    {
        $noRi = trim($noRi);
        $rows = DB::table('ri')->where('no_ri', $noRi)->get(['id', 'kode_barang', 'accurate_apinvoice_id', 'created_by', 'sumber', 'created_at']);
        if ($rows->isEmpty()) {
            throw ValidationException::withMessages(['no_ri' => "Receipt {$noRi} tidak ditemukan."]);
        }
        if ($rows->contains(fn ($r) => $r->accurate_apinvoice_id !== null || $r->created_by === null || $r->sumber === 'PO')) {
            throw ValidationException::withMessages(['no_ri' => "Receipt {$noRi} adalah penerimaan pembelian, bukan penerimaan hasil dokumen ini."]);
        }
        if ($rows->contains(fn ($r) => Carbon::parse($r->created_at)->lt($since))) {
            throw ValidationException::withMessages(['no_ri' => "Receipt {$noRi} dibuat sebelum dokumen ini."]);
        }
        $allowed = Item::whereIn('id', $itemIds)->pluck('code')->map(fn ($c) => mb_strtoupper((string) $c))->all();
        $foreign = $rows->pluck('kode_barang')->map(fn ($c) => mb_strtoupper((string) $c))->reject(fn ($c) => in_array($c, $allowed, true))->unique();
        if ($foreign->isNotEmpty()) {
            throw ValidationException::withMessages(['no_ri' => "Receipt {$noRi} berisi barang di luar dokumen ini: ".$foreign->implode(', ').'.']);
        }
        $used = DB::table('warehouse_gate_links')->where('no_ri', $noRi)->first();
        if ($used) {
            throw ValidationException::withMessages(['no_ri' => "Receipt {$noRi} sudah dipakai dokumen lain ({$used->owner_type} #{$used->owner_id})."]);
        }
        DB::table('warehouse_gate_links')->insert(['owner_type' => $owner, 'owner_id' => $ownerId, 'no_ri' => $noRi,
            'created_by' => $user->id, 'created_at' => now(), 'updated_at' => now()]);
    }

    public function unlinkReceipt(string $owner, int $ownerId, string $noRi): void
    {
        DB::table('warehouse_gate_links')->where(['owner_type' => $owner, 'owner_id' => $ownerId, 'no_ri' => trim($noRi)])->delete();
    }

    /** @return array<int, string> item id => qty received through the order's Receipts (Base UOM) */
    public function received(string $owner, int $ownerId): array
    {
        if (! self::ready()) {
            return [];
        }
        $nos = DB::table('warehouse_gate_links')->where(['owner_type' => $owner, 'owner_id' => $ownerId])->whereNotNull('no_ri')->pluck('no_ri');
        if ($nos->isEmpty()) {
            return [];
        }

        return DB::table('ri')->join('items', 'items.code', '=', 'ri.kode_barang')->whereIn('ri.no_ri', $nos->all())
            ->groupBy('items.id')->selectRaw('items.id, SUM(ri.kuantitas * COALESCE(ri.unit_ratio, 1)) q')->pluck('q', 'id')
            ->mapWithKeys(fn ($q, $id) => [(int) $id => MrpQty::dec($q)])->all();
    }

    /** @return list<array{no_ri:string, id:int, lines:list<array{code:?string, description:?string, qty:float, unit:?string}>}> */
    public function receipts(string $owner, int $ownerId): array
    {
        if (! self::ready()) {
            return [];
        }
        $nos = DB::table('warehouse_gate_links')->where(['owner_type' => $owner, 'owner_id' => $ownerId])->whereNotNull('no_ri')->orderBy('id')->pluck('no_ri');

        return $nos->map(function ($no) {
            $rows = DB::table('ri')->where('no_ri', $no)->orderBy('id')->get(['id', 'kode_barang', 'deskripsi_barang', 'kuantitas', 'satuan']);

            return ['no_ri' => $no, 'id' => (int) ($rows->first()->id ?? 0), 'lines' => $rows->map(fn ($r) => [
                'code' => $r->kode_barang, 'description' => $r->deskripsi_barang, 'qty' => (float) $r->kuantitas, 'unit' => $r->satuan,
            ])->all()];
        })->all();
    }

    private function lineSums(string $owner, int $ownerId, string $expr, bool $aliveOnly = false): array
    {
        if (! self::ready()) {
            return [];
        }
        return DB::table('warehouse_gate_links as g')->join('item_requests as r', 'r.id', '=', 'g.item_request_id')
            ->join('item_request_lines as l', 'l.item_request_id', '=', 'r.id')
            ->where(['g.owner_type' => $owner, 'g.owner_id' => $ownerId])->whereNotNull('l.item_id')
            ->when($aliveOnly, fn ($q) => $q->whereNotIn('r.status', ['DITOLAK', 'DIBATALKAN'])->where(fn ($w) => $w->whereNull('l.decision')->orWhere('l.decision', '!=', 'TOLAK')))
            ->groupBy('l.item_id')->selectRaw("l.item_id, SUM({$expr}) q")->pluck('q', 'item_id')
            ->mapWithKeys(fn ($q, $id) => [(int) $id => MrpQty::dec($q)])->all();
    }
}
