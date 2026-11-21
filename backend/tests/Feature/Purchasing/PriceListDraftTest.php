<?php

namespace Tests\Feature\Purchasing;

use App\Models\Item;
use App\Models\Ppb;
use App\Models\PurchaseOrderItem;
use App\Models\PurchaseOrderQuote;
use App\Models\Unit;
use App\Models\Vendor;
use App\Models\VendorPrice;
use App\Models\VendorPriceHistory;
use Database\Seeders\RbacSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** Draft Price List: items × vendors priced in one draft, "Set Harga" into the Master; the Draft PO takes those prices. */
class PriceListDraftTest extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected $seeder = RbacSeeder::class;

    private Unit $pcs;

    protected function setUp(): void
    {
        parent::setUp();
        $this->pcs = Unit::factory()->create(['code' => 'PCS']);
    }

    private function item(string $code): Item
    {
        return Item::factory()->create(['code' => $code, 'unit_id' => $this->pcs->id, 'is_active' => true]);
    }

    public function test_a_draft_is_a_matrix_of_the_items_and_vendors_picked_and_set_harga_fills_the_master(): void
    {
        $this->actingAsRole('purchasing');
        [$bearing, $kabel] = [$this->item('BRG.1'), $this->item('KBL.1')];
        [$a, $b] = Vendor::factory()->count(2)->create(['is_active' => true]);

        $d = $this->postJson('/api/price-list/drafts', ['item_ids' => [$bearing->id, $kabel->id], 'vendor_ids' => [$a->id, $b->id], 'note' => 'Q4'])->assertCreated()->json('data');
        // a PI document, numbered as the Excel Purchase Information: PI/26/XI/001
        $this->assertMatchesRegularExpression('#^PI/\d{2}/[IVX]+/001$#', $d['number']);
        $this->assertSame(['BRG.1', 'KBL.1'], array_column($d['items'], 'code'));
        $this->assertCount(2, $d['vendors']);

        $this->putJson("/api/price-list/drafts/{$d['id']}/cells", ['item_id' => $bearing->id, 'vendor_id' => $a->id, 'price' => 25000])->assertOk();
        $this->putJson("/api/price-list/drafts/{$d['id']}/cells", ['item_id' => $bearing->id, 'vendor_id' => $b->id, 'price' => 23500])->assertOk();
        $this->putJson("/api/price-list/drafts/{$d['id']}/cells", ['item_id' => $kabel->id, 'vendor_id' => $a->id, 'price' => 0])->assertUnprocessable();
        // nothing reaches the Master before "Set Harga"
        $this->assertSame(0, VendorPrice::count());
        $this->assertEquals(['BRG.1:A' => 25000, 'BRG.1:B' => 23500], collect($this->getJson("/api/price-list/drafts/{$d['id']}")->json('data.cells'))
            ->mapWithKeys(fn ($p, $k) => [str_replace([$bearing->id.':', ":{$a->id}", ":{$b->id}"], ['BRG.1:', ':A', ':B'], $bearing->id.':'.explode(':', $k)[1]) => $p])->all());

        $this->postJson("/api/price-list/drafts/{$d['id']}/finish")->assertOk()->assertJsonPath('data.status', 'DONE');
        $this->assertSame(2, VendorPrice::where('status', 'ACTIVE')->count());
        $this->assertSame(2, VendorPriceHistory::where('note', "Dari Draft Price List {$d['number']}")->count());
        // a draft set is read only
        $this->putJson("/api/price-list/drafts/{$d['id']}/cells", ['item_id' => $kabel->id, 'vendor_id' => $a->id, 'price' => 1000])->assertUnprocessable();
    }

    public function test_each_vendor_column_sets_its_tax_and_quotation_and_set_harga_copies_them_with_the_pi(): void
    {
        $this->actingAsRole('purchasing');
        [$bearing, $kabel] = [$this->item('BRG.1'), $this->item('KBL.1')];
        [$a, $b] = Vendor::factory()->count(2)->create(['is_active' => true]);
        $d = $this->postJson('/api/price-list/drafts', ['item_ids' => [$bearing->id, $kabel->id], 'vendor_ids' => [$a->id, $b->id]])->assertCreated()->json('data');
        // a new column starts before PPN at 11%
        $this->assertEquals(['EXCL', 11], [$d['vendors'][0]['price_type'], $d['vendors'][0]['ppn_rate']]);

        $this->putJson("/api/price-list/drafts/{$d['id']}/vendors/{$a->id}", ['price_type' => 'EXCL', 'ppn_rate' => 12, 'vendor_ref' => 'SPH-77'])->assertOk();
        $this->putJson("/api/price-list/drafts/{$d['id']}/vendors/{$b->id}", ['price_type' => 'NETT', 'ppn_rate' => 11])->assertOk();
        // PPN is a choice: no 1.11 / 2.11 like the Excel had
        $this->putJson("/api/price-list/drafts/{$d['id']}/vendors/{$a->id}", ['price_type' => 'EXCL', 'ppn_rate' => 1.11])->assertUnprocessable();
        $this->putJson("/api/price-list/drafts/{$d['id']}/cells", ['item_id' => $bearing->id, 'vendor_id' => $a->id, 'price' => 100000])->assertOk();
        $this->putJson("/api/price-list/drafts/{$d['id']}/cells", ['item_id' => $kabel->id, 'vendor_id' => $b->id, 'price' => 50000])->assertOk();
        $this->postJson("/api/price-list/drafts/{$d['id']}/finish")->assertOk();

        $pa = VendorPrice::where('vendor_id', $a->id)->sole();
        $pb = VendorPrice::where('vendor_id', $b->id)->sole();
        $this->assertSame(['EXCL', '12.00', 'SPH-77', $d['id']], [$pa->price_type, $pa->ppn_rate, $pa->vendor_ref, $pa->price_list_draft_id]);
        // nett carries no PPN on top
        $this->assertSame(['NETT', '0.00'], [$pb->price_type, $pb->ppn_rate]);
        $this->assertSame(112000.0, $pa->finalPrice());
        $this->assertSame(50000.0, $pb->finalPrice());

        $row = $this->getJson("/api/price-list/{$pa->id}")->assertOk()->json('data');
        $this->assertSame([112000, $d['number'], []], [$row['final_price'], $row['pi']['number'], $row['missing']]);
        // the draft's Chatter keeps the vendor's quotation files
        $this->getJson("/api/documents/price_list_draft/{$d['id']}/feed")->assertOk();
    }

    public function test_a_price_without_tax_or_source_shows_as_incomplete(): void
    {
        $this->actingAsRole('purchasing');
        $item = $this->item('BRG.1');
        $v = Vendor::factory()->create(['is_active' => true]);
        $id = $this->postJson('/api/price-list', ['item_id' => $item->id, 'vendor_id' => $v->id, 'unit_id' => $this->pcs->id, 'price' => 1000, 'status' => 'ACTIVE'])->assertCreated()->json('data.id');
        $this->assertSame(['tax', 'source'], $this->getJson("/api/price-list/{$id}")->json('data.missing'));
        $this->assertSame(1, $this->getJson('/api/price-list?incomplete=1')->assertOk()->json('meta.completeness.incomplete'));
        $this->assertCount(1, $this->getJson('/api/price-list/matrix?status=incomplete')->assertOk()->json('data.rows'));

        $this->putJson("/api/price-list/{$id}", ['vendor_id' => $v->id, 'unit_id' => $this->pcs->id, 'price' => 1000, 'status' => 'ACTIVE', 'price_type' => 'EXCL', 'ppn_rate' => 11, 'vendor_ref' => 'WA 20/11'])->assertOk()
            ->assertJsonPath('data.missing', [])->assertJsonPath('data.final_price', 1110);
        $this->assertSame(0, $this->getJson('/api/price-list')->json('meta.completeness.incomplete'));
        $this->assertCount(0, $this->getJson('/api/price-list/matrix?status=incomplete')->json('data.rows'));
        // the change of tax is kept in the history
        $this->assertNotNull(VendorPriceHistory::where('vendor_price_id', $id)->where('action', 'UPDATE')->value('changes')['price_type'] ?? null);
    }

    public function test_set_harga_keeps_its_note_and_logs_every_step_and_the_item_can_be_priced_again_later(): void
    {
        $this->actingAsRole('purchasing');
        $bearing = $this->item('BRG.1');
        $v = Vendor::factory()->create(['is_active' => true]);
        $first = $this->postJson('/api/price-list/drafts', ['item_ids' => [$bearing->id], 'vendor_ids' => [$v->id]])->assertCreated()->json('data');
        $this->putJson("/api/price-list/drafts/{$first['id']}/cells", ['item_id' => $bearing->id, 'vendor_id' => $v->id, 'price' => 10000])->assertOk();
        $this->putJson("/api/price-list/drafts/{$first['id']}/cells", ['item_id' => $bearing->id, 'vendor_id' => $v->id, 'price' => 9500])->assertOk();
        $this->postJson("/api/price-list/drafts/{$first['id']}/finish", ['note' => 'harga Q4 dari WA'])->assertOk()->assertJsonPath('data.done_note', 'harga Q4 dari WA');
        $this->assertSame("Dari Draft Price List {$first['number']} — harga Q4 dari WA", VendorPriceHistory::where('action', 'CREATE')->value('note'));

        // every step is in the draft's Audit Trail
        $events = \App\Models\DocAuditLog::where(['res_type' => 'price_list_draft', 'res_key' => (string) $first['id']])->pluck('event')->all();
        foreach (['ITEMS_ADDED', 'VENDORS_ADDED', 'PRICE', 'SET_HARGA'] as $e) {
            $this->assertContains($e, $events);
        }
        $this->assertSame('harga Q4 dari WA', \App\Models\DocAuditLog::where('event', 'SET_HARGA')->value('reason'));

        // once set, the item may go into a next draft and get a new price there
        $this->assertContains('BRG.1', array_column($this->getJson('/api/price-list/drafts/available-items')->json('data'), 'code'));
        $second = $this->postJson('/api/price-list/drafts', ['item_ids' => [$bearing->id], 'vendor_ids' => [$v->id]])->assertCreated()->json('data');
        $this->putJson("/api/price-list/drafts/{$second['id']}/cells", ['item_id' => $bearing->id, 'vendor_id' => $v->id, 'price' => 9000])->assertOk();
        $this->postJson("/api/price-list/drafts/{$second['id']}/finish")->assertOk();
        $price = VendorPrice::sole();
        $this->assertSame(['9000.00', $second['id']], [$price->price, $price->price_list_draft_id]);
        // while that next draft was open, no third draft could take the item
    }

    public function test_an_item_in_a_draft_is_not_offered_to_the_next_draft(): void
    {
        $this->actingAsRole('purchasing');
        [$bearing, $kabel] = [$this->item('BRG.1'), $this->item('KBL.1')];
        $v = Vendor::factory()->create(['is_active' => true]);
        $first = $this->postJson('/api/price-list/drafts', ['item_ids' => [$bearing->id], 'vendor_ids' => [$v->id]])->assertCreated()->json('data');

        $this->assertSame(['KBL.1'], array_column($this->getJson('/api/price-list/drafts/available-items')->assertOk()->json('data'), 'code'));
        $this->postJson('/api/price-list/drafts', ['item_ids' => [$bearing->id], 'vendor_ids' => [$v->id]])->assertUnprocessable()
            ->assertJsonPath('errors.item_ids.0', "BRG.1 sudah ada di {$first['number']}.");

        // deleting a draft not yet set frees its items
        $this->deleteJson("/api/price-list/drafts/{$first['id']}")->assertOk();
        $this->assertSame(['BRG.1', 'KBL.1'], array_column($this->getJson('/api/price-list/drafts/available-items')->json('data'), 'code'));
    }

    public function test_set_harga_updates_a_master_price_already_there_and_keeps_its_history(): void
    {
        $this->actingAsRole('purchasing');
        $bearing = $this->item('BRG.1');
        $v = Vendor::factory()->create(['is_active' => true]);
        $old = $this->postJson('/api/price-list', ['item_id' => $bearing->id, 'vendor_id' => $v->id, 'unit_id' => $this->pcs->id, 'price' => 20000, 'status' => 'ACTIVE', 'lead_time_days' => 3])->assertCreated()->json('data');

        $d = $this->postJson('/api/price-list/drafts', ['item_ids' => [$bearing->id], 'vendor_ids' => [$v->id]])->json('data');
        $this->putJson("/api/price-list/drafts/{$d['id']}/cells", ['item_id' => $bearing->id, 'vendor_id' => $v->id, 'price' => 21000])->assertOk();
        $this->postJson("/api/price-list/drafts/{$d['id']}/finish")->assertOk();

        $this->assertSame(1, VendorPrice::count());
        $p = VendorPrice::sole();
        $this->assertSame($old['id'], $p->id);
        $this->assertEquals(21000, $p->price);
        $this->assertSame(3, $p->lead_time_days);
        $this->assertSame(['CREATE', 'UPDATE'], VendorPriceHistory::orderBy('id')->pluck('action')->all());
    }

    public function test_reading_needs_rfq_view_and_making_needs_rfq_create(): void
    {
        $this->actingAsRole('karyawan');
        $this->getJson('/api/price-list/drafts')->assertForbidden();
        $this->postJson('/api/price-list/drafts', [])->assertForbidden();
        $this->actingAsRole('purchasing');
        $this->getJson('/api/price-list/drafts')->assertOk();
    }

    public function test_the_draft_po_matrix_takes_the_master_price_of_a_vendor_and_leaves_the_others_empty(): void
    {
        $this->actingAsRole('super_admin');
        $item = $this->item('BRG.5');
        $this->postJson('/api/ppb', ['no_ppb' => 'PPB/PL/009', 'tgl_ppb' => now()->toDateString(), 'kode_barang' => $item->code, 'deskripsi_barang' => 'Bearing', 'kuantitas' => 5])->assertCreated();
        $ppb = Ppb::where('no_ppb', 'PPB/PL/009')->sole();
        $this->actingAsRole('manager');
        $this->postJson("/api/ppb/{$ppb->id}/approval", ['action' => 'APPROVE'])->assertOk();
        $this->actingAsRole('direktur');
        $this->postJson("/api/ppb/{$ppb->id}/approval", ['action' => 'APPROVE'])->assertOk();
        $line = PurchaseOrderItem::where('approved_ppb_id', $ppb->id)->sole();
        [$a, $b] = Vendor::factory()->count(2)->create(['is_active' => true]);

        $this->actingAsRole('purchasing');
        $this->postJson('/api/price-list', ['item_id' => $item->id, 'vendor_id' => $a->id, 'unit_id' => $this->pcs->id, 'price' => 900, 'status' => 'ACTIVE'])->assertCreated();
        $this->postJson('/api/po-draft-lines/to-quotation', ['line_ids' => [$line->id], 'vendor_ids' => [$a->id, $b->id]])->assertOk();

        // vendor A has a price set in the Master: it shows in the matrix; vendor B has none: its cell stays empty
        $q = PurchaseOrderQuote::where('purchase_order_item_id', $line->id)->get();
        $this->assertSame([$a->id], $q->pluck('vendor_id')->all());
        $this->assertEquals(900, $q->first()->unit_price);
        $this->assertSame('Dari Price List', $q->first()->note);

        // vendor B's price set later in the Master (Set Harga of a draft) reaches the open quotation at once
        $d = $this->postJson('/api/price-list/drafts', ['item_ids' => [$item->id], 'vendor_ids' => [$b->id]])->assertCreated()->json('data');
        $this->putJson("/api/price-list/drafts/{$d['id']}/cells", ['item_id' => $item->id, 'vendor_id' => $b->id, 'price' => 870])->assertOk();
        $this->postJson("/api/price-list/drafts/{$d['id']}/finish")->assertOk();
        $this->assertEquals(870, PurchaseOrderQuote::where(['purchase_order_item_id' => $line->id, 'vendor_id' => $b->id])->value('unit_price'));
        // a price typed in the quotation is never overwritten by a later Master price
        $this->putJson("/api/po-draft-lines/{$line->id}/quotes", ['vendor_id' => $a->id, 'unit_price' => 880])->assertOk();
        $priceA = VendorPrice::where(['item_id' => $item->id, 'vendor_id' => $a->id])->sole();
        $this->putJson("/api/price-list/{$priceA->id}", ['vendor_id' => $a->id, 'unit_id' => $this->pcs->id, 'price' => 850, 'status' => 'ACTIVE'])->assertOk();
        $this->assertEquals(880, PurchaseOrderQuote::where(['purchase_order_item_id' => $line->id, 'vendor_id' => $a->id])->value('unit_price'));
    }
}
