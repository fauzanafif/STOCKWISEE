<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DocActivity;
use App\Models\DocAuditLog;
use App\Models\DocMessage;
use App\Models\DocMessageAttachment;
use App\Models\User;
use App\Support\Documents\DocRef;
use App\Support\Documents\DocumentActivities;
use App\Support\Documents\DocumentAudit;
use App\Support\Documents\DocumentGraph;
use App\Support\Documents\DocumentRegistry;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * /api/documents/{type}/{id}/… — Smart Buttons (related documents), Chatter, Activities and Audit of a transaction
 * document. Whoever may open the document's page may read its related documents, messages and changes;
 * internal notes and activities are for its staff (DocumentRegistry::isStaff). Nothing here changes the document.
 */
class DocumentController extends Controller
{
    private const DISK = 'local';

    private const MAX_FILE_KB = 10240;

    private const MIMES = 'jpg,jpeg,png,gif,webp,pdf,doc,docx,xls,xlsx,csv,txt,ppt,pptx,zip';

    // ------------------------------------------------------------------ Smart Buttons

    public function related(Request $request, string $type, int $id): JsonResponse
    {
        [$doc, $user, $staff] = $this->open($request, $type, $id);
        $openActivities = $staff ? DocActivity::where(['res_type' => $doc->type, 'res_key' => $doc->key])->whereNull('done_at')->whereNull('cancelled_at')->count() : 0;

        return response()->json(['data' => [
            'document' => $doc->toArray(),
            'groups' => DocumentGraph::related($doc, $user),
            'counts' => [
                'messages' => $this->messageQuery($doc, $staff)->whereNull('deleted_at')->count(),
                'activities' => $openActivities + count(DocumentActivities::system($doc, $user)),
            ],
        ]]);
    }

    // ------------------------------------------------------------------ Chatter

    /** The document's feed: messages, internal notes (staff), tracked changes and activity events, newest first. */
    public function feed(Request $request, string $type, int $id): JsonResponse
    {
        [$doc, $user, $staff] = $this->open($request, $type, $id);
        $messages = $this->messageQuery($doc, $staff)->with(['user:id,name', 'attachments'])->orderByDesc('id')->limit(300)->get()
            ->map(fn (DocMessage $m) => [
                'id' => "m{$m->id}", 'message_id' => $m->id, 'kind' => $m->kind, 'at' => $this->iso($m->created_at),
                'user_id' => $m->user_id, 'user_name' => $m->user?->name,
                'body' => $m->deleted_at ? null : $m->body, 'deleted' => (bool) $m->deleted_at, 'edited' => (bool) $m->edited_at,
                'can_edit' => ! $m->deleted_at && (int) $m->user_id === (int) $user->id,
                'attachments' => $m->deleted_at ? [] : $m->attachments->map(fn ($a) => ['id' => $a->id, 'name' => $a->original_name, 'mime' => $a->mime, 'size' => $a->size])->values(),
            ]);
        $tracking = DocAuditLog::where(['res_type' => $doc->type, 'res_key' => $doc->key])->orderByDesc('id')->limit(300)->get()
            ->map(fn (DocAuditLog $l) => [
                'id' => "a{$l->id}", 'kind' => 'TRACKING', 'at' => $this->iso($l->created_at), 'user_name' => $l->user_name,
                'event' => $l->event, 'model' => $l->model, 'changes' => $l->changes ?? [], 'reason' => $l->reason,
            ]);

        return response()->json(['data' => $messages->concat($tracking)->sortByDesc('at')->values(), 'meta' => ['staff' => $staff, 'document' => $doc->toArray()]]);
    }

    public function postMessage(Request $request, string $type, int $id): JsonResponse
    {
        [$doc, $user, $staff] = $this->open($request, $type, $id);
        $data = $request->validate([
            'kind' => ['required', Rule::in(DocMessage::KINDS)],
            'body' => ['nullable', 'string', 'max:5000'],
            'files' => ['nullable', 'array', 'max:5'],
            'files.*' => ['file', 'max:'.self::MAX_FILE_KB, 'mimes:'.self::MIMES],
        ], ['files.*.max' => 'Lampiran paling besar 10 MB.', 'files.*.mimes' => 'Jenis lampiran tidak didukung.']);
        if ($data['kind'] === 'NOTE' && ! $staff) {
            abort(403, 'Catatan internal hanya untuk petugas dokumen ini.');
        }
        $body = trim((string) ($data['body'] ?? ''));
        if ($body === '' && empty($data['files'])) {
            throw ValidationException::withMessages(['body' => 'Tulis pesan atau lampirkan file.']);
        }
        $message = DB::transaction(function () use ($doc, $user, $data, $body, $request) {
            $m = DocMessage::create(['res_type' => $doc->type, 'res_key' => $doc->key, 'kind' => $data['kind'], 'body' => $body, 'user_id' => $user->id]);
            foreach ($request->file('files', []) as $file) {
                $path = $file->store("doc-chatter/{$doc->type}/".Str::slug($doc->key ?: (string) $doc->id), self::DISK);
                $m->attachments()->create(['original_name' => mb_substr($file->getClientOriginalName(), 0, 255), 'path' => $path,
                    'mime' => $file->getMimeType(), 'size' => (int) $file->getSize(), 'uploaded_by' => $user->id]);
            }

            return $m;
        });

        return response()->json(['data' => ['id' => $message->id]], 201);
    }

