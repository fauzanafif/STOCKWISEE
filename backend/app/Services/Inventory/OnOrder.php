<?php

namespace App\Services\Inventory;

use App\Services\PpbApprovalService;
use Illuminate\Support\Facades\DB;

/**
 * What is already on its way per item, so Restock does not buy it twice:
 *  - draft   lines of Draft PPB not submitted yet (status DRAFT);
 *  - ppb     PPB lines (from PpbApprovalService::GO_LIVE, or STOCKWISE ones) not rejected and without any PO yet;
 *  - po      PO lines not fully received: STOCKWISE POs (Menunggu PO … partly received) and Accurate's open ones.
 * A PPB line that has a PO is counted only through the PO.
 */
class OnOrder
{
    /** @return array<int, array{draft:float, ppb:float, po:float, total:float, docs:list<string>}> item id => quantities */
    public static function byItem(?array $itemIds = null): array
    {
        $out = [];
        $add = function (int $id, string $kind, float $q, ?string $doc) use (&$out) {
            $out[$id] ??= ['draft' => 0.0, 'ppb' => 0.0, 'po' => 0.0, 'total' => 0.0, 'docs' => []];
            $out[$id][$kind] = round($out[$id][$kind] + $q, 2);
            $out[$id]['total'] = round($out[$id]['total'] + $q, 2);
            if ($doc && ! in_array($doc, $out[$id]['docs'], true) && count($out[$id]['docs']) < 5) {
                $out[$id]['docs'][] = $doc;
            }
        };
        $only = fn ($q, string $col) => $itemIds === null ? $q : $q->whereIn($col, $itemIds);

        foreach ($only(DB::table('ppb_draft_lines as l')->join('ppb_drafts as d', 'd.id', '=', 'l.ppb_draft_id')
            ->where('d.status', 'DRAFT')->whereNull('l.ppb_id')->whereNotNull('l.item_id'), 'l.item_id')->get(['l.item_id', 'l.qty', 'd.number']) as $r) {
            $add((int) $r->item_id, 'draft', (float) $r->qty, "Draft {$r->number}");
        }

        $rejected = DB::table(PpbApprovalService::TABLE.' as a')->select('a.no_ppb')->where('a.action', 'REJECT')
            ->whereRaw('a.id = (select max(b.id) from '.PpbApprovalService::TABLE." b where b.no_ppb = a.no_ppb and b.action in ('APPROVE', 'REJECT', 'APPROVE_MANAGER'))");
        $ppb = DB::table('ppb as p')->join('items as i', 'i.code', '=', 'p.kode_barang')
            ->where(fn ($w) => $w->whereDate('p.tgl_ppb', '>=', PpbApprovalService::GO_LIVE)->orWhere(fn ($m) => $m->whereNull('p.accurate_reqid')->whereNotNull('p.created_by')))
            ->whereNotIn('p.no_ppb', $rejected)
            ->whereNotExists(fn ($q) => $q->selectRaw('1')->from('purchase_order_items as x')->whereColumn('x.accurate_ppb_id', 'p.id'))
            ->whereNotExists(fn ($q) => $q->selectRaw('1')->from('purchase_order_items as y')->whereColumn('y.approved_ppb_id', 'p.id'));
        foreach ($only($ppb, 'i.id')->get(['i.id', 'p.kuantitas', 'p.qty_diterima', 'p.no_ppb', 'p.unit_ratio']) as $r) {
            $left = (float) \App\Services\UomConverter::baseQty((float) $r->kuantitas - (float) ($r->qty_diterima ?? 0), $r->unit_ratio ?? 1);
            if ($left > 0) {
                $add((int) $r->id, 'ppb', $left, "PPB {$r->no_ppb}");
            }
        }

        $po = DB::table('purchase_order_items as l')->join('purchase_orders as o', 'o.id', '=', 'l.purchase_order_id')
            ->whereNotNull('l.item_id')->whereColumn('l.qty_received', '<', 'l.qty')
            ->whereIn('o.status', [PpbApprovalService::WAITING, 'DRAFT', 'APPROVED', 'SENT', 'DIBELI', 'PARTIAL_RECEIVED'])
            ->whereNotIn('l.line_status', ['CLOSED', 'RECEIVED']);
        foreach ($only($po, 'l.item_id')->get(['l.item_id', 'l.qty', 'l.qty_received', 'l.unit_id', 'l.unit_ratio', 'o.number', 'o.accurate_po_id']) as $r) {
            $add((int) $r->item_id, 'po', self::leftInItemUnit($r), "PO {$r->number}");
        }

        return $out;
    }

