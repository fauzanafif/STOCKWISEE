<?php

namespace App\Services;

use App\Models\Item;
use App\Models\ItemRequest;
use App\Models\ItemRequestLine;
use App\Models\User;
use App\Services\Notifications\NotificationDispatcher;
use App\Support\ItemRequestForms;
use App\Support\Network\IpClassifier;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Request Barang (the parent transaction): karyawan asks → admin gudang VERIFIES each line (matches it to a
 * Master Produk item, Barang or Jasa — one not in the master yet is added there first, stock 0 — and may
 * propose a lower quantity) — no NPBG / PPB choice: every request goes into approval
 * (Manager → Direktur, ItemRequestApprovalService; they may lower the quantity or send it back —
 * PERLU_PERBAIKAN, then the admin verifies again). Once approved the SYSTEM decides from the real stock
 * (ItemRequestFulfillmentService::allocate): enough → NPBG of all, short → NPBG of what there is + the rest
 * to a Draft PPB, none (or a new item) → Draft PPB. Later deliveries are given by Gudang (NPBG lanjutan).
 */
class ItemRequestService
{
    public function __construct(private DocumentNumberService $numbers) {}

    /**
     * A request from a logged-in user (source APP) or through a share link (source LINK, no account).
     * Lines are free text — the requester names the item however they like; the admin matches it
     * to a master item later (ItemRecommender).
     *
     * @param  array{id?:?int,name:string,contact?:?string,ip?:?string,link_id?:?int}  $requester
     * @param  array{form_type?:?string,form_detail?:?string,divisi?:?string,needed_date?:?string,note?:?string,lines:list<array{item_id?:?int,kode_barang?:?string,deskripsi_barang:string,qty:float,satuan?:?string,note?:?string}>}  $data
     */
    /** Photo entity of the images the requester attaches (img1..img3): shown from the request to its end. */
    public const IMAGE_ENTITY = 'item_request_image';

    public const MAX_IMAGES = 3;

    /** Photo entity of the images of one item of the request (img1..img3), shown beside its name. */
    public const LINE_IMAGE_ENTITY = 'item_request_line_image';

    /** Less than asked while verifying (e.g. 9 of 10, 1 kept in stock): why — required then; kept on the line. */
    private function shortReason(ItemRequestLine $line, array $in): void
    {
        $given = ! empty($in['items']) ? array_sum(array_map(fn ($p) => (float) $p['qty'], $in['items']))
            : (isset($in['qty']) && $in['qty'] !== '' && $in['qty'] !== null ? (float) $in['qty'] : (float) $line->qty);
        $short = $given + 0.0001 < (float) $line->qty;
        $reason = trim((string) ($in['reason'] ?? ''));
        if ($short && $reason === '') {
            throw ValidationException::withMessages(["lines.{$line->id}.reason" => "\"{$line->requestedText()}\" diberi kurang dari yang diminta: isi alasannya."]);
        }
        $line->short_reason = $short ? mb_substr($reason, 0, 255) : null;
    }

    /**
     * The line in the item's own unit, the original kept beside it with the ratio of this moment. $asked and
     * $given are in the unit asked. A unit the master does not know is left as written and marked: not guessed.
     *
     * @return array<string, mixed> what to fill
     */
    private function inItemUnit(Item $item, string $unit, float $asked, float $given, string $label, string $field): array
    {
        $uom = app(UomConverter::class)->snapshot($item, $unit, $label, $field);
        if ($uom['known'] && UomConverter::isOne($uom['unit_ratio'])) {
            return ['qty' => $asked, 'approved_qty' => $given, 'requested_qty' => null, 'requested_unit' => null, 'unit_ratio' => null];
        }
        if (! $uom['known']) {
            return ['qty' => $asked, 'approved_qty' => $given, 'requested_qty' => $unit !== '' ? $asked : null, 'requested_unit' => $unit !== '' ? $unit : null, 'unit_ratio' => null];
        }
        $base = UomConverter::baseQty($given, $uom['unit_ratio']);
        if (bccomp($base, '0', 2) <= 0) {
            throw ValidationException::withMessages([$field => "{$label}: jumlahnya terlalu kecil dalam {$item->unit?->code}."]);
        }

        return ['qty' => UomConverter::baseQty($asked, $uom['unit_ratio']), 'approved_qty' => $base, 'requested_qty' => $asked, 'requested_unit' => $unit, 'unit_ratio' => $uom['unit_ratio']];
    }

