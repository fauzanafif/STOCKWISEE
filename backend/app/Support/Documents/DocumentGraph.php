<?php

namespace App\Support\Documents;

use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Related documents, read from the links the transactions already store (no table of its own, nothing copied):
 *   Item Request ─ item_request_lines.npbg_id / fulfillments.no_npbg ─▶ Delivery Order
 *   Item Request ─ ppb_drafts.item_request_id / item_request_lines.ppb_draft_id ─▶ Draft Purchase Request ─ no_ppb ─▶ Purchase Request
 *   Purchase Request ─ purchase_order_items.approved_ppb_id / purchase_orders.ppb_id / ri.no_ppb+no_po ─▶ Purchase Order
 *   Purchase Order ─ ri.no_po ─▶ Receipt ─ purchase_returns.no_ri / purchase_return_lines.ri_id ─▶ Return
 * and back. Only types the user may open are returned (an Item Request only when it is theirs, or they handle requests).
 */
final class DocumentGraph
{
    /** @return list<array{type:string, label:string, count:int, docs:list<array<string, mixed>>}> */
    public static function related(DocRef $doc, User $user): array
    {
        $out = [];
        foreach (self::keys($doc) as $type => $keys) {
            if ($type === $doc->type || ($type !== 'item_request' && ! DocumentRegistry::canViewType($user, $type))) {
                continue;
            }
            $docs = DocumentRegistry::summaries($type, $keys, $user);
            if ($docs->isNotEmpty()) {
                $out[] = ['type' => $type, 'label' => DocumentRegistry::label($type, $docs->count() !== 1), 'count' => $docs->count(), 'docs' => $docs->all()];
            }
        }

        return $out;
    }

    /** @return array<string, list<string|int>> type => keys of the related documents */
    public static function keys(DocRef $doc): array
    {
        return match ($doc->type) {
            'item_request' => self::fromItemRequest((int) $doc->key),
            'delivery_order' => ['item_request' => self::requestsOfNpbg($doc->key)],
            'ppb_draft' => self::fromDraft((int) $doc->key),
            'purchase_request' => self::fromPpb($doc->key),
            'purchase_order' => self::fromPo((int) $doc->key),
            'receipt' => self::fromRi($doc->key),
            'purchase_return' => self::fromReturn((int) $doc->key),
            default => [],
        };
    }

    private static function fromItemRequest(int $id): array
    {
        $lineNpbg = DB::table('item_request_lines')->where('item_request_id', $id)->whereNotNull('npbg_id')->pluck('npbg_id');
        $fulfilNpbg = DB::table('item_request_fulfillment_lines as fl')->join('item_request_fulfillments as f', 'f.id', '=', 'fl.item_request_fulfillment_id')
            ->where('f.item_request_id', $id)->whereNotNull('fl.npbg_id')->pluck('fl.npbg_id');
        $npbg = DB::table('npbg')->whereIn('id', $lineNpbg->merge($fulfilNpbg)->unique()->all())->pluck('no_npbg')
            ->merge(DB::table('item_request_fulfillments')->where('item_request_id', $id)->whereNotNull('no_npbg')->pluck('no_npbg'));
        $drafts = DB::table('ppb_drafts')->where('item_request_id', $id)->pluck('id')
            ->merge(DB::table('item_request_lines')->where('item_request_id', $id)->whereNotNull('ppb_draft_id')->pluck('ppb_draft_id'))->unique();
        $ppb = DB::table('ppb')->whereIn('id', DB::table('item_request_lines')->where('item_request_id', $id)->whereNotNull('ppb_id')->pluck('ppb_id')->all())->pluck('no_ppb')
            ->merge(DB::table('ppb_drafts')->whereIn('id', $drafts->all())->whereNotNull('no_ppb')->pluck('no_ppb'));

        return ['delivery_order' => $npbg->filter()->all(), 'ppb_draft' => $drafts->all(), 'purchase_request' => $ppb->filter()->all()];
    }

    private static function requestsOfNpbg(string $no): array
    {
        $ids = DB::table('npbg')->where('no_npbg', $no)->pluck('id')->all();

        return DB::table('item_request_lines')->whereIn('npbg_id', $ids)->pluck('item_request_id')
            ->merge(DB::table('item_request_fulfillments')->where('no_npbg', $no)->pluck('item_request_id'))
            ->merge(DB::table('item_request_fulfillment_lines as fl')->join('item_request_fulfillments as f', 'f.id', '=', 'fl.item_request_fulfillment_id')
                ->whereIn('fl.npbg_id', $ids)->pluck('f.item_request_id'))
            ->unique()->all();
    }

