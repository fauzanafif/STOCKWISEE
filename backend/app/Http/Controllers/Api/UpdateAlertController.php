<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\UpdateAlert;
use App\Models\UpdateAlertView;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Update Alert. Managing them is for the Super Admin role only (deliberately not a permission, which the
 * Roles page could hand to another role). due / seen serve every signed-in user: the popup itself.
 */
class UpdateAlertController extends Controller
{
    /** 365 days */
    private const MAX_INTERVAL = 525600;

    public function index(Request $request): JsonResponse
    {
        $this->superAdminOnly($request);
        $alerts = UpdateAlert::with('creator:id,name')->withCount($this->counts())->latest('id')->get();

        return response()->json(['data' => $alerts->map(fn (UpdateAlert $a) => $this->present($a))]);
    }

    public function store(Request $request): JsonResponse
    {
        $this->superAdminOnly($request);
        $alert = UpdateAlert::create($this->validated($request) + ['is_active' => true, 'created_by' => $request->user()->id]);

        return response()->json(['data' => $this->present($alert->loadCount($this->counts()))], 201);
    }

    public function update(Request $request, UpdateAlert $updateAlert): JsonResponse
    {
        $this->superAdminOnly($request);
        $updateAlert->update($this->validated($request, $updateAlert));

        return response()->json(['data' => $this->present($updateAlert->loadCount($this->counts()))]);
    }

    public function destroy(Request $request, UpdateAlert $updateAlert): JsonResponse
    {
        $this->superAdminOnly($request);
        $updateAlert->delete();

        return response()->json(['data' => null]);
    }

    /**
     * GET /api/update-alerts/due — what this user should see now, the most pressing first, and in how
     * many seconds to ask again (next_in: the next one falls due, or one on screen ends).
     */
    public function due(Request $request): JsonResponse
    {
        $user = $request->user();
        $now = now();
        $alerts = UpdateAlert::where('is_active', true)
            ->where(fn ($q) => $q->whereNull('ends_at')->orWhere('ends_at', '>', $now))
            ->get();
        $seen = UpdateAlertView::where('user_id', $user->id)->whereIn('update_alert_id', $alerts->pluck('id'))->get()->keyBy('update_alert_id');

        $due = collect();
        $wake = collect();
        foreach ($alerts as $alert) {
            $at = $alert->nextShowFor($user, $seen->get($alert->id)?->last_seen_at);
            if (! $at) {
                continue;
            }
            if ($at->gt($now)) {
                $wake->push($at);
            } else {
                $due->push($alert);
                if ($alert->ends_at) {
                    $wake->push($alert->ends_at);
                }
            }
        }
        $first = $wake->sortBy(fn ($at) => $at->getTimestamp())->first();

        return response()->json([
            'data' => $due->sortBy(fn (UpdateAlert $a) => [$a->type === 'warning' ? 0 : 1, -$a->opensAt()->getTimestamp()])->values()
                ->map(fn (UpdateAlert $a) => [
                    'id' => $a->id, 'title' => $a->title, 'message' => $a->message, 'type' => $a->type,
                    'published_at' => $a->opensAt()->toIso8601String(),
                ]),
            'meta' => ['next_in' => $first ? max(1, (int) ceil($now->diffInSeconds($first))) : null],
        ])->header('Cache-Control', 'no-store');
    }

    /** POST /api/update-alerts/{id}/seen — this user closed it; its schedule counts from now. */
    public function seen(Request $request, UpdateAlert $updateAlert): JsonResponse
    {
        UpdateAlertView::upsert(
            [['update_alert_id' => $updateAlert->id, 'user_id' => $request->user()->id, 'last_seen_at' => now()]],
            ['user_id', 'update_alert_id'],
            ['last_seen_at'],
        );

        return response()->json(['data' => null]);
    }

    /** POST /api/update-alerts/{id}/thumbs-up — closes it as any close does; the first thumb's time stays, each person counts once. */
    public function thumbsUp(Request $request, UpdateAlert $updateAlert): JsonResponse
    {
        $key = ['update_alert_id' => $updateAlert->id, 'user_id' => $request->user()->id];
        UpdateAlertView::upsert([$key + ['last_seen_at' => now()]], ['user_id', 'update_alert_id'], ['last_seen_at']);
        UpdateAlertView::where($key)->whereNull('thumbed_up_at')->update(['thumbed_up_at' => now()]);

        return response()->json(['data' => null]);
    }