    /** Only the author edits or deletes their own message; both are kept in the Audit Trail (before → after). */
    public function updateMessage(Request $request, string $type, int $id, DocMessage $message): JsonResponse
    {
        [$doc, $user] = $this->open($request, $type, $id);
        $this->ownMessage($doc, $user, $message);
        $data = $request->validate(['body' => ['required', 'string', 'max:5000']]);
        $before = $message->body;
        $message->update(['body' => trim($data['body']), 'edited_at' => now()]);
        DocumentAudit::event($doc, 'MESSAGE_EDITED', 'DocMessage', $message->id, ['body' => [Str::limit($before, 300), Str::limit($message->body, 300)]]);

        return response()->json(['data' => ['id' => $message->id]]);
    }

    public function deleteMessage(Request $request, string $type, int $id, DocMessage $message): JsonResponse
    {
        [$doc, $user] = $this->open($request, $type, $id);
        $this->ownMessage($doc, $user, $message);
        $message->update(['deleted_at' => now(), 'deleted_by' => $user->id]);
        DocumentAudit::event($doc, 'MESSAGE_DELETED', 'DocMessage', $message->id, ['body' => [Str::limit($message->body, 300), null]]);

        return response()->json(['data' => ['id' => $message->id]]);
    }

    public function attachment(Request $request, string $type, int $id, DocMessageAttachment $attachment): StreamedResponse
    {
        [$doc, , $staff] = $this->open($request, $type, $id);
        $message = $attachment->message;
        abort_unless($message && $message->res_type === $doc->type && $message->res_key === $doc->key && ! $message->deleted_at, 404);
        abort_if($message->kind === 'NOTE' && ! $staff, 403);
        abort_unless(Storage::disk(self::DISK)->exists($attachment->path), 404);

        return Storage::disk(self::DISK)->download($attachment->path, $attachment->original_name);
    }

    // ------------------------------------------------------------------ Activities

    public function activities(Request $request, string $type, int $id): JsonResponse
    {
        [$doc, $user, $staff] = $this->open($request, $type, $id);
        $manual = $staff ? DocActivity::with(['assignee:id,name', 'creator:id,name', 'doneBy:id,name'])->where(['res_type' => $doc->type, 'res_key' => $doc->key])
            ->orderByRaw('CASE WHEN done_at IS NULL AND cancelled_at IS NULL THEN 0 ELSE 1 END')->orderBy('due_date')->orderByDesc('id')->get()
            ->map(fn (DocActivity $a) => $this->activityRow($a, $user)) : collect();

        return response()->json(['data' => [
            'system' => DocumentActivities::system($doc, $user),
            'manual' => $manual->values(),
            'types' => DocumentActivities::TYPE_LABEL,
            'can_schedule' => $staff,
        ]]);
    }

    public function scheduleActivity(Request $request, string $type, int $id): JsonResponse
    {
        [$doc, $user, $staff] = $this->open($request, $type, $id);
        abort_unless($staff, 403, 'Hanya petugas dokumen ini yang bisa menjadwalkan aktivitas.');
        $data = $request->validate([
            'activity_type' => ['required', Rule::in(DocActivity::TYPES)],
            'summary' => ['nullable', 'string', 'max:200'],
            'note' => ['nullable', 'string', 'max:2000'],
            'assignee_id' => ['required', 'integer'],
            'due_date' => ['required', 'date', 'after_or_equal:today'],
        ], ['due_date.after_or_equal' => 'Tenggat tidak boleh sebelum hari ini.']);
        $a = DocumentActivities::schedule($doc, $user, $data);

        return response()->json(['data' => $this->activityRow($a->load(['assignee:id,name', 'creator:id,name']), $user)], 201);
    }

    public function completeActivity(Request $request, string $type, int $id, DocActivity $activity): JsonResponse
    {
        [$doc, $user] = $this->open($request, $type, $id);
        abort_unless($activity->res_type === $doc->type && $activity->res_key === $doc->key, 404);
        $data = $request->validate(['note' => ['nullable', 'string', 'max:500']]);

        return response()->json(['data' => $this->activityRow(DocumentActivities::complete($activity, $doc, $user, $data['note'] ?? null)->load(['assignee:id,name', 'creator:id,name', 'doneBy:id,name']), $user)]);
    }

    public function cancelActivity(Request $request, string $type, int $id, DocActivity $activity): JsonResponse
    {
        [$doc, $user] = $this->open($request, $type, $id);
        abort_unless($activity->res_type === $doc->type && $activity->res_key === $doc->key, 404);

        return response()->json(['data' => $this->activityRow(DocumentActivities::cancel($activity, $doc, $user)->load(['assignee:id,name', 'creator:id,name']), $user)]);
    }

