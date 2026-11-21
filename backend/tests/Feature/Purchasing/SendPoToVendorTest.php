<?php

namespace Tests\Feature\Purchasing;

use App\Models\DocAuditLog;
use App\Models\PurchaseOrder;
use App\Models\Vendor;
use App\Services\PurchaseOrderShareService;
use Database\Seeders\RbacSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/** Send a PO to its vendor: WhatsApp (a signed link to the PDF) or email (the PDF attached). */
class SendPoToVendorTest extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected $seeder = RbacSeeder::class;

    private function po(string $status = 'APPROVED', string $vendor = 'CV Maju'): PurchaseOrder
    {
        return PurchaseOrder::factory()->create(['status' => $status, 'vendor_id' => Vendor::factory()->create(['name' => $vendor, 'is_active' => true])->id]);
    }

    public function test_whatsapp_numbers_are_written_as_wa_me_wants_them(): void
    {
        $this->assertSame('6281234567890', PurchaseOrderShareService::waNumber('0812-3456-7890'));
        $this->assertSame('6281234567890', PurchaseOrderShareService::waNumber('+62 812 3456 7890'));
        $this->assertNull(PurchaseOrderShareService::waNumber('12'));
    }

    public function test_whatsapp_opens_with_the_message_marks_the_po_sent_saves_the_number_and_logs_it(): void
    {
        $this->actingAsRole('purchasing');
        $po = $this->po();
        $d = $this->getJson("/api/purchase-orders/{$po->id}/vendor-share")->assertOk()->json('data');
        $this->assertSame('CV Maju', $d['vendors'][0]['name']);
        $this->assertStringContainsString('/api/public/purchase-orders/'.$po->id.'/pdf?expires=', $d['pdf_url']);
        $this->assertStringContainsString($po->number, $d['message']);

        $r = $this->postJson("/api/purchase-orders/{$po->id}/send-to-vendor", ['channel' => 'whatsapp', 'vendor_id' => $po->vendor_id, 'to' => '0812 3456 7890', 'message' => $d['message'], 'save_contact' => true])
            ->assertOk()->json('data');
        $this->assertStringStartsWith('https://wa.me/6281234567890?text=', $r['whatsapp_url']);
        $this->assertSame('SENT', $po->fresh()->status);
        $this->assertSame('6281234567890', Vendor::find($po->vendor_id)->phone);
        $this->assertSame(1, DocAuditLog::where(['res_type' => 'purchase_order', 'event' => 'SENT_TO_VENDOR'])->count());

        // not before the Direktur approved it
        $draft = $this->po('DRAFT', 'PT Lain');
        $this->postJson("/api/purchase-orders/{$draft->id}/send-to-vendor", ['channel' => 'whatsapp', 'to' => '081234567890', 'message' => 'x'])->assertUnprocessable();
    }

    public function test_email_needs_a_mail_server_and_then_goes_with_the_pdf(): void
    {
        $this->actingAsRole('purchasing');
        $po = $this->po();
        // MAIL_MAILER=array (as "log" on the server): nothing would leave, so it says so
        $this->postJson("/api/purchase-orders/{$po->id}/send-to-vendor", ['channel' => 'email', 'to' => 'sales@maju.co.id', 'message' => 'PO terlampir'])
            ->assertUnprocessable()->assertJsonValidationErrors('to');
        $this->assertSame('APPROVED', $po->fresh()->status);

        config(['mail.default' => 'smtp']);
        Mail::fake();
        $this->postJson("/api/purchase-orders/{$po->id}/send-to-vendor", ['channel' => 'email', 'to' => 'not-an-email', 'message' => 'x'])->assertUnprocessable();
        $this->postJson("/api/purchase-orders/{$po->id}/send-to-vendor", ['channel' => 'email', 'vendor_id' => $po->vendor_id, 'to' => 'sales@maju.co.id', 'subject' => 'PO', 'message' => 'PO terlampir', 'save_contact' => true])
            ->assertOk()->assertJsonPath('data.emailed', true);
        $this->assertSame('SENT', $po->fresh()->status);
        $this->assertSame('sales@maju.co.id', Vendor::find($po->vendor_id)->email);
    }

    public function test_the_vendor_opens_the_pdf_by_its_signed_link_only(): void
    {
        $this->actingAsRole('purchasing');
        $po = $this->po();
        $other = $this->po('APPROVED', 'PT Lain');
        $url = app(PurchaseOrderShareService::class)->link($po);
        $path = parse_url($url, PHP_URL_PATH).'?'.parse_url($url, PHP_URL_QUERY);
        app('auth')->forgetGuards();

        $this->get($path)->assertOk()->assertHeader('Content-Type', 'application/pdf');
        $this->get("/api/public/purchase-orders/{$po->id}/pdf")->assertForbidden();
        // the signature is for this PO only: another PO's number in the same link is refused
        $this->get(str_replace("/purchase-orders/{$po->id}/", "/purchase-orders/{$other->id}/", $path))->assertForbidden();
    }
}
