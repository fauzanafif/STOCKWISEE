<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\CustomDashboard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Custom dashboards: only their layout is kept here. Each widget names a source, an API STOCKWISE already has
 * (module-stats, reminders, approvals, activity-logs, the MRP / Disassembly dashboards, the document lists),
 * which the page reads with the viewer's own token: the data follows the viewer's permissions there.
 */
class CustomDashboardController extends Controller
{
    /** source => the widget types it can show (the frontend catalog reads the same list) */
    public const SOURCES = [
        'stats.request' => ['kpi', 'line', 'pie', 'bar', 'table'],
        'stats.ppb' => ['kpi', 'line', 'pie', 'bar', 'table'],
        'stats.po' => ['kpi', 'line', 'pie', 'bar', 'table'],
        'stats.ri' => ['kpi', 'line', 'pie', 'bar', 'table'],
        'stats.important' => ['kpi', 'line', 'pie', 'bar', 'table'],
        'todo.all' => ['list'], 'todo.request' => ['list'], 'todo.ppb' => ['list'], 'todo.po' => ['list'], 'todo.ri' => ['list'], 'todo.important' => ['list'],
        'approvals' => ['list'],
        'activity' => ['list'],
        'mrp' => ['kpi', 'bar', 'pie'],
        'disassembly' => ['kpi', 'bar', 'pie'],
        'recent.item_requests' => ['table'], 'recent.npbg' => ['table'], 'recent.po' => ['table'], 'recent.ri' => ['table'],
    ];

    public const APPS = ['dashboard', 'important', 'inventory', 'purchase', 'manufacturing', 'tracking'];

    public const ICONS = ['layout-dashboard', 'bar-chart', 'pie-chart', 'trending-up', 'package', 'shopping-cart', 'warehouse', 'factory', 'clipboard-list', 'shield-check', 'activity', 'star'];

    /** the production server runs this code before its migration is approved: say so instead of failing */
    private function ready(): void
    {
        if (! Schema::hasTable('custom_dashboards')) {
            abort(response()->json(['message' => 'Custom dashboard belum aktif: migration belum dijalankan.'], 503));
        }
    }

    /** GET /custom-dashboards?app= — mine and the shared ones */
    public function index(Request $request): JsonResponse
    {
        $this->ready();
        $user = $request->user();
        $app = $request->string('app')->value();
        $rows = CustomDashboard::query()->with('owner:id,name')
            ->where(fn ($q) => $q->where('user_id', $user->id)->orWhere('visibility', CustomDashboard::SHARED))
            ->when($app !== '', fn ($q) => $q->where('app_key', $app))
            ->orderBy('name')->get();

        return response()->json(['data' => $rows->map(fn (CustomDashboard $d) => $this->row($d, $user))->values()]);
    }

    public function show(Request $request, int $id): JsonResponse
    {
        $d = $this->find($id);
        abort_unless($d->visibleTo($request->user()), 404);

        return response()->json(['data' => $this->row($d, $request->user())]);
    }

    public function store(Request $request): JsonResponse
    {
        $this->ready();
        $d = CustomDashboard::create($this->validated($request) + ['user_id' => $request->user()->id]);

        return response()->json(['data' => $this->row($d->load('owner:id,name'), $request->user())], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $d = $this->find($id);
        abort_unless($d->visibleTo($request->user()), 404);
        abort_unless($d->editableBy($request->user()), 403, 'Hanya pemilik dashboard yang bisa mengubahnya.');
        $d->update($this->validated($request));

        return response()->json(['data' => $this->row($d->load('owner:id,name'), $request->user())]);
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $d = $this->find($id);
        abort_unless($d->visibleTo($request->user()), 404);
        abort_unless($d->editableBy($request->user()), 403, 'Hanya pemilik dashboard yang bisa menghapusnya.');
        $d->delete();

        return response()->json(['data' => ['ok' => true]]);
    }

    private function find(int $id): CustomDashboard
    {
        $this->ready();

        return CustomDashboard::with('owner:id,name')->findOrFail($id);
    }

    /** @return array<string, mixed> */
    private function validated(Request $request): array
    {
        $f = $request->validate([
            'name' => ['required', 'string', 'max:100'],
            'description' => ['nullable', 'string', 'max:500'],
            'icon' => ['required', Rule::in(self::ICONS)],
            'visibility' => ['required', Rule::in([CustomDashboard::PERSONAL, CustomDashboard::SHARED])],
            'app_key' => ['nullable', Rule::in(self::APPS)],
            'widgets' => ['present', 'array', 'max:30'],
            'widgets.*.id' => ['required', 'string', 'max:40'],
            'widgets.*.source' => ['required', Rule::in(array_keys(self::SOURCES))],
            'widgets.*.type' => ['required', 'string'],
            'widgets.*.title' => ['nullable', 'string', 'max:80'],
            'widgets.*.w' => ['required', 'integer', Rule::in([3, 4, 6, 8, 12])],
            'widgets.*.h' => ['required', 'integer', Rule::in([1, 2, 3])],
        ]);
        $widgets = [];
        foreach ($f['widgets'] as $n => $w) {
            if (! in_array($w['type'], self::SOURCES[$w['source']], true)) {
                throw ValidationException::withMessages(["widgets.{$n}.type" => "Widget {$w['type']} tidak tersedia untuk sumber data {$w['source']}."]);
            }
            $widgets[] = ['id' => $w['id'], 'type' => $w['type'], 'source' => $w['source'], 'title' => isset($w['title']) ? (trim($w['title']) ?: null) : null, 'w' => (int) $w['w'], 'h' => (int) $w['h']];
        }

        return ['name' => trim($f['name']), 'description' => isset($f['description']) ? (trim($f['description']) ?: null) : null, 'icon' => $f['icon'],
            'visibility' => $f['visibility'], 'app_key' => $f['app_key'] ?? null, 'widgets' => $widgets];
    }

    private function row(CustomDashboard $d, $user): array
    {
        return [
            'id' => $d->id, 'name' => $d->name, 'description' => $d->description, 'icon' => $d->icon, 'visibility' => $d->visibility, 'app_key' => $d->app_key,
            'widgets' => $d->widgets ?? [], 'owner' => $d->owner?->name, 'mine' => $d->user_id === $user->id, 'can_edit' => $d->editableBy($user),
            'updated_at' => $d->updated_at?->toIso8601String(),
        ];
    }
}