    /**
     * An item with serial numbers: admin gudang picks the serials of the units given from stock while verifying
     * (one per unit, in the item's own unit, at most what is in stock: the rest is bought and picked when it arrives).
     * They are held for this request (no other request / NPBG takes them) and go out at the serah terima.
     *
     * @param  array<string, true>  $taken  serials already picked on another line of this request
     */
    private function holdSerials(ItemRequestLine $line, Item $item, ItemRequest $request, array $picked, string $field, array &$taken): void
    {
        if (! \Illuminate\Support\Facades\Schema::hasColumn('item_request_lines', 'serials')) {
            return;
        }
        if (! $item->manage_sn) {
            $line->serials = null;

            return;
        }
        $base = (float) $line->approved_qty;
        if (floor($base) !== $base) {
            throw ValidationException::withMessages([$field => "{$item->code} memakai nomor seri: jumlahnya harus bulat (sekarang {$base} {$item->unit?->code})."]);
        }
        $stock = app(SerialStock::class);
        $free = array_filter($stock->available($item->code, null, $request->id), fn ($s) => ! isset($taken[SerialStock::key($s['serial'])]));
        $need = (int) min($base, count($free));
        if ($need === 0) {
            $line->serials = null;

            return;
        }
        $list = $stock->pick($item->code, $need, $picked, null, $field, $request->id);
        foreach ($list as $sn) {
            if (isset($taken[SerialStock::key($sn)])) {
                throw ValidationException::withMessages([$field => "Nomor seri {$sn} sudah dipilih untuk barang lain di request ini."]);
            }
            $taken[SerialStock::key($sn)] = true;
        }
        $line->serials = \App\Support\RiSerials::join($list);
    }

    /** The unit a line is verified in: the correction given, else what was asked. */
    private function askedUnit(ItemRequestLine $line, array $in): string
    {
        return mb_strtoupper(trim((string) ($in['unit'] ?? $line->requested_unit ?? $line->satuan ?? '')));
    }

    /**
     * One requested item met by several Master Produk items: the line becomes one line per item, each
     * keeping the requester's own words and images (so approval groups them back under "buku"). Only
     * which item and how many is decided here — whether it comes from stock (NPBG) or is bought
     * (Draft PPB) is the stock's business, after approval.
     *
     * @param  list<array{item_id:int, qty:float|int|string}>  $picks
     */
    private function split(ItemRequestLine $line, User $admin, array $picks, string $unit, ItemRequest $request, array &$taken): void
    {
        $asked = $line->requestedText();
        $total = round(array_sum(array_map(fn ($p) => (float) $p['qty'], $picks)), 2);
        if ($total <= 0 || $total > (float) $line->qty + 0.0001) {
            throw ValidationException::withMessages(["lines.{$line->id}.qty" => "Jumlah \"{$asked}\" dari semua barang: 1–".rtrim(rtrim(number_format((float) $line->qty, 2, ',', '.'), '0'), ',').' (yang diminta).']);
        }
        if (count(array_unique(array_map(fn ($p) => (int) $p['item_id'], $picks))) !== count($picks)) {
            throw ValidationException::withMessages(["lines.{$line->id}.items" => "Barang yang sama dipilih dua kali untuk \"{$asked}\"."]);
        }
        $items = Item::with('unit:id,code')->whereIn('id', array_map(fn ($p) => (int) $p['item_id'], $picks))->get()->keyBy('id');
        $rest = (float) $line->qty - $total; // asked but not given: stays on the first line's request
        $images = \App\Models\TrackingPhoto::where(['entity' => self::LINE_IMAGE_ENTITY, 'entity_id' => $line->id])->get();
        foreach (array_values($picks) as $i => $p) {
            $item = $items->get((int) $p['item_id']);
            if (! $item->is_active) {
                throw ValidationException::withMessages(["lines.{$line->id}.items" => "{$item->description} nonaktif di Master Produk, aktifkan atau pilih barang lain."]);
            }
            $qty = round((float) $p['qty'], 2);
            $target = $i === 0 ? $line : tap($line->replicate(['item_id', 'kode_barang', 'decision', 'approved_qty', 'decided_by', 'decided_at']), function ($copy) use ($asked) {
                $copy->deskripsi_peminta = $asked;
            });
            $target->matchTo($item);
            $target->fill($this->inItemUnit($item, $unit, $i === 0 ? $qty + $rest : $qty, $qty, $asked, "lines.{$line->id}.items")
                + ['decision' => 'NPBG', 'decided_by' => $admin->id, 'decided_at' => now()]);
            $this->holdSerials($target, $item, $request, (array) ($p['serials'] ?? []), "lines.{$line->id}.items.{$i}.serials", $taken);
            $target->save();
            // the requester's images go with every part (own copies: one replaced never breaks the other)
            if ($i > 0) {
                foreach ($images as $img) {
                    $path = preg_replace('/(\.[a-z0-9]+)?$/i', "-{$target->id}$1", $img->path, 1);
                    if (\Illuminate\Support\Facades\Storage::disk('local')->exists($img->path)) {
                        \Illuminate\Support\Facades\Storage::disk('local')->copy($img->path, $path);
                        $img->replicate()->fill(['entity_id' => $target->id, 'path' => $path])->save();
                    }
                }
            }
        }
    }

