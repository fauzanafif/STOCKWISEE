<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\PoDraftService;
use App\Support\ManufacturingExcel;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * GET /api/dashboard/feature-stats — a few figures for every feature card of the Dashboard's Overview that has no
 * to-do of its own (Delivery Order, Barang, Vendor, Lending …): how many there are, and what needs a look. Keyed by
 * the feature's menu path; a feature the user may not open is left out. Counts only, nothing listed.
 */
class FeatureStatsController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $user = $request->user();
        $month = now()->startOfMonth();
        $today = today()->toDateString();
        $has = fn (string $table) => Schema::hasTable($table);
        $n = fn ($v) => (int) $v;

        // path => [permissions (any), figures()]  —  a figure: [label, value, tone?] (tone: warn | bad | ok)
        $features = [
            '/npbg' => [['npbg.view'], fn () => [
                ['This month', $n(DB::table('npbg')->where('tgl_npbg', '>=', $month)->distinct()->count('no_npbg'))],
                ['Today', $n(DB::table('npbg')->whereDate('tgl_npbg', $today)->distinct()->count('no_npbg'))],
            ]],
            '/ppb/drafts' => [['ppb.view', 'ppb.create'], fn () => [
                ['Open', $n(DB::table('ppb_drafts')->where('status', 'DRAFT')->count())],
                ['Submitted', $n(DB::table('ppb_drafts')->where('status', 'DIAJUKAN')->count())],
            ]],
            '/items?kind=BARANG' => [['item.view'], fn () => [
                ['Active items', $n(DB::table('items')->whereNull('deleted_at')->where('is_active', true)->where('product_kind', 'BARANG')->count())],
                ['No unit', $n(DB::table('items')->whereNull('deleted_at')->where('is_active', true)->where('product_kind', 'BARANG')->whereNull('unit_id')->count()), 'warn'],
            ]],
            '/items?kind=JASA' => [['item.view'], fn () => [
                ['Active services', $n(DB::table('items')->whereNull('deleted_at')->where('is_active', true)->where('product_kind', 'JASA')->count())],
            ]],
            '/item-categories' => [['master.category.view', 'item.view'], fn () => [
                ['Categories', $n(DB::table('categories')->where('is_active', true)->count())],
                ['Items without one', $n(DB::table('items')->whereNull('deleted_at')->where('is_active', true)->whereNull('category_id')->where(fn ($q) => $q->whereNull('accurate_category_induk')->orWhere('accurate_category_induk', ''))->count()), 'warn'],
            ]],
            '/uom' => [['master.unit.view'], fn () => [
                ['Units', $n(DB::table('units')->where('is_active', true)->count())],
                ['Items without a unit', $n(DB::table('items')->whereNull('deleted_at')->where('is_active', true)->whereNull('unit_id')->count()), 'warn'],
            ]],
            '/stock-card' => [['inventory.view', 'item.view', 'stock_movement.view'], fn () => [
                ['Movements this month', $n(DB::table('stock_movements')->where('created_at', '>=', $month)->count())],
                ['Today', $n(DB::table('stock_movements')->whereDate('created_at', $today)->count())],
            ]],
            '/inventory/analysis' => [['inventory.view_analysis', 'item.safety_stock.view'], fn () => [
                ['Not safe', $n(DB::table('inventory_snapshots')->where('status', 'TIDAK_AMAN')->count()), 'bad'],
                ['Empty, no usage', $n(DB::table('inventory_snapshots')->where('status', 'BEP')->count())],
            ]],
            '/master-data/quality' => [['item.view', 'master.vendor.view'], fn () => [
                ['Items to complete', $n(DB::table('items')->whereNull('deleted_at')->where('is_active', true)->where(fn ($q) => $q->whereNull('unit_id')->orWhere(fn ($c) => $c->whereNull('category_id')->where(fn ($t) => $t->whereNull('accurate_category_induk')->orWhere('accurate_category_induk', ''))))->count()), 'warn'],
                ['Vendors to review', $n(Schema::hasColumn('vendors', 'needs_review') ? DB::table('vendors')->where('needs_review', true)->count() : 0), 'warn'],
            ]],
            '/purchase-orders/siap-po' => [['po.create', 'po.view'], fn () => [
                ['Ready for PO', $n(PoDraftService::waiting()->whereNull('quote_stage')->count())],
            ]],
            '/purchase-orders/draft' => [['po.create', 'po.approve_director'], fn () => [
                ['Being quoted', $n(PoDraftService::waiting()->whereNotNull('quote_stage')->count())],
            ]],
            '/purchase-returns' => [['purchase_return.view'], fn () => [
                ['Open', $n(DB::table('purchase_returns')->whereIn('status', ['DIBUAT', 'DIKIRIM'])->count())],
                ['This month', $n(DB::table('purchase_returns')->where('created_at', '>=', $month)->count())],
            ]],
            '/price-list/drafts' => [['rfq.view'], fn () => [
                ['Open drafts', $n(DB::table('price_list_drafts')->where('status', 'DRAFT')->count())],
                ['Set this month', $n(DB::table('price_list_drafts')->where('status', 'DONE')->where('done_at', '>=', $month)->count())],
            ]],
            '/price-list' => [['rfq.view'], fn () => [
                ['Prices', $n(DB::table('vendor_prices')->where('status', '!=', 'ARCHIVED')->count())],
                ['Incomplete', $n(DB::table('vendor_prices')->where('status', '!=', 'ARCHIVED')->where(fn ($q) => $q->whereNull('price_type')
                    ->orWhere(fn ($s) => $s->whereNull('price_list_draft_id')->where(fn ($r) => $r->whereNull('vendor_ref')->orWhere('vendor_ref', ''))))->count()), 'warn'],
            ]],
            '/vendors' => [['master.vendor.view'], fn () => [
                ['Active vendors', $n(DB::table('vendors')->where('is_active', true)->count())],
                ['No email / phone', $n(DB::table('vendors')->where('is_active', true)->where(fn ($q) => $q->whereNull('email')->orWhere('email', ''))->where(fn ($q) => $q->whereNull('phone')->orWhere('phone', ''))->count()), 'warn'],
            ]],
            '/mrp/boms' => [['mrp.view'], fn () => $has('mrp_boms') ? [
                ['Active', $n(DB::table('mrp_boms')->where('status', 'ACTIVE')->count())],
                ['Draft', $n(DB::table('mrp_boms')->where('status', 'DRAFT')->count())],
            ] : []],
            '/mrp/history' => [['mrp.view'], fn () => $has('mrp_productions') ? [
                ['Done this month', $n(DB::table('mrp_productions')->where('status', 'DONE')->where('updated_at', '>=', $month)->count()), 'ok'],
            ] : []],
            '/disassembly/history' => [['disassembly.view'], fn () => $has('disassembly_orders') ? [
                ['Done this month', $n(DB::table('disassembly_orders')->where('status', 'DONE')->where('updated_at', '>=', $month)->count()), 'ok'],
            ] : []],
            '/lend' => [['lend.view'], fn () => [
                ['On loan', $n(DB::table('lend_transactions')->whereIn('status', ['ON_LOAN', 'OVERDUE', 'PARTIAL'])->count())],
                ['Past due', $n(DB::table('lend_transactions')->whereIn('status', ['ON_LOAN', 'OVERDUE', 'PARTIAL'])->whereNotNull('due_date')->where('due_date', '<', $today)->count()), 'bad'],
            ]],
            '/borrow' => [['borrow.view'], fn () => [
                ['Borrowed', $n(DB::table('borrow_transactions')->whereIn('status', ['BORROWED', 'PARTIAL'])->count())],
            ]],
            '/used-returns' => [['used_return.view'], fn () => [
                ['Still to return', $n(DB::table('used_returns')->where('status', 'PENDING')->count()), 'warn'],
                ['Returned', $n(DB::table('used_returns')->where('status', 'CLEAR')->count()), 'ok'],
            ]],
            '/stpp' => [['stpp.view'], fn () => [
                ['Out (in use)', $n(DB::table('stpp_transactions')->where('status', 'ACTIVE')->count())],
                ['Returned this month', $n(DB::table('stpp_transactions')->whereNotNull('return_date')->where('return_date', '>=', $month)->count()), 'ok'],
            ]],
            '/maintenance' => [['maintenance.view'], fn () => [
                ['Open', $n(DB::table('maintenance_orders')->where('status', '!=', ManufacturingExcel::COMPLETED)->count())],
            ]],
            '/tyre-changes' => [['tyre.view'], fn () => [
                ['Waiting for the old tyre', $n(DB::table('tyre_changes')->whereNull('in_date')->count()), 'warn'],
                ['This month', $n(DB::table('tyre_changes')->where('change_date', '>=', $month)->count())],
            ]],
            '/manufacturing' => [['manufacturing.view'], fn () => [
                ['Open', $n(DB::table('manufacturing_orders')->where('status', '!=', ManufacturingExcel::COMPLETED)->count())],
            ]],
            '/analytics/important-requests' => [['important_request.analytics'], fn () => [
                ['Active', $n(DB::table('important_requests')->whereNotIn('status', ['SELESAI', 'DIBATALKAN', 'DRAFT'])->count())],
                ['Late', $n(DB::table('important_requests')->whereNotIn('status', ['SELESAI', 'DIBATALKAN', 'DRAFT'])->whereNotNull('deadline')->where('deadline', '<', now())->count()), 'bad'],
            ]],
        ];

        $out = [];
        foreach ($features as $path => [$perms, $figures]) {
            if (! collect($perms)->contains(fn ($p) => $user->hasPermission($p))) {
                continue;
            }
            // one feature's table missing or changed never takes the others down
            $rows = rescue($figures, [], false);
            if ($rows) {
                $out[$path] = array_map(fn ($f) => ['label' => $f[0], 'value' => $f[1], 'tone' => $f[2] ?? null], $rows);
            }
        }

        return response()->json(['data' => (object) $out]);
    }
}
