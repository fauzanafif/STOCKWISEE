<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ImportantRequest;
use App\Models\ImportantRequestAssignee;
use App\Models\ImportantRequestSubmission;
use App\Models\ItemRequest;
use App\Models\PpbDraftLine;
use App\Models\PurchaseOrder;
use App\Models\PurchaseOrderItem;
use App\Services\ItemRequestApprovalService;
use App\Services\PoDraftService;
use App\Services\PurchaseOrderService;
use Carbon\CarbonInterface;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * GET /api/reminders?module=important|request|ppb|po|ri — the work waiting for this user, so nothing is
 * missed: the "Dashboard" of each menu shows its own; without a module, everything. Only what this user
 * may do, only what is not zero. Each reminder also says how urgent it is:
 *   overdue  past its due date (deadline / dibutuhkan / perkiraan tiba), or waiting longer than its SLA
 *   urgent   marked urgent (Request Barang URGENT, Important Request URGENT)
 *   soon     due within a day
 *   oldest_days, next_due, and the first documents (items) — each a link to the document itself.
 */
class ReminderController extends Controller
{
    public const MODULES = ['important', 'request', 'ppb', 'po', 'ri'];

    /** documents shown per reminder */
    private const PREVIEW = 5;

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $module = $request->string('module')->value();
        $can = fn (string ...$perms) => collect($perms)->contains(fn ($p) => $user->hasPermission($p));
        $want = fn (string ...$modules) => $module === '' || in_array($module, $modules, true);
        $out = [];
        $now = now();
        /*
         * $rows is a closure (only run when its module is asked for) giving the waiting documents:
         * [label, sub?, to, since?, due?, urgent?]. $sla: days a document may wait before it is late.
         */
        $add = function (string $key, array $modules, \Closure $rows, string $text, string $to, string $tone, int $sla) use (&$out, $want, $now) {
            if (! $want(...$modules)) {
                return;
            }
            $list = collect($rows())->map(function (array $r) use ($now, $sla) {
                $since = self::date($r['since'] ?? null);
                $due = self::date($r['due'] ?? null);
                $age = $since ? (int) floor($since->diffInHours($now) / 24) : null;
                // a date without a time (dibutuhkan / perkiraan tiba) lasts the whole day
                $dueEnd = $due && $due->format('H:i:s') === '00:00:00' ? $due->copy()->endOfDay() : $due;
                $late = ($dueEnd && $dueEnd->isPast()) || ($age !== null && $age >= $sla && ! $due);

                return [
                    'label' => (string) $r['label'], 'sub' => $r['sub'] ?? null, 'to' => $r['to'],
                    'since' => $since?->toIso8601String(), 'age_days' => $age, 'due' => $due?->toIso8601String(),
                    'late' => $late, 'urgent' => (bool) ($r['urgent'] ?? false),
                    'soon' => ! $late && $dueEnd && $dueEnd->lte($now->copy()->addDay()),
                ];
            });
            if ($list->isEmpty()) {
                return;
            }
            // late first, then urgent, then the nearest due, then the oldest
            $sorted = $list->sortBy(fn ($r) => [$r['late'] ? 0 : 1, $r['urgent'] ? 0 : 1, $r['soon'] ? 0 : 1, $r['due'] ?? '9999', $r['since'] ?? '9999'])->values();
            $overdue = $list->where('late', true)->count();
            $urgent = $list->where('urgent', true)->count();
            $soon = $list->where('soon', true)->count();
            $out[] = [
                'key' => $key, 'modules' => $modules, 'count' => $list->count(), 'text' => $text, 'to' => $to, 'tone' => $tone,
                'sla_days' => $sla, 'overdue' => $overdue, 'urgent' => $urgent, 'soon' => $soon,
                'priority' => $overdue ? 'overdue' : ($urgent ? 'urgent' : ($soon ? 'soon' : 'normal')),
                'oldest_days' => $list->max('age_days'),
                'next_due' => $list->pluck('due')->filter()->sort()->first(),
                'items' => $sorted->take(self::PREVIEW)->values(),
            ];
        };

