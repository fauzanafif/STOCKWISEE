<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Support\AutoRefresh;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * GET /api/live — one stamp per area that changes when anything in it changes (made, edited, deleted).
 * The app asks every few seconds and refetches only the area that changed, so what one account does shows
 * on the others at once. Deliberately tiny (a few MAX / COUNT), because the server answers one request at
 * a time: a long-open connection (WebSocket / SSE) would hold everyone else up.
 */
class LiveController extends Controller
{
    /** area => tables, each [table, columns to watch] */
    private const AREAS = [
        'request' => [
            ['item_requests', ['MAX(updated_at)', 'COUNT(*)']],
            ['item_request_lines', ['MAX(updated_at)', 'COUNT(*)']],
            ['item_request_fulfillments', ['MAX(updated_at)', 'COUNT(*)']],
            ['item_request_approvals', ['MAX(id)']],
        ],
        'important' => [
            ['important_requests', ['MAX(updated_at)', 'COUNT(*)']],
            ['important_request_assignees', ['MAX(updated_at)', 'COUNT(*)']],
            ['important_request_comments', ['MAX(updated_at)', 'COUNT(*)']],
            ['important_request_submissions', ['MAX(updated_at)', 'COUNT(*)']],
        ],
        'purchasing' => [
            ['purchase_orders', ['MAX(updated_at)', 'COUNT(*)']],
            ['purchase_order_items', ['MAX(updated_at)', 'COUNT(*)']],
            ['purchase_order_quotes', ['MAX(updated_at)', 'COUNT(*)']],
            ['purchase_order_approvals', ['MAX(id)']],
            ['ppb_approvals', ['MAX(id)']],
            ['ppb_drafts', ['MAX(updated_at)', 'COUNT(*)']],
            ['ppb_draft_lines', ['MAX(updated_at)', 'COUNT(*)']],
        ],
        'alerts' => [
            ['update_alerts', ['MAX(updated_at)', 'COUNT(*)']],
        ],
    ];

    public function index(Request $request): JsonResponse
    {
        // meta.refresh: how often to ask again. Switched off: tabs only look now and then whether it is back on.
        $refresh = AutoRefresh::get();
        if (! $refresh['enabled']) {
            return response()->json(['data' => (object) [], 'meta' => ['refresh' => $refresh]])->header('Cache-Control', 'no-store');
        }

        $parts = [];
        foreach (self::AREAS as $area => $tables) {
            foreach ($tables as [$table, $cols]) {
                foreach ($cols as $col) {
                    $parts[$area][] = "(SELECT {$col} FROM {$table})";
                }
            }
        }
        $user = $request->user();
        $parts['notifications'] = [
            '(SELECT MAX(updated_at) FROM notifications WHERE notifiable_id = '.(int) $user->id.')',
            '(SELECT COUNT(*) FROM notifications WHERE notifiable_id = '.(int) $user->id.' AND read_at IS NULL)',
        ];
        $select = collect($parts)->map(fn ($cols, $area) => "CONCAT_WS('|', ".implode(', ', $cols).") AS `{$area}`")->implode(', ');
        if (DB::getDriverName() === 'sqlite') {
            $select = collect($parts)->map(fn ($cols, $area) => '('.implode(" || '|' || ", array_map(fn ($c) => "IFNULL({$c}, '')", $cols)).") AS \"{$area}\"")->implode(', ');
        }
        $row = (array) DB::selectOne("SELECT {$select}");

        return response()->json(['data' => collect($row)->map(fn ($v) => substr(md5((string) $v), 0, 12)), 'meta' => ['refresh' => $refresh]])
            ->header('Cache-Control', 'no-store');
    }
}