    /**
     * @param  iterable<int>  $lineIds
     * @return array<int, list<string>> line id => its image slots
     */
    public static function lineImages(iterable $lineIds): array
    {
        $ids = collect($lineIds)->filter()->values();

        return $ids->isEmpty() ? [] : \App\Models\TrackingPhoto::where('entity', self::LINE_IMAGE_ENTITY)->whereIn('entity_id', $ids)
            ->orderBy('slot')->get(['entity_id', 'slot'])->groupBy('entity_id')->map(fn ($g) => $g->pluck('slot')->values()->all())->all();
    }

    /** @return list<string> the image slots of a request */
    public static function images(int $id): array
    {
        return \App\Models\TrackingPhoto::where(['entity' => self::IMAGE_ENTITY, 'entity_id' => $id])->orderBy('slot')->pluck('slot')->values()->all();
    }

    /** The requester's images (data URLs, max 3) on the request. */
    private function storeImages(ItemRequest $request, array $images, ?int $userId): void
    {
        $files = app(\App\Services\Tracking\TrackingPhotoService::class);
        foreach (array_slice(array_values($images), 0, self::MAX_IMAGES) as $i => $image) {
            $files->putDataUrl(self::IMAGE_ENTITY, $request->id, 'img'.($i + 1), $image, "gambar-{$request->number}-".($i + 1), $userId);
        }
    }

    public function create(array $requester, array $data): ItemRequest
    {
        $type = isset(ItemRequestForms::TYPES[$data['form_type'] ?? '']) ? $data['form_type'] : 'UMUM';
        $form = ItemRequestForms::describe($type);
        $request = DB::transaction(function () use ($requester, $data, $type, $form) {
            $request = ItemRequest::create([
                'number' => $this->numbers->nextShort('REQ'),
                // the requester follows the request with this (Cek Permintaan) — no account needed
                'track_token' => Str::random(32),
                'form_type' => $type,
                // never the requester's call — admin gudang marks it urgent afterwards (ItemRequestController::urgency)
                'urgency' => null,
                'form_detail' => $form['detail_label'] && filled($data['form_detail'] ?? null) ? mb_substr(trim($data['form_detail']), 0, 200) : null,
                'source' => ! empty($requester['link_id']) ? 'LINK' : 'APP',
                'link_id' => $requester['link_id'] ?? null,
                'requester_id' => $requester['id'] ?? null,
                'requester_name' => mb_substr($requester['name'], 0, 150),
                'requester_contact' => $requester['contact'] ?? null,
                'requester_ip' => $requester['ip'] ?? null,
                'requester_location' => isset($requester['ip']) ? IpClassifier::classify($requester['ip']) : null,
                'divisi' => filled($data['divisi'] ?? null) ? $data['divisi'] : $form['default_divisi'],
                'needed_date' => $data['needed_date'] ?? null,
                'note' => $data['note'] ?? null,
                'status' => 'MENUNGGU',
            ]);
            foreach ($data['lines'] as $line) {
                $item = ! empty($line['item_id']) ? Item::with('unit:id,code')->find($line['item_id']) : null;
                $made = $request->lines()->create([
                    'item_id' => $item?->id,
                    'kode_barang' => $item?->code ?? ($line['kode_barang'] ?? null),
                    'deskripsi_barang' => $line['deskripsi_barang'],
                    'deskripsi_peminta' => $line['deskripsi_barang'],
                    'qty' => $line['qty'],
                    'satuan' => $line['satuan'] ?? $item?->unit?->code,
                    'note' => $line['note'] ?? null,
                ]);
                // the images of this item, beside its name from the request to its end
                $files = app(\App\Services\Tracking\TrackingPhotoService::class);
                foreach (array_slice(array_values($line['images'] ?? []), 0, self::MAX_IMAGES) as $i => $image) {
                    $files->putDataUrl(self::LINE_IMAGE_ENTITY, $made->id, 'img'.($i + 1), $image, "gambar-{$request->number}-{$made->id}-".($i + 1), $requester['id'] ?? null);
                }
            }
            // the requester's images go with it (a bad file refuses the whole request)
            $this->storeImages($request, $data['images'] ?? [], $requester['id'] ?? null);

            return $request;
        });

        $urgent = $request->urgency === 'URGENT';
        NotificationDispatcher::toPermission('item_request.process', 'request', $urgent ? 'warning' : 'info',
            ($urgent ? 'URGENT: ' : '').$form['label'].' baru',
            "{$request->number} dari {$request->requester_name}, {$request->lines()->count()} barang, menunggu diproses.",
            "/item-requests/{$request->id}", $requester['id'] ?? null);

        return $request;
    }

