<?php

namespace Tests\Feature;

use App\Models\Item;
use App\Models\Ppb;
use App\Models\PpbDraft;
use App\Models\PpbDraftLine;
use App\Models\PpbSavedDraft;
use Database\Seeders\RbacSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** To do: the items ready for a Purchase Request. Picked ones can wait in a draft before asking for approval. */
class PpbSavedDraftTest extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected $seeder = RbacSeeder::class;

    /** @return list<int> two lines to do */
    private function twoLines(): array
    {
        $this->actingAsRole('admin_gudang');
        $a = Item::factory()->create(['code' => 'A.1', 'is_active' => true]);
        $b = Item::factory()->create(['code' => 'B.1', 'is_active' => true]);

        return $this->postJson('/api/ppb-drafts', ['items' => [['item_id' => $a->id, 'qty' => 5], ['item_id' => $b->id, 'qty' => 3]]])->assertCreated()->json('data.lines.*.id');
    }

    private function todo(): array
    {
        return array_column($this->getJson('/api/ppb-draft-lines')->assertOk()->json('data'), 'id');
    }

    public function test_picked_items_wait_in_a_draft_and_nobody_is_asked_until_approval_is_requested(): void
    {
        [$one, $two] = $this->twoLines();
        $this->assertSame([$one, $two], $this->todo());

        $id = $this->postJson('/api/ppb-saved-drafts', ['line_ids' => [$one], 'name' => 'Untuk minggu depan', 'no_ppb' => 'PPB/DR/001'])->assertCreated()->json('data.id');
        $this->assertSame([$two], $this->todo(), 'a drafted item leaves To do');
        $this->assertSame(0, Ppb::count(), 'no Purchase Request yet');
        $this->assertSame(0, \Illuminate\Support\Facades\DB::table('ppb_approvals')->count(), 'nobody is asked');

        // the same item cannot wait in two drafts, and a draft keeps what was written
        $this->postJson('/api/ppb-saved-drafts', ['line_ids' => [$one]])->assertStatus(422)->assertJsonValidationErrors('line_ids');
        $row = $this->getJson('/api/ppb-saved-drafts')->assertOk()->json('data.0');
        $this->assertSame(['Untuk minggu depan', 'PPB/DR/001', [$one]], [$row['name'], $row['no_ppb'], array_column($row['lines'], 'id')]);
        $this->putJson("/api/ppb-saved-drafts/{$id}", ['name' => 'Ganti nama', 'divisi' => 'IT'])->assertOk();
        $this->assertSame('Ganti nama', PpbSavedDraft::find($id)->name);

        // the number and date are needed only now; then it runs as any Purchase Request
        $this->postJson("/api/ppb-saved-drafts/{$id}/submit", ['no_ppb' => '', 'tgl_ppb' => now()->toDateString()])->assertStatus(422)->assertJsonValidationErrors('no_ppb');
        $this->postJson("/api/ppb-saved-drafts/{$id}/submit", ['no_ppb' => 'PPB/DR/001', 'tgl_ppb' => now()->toDateString()])->assertCreated();
        $made = Ppb::where('no_ppb', 'PPB/DR/001')->sole();
        $this->assertSame(['IT', 'A.1'], [$made->divisi, $made->kode_barang]);
        $this->assertNull(PpbSavedDraft::find($id), 'the draft is done');
        $this->assertSame($made->id, PpbDraftLine::find($one)->ppb_id);
        $this->assertSame([$two], $this->todo());
    }

    public function test_items_go_back_to_to_do_one_at_a_time_or_all_together(): void
    {
        [$one, $two] = $this->twoLines();
        $id = $this->postJson('/api/ppb-saved-drafts', ['line_ids' => [$one, $two]])->assertCreated()->json('data.id');
        $this->assertSame([], $this->todo());

        $this->deleteJson("/api/ppb-saved-drafts/{$id}/lines/{$one}")->assertOk();
        $this->assertSame([$one], $this->todo());
        $this->assertNotNull(PpbSavedDraft::find($id));
        // the last one going takes the empty draft with it
        $this->deleteJson("/api/ppb-saved-drafts/{$id}/lines/{$two}")->assertOk();
        $this->assertNull(PpbSavedDraft::find($id));
        $this->assertSame([$one, $two], $this->todo());

        $id = $this->postJson('/api/ppb-saved-drafts', ['line_ids' => [$two]])->assertCreated()->json('data.id');
        $this->deleteJson("/api/ppb-saved-drafts/{$id}")->assertOk();
        $this->assertSame([$one, $two], $this->todo());
        $this->assertSame(2, PpbDraftLine::count(), 'no item is lost');
    }

    public function test_reminders_tell_to_do_from_drafts_and_only_who_may_make_one_can(): void
    {
        [$one, $two] = $this->twoLines();
        $this->postJson('/api/ppb-saved-drafts', ['line_ids' => [$one]])->assertCreated();
        $reminders = collect($this->getJson('/api/reminders?module=ppb')->assertOk()->json('data'))->keyBy('key');
        $this->assertSame([1, 1], [$reminders['ppb_draft']['count'], $reminders['ppb_saved']['count']]);

        $this->actingAsRole('karyawan');
        $this->getJson('/api/ppb-saved-drafts')->assertForbidden();
        $this->postJson('/api/ppb-saved-drafts', ['line_ids' => [$two]])->assertForbidden();
    }

    public function test_a_line_whose_request_was_cancelled_cannot_be_drafted(): void
    {
        [$one] = $this->twoLines();
        PpbDraft::query()->update(['status' => 'DIBATALKAN']);
        $this->postJson('/api/ppb-saved-drafts', ['line_ids' => [$one]])->assertStatus(422)->assertJsonValidationErrors('line_ids');
    }
}
