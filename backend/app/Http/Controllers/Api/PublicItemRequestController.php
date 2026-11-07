<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\ItemRequest;
use App\Models\ItemRequestLink;
use App\Models\User;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use App\Services\ItemRequestProxyService;
use App\Services\ItemRequestApprovalService;
use App\Services\ItemRequestFulfillmentService;
use App\Services\ItemRequestService;
use App\Support\ItemRequestForms;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The Request Barang form opened through a share link — no account,
 * /api/public/item-request/{token}. It SENDS a request and gets back its number
 * and track token; with that token (Cek Permintaan) the requester follows the
 * status — nothing else is readable. Throttled per IP (routes).
 */
class PublicItemRequestController extends Controller
{
    public function __construct(private ItemRequestService $service) {}

    /** GET — is the form open? (the page shows "ditutup" otherwise) */
    public function show(string $token): JsonResponse
    {
        $link = $this->link($token);

        return response()->json(['data' => ['label' => $link->label, 'is_active' => $link->is_active, 'form' => ItemRequestForms::describe($link->form_type ?? 'UMUM')]]);
    }

    /**
     * POST {token}/login {username, password} — who is asking: the form opens only for a STOCKWISE account
     * that may make requests. Gives back the requester's data (auto-filled in the form) and a session for
     * sending. Failures count with the app's own login lockout (same key: account + IP).
     */
    public function login(Request $request, string $token): JsonResponse
    {
        $link = $this->link($token);
        abort_unless($link->is_active, 403, 'Form request sedang ditutup oleh admin gudang.');
        $data = $request->validate(['username' => ['required', 'string', 'max:150'], 'password' => ['required', 'string', 'max:200']]);
        $login = trim($data['username']);
        $key = sha1(Str::lower($login).'|'.$request->ip());
        $failedKey = 'login-failed:'.$key;
        $lockKey = 'login-locked:'.$key;
        if (RateLimiter::tooManyAttempts($lockKey, 1)) {
            $minutes = (int) ceil(RateLimiter::availableIn($lockKey) / 60);
            throw ValidationException::withMessages(['username' => ["Terlalu banyak percobaan yang gagal. Coba lagi dalam {$minutes} menit."]])->status(429);
        }
        $user = User::where('username', $login)->orWhere('email', $login)->first();
        if (! $user || ! Hash::check($data['password'], $user->password)) {
            if (RateLimiter::hit($failedKey, 15 * 60) >= 5) {
                RateLimiter::clear($failedKey);
                RateLimiter::hit($lockKey, 15 * 60);
            }
            throw ValidationException::withMessages(['username' => ['Nama pengguna atau password salah.']]);
        }
        RateLimiter::clear($failedKey);
        if (! $user->is_active) {
            throw ValidationException::withMessages(['username' => ['Akun dinonaktifkan. Hubungi administrator.']]);
        }
        if (! $user->hasPermission('item_request.create')) {
            throw ValidationException::withMessages(['username' => ['Akun ini belum punya akses Request Barang. Hubungi administrator.']])->status(403);
        }

        return response()->json(['data' => [
            'session' => Crypt::encryptString(json_encode(['u' => $user->id, 'l' => $link->id, 'e' => now()->addHours(self::SESSION_HOURS)->timestamp])),
            'profile' => self::profile($user),
        ]]);
    }

    private const SESSION_HOURS = 3;

    /** The requester's data from their account and employee record (data pekerja). */
    /** The account's own data from Data Pekerja (also the in-app Buat Request form). */
    public static function profile(User $user): array
    {
        $employee = Employee::with('department:id,name')->where('user_id', $user->id)->first()
            ?? ($user->employee_id ? Employee::with('department:id,name')->find($user->employee_id) : null);

        return [
            'name' => $employee?->name ?: $user->name,
            'username' => $user->username,
            'contact' => $employee?->phone_wa ?: ($employee?->phone_office ?: $user->phone),
            'divisi' => $employee?->department?->name,
            'position' => $employee?->position ?: $user->position,
        ];
    }

