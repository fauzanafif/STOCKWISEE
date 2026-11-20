<?php

namespace Tests\Feature\Opname;

use App\Models\Category;
use App\Models\Inventory;
use App\Models\Item;
use App\Models\Role;
use App\Models\Site;
use App\Models\StockAdjustment;
use App\Models\StockMovement;
use App\Models\StockOpname;
use App\Models\StockOpnameCount;
use App\Models\StockOpnameEvent;
use App\Models\StockOpnameItem;
use App\Models\User;
use App\Models\Warehouse;
use App\Models\WarehouseLocation;
use App\Services\Inventory\StockLedgerService;
use Database\Seeders\RbacSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use LogicException;
use Tests\TestCase;

/**
 * Stock Opname — the controlled workflow: Draft → Confirmed → Counting → Review ⇄ Recount → Waiting Approval →
 * Posted → Done, blind counting, count history, variance, approval, atomic + idempotent posting to the Stock
 * Ledger, rollback, permissions per role and the audit trail.
 */
class StockOpnameWorkflowTest extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected $seeder = RbacSeeder::class;

    private Warehouse $wh;

    /** @var array<string, User> */
    private array $u = [];

    protected function setUp(): void
    {
        parent::setUp();
        $site = Site::factory()->create(['code' => 'SIG-SDA']);
        $this->wh = Warehouse::factory()->create(['site_id' => $site->id]);
        foreach (['admin' => 'admin_gudang', 'counter' => 'anak_gudang', 'field' => 'lapangan_gudang', 'boss' => 'bos', 'buyer' => 'purchasing', 'super' => 'super_admin'] as $k => $role) {
            $this->u[$k] = User::factory()->create(['name' => ucfirst($k)]);
            $this->u[$k]->roles()->attach($this->role($role));
        }
    }

    private function as(string $who): User
    {
        Sanctum::actingAs($this->u[$who]);

        return $this->u[$who];
    }

    private function stocked(float $qty, array $attrs = []): Item
    {
        $item = Item::factory()->create($attrs);
        if ($qty > 0) {
            app(StockLedgerService::class)->openingBalance($item->id, $this->wh->id, $qty);
        }

        return $item;
    }

    private function stockOf(Item $item): float
    {
        return (float) Inventory::where(['item_id' => $item->id, 'warehouse_id' => $this->wh->id])->value('actual_qty');
    }

    /** @param list<Item> $items */
    private function order(array $items, array $extra = []): int
    {
        $this->as('admin');

        return $this->postJson('/api/stock-opnames/orders', [
            'scheduled_date' => now()->toDateString(), 'warehouse_id' => $this->wh->id,
            'scope' => 'SELECTED', 'item_ids' => array_map(fn ($i) => $i->id, $items),
        ] + $extra)->assertCreated()->json('data.id');
    }

    private function lineOf(int $id, Item $item): StockOpnameItem
    {
        return StockOpnameItem::where(['stock_opname_id' => $id, 'item_id' => $item->id])->firstOrFail();
    }

    /** order → confirm → start counting → count each → finish: the document lands in REVIEW */
    private function counted(array $qtyByItem, array $items): int
    {
        $id = $this->order($items);
        $this->postJson("/api/stock-opnames/{$id}/confirm")->assertOk()->assertJsonPath('data.flow_status', 'CONFIRMED');
        $this->as('counter');
        $this->postJson("/api/stock-opnames/{$id}/start-counting")->assertOk()->assertJsonPath('data.flow_status', 'COUNTING');
        foreach ($items as $i => $item) {
            $this->postJson("/api/stock-opnames/{$id}/lines/{$this->lineOf($id, $item)->id}/count", ['physical_qty' => $qtyByItem[$i]])->assertOk();
        }
        $this->postJson("/api/stock-opnames/{$id}/finish-counting")->assertOk()->assertJsonPath('data.flow_status', 'REVIEW');

        return $id;
    }

    // ---------------------------------------------------------------- creation

    public function test_an_order_gets_its_number_header_team_and_lines_from_the_masters(): void
    {
        $loc = WarehouseLocation::create(['warehouse_id' => $this->wh->id, 'code' => 'A.1.1', 'is_active' => true]);
        $a = $this->stocked(10, ['default_location_id' => $loc->id]);
        $b = $this->stocked(0);

        $res = $this->as('admin');
        $data = $this->postJson('/api/stock-opnames/orders', [
            'scheduled_date' => '2026-11-20', 'warehouse_id' => $this->wh->id, 'scope' => 'SELECTED', 'item_ids' => [$a->id, $b->id],
            'count_method' => 'FULL', 'responsible_id' => $this->u['field']->id, 'team_ids' => [$this->u['counter']->id, $this->u['field']->id],
            'notes' => 'Opname akhir bulan',
        ])->assertCreated()->json('data');

        $this->assertMatchesRegularExpression('#^SO/#', $data['number']);
        $this->assertSame(['DRAFT', 'SELECTED', 'FULL', 'Opname akhir bulan', 'Field'], [$data['flow_status'], $data['scope'], $data['count_method'], $data['notes'], $data['responsible']['name']]);
        $this->assertCount(2, $data['team']);
        $this->assertCount(2, $data['lines']);
        $line = collect($data['lines'])->firstWhere('item_id', $a->id);
        $this->assertSame(['A.1.1', 10.0], [$line['location'], (float) $line['system_qty']]);
        $this->assertContains('confirm', $data['actions']);
        $this->assertSame('CREATED', StockOpnameEvent::where('stock_opname_id', $data['id'])->value('event'));
    }

    public function test_all_items_by_category_and_location_and_a_cycle_count_of_the_longest_uncounted(): void
    {
        $parent = Category::factory()->create(['name' => 'Sparepart']);
        $child = Category::factory()->create(['name' => 'Filter', 'parent_id' => $parent->id]);
        $inCat = $this->stocked(1, ['category_id' => $child->id]);
        $this->stocked(1); // other category
        $this->as('admin');
        $data = $this->postJson('/api/stock-opnames/orders', ['scheduled_date' => now()->toDateString(), 'warehouse_id' => $this->wh->id,
            'scope' => 'ALL', 'category_id' => $parent->id])->assertCreated()->json('data');
        $this->assertSame([$inCat->id], array_column($data['lines'], 'item_id'));

        // cycle count: only items not counted for 30 days, at most 2, never-counted / oldest first
        $recent = $this->stocked(1);
        Inventory::where('item_id', $recent->id)->update(['last_counted_at' => now()->subDays(5)]);
        $old = $this->stocked(1);
        Inventory::where('item_id', $old->id)->update(['last_counted_at' => now()->subDays(200)]);
        $cycle = $this->postJson('/api/stock-opnames/orders', ['scheduled_date' => now()->toDateString(), 'warehouse_id' => $this->wh->id,
            'scope' => 'ALL', 'count_method' => 'CYCLE', 'cycle_days' => 30, 'cycle_limit' => 50])->assertCreated()->json('data');
        $ids = array_column($cycle['lines'], 'item_id');
        $this->assertContains($old->id, $ids);
        $this->assertNotContains($recent->id, $ids);
        $this->assertSame('CYCLE', $cycle['count_method']);

        // nothing matches → refused
        $this->postJson('/api/stock-opnames/orders', ['scheduled_date' => now()->toDateString(), 'warehouse_id' => $this->wh->id,
            'scope' => 'SELECTED', 'item_ids' => [999999]])->assertStatus(422);
    }

    public function test_a_draft_is_edited_then_locked_once_confirmed(): void
    {
        $a = $this->stocked(5);
        $b = $this->stocked(5);
        $id = $this->order([$a]);
        $this->postJson("/api/stock-opnames/{$id}/lines", ['item_ids' => [$b->id, $a->id]])->assertOk()->assertJsonCount(2, 'data.lines');
        $this->deleteJson("/api/stock-opnames/{$id}/lines/{$this->lineOf($id, $a)->id}")->assertOk()->assertJsonCount(1, 'data.lines');
        $this->putJson("/api/stock-opnames/{$id}/draft", ['notes' => 'ubah'])->assertOk()->assertJsonPath('data.notes', 'ubah');

        $this->postJson("/api/stock-opnames/{$id}/confirm")->assertOk();
        $this->postJson("/api/stock-opnames/{$id}/lines", ['item_ids' => [$a->id]])->assertStatus(422);
        $this->putJson("/api/stock-opnames/{$id}/draft", ['notes' => 'x'])->assertStatus(422);
    }

    // ---------------------------------------------------------------- counting

    public function test_blind_count_the_counter_never_sees_book_quantity_but_the_reviewer_and_auditor_do(): void
    {
        $a = $this->stocked(10);
        $id = $this->order([$a]);
        $this->postJson("/api/stock-opnames/{$id}/confirm")->assertOk();

        foreach (['counter', 'field'] as $who) {
            $this->as($who);
            $line = $this->getJson("/api/stock-opnames/{$id}/detail")->assertOk()->json('data.lines.0');
            foreach (['system_qty', 'variance', 'variance_pct', 'current_qty', 'adjustment'] as $k) {
                $this->assertArrayNotHasKey($k, $line, "{$who} must not see {$k}");
            }
            $this->assertArrayNotHasKey('variance_lines', $this->getJson("/api/stock-opnames/{$id}/detail")->json('data.summary'));
        }
        $this->as('counter');
        $this->postJson("/api/stock-opnames/{$id}/start-counting")->assertOk();
        $counted = $this->postJson("/api/stock-opnames/{$id}/lines/{$this->lineOf($id, $a)->id}/count", ['physical_qty' => 7])->assertOk()->json('data');
        $this->assertArrayNotHasKey('variance', $counted);
        $this->assertArrayNotHasKey('top_variances', array_filter($this->getJson('/api/stock-opnames/dashboard')->json('data')));

        // the old list endpoints follow the same rule for the auditor role (bos: opname.view_variance)
        $this->as('boss');
        $this->assertSame(10.0, (float) $this->getJson("/api/stock-opnames/{$id}/detail")->json('data.lines.0.system_qty'));
        $this->as('admin');
        $this->assertSame(-3.0, (float) $this->getJson("/api/stock-opnames/{$id}/detail")->json('data.lines.0.variance'));
    }

    public function test_every_count_is_kept_with_who_and_when_and_only_open_rounds_accept_counts(): void
    {
        $a = $this->stocked(10);
        $id = $this->order([$a]);
        $line = $this->lineOf($id, $a);
        $this->postJson("/api/stock-opnames/{$id}/lines/{$line->id}/count", ['physical_qty' => 3])->assertStatus(422); // still a draft
        $this->postJson("/api/stock-opnames/{$id}/confirm")->assertOk();

        $this->as('counter');
        $this->postJson("/api/stock-opnames/{$id}/lines/{$line->id}/count", ['physical_qty' => 3])->assertStatus(422); // not started
        $this->postJson("/api/stock-opnames/{$id}/start-counting")->assertOk();
        $this->postJson("/api/stock-opnames/{$id}/lines/{$line->id}/count", ['physical_qty' => -1])->assertStatus(422);
        $this->postJson("/api/stock-opnames/{$id}/lines/{$line->id}/count", ['physical_qty' => 8, 'source' => 'SCAN'])->assertOk();
        $row = $this->postJson("/api/stock-opnames/{$id}/lines/{$line->id}/count", ['physical_qty' => 9, 'note' => 'koreksi ketik'])->assertOk()->json('data');
        $this->assertSame(['Counter', 9.0, 1, 2], [$row['counted_by'], (float) $row['physical_qty'], $row['count_round'], $row['counts_count']]);

        $history = $this->getJson("/api/stock-opnames/{$id}/lines/{$line->id}/counts")->assertOk()->json('data');
        $this->assertSame([8.0, 9.0], array_map(fn ($c) => (float) $c['counted_qty'], $history));
        $this->assertSame('SCAN', $history[0]['source']);

        // finishing needs every line counted
        $b = $this->stocked(1);
        $id2 = $this->order([$a, $b]);
        $this->postJson("/api/stock-opnames/{$id2}/confirm");
        $this->as('counter');
        $this->postJson("/api/stock-opnames/{$id2}/start-counting");
        $this->postJson("/api/stock-opnames/{$id2}/lines/{$this->lineOf($id2, $a)->id}/count", ['physical_qty' => 1]);
        $this->postJson("/api/stock-opnames/{$id2}/finish-counting")->assertStatus(422)->assertJsonFragment(['Masih 1 barang belum dihitung. Isi semua baris sebelum selesai menghitung.']);
    }

    public function test_the_book_quantity_is_frozen_when_counting_starts_and_a_counting_team_is_enforced(): void
    {
        $a = $this->stocked(10);
        $id = $this->order([$a], ['team_ids' => [$this->u['counter']->id]]);
        $this->postJson("/api/stock-opnames/{$id}/confirm");
        // stock moves between the order and counting: the frozen book qty follows it
        app(StockLedgerService::class)->record(['type' => 'STOCK_IN', 'item_id' => $a->id, 'warehouse_id' => $this->wh->id, 'qty' => 5]);

        $this->as('field'); // not in the team
        $this->postJson("/api/stock-opnames/{$id}/start-counting")->assertForbidden();
        $this->as('counter');
        $this->postJson("/api/stock-opnames/{$id}/start-counting")->assertOk();
        $this->assertSame(15.0, (float) $this->lineOf($id, $a)->system_qty);
        $this->assertNotNull(StockOpname::find($id)->snapshot_at);
        $this->as('field');
        $this->postJson("/api/stock-opnames/{$id}/lines/{$this->lineOf($id, $a)->id}/count", ['physical_qty' => 1])->assertForbidden();
    }

    // ---------------------------------------------------------------- variance, recount, approval

    public function test_variance_quantity_percentage_and_kind(): void
    {
        [$plus, $minus, $same, $fresh] = [$this->stocked(10), $this->stocked(10), $this->stocked(10), $this->stocked(0)];
        $id = $this->counted([12, 7.5, 10, 4], [$plus, $minus, $same, $fresh]);
        $this->as('admin');
        $d = $this->getJson("/api/stock-opnames/{$id}/detail")->assertOk()->json('data');
        $by = collect($d['lines'])->keyBy('item_id');
        $this->assertSame([2.0, 20.0, 'PLUS'], [(float) $by[$plus->id]['variance'], (float) $by[$plus->id]['variance_pct'], $by[$plus->id]['variance_kind']]);
        $this->assertSame([-2.5, -25.0, 'MINUS'], [(float) $by[$minus->id]['variance'], (float) $by[$minus->id]['variance_pct'], $by[$minus->id]['variance_kind']]);
        $this->assertSame([0.0, 'MATCH'], [(float) $by[$same->id]['variance'], $by[$same->id]['variance_kind']]);
        $this->assertSame([4.0, null, 'PLUS'], [(float) $by[$fresh->id]['variance'], $by[$fresh->id]['variance_pct'], $by[$fresh->id]['variance_kind']]);
        $this->assertEquals([4, 3, 6, -2.5, 25], [$d['summary']['counted'], $d['summary']['variance_lines'], $d['summary']['plus_qty'], $d['summary']['minus_qty'], $d['summary']['accuracy']]);
    }

    public function test_recount_keeps_the_first_count_and_only_reopens_the_lines_asked_for(): void
    {
        [$a, $b] = [$this->stocked(10), $this->stocked(5)];
        $id = $this->counted([4, 5], [$a, $b]);
        $la = $this->lineOf($id, $a);

        $this->as('counter');
        $this->postJson("/api/stock-opnames/{$id}/recount", ['line_ids' => [$la->id], 'reason' => 'selisih besar'])->assertForbidden();
        $this->as('admin');
        $this->postJson("/api/stock-opnames/{$id}/recount", ['line_ids' => [$la->id]])->assertStatus(422); // reason is required
        $this->postJson("/api/stock-opnames/{$id}/recount", ['line_ids' => [$la->id], 'reason' => 'selisih besar'])->assertOk()
            ->assertJsonPath('data.flow_status', 'RECOUNT')->assertJsonPath('data.count_round', 2);

        $this->as('counter');
        $this->postJson("/api/stock-opnames/{$id}/lines/{$this->lineOf($id, $b)->id}/count", ['physical_qty' => 1])->assertStatus(422); // not asked for
        $this->postJson("/api/stock-opnames/{$id}/finish-counting")->assertStatus(422);
        $this->postJson("/api/stock-opnames/{$id}/lines/{$la->id}/count", ['physical_qty' => 9])->assertOk();
        $this->postJson("/api/stock-opnames/{$id}/finish-counting")->assertOk()->assertJsonPath('data.flow_status', 'REVIEW');

        $counts = StockOpnameCount::where('stock_opname_item_id', $la->id)->orderBy('id')->get();
        $this->assertSame([[1, 4.0], [2, 9.0]], $counts->map(fn ($c) => [$c->round, $c->counted_qty])->all());
        $this->assertSame('selisih besar', $counts[1]->recount_reason);
        $this->assertSame(9.0, $la->fresh()->physical_qty);
        // a count can never be rewritten or removed
        $this->expectException(LogicException::class);
        $counts[0]->delete();
    }

    public function test_approval_needs_a_reason_per_variance_and_the_supervisor_can_send_it_back(): void
    {
        [$a, $b] = [$this->stocked(10), $this->stocked(10)];
        $id = $this->counted([8, 10], [$a, $b]);
        $this->as('admin');
        $this->postJson("/api/stock-opnames/{$id}/request-approval")->assertStatus(422)->assertJsonFragment(['1 barang berselisih belum ada alasannya: '.$a->code.'. Isi alasan selisih, atau kecualikan barangnya.']);
        $this->postJson("/api/stock-opnames/{$id}/review-decisions", ['decisions' => [['id' => $this->lineOf($id, $a)->id, 'decision' => 'ACCEPT', 'note' => 'rusak, dibuang']]])->assertOk();
        $this->postJson("/api/stock-opnames/{$id}/request-approval", ['note' => 'cek'])->assertOk()->assertJsonPath('data.flow_status', 'WAITING_APPROVAL');

        // a counter / auditor cannot approve; the supervisor rejects with a note → back to review, stock unchanged
        foreach (['counter', 'boss'] as $who) {
            $this->as($who);
            $this->postJson("/api/stock-opnames/{$id}/approve")->assertForbidden();
        }
        $this->as('admin');
        $this->postJson("/api/stock-opnames/{$id}/reject")->assertStatus(422);
        $this->postJson("/api/stock-opnames/{$id}/reject", ['note' => 'hitung ulang rak A'])->assertOk()->assertJsonPath('data.flow_status', 'REVIEW');
        $this->assertSame(10.0, $this->stockOf($a));
        $this->assertDatabaseHas('stock_opname_events', ['stock_opname_id' => $id, 'event' => 'REJECTED', 'note' => 'hitung ulang rak A', 'from_status' => 'WAITING_APPROVAL', 'to_status' => 'REVIEW']);
    }

    // ---------------------------------------------------------------- posting

    private function waitingApproval(array $qty, array $items, array $exclude = []): int
    {
        $id = $this->counted($qty, $items);
        $this->as('admin');
        $this->postJson("/api/stock-opnames/{$id}/review-decisions", ['decisions' => array_map(fn (Item $i) => [
            'id' => $this->lineOf($id, $i)->id, 'decision' => in_array($i->id, $exclude, true) ? 'EXCLUDE' : 'ACCEPT', 'note' => 'alasan',
        ], $items)])->assertOk();
        $this->postJson("/api/stock-opnames/{$id}/request-approval")->assertOk();

        return $id;
    }

    public function test_posting_adjusts_stock_through_the_ledger_with_the_opname_as_reference(): void
    {
        [$a, $b, $c] = [$this->stocked(10), $this->stocked(10), $this->stocked(10)];
        $id = $this->waitingApproval([7, 12, 3], [$a, $b, $c], exclude: [$c->id]);
        $movementsBefore = StockMovement::count();

        $this->as('admin');
        $res = $this->postJson("/api/stock-opnames/{$id}/approve", ['note' => 'ok'])->assertOk()
            ->assertJsonPath('data.flow_status', 'POSTED')->assertJsonPath('meta.posted', true)->json('data');

        $this->assertSame([7.0, 12.0, 10.0], [$this->stockOf($a), $this->stockOf($b), $this->stockOf($c)]); // excluded: unchanged
        $this->assertSame($movementsBefore + 2, StockMovement::count());
        $m = StockMovement::where('item_id', $a->id)->where('movement_type', 'STOCK_ADJUSTMENT')->firstOrFail();
        $this->assertSame([StockOpnameItem::class, $this->lineOf($id, $a)->id, 10.0, 7.0], [$m->reference_type, $m->reference_id, (float) $m->actual_before, (float) $m->actual_after]);
        $this->assertStringContainsString(StockOpname::find($id)->number, $m->note);
        $this->assertSame($res['posting_batch'], $m->batch_uuid);
        $adj = StockAdjustment::where('stock_opname_item_id', $this->lineOf($id, $a)->id)->firstOrFail();
        $this->assertSame([$id, -3.0, $m->id], [$adj->stock_opname_id, $adj->difference, $adj->stock_movement_id]);
        $this->assertNotNull(Inventory::where('item_id', $a->id)->value('last_counted_at'));
        $this->assertSame(-3.0, (float) collect($res['lines'])->firstWhere('item_id', $a->id)['adjustment']['difference']);

        // locked: no more counts / review / cancel; close → DONE
        $this->postJson("/api/stock-opnames/{$id}/cancel", ['reason' => 'salah'])->assertStatus(422);
        $this->postJson("/api/stock-opnames/{$id}/review-decisions", ['decisions' => [['id' => $this->lineOf($id, $a)->id, 'decision' => 'EXCLUDE']]])->assertStatus(422);
        $this->postJson("/api/stock-opnames/{$id}/close")->assertOk()->assertJsonPath('data.flow_status', 'DONE')->assertJsonPath('data.actions', ['correction']);
    }

    public function test_posting_applies_the_variance_to_todays_stock_so_later_movements_are_not_undone(): void
    {
        $a = $this->stocked(10);
        $id = $this->waitingApproval([8], [$a]); // frozen book 10, counted 8 → variance −2
        app(StockLedgerService::class)->record(['type' => 'STOCK_OUT', 'item_id' => $a->id, 'warehouse_id' => $this->wh->id, 'qty' => 3]); // 7 now

        $this->as('admin');
        $this->assertSame(-3.0, (float) $this->getJson("/api/stock-opnames/{$id}/detail")->json('data.lines.0.moved_since_snapshot'));
        $this->postJson("/api/stock-opnames/{$id}/approve")->assertOk();
        $this->assertSame(5.0, $this->stockOf($a)); // 7 − 2, not back to 8
    }

    public function test_posting_twice_posts_once(): void
    {
        $a = $this->stocked(10);
        $id = $this->waitingApproval([6], [$a]);
        $this->as('admin');
        $this->postJson("/api/stock-opnames/{$id}/approve")->assertOk()->assertJsonPath('meta.posted', true);
        $this->postJson("/api/stock-opnames/{$id}/approve")->assertOk()->assertJsonPath('meta.already_posted', true);

        $this->assertSame(6.0, $this->stockOf($a));
        $this->assertSame(1, StockMovement::where('item_id', $a->id)->where('movement_type', 'STOCK_ADJUSTMENT')->count());
        $this->assertSame(1, StockAdjustment::where('stock_opname_id', $id)->count());
        $this->assertSame(1, StockOpnameEvent::where(['stock_opname_id' => $id, 'event' => 'POSTED'])->count());
    }

    public function test_a_failing_line_rolls_the_whole_posting_back(): void
    {
        [$a, $b] = [$this->stocked(10), $this->stocked(5)];
        $id = $this->waitingApproval([8, 1], [$a, $b]); // a: −2, b: −4
        // b leaves the warehouse after the freeze: 5 → 1, the −4 would make it −3
        app(StockLedgerService::class)->record(['type' => 'STOCK_OUT', 'item_id' => $b->id, 'warehouse_id' => $this->wh->id, 'qty' => 4]);
        $movements = StockMovement::count();

        $this->as('admin');
        $this->postJson("/api/stock-opnames/{$id}/approve")->assertStatus(422)->assertJsonValidationErrors('posting');
        // nothing of the posting stays: not a's adjustment either
        $this->assertSame([10.0, 1.0], [$this->stockOf($a), $this->stockOf($b)]);
        $this->assertSame($movements, StockMovement::count());
        $this->assertSame(0, StockAdjustment::count());
        $o = StockOpname::find($id);
        $this->assertSame(['WAITING_APPROVAL', null], [$o->status, $o->posting_batch]);
        $this->assertSame(0, StockOpnameEvent::where(['stock_opname_id' => $id, 'event' => 'POSTED'])->count());
    }

    public function test_a_ledger_error_also_rolls_back_and_says_why(): void
    {
        [$a, $b] = [$this->stocked(10), $this->stocked(10)];
        $id = $this->waitingApproval([9, 2], [$a, $b]);
        // 9 of b reserved: setting it to 2 would leave reserved > actual
        app(StockLedgerService::class)->record(['type' => 'RESERVATION', 'item_id' => $b->id, 'warehouse_id' => $this->wh->id, 'reserve_delta' => 9]);

        $this->as('admin');
        $msg = $this->postJson("/api/stock-opnames/{$id}/approve")->assertStatus(422)->json('errors.posting.0');
        $this->assertStringContainsString($b->code, $msg);
        $this->assertSame(10.0, $this->stockOf($a));
        $this->assertSame(0, StockAdjustment::count());
    }

    // ---------------------------------------------------------------- correction, cancel, audit, dashboard

    public function test_a_posted_document_is_corrected_by_a_new_audited_opname(): void
    {
        $a = $this->stocked(10);
        $id = $this->waitingApproval([6], [$a]);
        $this->as('admin');
        $this->postJson("/api/stock-opnames/{$id}/approve")->assertOk();
        $new = $this->postJson("/api/stock-opnames/{$id}/correction", ['note' => 'salah hitung'])->assertCreated()->json('data');
        $this->assertSame(['DRAFT', $id, [$a->id]], [$new['flow_status'], $new['correction_of']['id'], array_column($new['lines'], 'item_id')]);
        $this->assertSame(6.0, (float) $new['lines'][0]['system_qty']);
        $this->assertSame($new['id'], $this->getJson("/api/stock-opnames/{$id}/detail")->json('data.corrections.0.id'));
        $this->assertDatabaseHas('stock_opname_events', ['stock_opname_id' => $id, 'event' => 'CORRECTION_CREATED']);
    }

    public function test_cancel_needs_a_reason_and_the_audit_trail_records_every_step(): void
    {
        $a = $this->stocked(10);
        $id = $this->waitingApproval([8], [$a]);
        $this->as('admin');
        $this->postJson("/api/stock-opnames/{$id}/approve")->assertOk();
        $this->postJson("/api/stock-opnames/{$id}/close")->assertOk();

        $events = collect($this->getJson("/api/stock-opnames/{$id}/events")->assertOk()->json('data'))->reverse()->values();
        $this->assertSame(['CREATED', 'CONFIRMED', 'COUNT_STARTED', 'COUNT_FINISHED', 'REVIEW_SAVED', 'APPROVAL_REQUESTED', 'APPROVED', 'POSTED', 'CLOSED'], $events->pluck('event')->all());
        $this->assertSame(['Admin', 'Counter'], [$events[0]['user'], $events[2]['user']]);
        $this->assertSame(['COUNTING', 'REVIEW'], [$events[3]['from_status'], $events[3]['to_status']]);
        // the trail cannot be edited
        $this->expectException(LogicException::class);
        StockOpnameEvent::first()->update(['note' => 'x']);
    }

    public function test_cancel(): void
    {
        $a = $this->stocked(1);
        $id = $this->order([$a]);
        $this->postJson("/api/stock-opnames/{$id}/cancel")->assertStatus(422);
        $this->postJson("/api/stock-opnames/{$id}/cancel", ['reason' => 'dobel'])->assertOk()->assertJsonPath('data.flow_status', 'CANCELLED')->assertJsonPath('data.actions', []);
        $this->postJson("/api/stock-opnames/{$id}/confirm")->assertStatus(422);
    }

    public function test_permissions_of_each_role(): void
    {
        $a = $this->stocked(10);
        // counters and buyers cannot create an order; purchasing cannot even see opname
        foreach (['counter', 'field', 'boss'] as $who) {
            $this->as($who);
            $this->postJson('/api/stock-opnames/orders', ['scheduled_date' => now()->toDateString(), 'warehouse_id' => $this->wh->id, 'scope' => 'ALL'])->assertForbidden();
        }
        $id = $this->order([$a]);
        $this->as('buyer');
        $this->getJson("/api/stock-opnames/{$id}/detail")->assertForbidden();
        $this->getJson('/api/stock-opnames/dashboard')->assertForbidden();

        $this->as('admin');
        $this->postJson("/api/stock-opnames/{$id}/confirm")->assertOk();
        $this->as('boss'); // auditor: sees everything, does nothing
        $this->getJson("/api/stock-opnames/{$id}/detail")->assertOk()->assertJsonPath('data.actions', []);
        $this->postJson("/api/stock-opnames/{$id}/start-counting")->assertForbidden();
        $this->getJson('/api/stock-opnames/adjustments')->assertOk();
        $this->as('counter');
        $this->assertSame(['start_counting'], $this->getJson("/api/stock-opnames/{$id}/detail")->json('data.actions'));
        $this->postJson("/api/stock-opnames/{$id}/cancel", ['reason' => 'x x'])->assertForbidden();
    }

    public function test_dashboard_kpis_accuracy_largest_variances_and_my_todo(): void
    {
        [$a, $b] = [$this->stocked(10), $this->stocked(10)];
        $posted = $this->waitingApproval([10, 4], [$a, $b]);
        $this->as('admin');
        $this->postJson("/api/stock-opnames/{$posted}/approve")->assertOk();
        $draft = $this->order([$a]);
        $review = $this->counted([3], [$b]);

        $this->as('admin');
        $d = $this->getJson('/api/stock-opnames/dashboard')->assertOk()->json('data');
        $this->assertSame(['total' => 3, 'draft' => 1, 'counting' => 0, 'review' => 1, 'approval' => 0, 'done' => 1], array_intersect_key($d['kpi'], array_flip(['total', 'draft', 'counting', 'review', 'approval', 'done'])));
        $this->assertSame(2, $d['kpi']['variance_lines']); // b in the posted one, b in review
        $this->assertEquals(50, $d['kpi']['accuracy']); // posted: 1 of 2 lines matched
        $this->assertEquals(-6, $d['top_variances'][0]['variance']);
        $this->assertEqualsCanonicalizing(['Lengkapi & konfirmasi', 'Review selisih', 'Tutup dokumen'], array_column($d['todo'], 'action'));
        $this->assertSame($this->wh->code, $d['by_warehouse'][0]['code']);
        $this->assertNotEmpty($d['recent']);

        $this->getJson('/api/stock-opnames/dashboard?status=DRAFT')->assertOk()->assertJsonPath('data.kpi.total', 1);
        $this->as('counter');
        $this->assertNull($this->getJson('/api/stock-opnames/dashboard')->json('data.top_variances'));

        // the overview card's reminders: what waits for the reviewer
        $this->as('admin');
        $keys = collect($this->getJson('/api/reminders?module=opname')->json('data'))->pluck('key')->all();
        $this->assertContains('opname_review', $keys);
        $this->assertContains('opname_draft', $keys);
    }

    public function test_documents_of_the_earlier_flow_continue_in_the_controlled_one(): void
    {
        $a = $this->stocked(10);
        $this->as('admin');
        $id = $this->postJson('/api/stock-opnames', ['warehouse_id' => $this->wh->id, 'scheduled_date' => now()->toDateString(), 'item_ids' => [$a->id]])
            ->assertCreated()->json('data.id');
        $this->assertSame('SCHEDULED', StockOpname::find($id)->status);
        $this->getJson("/api/stock-opnames/{$id}/detail")->assertJsonPath('data.flow_status', 'CONFIRMED');
        $this->getJson('/api/stock-opnames?source=internal&status=CONFIRMED')->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.flow_status', 'CONFIRMED');

        $this->as('counter');
        $this->postJson("/api/stock-opnames/{$id}/start-counting")->assertOk()->assertJsonPath('data.status', 'COUNTING');
    }

    public function test_an_accurate_mirror_never_enters_the_workflow(): void
    {
        $a = $this->stocked(10);
        $o = StockOpname::create(['number' => 'ADJ/1', 'warehouse_id' => $this->wh->id, 'site_id' => $this->wh->site_id, 'scheduled_date' => now(),
            'type' => 'PARTIAL', 'status' => 'PENDING_REVIEW', 'accurate_itemadj_id' => 77]);
        $o->items()->create(['item_id' => $a->id, 'warehouse_id' => $this->wh->id, 'system_qty' => 10, 'physical_qty' => 2]);
        $this->as('admin');
        $this->getJson("/api/stock-opnames/{$o->id}/detail")->assertOk()->assertJsonPath('data.actions', [])->assertJsonPath('data.flow_status', 'PENDING_REVIEW');
        $this->postJson("/api/stock-opnames/{$o->id}/request-approval")->assertStatus(422);
        $this->postJson("/api/stock-opnames/{$o->id}/approve")->assertStatus(422);
        $this->assertSame(10.0, $this->stockOf($a));
        $this->getJson('/api/stock-opnames/dashboard')->assertJsonPath('data.kpi.total', 0);
    }
}