        if ($can('important_request.access')) {
            $mine = fn (string $status) => fn () => ImportantRequestAssignee::where(['user_id' => $user->id, 'status' => $status])
                ->whereHas('request', fn ($r) => $r->whereNotIn('status', ImportantRequest::CLOSED))->with('request:id,number,title,deadline,sent_at,priority')->get()
                ->map(fn ($a) => ['label' => "{$a->request->number} · {$a->request->title}", 'to' => "/important-requests/{$a->request->id}",
                    'since' => $a->request->sent_at, 'due' => $a->request->deadline, 'urgent' => $a->request->priority === 'URGENT']);
            $add('ir_revise', ['important'], $mine('REVISI'), 'tugas dikembalikan, perlu direvisi', '/important-requests/tugas', 'orange', 1);
            $add('ir_todo', ['important'], $mine('DITUGASKAN'), 'tugas belum diserahkan', '/important-requests/tugas', 'blue', 3);
            $add('ir_review', ['important'], fn () => ImportantRequestSubmission::where('status', 'MENUNGGU_REVIEW')
                ->whereIn('important_request_id', ImportantRequest::where('created_by', $user->id)->whereNotIn('status', ImportantRequest::CLOSED)->select('id'))
                ->with('request:id,number,title,priority', 'user:id,name')->get()
                ->map(fn ($s) => ['label' => "{$s->request->number} · {$s->request->title}", 'sub' => "dari {$s->user?->name}", 'to' => "/important-requests/{$s->request->id}",
                    'since' => $s->created_at, 'urgent' => $s->request->priority === 'URGENT']),
                'hasil tugas menunggu Anda tinjau', '/important-requests/persetujuan', 'amber', 1);
        }

        $requestRow = fn (ItemRequest $r) => ['label' => "{$r->number} · {$r->requester_name}", 'sub' => $r->divisi, 'to' => "/item-requests/{$r->id}",
            'since' => $r->updated_at, 'due' => $r->needed_date, 'urgent' => $r->urgency === 'URGENT'];
        if ($can('item_request.process')) {
            $add('request_verify', ['request'], fn () => ItemRequest::whereIn('status', ['MENUNGGU', 'DIPROSES', 'PERLU_PERBAIKAN'])->get()
                ->map(fn ($r) => ['since' => $r->created_at] + $requestRow($r)),
                'request barang perlu diverifikasi', '/item-requests', 'amber', 1);
        }
        $statuses = ItemRequestApprovalService::actionableStatuses($user);
        if ($statuses) {
            $add('request_approval', ['request'], fn () => ItemRequest::whereIn('status', $statuses)->get()->map($requestRow),
                'request barang menunggu approval / serah terima Anda', '/approvals', 'blue', 1);
        }
        if ($can('item_request.create')) {
            // the requester's own: the goods are ready, come and take them
            $add('request_pickup', ['request'], fn () => ItemRequest::where('requester_id', $user->id)->where('status', 'SIAP_DISERAHKAN')->get()->map($requestRow),
                'barang permintaan Anda siap diambil di gudang', '/item-requests', 'emerald', 2);
        }
        $purchasing = $can(...PurchasingApprovalController::PERMISSIONS) ? PurchasingApprovalController::waiting($user) : null;
        if ($purchasing) {
            $add('ppb_approval', ['ppb'], fn () => collect($purchasing['ppb'])->map(fn ($p) => ['label' => $p['no_ppb'], 'sub' => trim(($p['peminta'] ?? '').' · '.($p['divisi'] ?? ''), ' ·'),
                'to' => "/ppb/{$p['id']}", 'since' => $p['tgl_ppb']]), 'PPB menunggu approval Anda', '/approvals', 'blue', 1);
            $add('po_approval', ['po'], fn () => collect($purchasing['po'])->map(fn ($p) => ['label' => $p['number'], 'sub' => trim(($p['vendor'] ?? '').' · Rp '.number_format($p['total'], 0, ',', '.'), ' ·'),
                'to' => "/purchase-orders/{$p['id']}", 'since' => $p['date']]), 'PO menunggu approval Anda', '/approvals', 'blue', 1);
            $add('npbg_approval', ['request'], fn () => collect($purchasing['npbg'])->map(fn ($n) => ['label' => $n['no_npbg'], 'sub' => $n['peminta'] ?? $n['pelanggan'],
                'to' => "/npbg/{$n['id']}", 'since' => $n['tgl_npbg']]), 'NPBG menunggu approval Anda', '/approvals', 'blue', 1);
        }
        if ($can(PurchaseOrderService::DIRECTOR)) {
            $add('po_quote_pick', ['po'], fn () => $this->poLines(PoDraftService::waiting()->where('quote_stage', 'MENUNGGU_DIREKTUR'), 'quote_submitted_at', '/purchase-orders/penawaran?tab=direktur'),
                'penawaran harga menunggu Anda pilih vendornya', '/purchase-orders/penawaran?tab=direktur', 'blue', 1);
        }

