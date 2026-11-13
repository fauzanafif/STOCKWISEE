<?php

namespace Tests\Feature\Documents;

use App\Models\DocAuditLog;
use App\Models\Item;
use App\Models\ItemRequest;
use App\Models\Npbg;
use App\Models\PpbDraft;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Inventory\StockLedgerService;
use Database\Seeders\RbacSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use LogicException;
use Tests\TestCase;

/**
 * Odoo-style collaboration on transaction documents: Smart Buttons (related documents read from the existing links),
 * Chatter (messages / internal notes / attachments), Activities (system + scheduled) and the Audit Trail —
 * on top of the real Item Request → Delivery Order flow, which must stay exactly as it is.
 */
class DocumentCollaborationTest extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected $seeder = RbacSeeder::class;

    private const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

    private Item $item;

    private Warehouse $warehouse;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        Storage::fake('local');
        config(['stockwise.stockwise_ledger_since' => now()->subDay()->toDateTimeString()]);
        $this->item = Item::factory()->create(['code' => 'ATK.0001', 'description' => 'KERTAS HVS A4 70 GSM', 'is_active' => true]);
        $this->warehouse = Warehouse::factory()->create();
    }

    /**
     * Stock 4, a request of 10 → verified → Manager → Director: 4 from stock (Delivery Order, held), 6 to a Draft
     * Purchase Request. Returns [request id, requester].
     */
    private function approvedRequest(): array
    {
        app(StockLedgerService::class)->record(['type' => 'STOCK_IN', 'item_id' => $this->item->id, 'warehouse_id' => $this->warehouse->id, 'qty' => 4]);
        $karyawan = $this->actingAsRole('karyawan', ['name' => 'SITI']);
        $req = $this->postJson('/api/item-requests', ['divisi' => 'HRD', 'lines' => [['deskripsi_barang' => 'kertas hvs a4', 'qty' => 10, 'satuan' => 'RIM']]])->assertCreated()->json('data');
        $this->actingAsRole('admin_gudang', ['name' => 'ADMIN GUDANG']);
        $this->postJson("/api/item-requests/{$req['id']}/process", ['lines' => [$req['lines'][0]['id'] => ['item_id' => $this->item->id]], 'npbg' => ['pelanggan' => 'HRD']])->assertOk();
        $this->actingAsRole('manager');
        $this->postJson("/api/item-requests/{$req['id']}/approval", ['action' => 'APPROVE'])->assertOk();
        $this->actingAsRole('direktur');
        $this->postJson("/api/item-requests/{$req['id']}/approval", ['action' => 'APPROVE'])->assertOk()->assertJsonPath('data.status', 'DISIAPKAN');

        return [$req['id'], $karyawan];
    }

    private function relatedGroups(string $type, int $id): array
    {
        return collect($this->getJson("/api/documents/{$type}/{$id}/related")->assertOk()->json('data.groups'))->keyBy('type')->all();
    }

    // ------------------------------------------------------------------ Smart Buttons / relations

    public function test_item_request_and_delivery_order_are_linked_both_ways_from_the_existing_data(): void
    {
        [$id, $karyawan] = $this->approvedRequest();
        $npbg = Npbg::sole();
        $draft = PpbDraft::where('item_request_id', $id)->sole();

        $this->actingAsRole('admin_gudang');
        $g = $this->relatedGroups('item_request', $id);
        $this->assertSame([1, $npbg->no_npbg, $npbg->id], [$g['delivery_order']['count'], $g['delivery_order']['docs'][0]['number'], $g['delivery_order']['docs'][0]['id']]);
        $this->assertSame([1, $draft->id], [$g['ppb_draft']['count'], $g['ppb_draft']['docs'][0]['id']]);
        // and back: the Delivery Order knows its Item Request, the draft too
        $this->assertSame($id, $this->relatedGroups('delivery_order', $npbg->id)['item_request']['docs'][0]['id']);
        $this->assertSame($id, $this->relatedGroups('ppb_draft', $draft->id)['item_request']['docs'][0]['id']);

        // the requester sees their own request, but no Delivery Order / Purchase Request button (no permission for those pages)
        $this->actingAs($karyawan);
        $this->assertSame([], $this->relatedGroups('item_request', $id));
        $this->getJson("/api/documents/delivery_order/{$npbg->id}/related")->assertForbidden();
        // another employee does not see it at all
        $this->actingAsRole('karyawan');
        $this->getJson("/api/documents/item_request/{$id}/related")->assertForbidden();
        $this->getJson('/api/documents/unknown/1/related')->assertNotFound();
        $this->actingAsRole('admin_gudang');
        $this->getJson('/api/documents/item_request/999999/related')->assertNotFound();
    }

    public function test_purchase_chain_is_followed_through_the_numbers_already_stored(): void
    {
        $now = now();
        $vendor = DB::table('vendors')->insertGetId(['name' => 'PT VENDOR', 'created_at' => $now, 'updated_at' => $now]);
        $ppb = [];
        foreach (['KERTAS', 'TINTA'] as $d) {
            $ppb[] = DB::table('ppb')->insertGetId(['no_ppb' => 'PPB/NA/26/XI/001', 'deskripsi_barang' => $d, 'kuantitas' => 1, 'tgl_ppb' => $now->toDateString(), 'created_at' => $now, 'updated_at' => $now]);
        }
        $po = DB::table('purchase_orders')->insertGetId(['number' => 'BL/D/26/XI/001', 'vendor_id' => $vendor, 'status' => 'DIBELI', 'date' => $now->toDateString(), 'created_at' => $now, 'updated_at' => $now]);
        DB::table('purchase_order_items')->insert(['purchase_order_id' => $po, 'approved_ppb_id' => $ppb[0], 'description_raw' => 'KERTAS', 'qty' => 1, 'created_at' => $now, 'updated_at' => $now]);
        $ri = DB::table('ri')->insertGetId(['no_ri' => 'RI/NV/26/XI/001', 'no_po' => 'BL/D/26/XI/001', 'no_ppb' => 'PPB/NA/26/XI/001', 'deskripsi_barang' => 'KERTAS', 'kuantitas' => 1, 'tgl_ri' => $now->toDateString(), 'created_at' => $now, 'updated_at' => $now]);
        $ret = DB::table('purchase_returns')->insertGetId(['number' => 'RET/26/XI/001', 'no_ri' => 'RI/NV/26/XI/001', 'no_po' => 'BL/D/26/XI/001', 'status' => 'DIBUAT', 'tgl_retur' => $now->toDateString(), 'resolution' => 'REPLACE', 'reason' => 'Rusak', 'created_at' => $now, 'updated_at' => $now]);

        $this->actingAsRole('super_admin');
        $g = $this->relatedGroups('purchase_request', $ppb[1]); // opened from its second line: the same document
        $this->assertSame([[$po], ['RI/NV/26/XI/001']], [array_column($g['purchase_order']['docs'], 'id'), array_column($g['receipt']['docs'], 'number')]);
        $g = $this->relatedGroups('purchase_order', $po);
        $this->assertSame([['PPB/NA/26/XI/001'], [$ri], [$ret]], [array_column($g['purchase_request']['docs'], 'number'), array_column($g['receipt']['docs'], 'id'), array_column($g['purchase_return']['docs'], 'id')]);
        $g = $this->relatedGroups('receipt', $ri);
        $this->assertSame([[$po], [$ret], ['PPB/NA/26/XI/001']], [array_column($g['purchase_order']['docs'], 'id'), array_column($g['purchase_return']['docs'], 'id'), array_column($g['purchase_request']['docs'], 'number')]);
        $this->assertSame([$ri], array_column($this->relatedGroups('purchase_return', $ret)['receipt']['docs'], 'id'));

        // purchasing may open POs but not Receipts? only what their permissions allow is returned
        $this->actingAsRole('karyawan');
        $this->getJson("/api/documents/purchase_order/{$po}/related")->assertForbidden();
    }

    // ------------------------------------------------------------------ Chatter

    public function test_messages_are_shared_internal_notes_stay_with_staff(): void
    {
        [$id, $karyawan] = $this->approvedRequest();
        $this->actingAs($karyawan);
        $this->postJson("/api/documents/item_request/{$id}/messages", ['kind' => 'MESSAGE', 'body' => 'Kapan bisa diambil?'])->assertCreated();
        $this->postJson("/api/documents/item_request/{$id}/messages", ['kind' => 'NOTE', 'body' => 'x'])->assertForbidden();
        $this->postJson("/api/documents/item_request/{$id}/messages", ['kind' => 'MESSAGE', 'body' => ' '])->assertStatus(422);

        $admin = $this->actingAsRole('admin_gudang', ['name' => 'ADMIN']);
        $this->postJson("/api/documents/item_request/{$id}/messages", ['kind' => 'NOTE', 'body' => 'Stok sisa 6 menunggu PO',
            'files' => [UploadedFile::fake()->create('quote.pdf', 20, 'application/pdf')]])->assertCreated();
        $this->postJson("/api/documents/item_request/{$id}/messages", ['kind' => 'MESSAGE', 'body' => 'Besok siang',
            'files' => [UploadedFile::fake()->create('big.pdf', 11000, 'application/pdf')]])->assertStatus(422);
        $feed = collect($this->getJson("/api/documents/item_request/{$id}/feed")->assertOk()->json('data'));
        $this->assertSame(1, $feed->where('kind', 'NOTE')->count());
        $this->assertTrue($feed->contains(fn ($i) => $i['kind'] === 'TRACKING'), 'the tracked changes are in the feed');
        $note = $feed->firstWhere('kind', 'NOTE');
        $this->get("/api/documents/item_request/{$id}/attachments/{$note['attachments'][0]['id']}")->assertOk();

        // the requester never sees the note nor its file
        $this->actingAs($karyawan);
        $theirs = collect($this->getJson("/api/documents/item_request/{$id}/feed")->assertOk()->json('data'));
        $this->assertSame(0, $theirs->where('kind', 'NOTE')->count());
        $this->assertSame(1, $theirs->where('kind', 'MESSAGE')->count());
        $this->get("/api/documents/item_request/{$id}/attachments/{$note['attachments'][0]['id']}")->assertForbidden();

        // only the author edits / deletes, both kept in the audit trail
        $mine = $theirs->firstWhere('kind', 'MESSAGE');
        $this->actingAs($admin);
        $this->putJson("/api/documents/item_request/{$id}/messages/{$mine['message_id']}", ['body' => 'hack'])->assertForbidden();
        $this->actingAs($karyawan);
        $this->putJson("/api/documents/item_request/{$id}/messages/{$mine['message_id']}", ['body' => 'Kapan bisa diambil, Pak?'])->assertOk();
        $this->deleteJson("/api/documents/item_request/{$id}/messages/{$mine['message_id']}")->assertOk();
        $this->deleteJson("/api/documents/item_request/{$id}/messages/{$mine['message_id']}")->assertStatus(422);
        $after = collect($this->getJson("/api/documents/item_request/{$id}/feed")->json('data'))->firstWhere('kind', 'MESSAGE');
        $this->assertSame([true, null], [$after['deleted'], $after['body']]);
        $this->assertSame(['MESSAGE_EDITED', 'MESSAGE_DELETED'], DocAuditLog::where('model', 'DocMessage')->orderBy('id')->pluck('event')->all());
    }

    // ------------------------------------------------------------------ Activities

    public function test_activities_system_and_scheduled_with_notification_and_todo(): void
    {
        [$id, $karyawan] = $this->approvedRequest();
        $field = User::factory()->create(['name' => 'PETUGAS']);
        $field->roles()->attach(\App\Models\Role::where('slug', 'lapangan_gudang')->sole());
        $admin = $this->actingAsRole('admin_gudang', ['name' => 'ADMIN']);

        // the status says what is next: the warehouse prepares and hands over
        $acts = $this->getJson("/api/documents/item_request/{$id}/activities")->assertOk()->json('data');
        $this->assertSame('Prepare the Delivery Order and hand the items over', $acts['system'][0]['summary']);
        $this->assertTrue($acts['can_schedule']);

        $this->postJson("/api/documents/item_request/{$id}/activities", ['activity_type' => 'PREPARE', 'assignee_id' => $field->id, 'due_date' => now()->subDay()->toDateString()])->assertStatus(422);
        $other = User::factory()->create(['name' => 'ORANG LAIN']);
        $other->roles()->attach(\App\Models\Role::where('slug', 'karyawan')->sole());
        $this->postJson("/api/documents/item_request/{$id}/activities", ['activity_type' => 'PREPARE', 'assignee_id' => $other->id, 'due_date' => now()->toDateString()])
            ->assertStatus(422)->assertJsonValidationErrors('assignee_id'); // cannot open the request
        $a = $this->postJson("/api/documents/item_request/{$id}/activities", ['activity_type' => 'PREPARE', 'summary' => 'Siapkan kertas di rak A', 'assignee_id' => $field->id, 'due_date' => now()->toDateString()])
            ->assertCreated()->json('data');
        $this->assertSame('TODAY', $a['state']);
        $this->assertSame(1, $field->notifications()->count());

        // the requester can neither schedule nor see scheduled activities
        $this->actingAs($karyawan);
        $this->postJson("/api/documents/item_request/{$id}/activities", ['activity_type' => 'TODO', 'assignee_id' => $karyawan->id, 'due_date' => now()->toDateString()])->assertForbidden();
        $this->assertSame([], $this->getJson("/api/documents/item_request/{$id}/activities")->json('data.manual'));
        $this->postJson("/api/documents/item_request/{$id}/activities/{$a['id']}/done")->assertStatus(422);

        // the assignee finds it in the To-Do and marks it done
        $this->actingAs($field);
        $todo = collect($this->getJson('/api/reminders')->assertOk()->json('data'))->firstWhere('key', 'doc_activity');
        $this->assertSame("/item-requests/{$id}", $todo['items'][0]['to']);
        $this->assertCount(1, $this->getJson('/api/documents/activities/mine')->json('data'));
        $done = $this->postJson("/api/documents/item_request/{$id}/activities/{$a['id']}/done", ['note' => 'sudah di rak'])->assertOk()->json('data');
        $this->assertSame(['DONE', 'PETUGAS'], [$done['state'], $done['done_by_name']]);
        $this->postJson("/api/documents/item_request/{$id}/activities/{$a['id']}/done")->assertStatus(422);
        $this->assertNull(collect($this->getJson('/api/reminders')->json('data'))->firstWhere('key', 'doc_activity'));
        $this->assertSame(['ACTIVITY_SCHEDULED', 'ACTIVITY_DONE'], DocAuditLog::where('model', 'DocActivity')->orderBy('id')->pluck('event')->all());
        $this->assertNotNull($admin);
    }

    // ------------------------------------------------------------------ Audit Trail

    public function test_audit_trail_records_users_changes_before_after_and_cannot_be_altered(): void
    {
        [$id] = $this->approvedRequest();
        $this->actingAsRole('admin_gudang');
        $rows = collect($this->getJson("/api/documents/item_request/{$id}/audit")->assertOk()->json('data'));
        $statusChanges = $rows->where('model', 'ItemRequest')->where('event', 'UPDATED')->pluck('changes.status')->filter()->values();
        $this->assertContains(['APPROVAL_MANAGER', 'APPROVAL_DIREKTUR'], $statusChanges->all());
        $this->assertTrue($rows->contains(fn ($r) => $r['user_name'] === 'ADMIN GUDANG'));
        // the Delivery Order made by the system during the Director's approval is logged on the Delivery Order
        $npbg = Npbg::sole();
        $this->assertTrue(DocAuditLog::where(['res_type' => 'delivery_order', 'res_key' => $npbg->no_npbg, 'event' => 'CREATED'])->exists());

        // nothing is logged without a signed-in user (console, scheduler, the Accurate agent / sync)
        $before = DocAuditLog::count();
        auth()->forgetGuards();
        ItemRequest::find($id)->update(['divisi' => 'GA']);
        $this->assertSame($before, DocAuditLog::count());

        $log = DocAuditLog::first();
        $this->expectException(LogicException::class);
        $log->update(['reason' => 'tamper']);
    }

    public function test_the_item_request_flow_and_stock_are_unchanged(): void
    {
        [$id] = $this->approvedRequest();
        $this->actingAsRole('lapangan_gudang');
        $f = $this->getJson("/api/item-requests/{$id}")->assertOk()->json('data.fulfillments.0');
        $this->postJson("/api/item-requests/{$id}/fulfillments/{$f['id']}/handover", ['photo' => self::PNG, 'signature' => self::PNG, 'received_by' => 'Siti'])->assertOk()
            ->assertJsonPath('data.status', 'MENUNGGU_PENGADAAN');
        $this->assertSame(0.0, (float) DB::table('inventory')->where('item_id', $this->item->id)->sum('actual_qty'), 'the stock left only through the Delivery Order');
        $this->assertSame(1, DB::table('stock_movements')->where('item_id', $this->item->id)->where('movement_type', 'STOCK_OUT')->count());
    }
}