    /**
     * Admin gudang verifies the open lines and sends the request to approval.
     *
     * @param  array<int, array{item_id?:?int, qty?:float|string|null}>  $lines  line id => master item (null = new item, keep the
     *         requester's words) and the quantity proposed (≤ asked; default as asked)
     * @param  array{pelanggan?:?string,tipe_npbg?:?string}  $npbg  header of the NPBG(s) made later
     */
    public function process(ItemRequest $request, User $admin, array $lines, array $npbg, ?string $note = null): ItemRequest
    {
        DB::transaction(function () use ($request, $admin, $lines, $npbg, $note) {
            $request = ItemRequest::lockForUpdate()->findOrFail($request->id);
            if (! in_array($request->status, ['MENUNGGU', 'DIPROSES', 'PERLU_PERBAIKAN'], true)) {
                throw ValidationException::withMessages(['status' => 'Request ini sudah '.ItemRequestApprovalService::label($request->status).'.']);
            }
            /** @var Collection<int, ItemRequestLine> $open */
            $open = $request->lines()->whereNull('decision')->get()->keyBy('id');
            if ($open->isEmpty()) {
                throw ValidationException::withMessages(['lines' => 'Tidak ada barang yang perlu diverifikasi.']);
            }
            $pelanggan = trim((string) ($npbg['pelanggan'] ?? $request->npbg_pelanggan ?? ''));
            $request->fill([
                'npbg_pelanggan' => mb_substr($pelanggan !== '' ? $pelanggan : ($request->divisi ?: (string) $request->requester_name), 0, 200),
                'npbg_tipe' => mb_substr((string) ($npbg['tipe_npbg'] ?? $request->npbg_tipe ?? 'Non Penjualan'), 0, 20),
                // admin gudang's note on the request, seen by the approvers and the requester
                'verify_note' => trim((string) $note) !== '' ? mb_substr(trim((string) $note), 0, 1000) : null,
            ]);
            $taken = [];
            foreach ($open as $id => $line) {
                $in = $lines[$id] ?? [];
                // several Master Produk items for one requested item: one line per item (split() below)
                if (! empty($in['items']) && count($in['items']) > 1) {
                    $this->shortReason($line, $in);
                    $this->split($line, $admin, $in['items'], $this->askedUnit($line, $in), $request, $taken);

                    continue;
                }
                if (! empty($in['items'])) {
                    $in = ['item_id' => $in['items'][0]['item_id'], 'qty' => $in['items'][0]['qty'], 'reason' => $in['reason'] ?? null, 'unit' => $in['unit'] ?? null, 'serials' => $in['items'][0]['serials'] ?? ($in['serials'] ?? [])];
                }
                $unit = $this->askedUnit($line, $in);
                $itemId = ! empty($in['item_id']) ? (int) $in['item_id'] : $line->item_id;
                // every line is a Master Produk item: a new one is added there first (Barang / Jasa, stock 0)
                if (! $itemId) {
                    throw ValidationException::withMessages(["lines.{$id}.item_id" => "\"{$line->requestedText()}\" belum ada di Master Produk, tambahkan dulu (Barang / Jasa), lalu pilih."]);
                }
                // the name sent to approval is Master Produk's: the item must still be there, and active
                $item = Item::with('unit:id,code')->find($itemId);
                if (! $item) {
                    throw ValidationException::withMessages(["lines.{$id}.item_id" => "Barang untuk \"{$line->requestedText()}\" tidak ada lagi di Master Produk, pilih ulang."]);
                }
                if (! $item->is_active) {
                    throw ValidationException::withMessages(["lines.{$id}.item_id" => "{$item->description} nonaktif di Master Produk, aktifkan atau pilih barang lain."]);
                }
                $line->matchTo($item);
                $this->shortReason($line, $in);
                $qty = isset($in['qty']) && $in['qty'] !== '' && $in['qty'] !== null ? round((float) $in['qty'], 2) : (float) $line->qty;
                if ($qty <= 0 || $qty > (float) $line->qty + 0.0001) {
                    throw ValidationException::withMessages(["lines.{$id}.qty" => "Jumlah {$line->deskripsi_barang} 1–".rtrim(rtrim(number_format((float) $line->qty, 2, ',', '.'), '0'), ',').' (yang diminta).']);
                }
                // NPBG = "from the warehouse"; whether it is given from stock or bought is decided after approval
                $line->fill($this->inItemUnit($item, $unit, (float) $line->qty, $qty, $line->requestedText(), "lines.{$id}.item_id")
                    + ['decision' => 'NPBG', 'decided_by' => $admin->id, 'decided_at' => now()]);
                $this->holdSerials($line, $item, $request, (array) ($in['serials'] ?? []), "lines.{$id}.serials", $taken);
                $line->save();
            }
            $request->update(['status' => self::statusOf($request->lines()->get()), 'processed_by' => $admin->id, 'processed_at' => now()]);
        });

        $request->refresh()->load('lines');
        if ($request->status === 'APPROVAL_MANAGER') {
            app(ItemRequestApprovalService::class)->submitted($request, $admin);
        }
        NotificationDispatcher::toUser($request->requester_id, 'request', 'success',
            "Request {$request->number} diverifikasi", 'Status: '.ItemRequestApprovalService::label($request->status).'.', "/item-requests/{$request->id}");

        return $request;
    }