    /** Who an activity can be given to: active users who may open this document. */
    public function assignees(Request $request, string $type, int $id): JsonResponse
    {
        [$doc, , $staff] = $this->open($request, $type, $id);
        abort_unless($staff, 403);
        $users = User::where('is_active', true)->orderBy('name')->get(['id', 'name'])->filter(fn (User $u) => DocumentRegistry::canView($u, $doc));

        return response()->json(['data' => $users->map(fn ($u) => ['id' => $u->id, 'name' => $u->name])->values()]);
    }

    /** GET /api/documents/activities/mine — my open activities across documents (also shown in the To-Do). */
    public function myActivities(Request $request): JsonResponse
    {
        $user = $request->user();
        $rows = DocActivity::where('assignee_id', $user->id)->whereNull('done_at')->whereNull('cancelled_at')->orderBy('due_date')->limit(200)->get();

        return response()->json(['data' => $rows->map(fn ($a) => $this->activityRow($a, $user) + [
            'document' => ['type' => $a->res_type, 'id' => $a->res_id, 'number' => $a->res_number, 'label' => DocumentRegistry::label($a->res_type),
                'path' => DocumentActivities::path($a->res_type, (int) $a->res_id)],
        ])]);
    }

    // ------------------------------------------------------------------ Audit

    public function audit(Request $request, string $type, int $id): JsonResponse
    {
        [$doc] = $this->open($request, $type, $id);
        $rows = DocAuditLog::where(['res_type' => $doc->type, 'res_key' => $doc->key])->orderByDesc('id')->paginate(min(max((int) $request->integer('per_page', 50), 1), 200));

        return response()->json([
            'data' => collect($rows->items())->map(fn (DocAuditLog $l) => ['id' => $l->id, 'at' => $this->iso($l->created_at), 'user_name' => $l->user_name, 'event' => $l->event,
                'model' => $l->model, 'model_id' => $l->model_id, 'changes' => $l->changes ?? [], 'reason' => $l->reason, 'ip' => $l->ip]),
            'meta' => ['page' => $rows->currentPage(), 'per_page' => $rows->perPage(), 'total' => $rows->total(), 'last_page' => $rows->lastPage()],
        ]);
    }

    // ------------------------------------------------------------------ helpers

    /** @return array{0:DocRef, 1:User, 2:bool} the document (404 / 403 like its own page), the user, whether they are its staff */
    private function open(Request $request, string $type, int $id): array
    {
        abort_unless(array_key_exists($type, DocumentRegistry::TYPES), 404);
        $user = $request->user();
        $doc = DocumentRegistry::find($type, $id);
        abort_unless(DocumentRegistry::canView($user, $doc), 403, 'Anda tidak punya akses ke dokumen ini.');

        return [$doc, $user, DocumentRegistry::isStaff($user, $doc)];
    }

    private function messageQuery(DocRef $doc, bool $staff)
    {
        return DocMessage::where(['res_type' => $doc->type, 'res_key' => $doc->key])->when(! $staff, fn ($q) => $q->where('kind', 'MESSAGE'));
    }

    private function ownMessage(DocRef $doc, User $user, DocMessage $message): void
    {
        abort_unless($message->res_type === $doc->type && $message->res_key === $doc->key, 404);
        abort_unless((int) $message->user_id === (int) $user->id, 403, 'Hanya penulis yang bisa mengubah atau menghapus pesannya.');
        if ($message->deleted_at) {
            throw ValidationException::withMessages(['message' => 'Pesan ini sudah dihapus.']);
        }
    }

    private function activityRow(DocActivity $a, User $user): array
    {
        $open = ! $a->done_at && ! $a->cancelled_at;

        return [
            'id' => $a->id, 'activity_type' => $a->activity_type, 'type_label' => DocumentActivities::TYPE_LABEL[$a->activity_type] ?? $a->activity_type,
            'summary' => $a->summary, 'note' => $a->note, 'assignee_id' => $a->assignee_id, 'assignee_name' => $a->assignee?->name,
            'created_by_name' => $a->creator?->name, 'due_date' => $a->due_date?->toDateString(),
            'state' => $a->done_at ? 'DONE' : ($a->cancelled_at ? 'CANCELLED' : ($a->due_date?->lt(now()->startOfDay()) ? 'OVERDUE' : ($a->due_date?->isToday() ? 'TODAY' : 'PLANNED'))),
            'done_at' => $this->iso($a->done_at), 'done_by_name' => $a->doneBy?->name, 'done_note' => $a->done_note, 'created_at' => $this->iso($a->created_at),
            'can_complete' => $open && in_array((int) $user->id, [(int) $a->assignee_id, (int) $a->created_by], true),
            'can_cancel' => $open && ((int) $user->id === (int) $a->created_by || $user->hasRole('super_admin')),
        ];
    }

    private function iso(mixed $t): ?string
    {
        return $t ? Carbon::parse($t)->timezone(config('app.timezone'))->toIso8601String() : null;
    }
}
