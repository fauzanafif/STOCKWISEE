<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DashboardNote;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * /api/dashboard-notes — the user's own sticky notes on the main dashboard. Every query is scoped to the
 * signed-in user, so another user's note is simply not found (404).
 */
class DashboardNoteController extends Controller
{
    private const LIMIT = 200;

    public function index(Request $request): JsonResponse
    {
        $notes = DashboardNote::where('user_id', $request->user()->id)
            ->orderByDesc('pinned')->orderByRaw('done_at IS NOT NULL')->orderByDesc('updated_at')
            ->limit(self::LIMIT)->get();

        return response()->json(['data' => $notes->map(fn (DashboardNote $n) => $this->out($n))]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        if (DashboardNote::where('user_id', $user->id)->count() >= self::LIMIT) {
            throw ValidationException::withMessages(['title' => 'Maksimal '.self::LIMIT.' catatan. Hapus catatan lama dulu.']);
        }
        $data = $this->validated($request, true);
        $note = DashboardNote::create([...$data, 'user_id' => $user->id]);

        return response()->json(['data' => $this->out($note)], 201);
    }

    public function update(Request $request, int $note): JsonResponse
    {
        $row = $this->mine($request, $note);
        $data = $this->validated($request, false);
        $row->fill($data);
        if (blank($row->title) && blank($row->body) && empty($row->checklist)) {
            throw ValidationException::withMessages(['title' => 'Isi judul, catatan, atau checklist.']);
        }
        $row->save();

        return response()->json(['data' => $this->out($row)]);
    }

    public function destroy(Request $request, int $note): JsonResponse
    {
        $this->mine($request, $note)->delete();

        return response()->json(['data' => ['deleted' => true]]);
    }

    private function mine(Request $request, int $id): DashboardNote
    {
        return DashboardNote::where('user_id', $request->user()->id)->findOrFail($id);
    }

    private function validated(Request $request, bool $creating): array
    {
        $req = $creating ? 'nullable' : 'sometimes';
        $data = $request->validate([
            'title' => [$req, 'nullable', 'string', 'max:120'],
            'body' => [$req, 'nullable', 'string', 'max:2000'],
            'checklist' => [$req, 'nullable', 'array', 'max:30'],
            'checklist.*.text' => ['nullable', 'string', 'max:200'],
            'checklist.*.done' => ['sometimes', 'boolean'],
            'color' => [$req, Rule::in(DashboardNote::COLORS)],
            'pinned' => [$req, 'boolean'],
            'done' => [$req, 'boolean'],
            'remind_at' => [$req, 'nullable', 'date'],
        ]);
        if (array_key_exists('title', $data)) {
            $data['title'] = filled($data['title']) ? trim($data['title']) : null;
        }
        if (array_key_exists('checklist', $data)) {
            $data['checklist'] = collect($data['checklist'] ?? [])
                ->map(fn ($i) => ['text' => trim((string) ($i['text'] ?? '')), 'done' => (bool) ($i['done'] ?? false)])
                ->filter(fn ($i) => $i['text'] !== '')->values()->all() ?: null;
        }
        if (! empty($data['remind_at'])) {
            // the browser sends its own moment (ISO with offset); keep it as the same moment in the app's time
            $data['remind_at'] = \Illuminate\Support\Carbon::parse($data['remind_at'])->setTimezone(config('app.timezone'));
        }
        if (array_key_exists('done', $data)) {
            $data['done_at'] = $data['done'] ? now() : null;
            unset($data['done']);
        }
        if ($creating && blank($data['title'] ?? null) && blank($data['body'] ?? null) && empty($data['checklist'])) {
            throw ValidationException::withMessages(['title' => 'Isi judul, catatan, atau checklist.']);
        }

        return $data;
    }

    private function out(DashboardNote $n): array
    {
        return [
            'id' => $n->id, 'title' => $n->title, 'body' => $n->body, 'checklist' => $n->checklist ?? [],
            'color' => $n->color, 'pinned' => $n->pinned, 'done' => $n->done_at !== null,
            'done_at' => $n->done_at?->toIso8601String(), 'remind_at' => $n->remind_at?->toIso8601String(),
            'updated_at' => $n->updated_at?->toIso8601String(),
        ];
    }
}