        if ($can('ppb.create')) {
            $add('ppb_saved', ['ppb'], fn () => \App\Models\PpbSavedDraft::withCount('openLines')->whereHas('openLines')->get()
                ->map(fn ($d) => ['label' => $d->name ?: 'Draft #'.$d->id, 'sub' => "{$d->open_lines_count} barang", 'to' => '/ppb/drafts?tab=saved', 'since' => $d->updated_at]),
                'draft Purchase Request belum diminta approval', '/ppb/drafts?tab=saved', 'amber', 2);
            $add('ppb_draft', ['ppb'], fn () => PpbDraftLine::whereNull('ppb_id')->whereNull('saved_draft_id')->whereHas('draft', fn ($d) => $d->where('status', 'DRAFT'))->with('draft:id,number')->get()
                ->map(fn ($l) => ['label' => $l->deskripsi_barang, 'sub' => trim(rtrim(rtrim(number_format((float) $l->qty, 2, ',', '.'), '0'), ',')." {$l->satuan} · {$l->draft?->number}"),
                    'to' => '/ppb/drafts', 'since' => $l->created_at]),
                'barang perlu dibuatkan PPB (Draft PPB)', '/ppb/drafts', 'indigo', 2);
        }
        if ($can('po.create')) {
            $add('po_draft', ['po', 'ppb'], fn () => $this->poLines(PoDraftService::waiting()->whereNull('quote_stage'), 'created_at', '/purchase-orders/siap-po'),
                'item PPB disetujui, masukkan ke Penawaran Harga', '/purchase-orders/siap-po', 'indigo', 2);
            $add('po_quotation', ['po'], fn () => $this->poLines(PoDraftService::waiting()->where('quote_stage', 'PENAWARAN'), 'updated_at', '/purchase-orders/penawaran'),
                'barang di Penawaran Harga, belum diajukan ke Direktur', '/purchase-orders/penawaran', 'amber', 2);
            $add('po_chosen', ['po'], fn () => $this->poLines(PoDraftService::waiting()->where('quote_stage', 'DIPILIH'), 'updated_at', '/purchase-orders/draft'),
                'vendor dipilih Direktur, buat Draft PO', '/purchase-orders/draft', 'emerald', 1);
            $add('po_returned', ['po'], fn () => PurchaseOrder::with('vendor:id,name')->whereNull('accurate_po_id')->where('status', 'DRAFT')->get()
                ->filter(fn ($po) => PurchaseOrderService::approvalStatus($po) === 'DIKEMBALIKAN')
                ->map(fn ($po) => ['label' => $po->number, 'sub' => $po->vendor?->name, 'to' => "/purchase-orders/{$po->id}", 'since' => $po->updated_at]),
                'PO dikembalikan Direktur, perlu diperbaiki', '/purchase-orders', 'orange', 1);
        }
        if ($can('po.send', 'po.create')) {
            $add('po_buy', ['po'], fn () => PurchaseOrder::with('vendor:id,name')->whereNull('accurate_po_id')->whereIn('status', ['APPROVED', 'SENT'])->get()
                ->map(fn ($po) => ['label' => $po->number, 'sub' => $po->vendor?->name, 'to' => "/purchase-orders/{$po->id}", 'since' => $po->updated_at]),
                'PO disetujui, belum dibeli (unggah bukti pembelian)', '/purchase-orders', 'emerald', 2);
        }
        if ($can('ri.create')) {
            $add('ri_waiting', ['ri', 'po'], fn () => PurchaseOrderItem::with('purchaseOrder:id,number,expected_date,updated_at,vendor_id', 'purchaseOrder.vendor:id,name')
                ->whereHas('purchaseOrder', fn ($p) => $p->whereNull('accurate_po_id')->whereIn('status', ['DIBELI', 'PARTIAL_RECEIVED']))
                ->whereIn('line_status', ['PENDING', 'PARTIAL_RECEIVED'])->get()
                // late = past the PO's "perkiraan tiba"
                ->map(fn ($l) => ['label' => $l->description_raw, 'sub' => trim("{$l->purchaseOrder->number} · ".($l->purchaseOrder->vendor?->name ?? ''), ' ·'),
                    'to' => "/purchase-orders/{$l->purchase_order_id}", 'since' => $l->purchaseOrder->updated_at, 'due' => $l->purchaseOrder->expected_date]),
                'barang sudah dibeli, menunggu diterima (buat RI)', '/ri', 'teal', 7);
        }