    /** GET /api/update-alerts/{id}/thumbs-up — who gave a thumbs up and when, newest first. */
    public function thumbs(Request $request, UpdateAlert $updateAlert): JsonResponse
    {
        $this->superAdminOnly($request);
        $rows = UpdateAlertView::query()->join('users', 'users.id', '=', 'update_alert_views.user_id')
            ->where('update_alert_views.update_alert_id', $updateAlert->id)->whereNotNull('update_alert_views.thumbed_up_at')
            ->orderByDesc('update_alert_views.thumbed_up_at')->get(['users.id', 'users.name', 'users.username', 'update_alert_views.thumbed_up_at']);

        return response()->json(['data' => $rows->map(fn ($r) => ['id' => $r->id, 'name' => $r->name, 'username' => $r->username, 'at' => $r->thumbed_up_at?->toIso8601String()])->values()]);
    }

    /** GET /api/update-alerts/{id}/closed-by — who closed it, the last time each did, and whether with a thumb. */
    public function closedBy(Request $request, UpdateAlert $updateAlert): JsonResponse
    {
        $this->superAdminOnly($request);
        $rows = UpdateAlertView::query()->join('users', 'users.id', '=', 'update_alert_views.user_id')
            ->where('update_alert_views.update_alert_id', $updateAlert->id)->orderByDesc('update_alert_views.last_seen_at')
            ->get(['users.id', 'users.name', 'users.username', 'update_alert_views.last_seen_at', 'update_alert_views.thumbed_up_at']);

        return response()->json(['data' => $rows->map(fn ($r) => ['id' => $r->id, 'name' => $r->name, 'username' => $r->username, 'at' => $r->last_seen_at?->toIso8601String(), 'thumbs_up' => $r->thumbed_up_at !== null])->values()]);
    }

    private function counts(): array
    {
        return ['views', 'views as thumbs_count' => fn ($q) => $q->whereNotNull('thumbed_up_at')];
    }

    private function superAdminOnly(Request $request): void
    {
        abort_unless($request->user()->hasRole('super_admin'), 403, 'Super Admin only.');
    }

    /** The fields to save; on an edit only what was sent, checked together with what it already has. */
    private function validated(Request $request, ?UpdateAlert $alert = null): array
    {
        $required = $alert ? 'sometimes' : 'required';
        $data = $request->validate([
            'title' => [$required, 'string', 'max:120'],
            'message' => [$required, 'string', 'max:2000'],
            'type' => [$required, Rule::in(UpdateAlert::TYPES)],
            'display_mode' => [$required, Rule::in(UpdateAlert::MODES)],
            'interval_minutes' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:'.self::MAX_INTERVAL],
            'starts_at' => ['sometimes', 'nullable', 'date'],
            'ends_at' => ['sometimes', 'nullable', 'date'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        foreach (['title', 'message'] as $field) {
            if (array_key_exists($field, $data)) {
                $data[$field] = trim($data[$field]);
                if ($data[$field] === '') {
                    throw ValidationException::withMessages([$field => "The {$field} is required."]);
                }
            }
        }
        // the browser sends the moment with its offset; stored in the app's own timezone
        foreach (['starts_at', 'ends_at'] as $field) {
            if (! empty($data[$field])) {
                $data[$field] = Carbon::parse($data[$field])->setTimezone(config('app.timezone'));
            }
        }

        $mode = $data['display_mode'] ?? $alert?->display_mode;
        if ($mode === 'interval') {
            $interval = array_key_exists('interval_minutes', $data) ? $data['interval_minutes'] : $alert?->interval_minutes;
            if (! $interval) {
                throw ValidationException::withMessages(['interval_minutes' => 'Fill in how often the alert repeats.']);
            }
        } else {
            $data['interval_minutes'] = null;
        }

        $starts = array_key_exists('starts_at', $data) ? $data['starts_at'] : $alert?->starts_at;
        $ends = array_key_exists('ends_at', $data) ? $data['ends_at'] : $alert?->ends_at;
        if ($starts && $ends && $ends->lte($starts)) {
            throw ValidationException::withMessages(['ends_at' => 'The end must be after the start.']);
        }

        return $data;
    }

    private function present(UpdateAlert $a): array
    {
        return [
            'id' => $a->id, 'title' => $a->title, 'message' => $a->message, 'type' => $a->type,
            'display_mode' => $a->display_mode, 'interval_minutes' => $a->interval_minutes,
            'starts_at' => $a->starts_at?->toIso8601String(), 'ends_at' => $a->ends_at?->toIso8601String(),
            'is_active' => $a->is_active, 'status' => $a->status(), 'seen_count' => (int) $a->views_count, 'thumbs_count' => (int) $a->thumbs_count,
            'created_by' => $a->creator?->name, 'created_at' => $a->created_at?->toIso8601String(),
        ];
    }
}
