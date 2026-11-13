<?php

namespace App\Services;

use App\Support\RiSerials;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\ValidationException;

/**
 * The serial numbers of an item still in the warehouse, from both sides kept in step:
 *   Accurate: a serial whose history (SNHISTORY, +1 in / −1 out) sums above zero;
 *   STOCKWISE: serials received by an RI made here, minus serials given out by an NPBG made here.
 * One serial = one unit (Accurate keeps QUANTITY 1 per serial, a pack range included).
 */
class SerialStock
{
    /**
     * @return list<array{serial:string, source:string, expired:?string}>
     */
    public function available(string $code, ?int $exceptNpbgId = null, ?int $exceptRequestId = null): array
    {
        $in = [];
        if (Schema::hasTable('accurate_serialnumbers') && Schema::hasTable('accurate_snhistory')) {
            $rows = DB::table('accurate_serialnumbers as s')
                ->join('accurate_snhistory as h', 'h.SNID', '=', 's.SNID')
                ->where('s.ITEMNO', $code)
                ->groupBy('s.SNID', 's.SERIALNUMBER', 's.EXPIREDDATE')
                ->havingRaw('SUM(h.SNSIGN * h.QUANTITY) > 0')
                ->orderBy('s.SERIALNUMBER')
                ->get(['s.SERIALNUMBER as serial', 's.EXPIREDDATE as expired']);
            foreach ($rows as $r) {
                $in[self::key($r->serial)] = ['serial' => trim((string) $r->serial), 'source' => 'ACCURATE', 'expired' => $r->expired ? substr((string) $r->expired, 0, 10) : null];
            }
        }
        // received here (an RI not from Accurate)
        foreach (DB::table('ri')->whereNull('accurate_synced_at')->where('kode_barang', $code)->whereNotNull('no_seri')->pluck('no_seri') as $text) {
            foreach (RiSerials::split($text) as $s) {
                $in[self::key($s)] ??= ['serial' => $s, 'source' => 'RI', 'expired' => null];
            }
        }
        // given out here (an NPBG not from Accurate); the NPBG being edited keeps its own
        $out = DB::table('npbg')->whereNull('accurate_synced_at')->where('kode_barang', $code)->whereNotNull('no_seri')
            ->when($exceptNpbgId, fn ($q, $id) => $q->where('id', '!=', $id))->pluck('no_seri');
        foreach ($out as $text) {
            foreach (RiSerials::split($text) as $s) {
                unset($in[self::key($s)]);
            }
        }

        // held by an Item Request still open (picked while verifying); the request being worked on keeps its own
        foreach (self::held($code, $exceptRequestId) as $s) {
            unset($in[self::key($s)]);
        }

        return array_values($in);
    }

    /** serials of this item picked on the lines of open Item Requests (verified, not finished / rejected / cancelled) */
    public static function held(string $code, ?int $exceptRequestId = null): array
    {
        static $hasColumn = null;
        $hasColumn ??= Schema::hasColumn('item_request_lines', 'serials');
        if (! $hasColumn) {
            return [];
        }
        $rows = DB::table('item_request_lines as l')->join('item_requests as r', 'r.id', '=', 'l.item_request_id')
            ->where('l.kode_barang', $code)->whereNotNull('l.serials')->whereNull('l.closed_at')
            ->whereNotIn('r.status', ['SELESAI', 'DITOLAK', 'DIBATALKAN'])
            ->when($exceptRequestId, fn ($q, $id) => $q->where('r.id', '!=', $id))
            ->pluck('l.serials');

        return $rows->flatMap(fn ($t) => RiSerials::split($t))->all();
    }

    /**
     * The serials picked for an item going out: one per unit (a whole quantity), each once, each still in stock.
     *
     * @return list<string>
     */
    public function pick(string $code, float $qty, array $picked, ?int $exceptNpbgId = null, string $field = 'serials', ?int $exceptRequestId = null): array
    {
        $list = array_values(array_filter(array_map(fn ($s) => trim((string) $s), $picked), fn ($s) => $s !== ''));
        if (floor($qty) !== $qty) {
            throw ValidationException::withMessages([$field => "{$code} memakai nomor seri: jumlah harus bulat."]);
        }
        if (count($list) !== (int) $qty) {
            throw ValidationException::withMessages([$field => "{$code} memakai nomor seri: pilih ".(int) $qty.' nomor seri (sekarang '.count($list).').']);
        }
        if ($twice = RiSerials::firstRepeated($list)) {
            throw ValidationException::withMessages([$field => "Nomor seri {$twice} dipilih lebih dari sekali."]);
        }
        $stock = collect($this->available($code, $exceptNpbgId, $exceptRequestId))->keyBy(fn ($s) => self::key($s['serial']));
        $missing = collect($list)->reject(fn ($s) => $stock->has(self::key($s)))->values();
        if ($missing->isNotEmpty()) {
            throw ValidationException::withMessages([$field => "{$code}: nomor seri tidak ada di stok / sudah keluar: ".$missing->take(5)->implode(', ').'.']);
        }

        return $list;
    }