    /** The account behind a form session (from login), for this link, not expired. */
    private function sessionUser(?string $session, ItemRequestLink $link): User
    {
        $payload = null;
        try {
            $payload = $session ? json_decode(Crypt::decryptString($session), true) : null;
        } catch (DecryptException) {
        }
        abort_unless(is_array($payload) && ($payload['l'] ?? null) === $link->id && ($payload['e'] ?? 0) > now()->timestamp, 419, 'Sesi habis. Masuk lagi dengan nama pengguna & password.');
        $user = User::find($payload['u'] ?? 0);
        abort_unless($user && $user->is_active && $user->hasPermission('item_request.create'), 419, 'Sesi habis. Masuk lagi dengan nama pengguna & password.');

        return $user;
    }

    /**
     * POST /api/public/request-status/mine {session} — the signed-in requester (the link form's session,
     * any link) gets the track tokens of all their requests, sent from any device. The newest 30 of 6 months.
     */
    public function mine(Request $request): JsonResponse
    {
        $payload = null;
        try {
            $payload = json_decode(Crypt::decryptString((string) $request->input('session', '')), true);
        } catch (DecryptException) {
        }
        abort_unless(is_array($payload) && ($payload['e'] ?? 0) > now()->timestamp, 419, 'Sesi habis. Masuk lagi dengan nama pengguna & password.');
        $user = User::find($payload['u'] ?? 0);
        abort_unless($user && $user->is_active, 419, 'Sesi habis. Masuk lagi dengan nama pengguna & password.');
        $tokens = ItemRequest::where('requester_id', $user->id)->whereNotNull('track_token')->where('created_at', '>=', now()->subMonths(6))
            ->orderByDesc('id')->limit(30)->pluck('track_token');

        return response()->json(['data' => ['tokens' => $tokens, 'name' => self::profile($user)['name']]]);
    }

    public function store(Request $request, string $token): JsonResponse
    {
        $link = $this->link($token);
        abort_unless($link->is_active, 403, 'Form request sedang ditutup oleh admin gudang.');
        // honeypot: a field people never see — bots fill it in
        abort_if(filled($request->input('website')), 422, 'Permintaan ditolak.');
        $user = $this->sessionUser($request->string('session')->value() ?: null, $link);

        $data = $request->validate([
            'requester_contact' => ['nullable', 'string', 'max:60'],
            'form_detail' => ['nullable', 'string', 'max:200'],
            'divisi' => ['nullable', 'string', 'max:100'],
            'needed_date' => ['nullable', 'date'],
            'note' => ['nullable', 'string', 'max:2000'],
            'lines' => ['required', 'array', 'min:1', 'max:30'],
            'lines.*.deskripsi_barang' => ['required', 'string', 'max:400'],
            'lines.*.qty' => ['required', 'numeric', 'min:0.01', 'max:1000000'],
            'lines.*.satuan' => ['nullable', 'string', 'max:30'],
            'lines.*.note' => ['nullable', 'string', 'max:255'],
            // the images of each item (beside its name)
            'lines.*.images' => ['nullable', 'array', 'max:3'],
            'lines.*.images.*' => ['required', 'string', 'max:12000000'],
            // up to 3 images of what is asked (photo of the broken part, an example...)
            'images' => ['nullable', 'array', 'max:3'],
            'images.*' => ['required', 'string', 'max:12000000'],
        ], ['images.max' => 'Gambar maksimal 3.', 'lines.*.images.max' => 'Gambar maksimal 3 per barang.']);
        // the requester is the signed-in account: their own requests in STOCKWISE too
        $made = $this->service->create([
            'id' => $user->id,
            'name' => self::profile($user)['name'],
            'contact' => $data['requester_contact'] ?? null,
            'ip' => $request->ip(),
            'link_id' => $link->id,
        ], [
            // the form comes from the link, never from what the sender posts
            'form_type' => $link->form_type ?? 'UMUM',
            'form_detail' => $data['form_detail'] ?? null,
            'divisi' => $data['divisi'] ?? null,
            'needed_date' => $data['needed_date'] ?? null,
            'note' => $data['note'] ?? null,
            // free text only — a link never picks master items itself
            'lines' => array_map(fn ($l) => array_intersect_key($l, array_flip(['deskripsi_barang', 'qty', 'satuan', 'note', 'images'])), $data['lines']),
            'images' => $data['images'] ?? [],
        ]);
        $link->forceFill(['last_used_at' => now()])->saveQuietly();

        return response()->json(['data' => ['number' => $made->number, 'track_token' => $made->track_token]], 201);
    }

