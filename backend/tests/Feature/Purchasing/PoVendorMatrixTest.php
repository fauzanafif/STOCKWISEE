<?php

namespace Tests\Feature\Purchasing;

use App\Models\Item;
use App\Models\PurchaseOrder;
use App\Models\PurchaseOrderItem;
use App\Models\Vendor;
use Database\Seeders\RbacSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** To do → items and vendors picked → prices at their crossings → the Director picks as before. */
class PoVendorMatrixTest extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected $seeder = RbacSeeder::class;

    private function waitingLine(string $no = 'PPB/M/001'): PurchaseOrderItem
    {
        $this->actingAsRole('super_admin');
        $item = Item::factory()->create(['is_active' => true]);
        $this->postJson('/api/ppb', ['no_ppb' => $no, 'tgl_ppb' => now()->toDateString(), 'kode_barang' => $item->code, 'deskripsi_barang' => 'Kertas', 'kuantitas' => 5])->assertCreated();
        $ppb = \App\Models\Ppb::where('no_ppb', $no)->sole();
        $this->actingAsRole('manager');
        $this->postJson("/api/ppb/{$ppb->id}/approval", ['action' => 'APPROVE'])->assertOk();
        $this->actingAsRole('direktur');
        $this->postJson("/api/ppb/{$ppb->id}/approval", ['action' => 'APPROVE'])->assertOk();

        return PurchaseOrderItem::where('approved_ppb_id', $ppb->id)->sole();
    }

    public function test_items_and_vendors_are_picked_and_prices_go_in_at_their_crossings(): void
    {
        $line = $this->waitingLine();
        [$a, $b, $c] = Vendor::factory()->count(3)->create();
        $this->actingAsRole('purchasing');

        // any vendors for any items; no price yet
        $this->postJson('/api/po-draft-lines/to-quotation', ['line_ids' => [$line->id], 'vendor_ids' => [$a->id, $b->id]])->assertOk()->assertJsonPath('data.moved', 1);
        $row = $this->getJson('/api/po-draft-lines?stage=PENAWARAN')->assertOk()->json('data.0');
        $this->assertEqualsCanonicalizing([$a->id, $b->id], array_column($row['draft_vendors'], 'id'));
        $this->assertSame([], $row['quotes']);

        // another column later; the same one twice is one column
        $this->postJson('/api/po-draft-lines/vendors', ['line_ids' => [$line->id], 'vendor_ids' => [$c->id, $a->id]])->assertOk();
        $this->assertCount(3, $this->getJson('/api/po-draft-lines?stage=PENAWARAN')->json('data.0.draft_vendors'));

        // a price at a crossing is that vendor's quote
        $this->putJson("/api/po-draft-lines/{$line->id}/quotes", ['vendor_id' => $a->id, 'unit_price' => 900])->assertOk();
        // a column with a price stays; an empty one can go
        $this->deleteJson("/api/po-draft-lines/vendors/{$a->id}", ['line_ids' => [$line->id]])->assertStatus(422)->assertJsonValidationErrors('vendor');
        $this->deleteJson("/api/po-draft-lines/vendors/{$c->id}", ['line_ids' => [$line->id]])->assertOk();
        $this->assertCount(2, $this->getJson('/api/po-draft-lines?stage=PENAWARAN')->json('data.0.draft_vendors'));

        // the rest is as it was: the Director picks, then a PO
        $this->postJson('/api/po-draft-lines/submit-quotation', ['line_ids' => [$line->id]])->assertOk();
        $this->actingAsRole('direktur');
        $quote = $this->getJson('/api/po-draft-lines?stage=MENUNGGU_DIREKTUR')->json('data.0.quotes.0.id');
        $this->postJson("/api/po-draft-lines/{$line->id}/choose", ['quote_id' => $quote])->assertOk();
        $this->actingAsRole('purchasing');
        $po = $this->postJson('/api/po-draft-lines/submit', ['line_ids' => [$line->id], 'vendor_id' => $a->id])->assertCreated()->json('data');
        $this->assertSame($a->id, PurchaseOrder::find($po['id'])->vendor_id);
    }

    public function test_an_item_needs_a_price_before_the_director_and_only_purchasing_picks(): void
    {
        $line = $this->waitingLine();
        $a = Vendor::factory()->create();
        $this->actingAsRole('purchasing');
        $this->postJson('/api/po-draft-lines/to-quotation', ['line_ids' => [$line->id], 'vendor_ids' => [$a->id]])->assertOk();
        $this->postJson('/api/po-draft-lines/submit-quotation', ['line_ids' => [$line->id]])->assertStatus(422)->assertJsonValidationErrors('line_ids');
        $this->postJson('/api/po-draft-lines/to-quotation', ['line_ids' => [$line->id], 'vendor_ids' => [999999]])->assertStatus(422)->assertJsonValidationErrors('vendor_ids.0');
        $this->actingAsRole('karyawan');
        $this->postJson('/api/po-draft-lines/vendors', ['line_ids' => [$line->id], 'vendor_ids' => [$a->id]])->assertForbidden();
    }

    public function test_moving_items_without_vendors_works_as_before(): void
    {
        $line = $this->waitingLine();
        $this->actingAsRole('purchasing');
        $this->postJson('/api/po-draft-lines/to-quotation', ['line_ids' => [$line->id]])->assertOk()->assertJsonPath('data.moved', 1);
        $this->assertSame([], $this->getJson('/api/po-draft-lines?stage=PENAWARAN')->json('data.0.draft_vendors'));
    }
}
