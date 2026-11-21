<?php

namespace App\Services;

use App\Models\PurchaseOrder;
use App\Models\User;
use App\Models\Vendor;
use App\Services\Export\DocumentPrintRenderer;
use App\Support\Documents\DocumentAudit;
use App\Support\Documents\DocumentRegistry;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\URL;
use Illuminate\Validation\ValidationException;

/**
 * Send a PO to its vendor, by email (the PDF attached) or WhatsApp (a message with a link to the PDF).
 * The link is signed and expires: the vendor opens the PDF without logging in, and nothing else. It starts with
 * STOCKWISE_SHARE_URL, so a vendor outside the office can open it once that is a public address.
 * Every sending goes to the PO's Audit Trail; an APPROVED PO becomes SENT.
 */
class PurchaseOrderShareService
{
    public const LINK_DAYS = 7;

    public function __construct(private PurchaseOrderService $orders) {}

    /** May an email really leave the server? (MAIL_MAILER log / array only write it down.) */
    public static function mailReady(): bool
    {
        return ! in_array((string) config('mail.default'), ['log', 'array', ''], true);
    }

    /** What the send form starts with: the PO's vendors and their contacts, the message, the link. */
    public function defaults(PurchaseOrder $po): array
    {
        $po->loadMissing('vendor', 'items.vendor');
        $vendors = $po->items->map(fn ($l) => $l->vendor ?? $po->vendor)->push($po->vendor)->filter()->unique('id')->values();
        $link = $this->link($po);

        return [
            'vendors' => $vendors->map(fn (Vendor $v) => ['id' => $v->id, 'name' => $v->name, 'email' => $v->email, 'phone' => $v->phone])->all(),
            'subject' => "Purchase Order {$po->number} — PT Surya Inti Gas",
            'message' => $this->message($po, $vendors->first()?->name, $link),
            'pdf_url' => $link,
            'link_days' => self::LINK_DAYS,
            'mail_ready' => self::mailReady(),
            'public_base' => $this->base(),
        ];
    }

    /**
     * @param  array{channel:string, vendor_id?:?int, to:string, subject?:?string, message:string, save_contact?:bool}  $data
     * @return array{channel:string, to:string, whatsapp_url:?string, emailed:bool}
     */
    public function send(User $user, PurchaseOrder $po, array $data): array
    {
        abort_if($po->accurate_po_id !== null, 422, 'PO ini berasal dari Accurate.');
        if (! in_array($po->status, ['APPROVED', 'SENT', 'DIBELI', 'PARTIAL_RECEIVED', 'RECEIVED'], true)) {
            throw ValidationException::withMessages(['status' => 'PO baru bisa dikirim ke vendor setelah disetujui Direktur.']);
        }
        $vendor = ! empty($data['vendor_id']) ? Vendor::find($data['vendor_id']) : null;
        $channel = $data['channel'];
        $to = trim($data['to']);
        $whatsapp = null;
        $emailed = false;

        if ($channel === 'email') {
            if (! filter_var($to, FILTER_VALIDATE_EMAIL)) {
                throw ValidationException::withMessages(['to' => 'Alamat email tidak valid.']);
            }
            if (! self::mailReady()) {
                throw ValidationException::withMessages(['to' => 'Email server belum diatur (MAIL_MAILER di .env), jadi email belum bisa terkirim. Kirim lewat WhatsApp dulu, atau minta admin mengatur SMTP.']);
            }
            $pdf = app(DocumentPrintRenderer::class)->pdf(...app(\App\Http\Controllers\Api\PurchaseOrderController::class)->printArgsFor($po));
            $file = preg_replace('/[^A-Za-z0-9._-]+/', '-', (string) $po->number).'.pdf';
            Mail::raw($data['message'], function ($m) use ($to, $data, $po, $pdf, $file, $user) {
                $m->to($to)->subject($data['subject'] ?: "Purchase Order {$po->number}")->attachData($pdf, $file, ['mime' => 'application/pdf']);
                if ($user->email) {
                    $m->replyTo($user->email, $user->name);
                }
            });
            $emailed = true;
        } else {
            $phone = self::waNumber($to);
            if ($phone === null) {
                throw ValidationException::withMessages(['to' => 'Nomor WhatsApp tidak valid (mis. 0812… atau +62812…).']);
            }
            $to = $phone;
            $whatsapp = 'https://wa.me/'.$phone.'?text='.rawurlencode($data['message']);
        }

        DB::transaction(function () use ($user, $po, $vendor, $channel, $to, $data) {
            if ($vendor && ! empty($data['save_contact'])) {
                $vendor->update($channel === 'email' ? ['email' => $to] : ['phone' => $to]);
            }
            if ($po->status === 'APPROVED') {
                $this->orders->send($po);
            }
            rescue(fn () => DocumentAudit::event(DocumentRegistry::find('purchase_order', $po->id), 'SENT_TO_VENDOR', 'PurchaseOrder', $po->id,
                ['channel' => [null, $channel === 'email' ? 'Email' : 'WhatsApp'], 'to' => [null, $to], 'vendor' => [null, $vendor?->name]], null), null, false);
        });

        return ['channel' => $channel, 'to' => $to, 'whatsapp_url' => $whatsapp, 'emailed' => $emailed];
    }

    /** The signed, expiring link to the PO's PDF, on the address vendors can reach. */
    public function link(PurchaseOrder $po): string
    {
        $path = URL::temporarySignedRoute('api.po.public-pdf', now()->addDays(self::LINK_DAYS), ['purchaseOrder' => $po->id], absolute: false);

        return $this->base().$path;
    }

    private function base(): string
    {
        return rtrim((string) (config('stockwise.share_url') ?: config('app.url')), '/');
    }

    private function message(PurchaseOrder $po, ?string $vendor, string $link): string
    {
        $date = $po->date?->format('d/m/Y');

        return "Yth. {$vendor},\n\nBerikut Purchase Order {$po->number}".($date ? " tanggal {$date}" : '')." dari PT Surya Inti Gas.\n"
            ."PDF PO: {$link}\n(link berlaku ".self::LINK_DAYS." hari)\n\nMohon konfirmasi ketersediaan dan jadwal pengiriman. Terima kasih.";
    }

    /** 0812… / +62 812… / 62812… → 62812… (WhatsApp's wa.me format); null when it is no phone number. */
    public static function waNumber(string $raw): ?string
    {
        $d = preg_replace('/\D+/', '', $raw);
        if ($d === '' || strlen($d) < 9 || strlen($d) > 15) {
            return null;
        }

        return str_starts_with($d, '0') ? '62'.substr($d, 1) : $d;
    }
}
