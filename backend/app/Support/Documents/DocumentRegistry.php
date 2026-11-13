<?php

namespace App\Support\Documents;

use App\Models\User;
use App\Services\ItemRequestApprovalService;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * The transaction documents Chatter, Activities, Audit and Smart Buttons work on, and who may see them. The view
 * rules are the ones the document's own page already uses (route permission, an Item Request also by its
 * requester); nothing here grants more than that page does.
 *
 * Delivery Order (npbg), Purchase Request (ppb) and Receipt (ri) are kept one row per item line, mirrored from
 * Accurate: the document is its number, and the page opens with the first row's id.
 */
final class DocumentRegistry
{
    /** type => display label (current menu names), the permissions that open its page */
    public const TYPES = [
        'item_request' => ['label' => 'Item Request', 'plural' => 'Item Requests', 'view' => []], // see canView
        'delivery_order' => ['label' => 'Delivery Order', 'plural' => 'Delivery Orders', 'view' => ['npbg.view']],
        'ppb_draft' => ['label' => 'Draft Purchase Request', 'plural' => 'Draft Purchase Requests', 'view' => ['ppb.view', 'ppb.create']],
        'purchase_request' => ['label' => 'Purchase Request', 'plural' => 'Purchase Requests', 'view' => ['ppb.view']],
        'purchase_order' => ['label' => 'Purchase Order', 'plural' => 'Purchase Orders', 'view' => ['po.view']],
        'receipt' => ['label' => 'Receipt', 'plural' => 'Receipts', 'view' => ['ri.view']],
        'purchase_return' => ['label' => 'Return', 'plural' => 'Returns', 'view' => ['purchase_return.view']],
    ];

    public static function label(string $type, bool $plural = false): string
    {
        return self::TYPES[$type][$plural ? 'plural' : 'label'] ?? $type;
    }

    /** The document a page shows (by the id in its URL). 404 when it does not exist. */
    public static function find(string $type, int $id): DocRef
    {
        $ref = match ($type) {
            'item_request' => ($r = DB::table('item_requests')->where('id', $id)->first(['id', 'number', 'requester_id']))
                ? new DocRef($type, (string) $r->id, (int) $r->id, (string) $r->number, $r->requester_id ? (int) $r->requester_id : null) : null,
            'delivery_order' => self::lineDoc($type, 'npbg', 'no_npbg', $id),
            'purchase_request' => self::lineDoc($type, 'ppb', 'no_ppb', $id),
            'receipt' => self::lineDoc($type, 'ri', 'no_ri', $id),
            'ppb_draft' => ($r = DB::table('ppb_drafts')->where('id', $id)->first(['id', 'number'])) ? new DocRef($type, (string) $r->id, (int) $r->id, (string) $r->number) : null,
            'purchase_order' => ($r = DB::table('purchase_orders')->where('id', $id)->first(['id', 'number'])) ? new DocRef($type, (string) $r->id, (int) $r->id, (string) ($r->number ?? "PO #{$r->id}")) : null,
            'purchase_return' => ($r = DB::table('purchase_returns')->where('id', $id)->first(['id', 'number'])) ? new DocRef($type, (string) $r->id, (int) $r->id, (string) $r->number) : null,
            default => null,
        };
        abort_if($ref === null, 404, 'Dokumen tidak ditemukan.');

        return $ref;
    }

    /** The document a stored key (Chatter / Activity / Audit) belongs to, or null when it no longer exists. */
    public static function byKey(string $type, string $key): ?DocRef
    {
        $id = match ($type) {
            'delivery_order' => DB::table('npbg')->where('no_npbg', $key)->min('id'),
            'purchase_request' => DB::table('ppb')->where('no_ppb', $key)->min('id'),
            'receipt' => DB::table('ri')->where('no_ri', $key)->min('id'),
            default => ctype_digit($key) ? (int) $key : null,
        };

        return $id ? rescue(fn () => self::find($type, (int) $id), null, false) : null;
    }

    /** May this user open the document (the same rule as its page)? */
    public static function canView(User $user, DocRef $doc): bool
    {
        if ($doc->type === 'item_request') {
            return self::itemRequestStaff($user)
                || ($doc->ownerId !== null && $doc->ownerId === (int) $user->id && $user->hasPermission('item_request.create'));
        }

        return self::canViewType($user, $doc->type);
    }