    /** item codes of these that go out by serial number (none until the Master Barang has the flag) */
    public static function managedCodes(iterable $codes): array
    {
        static $hasColumn = null;
        $hasColumn ??= Schema::hasColumn('items', 'manage_sn');
        $codes = collect($codes)->filter()->unique()->values();
        if (! $hasColumn || $codes->isEmpty()) {
            return [];
        }

        return \App\Models\Item::whereIn('code', $codes)->where('manage_sn', true)->pluck('code')->all();
    }

    /**
     * Every serial number known for an item and where it is now: in stock, held by an open Item Request
     * (picked while verifying), or out (an NPBG made here, or Accurate's history at zero).
     *
     * @return list<array<string, mixed>>
     */
    public function ledger(string $code): array
    {
        $rows = [];
        $put = function (string $serial, array $fields) use (&$rows) {
            $k = self::key($serial);
            $rows[$k] = array_merge($rows[$k] ?? ['serial' => trim($serial), 'status' => 'IN_STOCK', 'source' => 'ACCURATE', 'expired' => null,
                'in_doc' => null, 'in_date' => null, 'out_doc' => null, 'out_date' => null, 'out_to' => null, 'request' => null], $fields);
        };
        if (Schema::hasTable('accurate_serialnumbers') && Schema::hasTable('accurate_snhistory')) {
            $acc = DB::table('accurate_serialnumbers as s')->leftJoin('accurate_snhistory as h', 'h.SNID', '=', 's.SNID')
                ->where('s.ITEMNO', $code)->groupBy('s.SNID', 's.SERIALNUMBER', 's.EXPIREDDATE')
                ->get(['s.SERIALNUMBER as serial', 's.EXPIREDDATE as expired', DB::raw('COALESCE(SUM(h.SNSIGN * h.QUANTITY), 0) as net')]);
            foreach ($acc as $r) {
                $put((string) $r->serial, ['source' => 'ACCURATE', 'expired' => $r->expired ? substr((string) $r->expired, 0, 10) : null,
                    'status' => (float) $r->net > 0 ? 'IN_STOCK' : 'OUT']);
            }
        }
        foreach (DB::table('ri')->whereNull('accurate_synced_at')->where('kode_barang', $code)->whereNotNull('no_seri')->get(['no_seri', 'no_ri', 'tgl_ri']) as $ri) {
            foreach (RiSerials::split($ri->no_seri) as $sn) {
                $known = isset($rows[self::key($sn)]);
                $put($sn, ['in_doc' => $ri->no_ri, 'in_date' => $ri->tgl_ri ? substr((string) $ri->tgl_ri, 0, 10) : null]
                    + ($known ? [] : ['source' => 'RI', 'status' => 'IN_STOCK']));
            }
        }
        foreach (DB::table('npbg')->whereNull('accurate_synced_at')->where('kode_barang', $code)->whereNotNull('no_seri')->orderBy('id')->get(['no_seri', 'no_npbg', 'tgl_npbg', 'pelanggan', 'peminta']) as $n) {
            foreach (RiSerials::split($n->no_seri) as $sn) {
                $put($sn, ['status' => 'OUT', 'out_doc' => $n->no_npbg, 'out_date' => $n->tgl_npbg ? substr((string) $n->tgl_npbg, 0, 10) : null, 'out_to' => $n->peminta ?: $n->pelanggan]);
            }
        }
        if (Schema::hasColumn('item_request_lines', 'serials')) {
            $held = DB::table('item_request_lines as l')->join('item_requests as r', 'r.id', '=', 'l.item_request_id')
                ->where('l.kode_barang', $code)->whereNotNull('l.serials')->whereNull('l.closed_at')
                ->whereNotIn('r.status', ['SELESAI', 'DITOLAK', 'DIBATALKAN'])->get(['l.serials', 'r.id', 'r.number', 'r.requester_name']);
            foreach ($held as $h) {
                foreach (RiSerials::split($h->serials) as $sn) {
                    if (($rows[self::key($sn)]['status'] ?? null) === 'IN_STOCK') {
                        $put($sn, ['status' => 'HELD', 'request' => ['id' => (int) $h->id, 'number' => $h->number, 'requester' => $h->requester_name]]);
                    }
                }
            }
        }
        $order = ['IN_STOCK' => 0, 'HELD' => 1, 'OUT' => 2];
        $list = array_values($rows);
        usort($list, fn ($a, $b) => [$order[$a['status']], $a['serial']] <=> [$order[$b['status']], $b['serial']]);

        return $list;
    }

    public static function key(string $serial): string
    {
        return mb_strtoupper(trim($serial));
    }
}