        // activities scheduled on a document and given to this user (Chatter › Activities); every module shows them
        if (\Illuminate\Support\Facades\Schema::hasTable('doc_activities')) {
            $add('doc_activity', self::MODULES, fn () => \App\Models\DocActivity::where('assignee_id', $user->id)->whereNull('done_at')->whereNull('cancelled_at')
                ->orderBy('due_date')->get()
                ->map(fn ($a) => ['label' => "{$a->res_number} · {$a->summary}", 'sub' => \App\Support\Documents\DocumentRegistry::label($a->res_type),
                    'to' => \App\Support\Documents\DocumentActivities::path($a->res_type, (int) $a->res_id), 'since' => $a->created_at, 'due' => $a->due_date]),
                'aktivitas dokumen ditugaskan ke Anda', '/', 'violet', 3);
        }

        // the most pressing first: late, urgent, due soon — then as listed
        $rank = ['overdue' => 0, 'urgent' => 1, 'soon' => 2, 'normal' => 3];
        $out = collect($out)->values()->sortBy(fn ($r, $i) => [$rank[$r['priority']], $i])->values()->all();

        return response()->json(['data' => $out, 'meta' => [
            'total' => array_sum(array_column($out, 'count')),
            'overdue' => array_sum(array_column($out, 'overdue')),
            'urgent' => array_sum(array_column($out, 'urgent')),
            'soon' => array_sum(array_column($out, 'soon')),
        ]]);
    }

    /** PO-flow lines as reminder rows: the item, its PPB, due = the PPB's "dibutuhkan" */
    private function poLines($query, string $since, string $to): Collection
    {
        return $query->with('approvedPpb:id,no_ppb,tgl_diperlukan')->get()
            ->map(fn (PurchaseOrderItem $l) => ['label' => $l->description_raw, 'sub' => $l->approvedPpb?->no_ppb, 'to' => $to,
                'since' => $l->{$since} ?? $l->created_at, 'due' => $l->approvedPpb?->tgl_diperlukan]);
    }

    private static function date(mixed $v): ?CarbonInterface
    {
        if ($v === null || $v === '') {
            return null;
        }
        try {
            return $v instanceof CarbonInterface ? $v : Carbon::parse($v);
        } catch (\Throwable) {
            return null;
        }
    }
}