    /** May this user open documents of this type in general (not only their own)? */
    public static function canViewType(User $user, string $type): bool
    {
        if ($type === 'item_request') {
            return self::itemRequestStaff($user);
        }

        return collect(self::TYPES[$type]['view'] ?? [])->contains(fn ($p) => $user->hasPermission($p));
    }

    /**
     * Staff of the document: may read and write internal notes and schedule activities. On an Item Request that is
     * everyone who handles requests (not the requester as such); elsewhere whoever may open the document.
     */
    public static function isStaff(User $user, DocRef $doc): bool
    {
        return $doc->type === 'item_request' ? self::itemRequestStaff($user) : self::canView($user, $doc);
    }

    /**
     * Short rows for a list of documents of one type (number, status, date, party), each with the id its page opens
     * with — for the Smart Buttons. Item Requests the user may not open are left out.
     *
     * @param  list<string|int>  $keys
     * @return Collection<int, array<string, mixed>>
     */
    public static function summaries(string $type, array $keys, User $user): Collection
    {
        $keys = array_values(array_unique(array_filter(array_map('strval', $keys), fn ($k) => $k !== '')));
        if ($keys === []) {
            return collect();
        }
        $rows = match ($type) {
            'item_request' => DB::table('item_requests')->whereIn('id', $keys)
                ->when(! self::itemRequestStaff($user), fn ($q) => $q->where('requester_id', $user->id))
                ->get(['id', 'number', 'status', 'created_at as date', 'requester_name as party']),
            'delivery_order' => DB::table('npbg')->whereIn('no_npbg', $keys)->groupBy('no_npbg')
                ->selectRaw('MIN(id) id, no_npbg number, NULL status, MAX(tgl_npbg) date, MAX(COALESCE(peminta, pelanggan)) party')->get(),
            'purchase_request' => DB::table('ppb')->whereIn('no_ppb', $keys)->groupBy('no_ppb')
                ->selectRaw('MIN(id) id, no_ppb number, MAX(status) status, MAX(tgl_ppb) date, MAX(peminta) party')->get(),
            'receipt' => DB::table('ri')->whereIn('no_ri', $keys)->groupBy('no_ri')
                ->selectRaw('MIN(id) id, no_ri number, NULL status, MAX(tgl_ri) date, MAX(vendor) party')->get(),
            'ppb_draft' => DB::table('ppb_drafts')->whereIn('id', $keys)->get(['id', 'number', 'status', 'created_at as date', 'peminta as party']),
            'purchase_order' => DB::table('purchase_orders as p')->leftJoin('vendors as v', 'v.id', '=', 'p.vendor_id')->whereIn('p.id', $keys)
                ->get(['p.id', 'p.number', 'p.status', 'p.date', 'v.name as party']),
            'purchase_return' => DB::table('purchase_returns')->whereIn('id', $keys)->get(['id', 'number', 'status', 'tgl_retur as date', 'vendor as party']),
            default => collect(),
        };

        return collect($rows)->map(fn ($r) => [
            'type' => $type, 'id' => (int) $r->id, 'number' => (string) ($r->number ?? "#{$r->id}"), 'status' => $r->status,
            'date' => $r->date ? substr((string) $r->date, 0, 10) : null, 'party' => $r->party,
        ])->sortByDesc('date')->values();
    }

    private static function lineDoc(string $type, string $table, string $column, int $id): ?DocRef
    {
        $no = DB::table($table)->where('id', $id)->value($column);
        if ($no === null || $no === '') {
            // a line without a number yet: it is its own document
            return DB::table($table)->where('id', $id)->exists() ? new DocRef($type, "#{$id}", $id, "#{$id}") : null;
        }
        $first = (int) DB::table($table)->where($column, $no)->min('id');

        return new DocRef($type, (string) $no, $first, (string) $no);
    }

    private static function itemRequestStaff(User $user): bool
    {
        return $user->hasPermission('item_request.view') || $user->hasPermission('item_request.process')
            || collect(ItemRequestApprovalService::PERMISSIONS)->contains(fn ($p) => $user->hasPermission($p));
    }
}