    /** GET /api/public/request-status?tokens=a,b,c — status of the requests whose track tokens the requester holds. */
    public function status(Request $request): JsonResponse
    {
        $tokens = collect(explode(',', (string) $request->query('tokens', '')))
            ->map(fn ($t) => trim($t))->filter(fn ($t) => preg_match('/^[A-Za-z0-9]{20,40}$/', $t))->unique()->take(30);
        if ($tokens->isEmpty()) {
            return response()->json(['data' => []]);
        }
        $rows = ItemRequest::with(['lines.item:id,code,description', 'approvals', 'processor:id,name', 'fulfillments.lines'])->whereIn('track_token', $tokens)->orderByDesc('id')->get();
        $lineImages = ItemRequestService::lineImages($rows->flatMap(fn ($r) => $r->lines->pluck('id')));

        return response()->json(['data' => $rows->map(function (ItemRequest $r) use ($lineImages) {
            // the lines prepared from stock, waiting for their serah terima
            $prepared = $r->fulfillments->filter(fn ($f) => in_array($f->status, ItemRequestFulfillmentService::OPEN, true))
                ->flatMap(fn ($f) => $f->lines->pluck('item_request_line_id'))->map(fn ($id) => (int) $id)->unique()->values()->all();

            return [
                'token' => $r->track_token, 'number' => $r->number, 'form_label' => ItemRequestForms::label($r->form_type),
                'status' => $r->status, 'status_label' => ItemRequestFulfillmentService::statusLabel($r),
                'requester_name' => $r->requester_name, 'divisi' => $r->divisi,
                'needed_date' => $r->needed_date?->toDateString(), 'created_at' => $r->created_at?->toIso8601String(),
                // admin gudang's note at the verification, for the requester too
                'verify_note' => $r->verify_note,
                // past the approvals (Manager + Direktur): the verified items are final
                'approved' => in_array($r->status, [...ItemRequest::FULFILMENT_STATUSES, 'SELESAI'], true),
                'lines' => $r->lines->map(fn ($l) => ['id' => $l->id, 'images' => $lineImages[$l->id] ?? [], 'deskripsi_barang' => $l->deskripsi_barang, 'qty' => $l->qty, 'satuan' => $l->satuan,
                    // what the requester typed, and the Master Produk item admin gudang verified it as (several items may share one "asked")
                    'asked' => $l->requestedText(),
                    'item' => $l->item && $l->decision !== 'TOLAK' ? ['code' => $l->item->code, 'name' => $l->item->description] : null,
                    'decision' => $l->decision, 'reject_reason' => $l->reject_reason, 'short_reason' => $l->short_reason,
                    // how much was approved / already handed over, and where this item stands
                    'approved_qty' => $l->approved_qty, 'fulfilled_qty' => (float) $l->fulfilled_qty,
                    'line_status_label' => ItemRequestFulfillmentService::lineLabel($l, $r, ItemRequestFulfillmentService::lineStatus($l, $r, $prepared, false))]),
                'timeline' => ItemRequestApprovalService::timeline($r),
                'received_by' => $r->received_by_name,
                // the images attached to the request (GET public/request-status/image?token=&slot=)
                'images' => ItemRequestService::images($r->id),
                // goods prepared from stock: the requester can pick them up at the warehouse
                'ready_to_pick' => $prepared !== [],
                // pickup by a representative: who, and the code / QR to give them (the track token is the requester's)
                'proxy' => ItemRequestProxyService::present($r, true),
                'can_proxy' => ItemRequestProxyService::allowed($r),
            ];
        })]);
    }

