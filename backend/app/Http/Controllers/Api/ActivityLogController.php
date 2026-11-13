<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Models\UserActivityLog;
use App\Support\ActivityLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;

/**
 * User Log: what every user did, to the second. POST page-view is written by the app itself whenever a page
 * or tab is opened; the list needs audit_log.view (checked on the route).
 */
class ActivityLogController extends Controller
{
    public function pageView(Request $request): JsonResponse
    {
        $data = $request->validate([
            'path' => ['required', 'string', 'max:255', 'starts_with:/'],
            'title' => ['nullable', 'string', 'max:160'],
        ]);
        ActivityLogger::record('PAGE_VIEW', $request, [
            'module' => 'Halaman',
            'description' => mb_substr('Membuka '.(($data['title'] ?? null) ?: $data['path']), 0, 255),
            'subject' => $data['title'] ?? null,
            'path' => $data['path'],
            'status' => 200,
        ]);

        return response()->json(['data' => ['ok' => true]]);
    }

    public function index(Request $request): JsonResponse
    {
        $f = $request->validate([
            'user_id' => ['nullable', 'integer'],
            'event' => ['nullable', Rule::in(UserActivityLog::EVENTS)],
            'module' => ['nullable', 'string', 'max:80'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
            'search' => ['nullable', 'string', 'max:100'],
            'page' => ['nullable', 'integer', 'min:1'],
            'per_page' => ['nullable', 'integer', 'min:10', 'max:200'],
        ]);
        $q = UserActivityLog::query()
            ->when($f['user_id'] ?? null, fn ($q, $v) => $q->where('user_id', $v))
            ->when($f['event'] ?? null, fn ($q, $v) => $q->where('event', $v))
            ->when($f['module'] ?? null, fn ($q, $v) => $q->where('module', $v))
            ->when($f['from'] ?? null, fn ($q, $v) => $q->where('created_at', '>=', Carbon::parse($v)->startOfDay()))
            ->when($f['to'] ?? null, fn ($q, $v) => $q->where('created_at', '<=', Carbon::parse($v)->endOfDay()))
            ->when($f['search'] ?? null, function ($q, $v) {
                $like = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $v).'%';
                $q->where(fn ($w) => $w->where('description', 'like', $like)->orWhere('subject', 'like', $like)
                    ->orWhere('path', 'like', $like)->orWhere('user_name', 'like', $like)->orWhere('ip', 'like', $like));
            })
            ->orderByDesc('id');
        $page = $q->paginate($f['per_page'] ?? 50);

        return response()->json([
            'data' => collect($page->items())->map(fn (UserActivityLog $l) => [
                'id' => $l->id, 'at' => $l->created_at?->toIso8601String(), 'user_id' => $l->user_id, 'user_name' => $l->user_name,
                'event' => $l->event, 'module' => $l->module, 'description' => $l->description, 'subject' => $l->subject,
                'method' => $l->method, 'path' => $l->path, 'route' => $l->route, 'status' => $l->status,
                'ip' => $l->ip, 'user_agent' => $l->user_agent, 'details' => $l->details,
            ]),
            'meta' => [
                'page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total(), 'per_page' => $page->perPage(),
                'users' => User::orderBy('name')->get(['id', 'name', 'username']),
                'modules' => UserActivityLog::query()->whereNotNull('module')->distinct()->orderBy('module')->limit(200)->pluck('module'),
            ],
        ]);
    }
}
