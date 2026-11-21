<?php

namespace App\Support\Documents;

use App\Models\DocActivity;
use App\Models\PurchaseOrder;
use App\Models\User;
use App\Notifications\StockwiseAlert;
use App\Services\NpbgApprovalService;
use App\Services\PpbApprovalService;
use App\Services\PurchaseOrderService;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * Activities on a document, Odoo style:
 *   system  what the document's status says has to happen next, and by whom (read from the real status, the same
 *           rules as the To-Do; it disappears by itself once the document moves on — nothing is stored)
 *   manual  a follow-up someone schedules: assignee, type, due date, done / cancelled with history (doc_activities);
 *           the assignee is notified and sees it in the To-Do.
 */
final class DocumentActivities
{
    public const TYPE_LABEL = ['TODO' => 'To-Do', 'FOLLOW_UP' => 'Follow up', 'VERIFY' => 'Verify', 'PREPARE' => 'Prepare', 'CALL' => 'Call', 'DOCUMENT' => 'Upload document'];

    /** @return list<array{summary:string, responsible:string, for_you:bool, since:?string}> */
    public static function system(DocRef $doc, User $user): array
    {
        $can = fn (string ...$p) => collect($p)->contains(fn ($x) => $user->hasPermission($x));
        $out = [];
        $add = function (string $summary, string $responsible, bool $forYou, mixed $since = null) use (&$out) {
            $out[] = ['summary' => $summary, 'responsible' => $responsible, 'for_you' => $forYou,
                'since' => $since ? Carbon::parse($since)->timezone(config('app.timezone'))->toIso8601String() : null];
        };
        try {
            switch ($doc->type) {
                case 'item_request':
                    $r = DB::table('item_requests')->where('id', $doc->id)->first(['status', 'requester_id', 'updated_at']);
                    match ($r?->status) {
                        'MENUNGGU', 'DIPROSES', 'PERLU_PERBAIKAN' => $add('Verify the request (items & quantities)', 'Admin Gudang', $can('item_request.process'), $r->updated_at),
                        'APPROVAL_MANAGER' => $add('Approve the request', 'Manager', $can('item_request.approve_manager'), $r->updated_at),
                        'APPROVAL_DIREKTUR' => $add('Approve the request', 'Director', $can('item_request.approve_director'), $r->updated_at),
                        'DISIAPKAN', 'DIPENUHI_SEBAGIAN' => $add('Prepare the Delivery Order and hand the items over', 'Lapangan Gudang', $can('item_request.handover'), $r->updated_at),
                        'SIAP_DISERAHKAN' => $add('Hand the items over (ready at the warehouse)', 'Lapangan Gudang', $can('item_request.handover'), $r->updated_at),
                        'MENUNGGU_PENGADAAN' => $add('Buy the shortage through a Purchase Request', 'Admin Gudang', $can('ppb.create'), $r->updated_at),
                        'MENUNGGU_BARANG' => $add('Receive the purchased items (Receipt)', 'Admin Gudang', $can('ri.create'), $r->updated_at),
                        default => null,
                    };
                    if ($r?->status === 'SIAP_DISERAHKAN') {
                        $add('Pick up the items at the warehouse', 'Requester', (int) $r->requester_id === (int) $user->id, $r->updated_at);
                    }
                    break;
                case 'delivery_order':
                    $s = NpbgApprovalService::statusFor(collect([$doc->key]))[$doc->key] ?? null;
                    if (($s['status'] ?? null) === 'MENUNGGU') {
                        $add('Approve the manual Delivery Order', 'Manager', $user->hasPermission('npbg.approve_manager') && NpbgApprovalService::canDecide($user, $s));
                    } elseif (($s['status'] ?? null) === 'MENUNGGU_DIREKTUR') {
                        $add('Approve the manual Delivery Order', 'Director', NpbgApprovalService::canDecide($user, $s));
                    }
                    break;
                case 'purchase_request':
                    $s = PpbApprovalService::statusFor(collect([$doc->key]))[$doc->key] ?? null;
                    if (in_array($s['status'] ?? null, ['MENUNGGU', 'MENUNGGU_DIREKTUR'], true)) {
                        $add('Approve the Purchase Request', $s['status'] === 'MENUNGGU' && ($s['stockwise'] ?? false) ? 'Manager' : 'Director', PpbApprovalService::canDecide($user, $s));
                    } elseif (($s['status'] ?? null) === 'DIKEMBALIKAN') {
                        $add('Correct the returned Purchase Request', 'Admin Gudang', $can('ppb.create'));
                    }
                    break;
                case 'ppb_draft':
                    $d = DB::table('ppb_drafts')->where('id', $doc->id)->first(['status', 'updated_at']);
                    $open = DB::table('ppb_draft_lines')->where('ppb_draft_id', $doc->id)->whereNull('ppb_id')->exists();
                    if ($d?->status === 'DRAFT' && $open) {
                        $add('Submit the items as a Purchase Request', 'Admin Gudang', $can('ppb.create'), $d->updated_at);
                    }
                    break;
                case 'purchase_order':
                    $po = PurchaseOrder::find($doc->id);
                    if ($po) {
                        $approval = PurchaseOrderService::approvalStatus($po);
                        if ($po->status === 'DRAFT' && $approval === 'MENUNGGU_DIREKTUR') {
                            $add('Approve the Purchase Order', 'Director', $can(PurchaseOrderService::DIRECTOR), $po->updated_at);
                        } elseif ($po->status === 'DRAFT' && $approval === 'DIKEMBALIKAN') {
                            $add('Correct the returned Purchase Order', 'Purchasing', $can('po.create'), $po->updated_at);
                        } elseif ($po->accurate_po_id === null && in_array($po->status, ['APPROVED', 'SENT'], true)) {
                            $add('Buy and upload the purchase proof', 'Purchasing', $can('po.send', 'po.create'), $po->updated_at);
                        } elseif ($po->accurate_po_id === null && in_array($po->status, ['DIBELI', 'PARTIAL_RECEIVED'], true)) {
                            $add('Receive the items (Receipt)', 'Admin Gudang', $can('ri.create'), $po->expected_date ?? $po->updated_at);
                        }
                    }
                    break;
                case 'purchase_return':
                    $s = DB::table('purchase_returns')->where('id', $doc->id)->first(['status', 'updated_at']);
                    match ($s?->status) {
                        'DIBUAT' => $add('Ship the items back to the vendor', 'Admin Gudang', $can('purchase_return.manage'), $s->updated_at),
                        'DIKIRIM' => $add('Settle the return with the vendor', 'Admin Gudang', $can('purchase_return.manage'), $s->updated_at),
                        default => null,
                    };
                    break;
            }
        } catch (Throwable $e) {
            report($e); // a hint, never a reason to fail the page
        }

        return $out;
    }