    /** Locked and checked again: admin gudang may be verifying it at the same moment (then it is not cancelled). */
    public function cancel(ItemRequest $request): ItemRequest
    {
        $request = DB::transaction(function () use ($request) {
            $request = ItemRequest::lockForUpdate()->findOrFail($request->id);
            if ($request->status !== 'MENUNGGU' || $request->lines()->whereNotNull('decision')->exists()) {
                throw ValidationException::withMessages(['status' => 'Request yang sudah diproses tidak bisa dibatalkan.']);
            }
            $request->update(['status' => 'DIBATALKAN']);

            return $request;
        });
        NotificationDispatcher::toPermission('item_request.process', 'request', 'info', "{$request->number} dibatalkan",
            "{$request->requester_name} membatalkan request-nya.", "/item-requests/{$request->id}", $request->requester_id);

        return $request;
    }

    /** @param  Collection<int, ItemRequestLine>  $lines */
    public static function statusOf(Collection $lines): string
    {
        if ($lines->contains(fn ($l) => $l->decision === null)) {
            return $lines->contains(fn ($l) => $l->decision !== null) ? 'DIPROSES' : 'MENUNGGU';
        }

        if ($lines->every(fn ($l) => $l->decision === 'TOLAK')) {
            return 'DITOLAK';
        }

        // goods from stock need approval first; goods to buy wait for purchasing, then Gudang hands them over
        return $lines->contains(fn ($l) => $l->decision === 'NPBG') ? 'APPROVAL_MANAGER' : 'MENUNGGU_PENGADAAN';
    }
}
