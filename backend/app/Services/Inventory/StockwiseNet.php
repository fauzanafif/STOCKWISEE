<?php

namespace App\Services\Inventory;

use Illuminate\Support\Facades\DB;

/**
 * What STOCKWISE itself moved since it started issuing goods (config stockwise.stockwise_ledger_since):
 * + manual RI (RiController::store — not in Accurate), − goods handed out for Request Barang
 * (ItemRequestFulfillmentService: prepared, or what was really handed over). Accurate never sees these,
 * so following Accurate's qty (AccurateDerivedAnalysis) keeps them: stock = Accurate qty + this net.
 */
class StockwiseNet
{
    /** @return array<int, float> item id => net qty */
    public static function byItem(): array
    {
        $since = config('stockwise.stockwise_ledger_since');
        $net = [];
        $in = DB::table('ri')->join('items', 'items.code', '=', 'ri.kode_barang')
            ->whereNull('ri.accurate_apinvoice_id')->whereNotNull('ri.created_by')->where('ri.created_at', '>=', $since)
            ->groupBy('items.id')->selectRaw('items.id, SUM(ri.kuantitas * COALESCE(ri.unit_ratio, 1)) q')->pluck('q', 'id');
        foreach ($in as $id => $q) {
            $net[(int) $id] = (float) $q;
        }
        // Request Barang: only what was handed over left the stock (a prepared NPBG only holds it)
        $out = DB::table('item_request_fulfillment_lines as fl')
            ->join('item_request_lines as l', 'l.id', '=', 'fl.item_request_line_id')
            ->whereNotNull('l.item_id')->whereNotNull('fl.handed_qty')->where('fl.created_at', '>=', $since)
            ->groupBy('l.item_id')->selectRaw('l.item_id, SUM(fl.handed_qty) q')->pluck('q', 'item_id');
        foreach ($out as $id => $q) {
            $net[(int) $id] = round(($net[(int) $id] ?? 0.0) - (float) $q, 2);
        }
        // a manual NPBG approved by the Direktur (NpbgApprovalService) took its goods out of the stock too
        $approved = DB::table('stock_movements')->where('movement_type', 'STOCK_OUT')->where('reference_type', (new \App\Models\Npbg)->getMorphClass())
            ->where('note', 'like', '%(disetujui)')->where('created_at', '>=', $since)->groupBy('item_id')->selectRaw('item_id, SUM(qty) q')->pluck('q', 'item_id');
        foreach ($approved as $id => $q) {
            $net[(int) $id] = round(($net[(int) $id] ?? 0.0) - (float) $q, 2);
        }
        foreach (self::manufacturing() as $id => $q) {
            $net[(int) $id] = round(($net[(int) $id] ?? 0.0) + (float) $q, 2);
        }
        foreach (self::disassembly() as $id => $q) {
            $net[(int) $id] = round(($net[(int) $id] ?? 0.0) + (float) $q, 2);
        }

        return $net;
    }

    /**
     * Manufacturing Orders validated in STOCKWISE (components out, finished goods in, reversals) until the MO is
     * marked as entered in Accurate: from then on Accurate's own qty carries it, so it is no longer added here
     * (counting it twice). Nothing while the MRP tables are not migrated.
     *
     * @return array<int, float> item id => net qty
     */
    public static function manufacturing(): array
    {
        if (! \Illuminate\Support\Facades\Schema::hasTable('mrp_productions')) {
            return [];
        }

        return DB::table('stock_movements as m')
            ->join('mrp_productions as p', fn ($j) => $j->on('p.id', '=', 'm.reference_id')->where('m.reference_type', (new \App\Models\MrpProduction)->getMorphClass()))
            ->whereIn('m.movement_type', StockLedgerService::MRP_TYPES)->whereNull('p.accurate_recorded_at')
            ->groupBy('m.item_id')->selectRaw('m.item_id, SUM(m.direction * m.qty) q')->pluck('q', 'item_id')
            ->map(fn ($q) => (float) $q)->all();
    }

    /**
     * Disassembly Orders validated in STOCKWISE (product out, good components in, reversals) until the order is
     * marked as entered in Accurate: from then on Accurate's qty carries them. Empty while the table is absent.
     *
     * @return array<int, float> item id => net qty
     */
    public static function disassembly(): array
    {
        if (! \Illuminate\Support\Facades\Schema::hasTable('disassembly_orders')) {
            return [];
        }

        return DB::table('stock_movements as m')
            ->join('disassembly_orders as o', fn ($j) => $j->on('o.id', '=', 'm.reference_id')->where('m.reference_type', (new \App\Models\DisassemblyOrder)->getMorphClass()))
            ->whereIn('m.movement_type', StockLedgerService::DISASSEMBLY_TYPES)->whereNull('o.accurate_recorded_at')
            ->groupBy('m.item_id')->selectRaw('m.item_id, SUM(m.direction * m.qty) q')->pluck('q', 'item_id')
            ->map(fn ($q) => (float) $q)->all();
    }
}