    /** @param array{activity_type:string, summary:?string, note:?string, assignee_id:int, due_date:string} $data */
    public static function schedule(DocRef $doc, User $user, array $data): DocActivity
    {
        $assignee = User::where('is_active', true)->find((int) $data['assignee_id']);
        if (! $assignee) {
            throw ValidationException::withMessages(['assignee_id' => 'Pilih penanggung jawab yang aktif.']);
        }
        if (! DocumentRegistry::canView($assignee, $doc)) {
            throw ValidationException::withMessages(['assignee_id' => "{$assignee->name} tidak punya akses ke dokumen ini."]);
        }
        $type = $data['activity_type'];
        $activity = DocActivity::create([
            'res_type' => $doc->type, 'res_key' => $doc->key, 'res_id' => $doc->id, 'res_number' => $doc->number,
            'activity_type' => $type, 'summary' => trim((string) ($data['summary'] ?? '')) ?: self::TYPE_LABEL[$type],
            'note' => trim((string) ($data['note'] ?? '')) ?: null, 'assignee_id' => $assignee->id,
            'due_date' => $data['due_date'], 'created_by' => $user->id,
        ]);
        DocumentAudit::event($doc, 'ACTIVITY_SCHEDULED', 'DocActivity', $activity->id, [
            'activity' => [null, $activity->summary], 'assignee' => [null, $assignee->name], 'due_date' => [null, $activity->due_date->toDateString()],
        ]);
        if ((int) $assignee->id !== (int) $user->id) {
            rescue(fn () => $assignee->notify(new StockwiseAlert('activity', 'info', "Activity: {$activity->summary}",
                DocumentRegistry::label($doc->type)." {$doc->number} · due ".$activity->due_date->format('d M Y')." · from {$user->name}",
                self::path($doc->type, $doc->id))), null, false);
        }

        return $activity;
    }

    public static function complete(DocActivity $activity, DocRef $doc, User $user, ?string $note): DocActivity
    {
        self::assertOpen($activity);
        if (! in_array((int) $user->id, [(int) $activity->assignee_id, (int) $activity->created_by], true)) {
            throw ValidationException::withMessages(['activity' => 'Hanya penanggung jawab atau pembuat aktivitas yang bisa menandainya selesai.']);
        }
        $activity->update(['done_at' => now(), 'done_by' => $user->id, 'done_note' => $note !== null ? mb_substr(trim($note), 0, 500) ?: null : null]);
        DocumentAudit::event($doc, 'ACTIVITY_DONE', 'DocActivity', $activity->id, ['activity' => [$activity->summary, 'Done']], $activity->done_note);

        return $activity->refresh();
    }

    public static function cancel(DocActivity $activity, DocRef $doc, User $user): DocActivity
    {
        self::assertOpen($activity);
        if ((int) $user->id !== (int) $activity->created_by && ! $user->hasRole('super_admin')) {
            throw ValidationException::withMessages(['activity' => 'Hanya pembuat aktivitas yang bisa membatalkannya.']);
        }
        $activity->update(['cancelled_at' => now(), 'cancelled_by' => $user->id]);
        DocumentAudit::event($doc, 'ACTIVITY_CANCELLED', 'DocActivity', $activity->id, ['activity' => [$activity->summary, 'Cancelled']]);

        return $activity->refresh();
    }

    /** The page each document type opens on (frontend route). */
    public static function path(string $type, int $id): string
    {
        return match ($type) {
            'item_request' => "/item-requests/{$id}",
            'delivery_order' => "/npbg/{$id}",
            'ppb_draft' => "/ppb/drafts/{$id}",
            'purchase_request' => "/ppb/{$id}",
            'purchase_order' => "/purchase-orders/{$id}",
            'receipt' => "/ri/{$id}",
            'purchase_return' => "/purchase-returns/{$id}",
            'price_list_draft' => "/price-list/drafts/{$id}",
            default => '/',
        };
    }

    private static function assertOpen(DocActivity $activity): void
    {
        if ($activity->done_at || $activity->cancelled_at) {
            throw ValidationException::withMessages(['activity' => 'Aktivitas ini sudah selesai atau dibatalkan.']);
        }
    }
}
