<?php

namespace App\Services;

use App\Models\Employee;
use App\Models\ItemRequest;
use App\Models\ItemRequestProxy;
use Illuminate\Validation\ValidationException;

/**
 * Pickup by a representative ("Diwakilkan"): the requester names the person and gets a 6-digit code + QR;
 * at the serah terima Gudang scans / types it — the code must belong to this request, be unused, not
 * cancelled and not expired. Used once; a new code replaces the old one.
 */
class ItemRequestProxyService
{
    public const DAYS = 3;

    /** What the QR holds: a prefix, so a random QR is never taken for a code. */
    public const QR_PREFIX = 'STOCKWISE-WAKIL:';

    /** Not to be picked up any more. */
    private const FINAL = ['SELESAI', 'DITOLAK', 'DIBATALKAN'];

    public static function active(int $requestId): ?ItemRequestProxy
    {
        return ItemRequestProxy::where('item_request_id', $requestId)->whereNull('used_at')->whereNull('cancelled_at')
            ->where('expires_at', '>', now())->latest('id')->first();
    }

    /** For the screens: the code only for the requester (Gudang must scan it, never read it here). */
    public static function present(ItemRequest $r, bool $withCode): ?array
    {
        $p = self::active($r->id);

        return $p ? ['name' => $p->name, 'expires_at' => $p->expires_at->toIso8601String()]
            + ($withCode ? ['code' => $p->code, 'qr' => self::QR_PREFIX.$p->code] : []) : null;
    }

    public static function allowed(ItemRequest $r): bool
    {
        return ! in_array($r->status, self::FINAL, true);
    }

    /** @return list<array{name: string, divisi: ?string}> active workers whose name has $q in it (names starting with it first) */
    public static function people(string $q, int $limit = 8): array
    {
        $q = Employee::normalize($q);
        if (mb_strlen($q) < 2) {
            return [];
        }
        $esc = str_replace(['\\', '%', '_'], ['\\\\', '\%', '\_'], $q);

        return Employee::with('department:id,name')->where('is_active', true)->where('name_normalized', 'like', "%{$esc}%")
            ->orderByRaw('CASE WHEN name_normalized LIKE ? THEN 0 ELSE 1 END', ["{$esc}%"])->orderBy('name')->limit($limit)->get()
            ->map(fn (Employee $e) => ['name' => $e->name, 'divisi' => $e->department?->name])->all();
    }

    public function create(ItemRequest $r, string $name): ItemRequestProxy
    {
        if (! self::allowed($r)) {
            throw ValidationException::withMessages(['name' => 'Request ini sudah selesai / ditutup, tidak ada barang yang diambil lagi.']);
        }
        // the representative is someone of the company (data pekerja), picked from the suggestions
        $person = Employee::where('is_active', true)->where('name_normalized', Employee::normalize($name))->first();
        if (! $person) {
            throw ValidationException::withMessages(['name' => 'Pilih nama wakil dari daftar Data Pekerja.']);
        }
        $name = $person->name;

        // locked on the request: a double tap makes one active code, not two
        return \Illuminate\Support\Facades\DB::transaction(function () use ($r, $name) {
            ItemRequest::whereKey($r->id)->lockForUpdate()->first();
            $this->cancel($r);
            do {
                $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
            } while (ItemRequestProxy::where('code', $code)->whereNull('used_at')->whereNull('cancelled_at')->where('expires_at', '>', now())->exists());

            return ItemRequestProxy::create(['item_request_id' => $r->id, 'name' => $name, 'code' => $code, 'expires_at' => now()->addDays(self::DAYS)]);
        });
    }

    public function cancel(ItemRequest $r): void
    {
        ItemRequestProxy::where('item_request_id', $r->id)->whereNull('used_at')->whereNull('cancelled_at')->update(['cancelled_at' => now()]);
    }

    /** The scanned / typed code (the QR text or its 6 digits) for this request; locked for the serah terima. */
    public function verify(ItemRequest $r, string $scanned): ItemRequestProxy
    {
        $code = preg_replace('/\D/', '', str_starts_with($scanned, self::QR_PREFIX) ? substr($scanned, strlen(self::QR_PREFIX)) : $scanned);
        $p = strlen($code) === 6 ? ItemRequestProxy::where('item_request_id', $r->id)->where('code', $code)->latest('id')->lockForUpdate()->first() : null;
        $why = match (true) {
            $p === null => 'Kode wakil tidak cocok dengan request ini.',
            $p->used_at !== null => 'Kode wakil ini sudah dipakai.',
            $p->cancelled_at !== null => 'Kode wakil ini sudah dibatalkan peminta.',
            $p->expires_at->isPast() => 'Kode wakil ini sudah kedaluwarsa. Minta peminta membuat kode baru.',
            default => null,
        };
        if ($why) {
            throw ValidationException::withMessages(['proxy_code' => $why]);
        }

        return $p;
    }
}