    private static function fromDraft(int $id): array
    {
        $requests = DB::table('ppb_drafts')->where('id', $id)->whereNotNull('item_request_id')->pluck('item_request_id')
            ->merge(DB::table('ppb_draft_lines as l')->join('item_request_lines as r', 'r.id', '=', 'l.item_request_line_id')->where('l.ppb_draft_id', $id)->pluck('r.item_request_id'));
        $ppb = DB::table('ppb_drafts')->where('id', $id)->whereNotNull('no_ppb')->pluck('no_ppb')
            ->merge(DB::table('ppb')->whereIn('id', DB::table('ppb_draft_lines')->where('ppb_draft_id', $id)->whereNotNull('ppb_id')->pluck('ppb_id')->all())->pluck('no_ppb'));

        return ['item_request' => $requests->unique()->all(), 'purchase_request' => $ppb->filter()->unique()->all()];
    }

    private static function fromPpb(string $no): array
    {
        $ids = DB::table('ppb')->where('no_ppb', $no)->pluck('id')->all();
        $drafts = DB::table('ppb_drafts')->where('no_ppb', $no)->pluck('id')
            ->merge(DB::table('ppb_draft_lines')->whereIn('ppb_id', $ids)->pluck('ppb_draft_id'))->unique();
        $requests = DB::table('item_request_lines')->whereIn('ppb_id', $ids)->pluck('item_request_id')
            ->merge(DB::table('ppb_drafts')->whereIn('id', $drafts->all())->whereNotNull('item_request_id')->pluck('item_request_id'));
        $riPo = DB::table('ri')->where('no_ppb', $no)->whereNotNull('no_po')->distinct()->pluck('no_po');
        $pos = DB::table('purchase_order_items')->whereIn('approved_ppb_id', $ids)->pluck('purchase_order_id')
            ->merge(DB::table('purchase_orders')->whereIn('ppb_id', $ids)->pluck('id'))
            ->merge(DB::table('purchase_orders')->whereIn('number', $riPo->all())->pluck('id'));

        return [
            'item_request' => $requests->unique()->all(), 'ppb_draft' => $drafts->all(), 'purchase_order' => $pos->unique()->all(),
            'receipt' => DB::table('ri')->where('no_ppb', $no)->distinct()->pluck('no_ri')->filter()->all(),
        ];
    }

    private static function fromPo(int $id): array
    {
        $number = DB::table('purchase_orders')->where('id', $id)->value('number');
        $ppbIds = DB::table('purchase_order_items')->where('purchase_order_id', $id)->whereNotNull('approved_ppb_id')->pluck('approved_ppb_id')
            ->merge(DB::table('purchase_orders')->where('id', $id)->whereNotNull('ppb_id')->pluck('ppb_id'));
        $ppb = DB::table('ppb')->whereIn('id', $ppbIds->unique()->all())->pluck('no_ppb')
            ->merge($number ? DB::table('ri')->where('no_po', $number)->whereNotNull('no_ppb')->distinct()->pluck('no_ppb') : collect());

        return [
            'purchase_request' => $ppb->filter()->unique()->all(),
            'receipt' => $number ? DB::table('ri')->where('no_po', $number)->distinct()->pluck('no_ri')->filter()->all() : [],
            'purchase_return' => $number ? DB::table('purchase_returns')->where('no_po', $number)->pluck('id')->all() : [],
        ];
    }

    private static function fromRi(string $no): array
    {
        $ids = DB::table('ri')->where('no_ri', $no)->pluck('id')->all();
        $po = DB::table('ri')->where('no_ri', $no)->whereNotNull('no_po')->distinct()->pluck('no_po');

        return [
            'purchase_order' => DB::table('purchase_orders')->whereIn('number', $po->all())->pluck('id')->all(),
            'purchase_request' => DB::table('ri')->where('no_ri', $no)->whereNotNull('no_ppb')->distinct()->pluck('no_ppb')->all(),
            'purchase_return' => DB::table('purchase_returns')->where('no_ri', $no)->pluck('id')
                ->merge(DB::table('purchase_return_lines')->whereIn('ri_id', $ids)->pluck('purchase_return_id'))->unique()->all(),
        ];
    }

    private static function fromReturn(int $id): array
    {
        $r = DB::table('purchase_returns')->where('id', $id)->first(['no_ri', 'no_po']);
        $riNos = DB::table('ri')->whereIn('id', DB::table('purchase_return_lines')->where('purchase_return_id', $id)->whereNotNull('ri_id')->pluck('ri_id')->all())->pluck('no_ri')
            ->merge($r?->no_ri ? [$r->no_ri] : []);

        return [
            'receipt' => $riNos->filter()->unique()->all(),
            'purchase_order' => $r?->no_po ? DB::table('purchase_orders')->where('number', $r->no_po)->pluck('id')->all() : [],
        ];
    }
}