    /**
     * POST /api/public/request-status/lookup {name} — find one's requests by name (any device).
     * The whole name or its first name(s) must match — "Fauzan" finds "Fauzan Afif", "Fau" doesn't —
     * case and spaces don't matter. The newest 20 of the last 6 months.
     */
    public function lookup(Request $request): JsonResponse
    {
        $data = $request->validate(['name' => ['required', 'string', 'min:3', 'max:150']]);
        $norm = fn (?string $s) => mb_strtolower(preg_replace('/\s+/u', ' ', trim((string) $s)));
        $q = $norm($data['name']);
        abort_if(mb_strlen($q) < 3, 422, 'Nama minimal 3 huruf.');
        $tokens = ItemRequest::whereNotNull('track_token')->where('created_at', '>=', now()->subMonths(6))
            ->whereRaw('LOWER(requester_name) LIKE ?', [str_replace(['%', '_'], ['\%', '\_'], explode(' ', $q)[0]).'%'])
            ->orderByDesc('id')->limit(300)->get(['requester_name', 'track_token'])
            ->filter(fn ($r) => ($n = $norm($r->requester_name)) === $q || str_starts_with($n, $q.' '))
            ->take(20)->pluck('track_token')->values();
        abort_if($tokens->isEmpty(), 404, 'Belum ada permintaan atas nama ini. Tulis nama seperti saat mengisi form.');

        return response()->json(['data' => ['tokens' => $tokens]]);
    }

    /** POST /api/public/request-status/proxy {token, name} — the requester (holder of the track token): someone else picks up. */
    public function createProxy(Request $request): JsonResponse
    {
        $data = $request->validate(['token' => ['required', 'string', 'regex:/^[A-Za-z0-9]{20,40}$/'], 'name' => ['required', 'string', 'max:150']]);
        $r = ItemRequest::where('track_token', $data['token'])->firstOrFail();
        $p = app(ItemRequestProxyService::class)->create($r, $data['name']);

        return response()->json(['data' => ItemRequestProxyService::present($r, true) ?? ['name' => $p->name]]);
    }

    /** GET /api/public/request-status/proxy-people?token=&q= — data pekerja names to pick the representative from (holders of a request's track token only). */
    public function proxyPeople(Request $request): JsonResponse
    {
        $token = (string) $request->query('token', '');
        abort_unless(preg_match('/^[A-Za-z0-9]{20,40}$/', $token) && ItemRequest::where('track_token', $token)->exists(), 404);

        return response()->json(['data' => ItemRequestProxyService::people((string) $request->query('q', ''))]);
    }

    /** DELETE /api/public/request-status/proxy?token= — the requester picks up themself after all. */
    public function cancelProxy(Request $request): JsonResponse
    {
        $token = (string) $request->query('token', '');
        abort_unless(preg_match('/^[A-Za-z0-9]{20,40}$/', $token), 404);
        app(ItemRequestProxyService::class)->cancel(ItemRequest::where('track_token', $token)->firstOrFail());

        return response()->json(['data' => null]);
    }

    /** GET /api/public/request-status/image?token=&slot= — an image of a request, for whoever holds its track token. */
    public function image(Request $request): \Symfony\Component\HttpFoundation\StreamedResponse
    {
        $token = (string) $request->query('token', '');
        $slot = (string) $request->query('slot', '');
        abort_unless(preg_match('/^[A-Za-z0-9]{20,40}$/', $token) && in_array($slot, ['img1', 'img2', 'img3'], true), 404);
        $id = ItemRequest::where('track_token', $token)->value('id');
        // ?line= : an image of one item of that request
        $line = $request->integer('line');
        if ($id && $line) {
            abort_unless(\App\Models\ItemRequestLine::where(['id' => $line, 'item_request_id' => $id])->exists(), 404);
        }
        $p = $id ? \App\Models\TrackingPhoto::where(['entity' => $line ? ItemRequestService::LINE_IMAGE_ENTITY : ItemRequestService::IMAGE_ENTITY, 'entity_id' => $line ?: $id, 'slot' => $slot])->first() : null;
        abort_unless($p && \Illuminate\Support\Facades\Storage::disk('local')->exists($p->path), 404);

        return \Illuminate\Support\Facades\Storage::disk('local')->response($p->path, null, ['Content-Type' => $p->mime ?? 'image/jpeg', 'Cache-Control' => 'private, max-age=3600']);
    }

    private function link(string $token): ItemRequestLink
    {
        $link = ItemRequestLink::where('token', $token)->first();
        abort_unless($link, 404, 'Link tidak ditemukan atau sudah dihapus.');

        return $link;
    }
}