    /**
     * What is left of a PO line, in the item's own unit. A STOCKWISE PO may order in another unit (5 PCK);
     * Accurate's POs keep their figures, and a line with no ratio yet counts as it is.
     */
    private static function leftInItemUnit(object $r): float
    {
        $left = (float) $r->qty - (float) $r->qty_received;
        if ($r->accurate_po_id !== null || ! $r->unit_id) {
            return $left;
        }
        if ($r->unit_ratio !== null) {
            return (float) \App\Services\UomConverter::baseQty($left, $r->unit_ratio);
        }
        static $units = [], $items = [];
        $units[$r->unit_id] ??= \App\Models\Unit::find($r->unit_id);
        $items[$r->item_id] ??= \App\Models\Item::with('unit')->find($r->item_id);
        try {
            return (float) \App\Services\UomConverter::baseQty($left, app(\App\Services\UomConverter::class)->documentRatio($items[$r->item_id], $units[$r->unit_id]));
        } catch (\Illuminate\Validation\ValidationException) {
            return $left;
        }
    }

    /** PO statuses that are approved and still on their way (an RI lowers what is left). */
    public const APPROVED_PO = ['APPROVED', 'SENT', 'DIBELI', 'PARTIAL_RECEIVED'];

    /**
     * What is coming in and already approved, per item — the Master Barang forecast:
     *  - ppb  PPB lines approved (Manajer + Direktur: DISETUJUI) without a PO yet, what is not received;
     *  - po   PO lines of approved / sent / bought / partly received POs (STOCKWISE and Accurate), what is not received.
     *
     * @return array<int, array{ppb:float, po:float, total:float, docs:list<string>}>
     */
    public static function approvedByItem(?array $itemIds = null): array
    {
        $out = [];
        $add = function (int $id, string $kind, float $q, string $doc) use (&$out) {
            $out[$id] ??= ['ppb' => 0.0, 'po' => 0.0, 'total' => 0.0, 'docs' => []];
            $out[$id][$kind] = round($out[$id][$kind] + $q, 2);
            $out[$id]['total'] = round($out[$id]['total'] + $q, 2);
            if (! in_array($doc, $out[$id]['docs'], true) && count($out[$id]['docs']) < 5) {
                $out[$id]['docs'][] = $doc;
            }
        };
        $only = fn ($q, string $col) => $itemIds === null ? $q : $q->whereIn($col, $itemIds);

        $ppb = $only(DB::table('ppb as p')->join('items as i', 'i.code', '=', 'p.kode_barang')
            ->where(fn ($w) => $w->whereDate('p.tgl_ppb', '>=', PpbApprovalService::GO_LIVE)->orWhere(fn ($m) => $m->whereNull('p.accurate_reqid')->whereNotNull('p.created_by')))
            ->whereNotExists(fn ($q) => $q->selectRaw('1')->from('purchase_order_items as x')->whereColumn('x.accurate_ppb_id', 'p.id'))
            ->whereNotExists(fn ($q) => $q->selectRaw('1')->from('purchase_order_items as y')->whereColumn('y.approved_ppb_id', 'p.id')), 'i.id')
            ->get(['i.id', 'p.kuantitas', 'p.qty_diterima', 'p.no_ppb', 'p.unit_ratio']);
        $status = PpbApprovalService::statusFor($ppb->pluck('no_ppb'));
        foreach ($ppb as $r) {
            $left = (float) \App\Services\UomConverter::baseQty((float) $r->kuantitas - (float) ($r->qty_diterima ?? 0), $r->unit_ratio ?? 1);
            if ($left > 0 && ($status[$r->no_ppb]['status'] ?? null) === 'DISETUJUI') {
                $add((int) $r->id, 'ppb', $left, "PPB {$r->no_ppb}");
            }
        }

        $po = $only(DB::table('purchase_order_items as l')->join('purchase_orders as o', 'o.id', '=', 'l.purchase_order_id')
            ->whereNotNull('l.item_id')->whereColumn('l.qty_received', '<', 'l.qty')
            ->whereIn('o.status', self::APPROVED_PO)->where(fn ($w) => $w->whereNull('l.line_status')->orWhereNotIn('l.line_status', ['CLOSED', 'RECEIVED'])), 'l.item_id')
            ->get(['l.item_id', 'l.qty', 'l.qty_received', 'l.unit_id', 'l.unit_ratio', 'o.number', 'o.accurate_po_id']);
        foreach ($po as $r) {
            $add((int) $r->item_id, 'po', self::leftInItemUnit($r), "PO {$r->number}");
        }

        return $out;
    }
}
