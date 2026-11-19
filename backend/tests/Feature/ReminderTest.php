<?php

namespace Tests\Feature;

use App\Models\ImportantRequest;
use App\Models\ItemRequest;
use App\Models\User;
use Database\Seeders\RbacSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** The reminders: late / urgent / due soon, the oldest wait, and the documents themselves — the most pressing first. */
class ReminderTest extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected $seeder = RbacSeeder::class;

    public function test_reminders_say_what_is_late_urgent_or_due_soon_and_link_each_document(): void
    {
        $me = $this->actingAsRole('karyawan');
        $boss = User::factory()->create();
        $task = fn (string $no, $deadline, string $priority = 'MEDIUM') => tap(ImportantRequest::create(['number' => $no, 'title' => "Tugas {$no}", 'description' => 'x',
            'priority' => $priority, 'status' => 'DITUGASKAN', 'created_by' => $boss->id, 'sent_at' => now()->subDays(4), 'deadline' => $deadline]),
            fn ($r) => $r->assignees()->create(['user_id' => $me->id, 'status' => 'DITUGASKAN']));
        $task('IMP/1', now()->addDays(5));
        $late = $task('IMP/2', now()->subHour());
        $task('IMP/3', now()->addHours(5), 'URGENT');

        $res = $this->getJson('/api/reminders?module=important')->assertOk();
        $todo = collect($res->json('data'))->firstWhere('key', 'ir_todo');
        $this->assertSame([3, 1, 1, 1, 'overdue', 4], [$todo['count'], $todo['overdue'], $todo['urgent'], $todo['soon'], $todo['priority'], $todo['oldest_days']]);
        // the late one first, then the urgent / due soon one; each a link to its request
        $this->assertSame(['IMP/2', 'IMP/3', 'IMP/1'], array_map(fn ($i) => explode(' · ', $i['label'])[0], $todo['items']));
        $this->assertSame("/important-requests/{$late->id}", $todo['items'][0]['to']);
        $this->assertSame([1, 1, 1], [$res->json('meta.overdue'), $res->json('meta.urgent'), $res->json('meta.soon')]);

        // admin gudang: an urgent request first; one waiting 2 days is late (SLA 1 day)
        $this->actingAsRole('admin_gudang');
        $old = ItemRequest::create(['number' => 'REQ/1', 'requester_name' => 'Budi', 'status' => 'MENUNGGU', 'source' => 'APP']);
        ItemRequest::whereKey($old->id)->update(['created_at' => now()->subDays(2), 'updated_at' => now()->subDays(2)]);
        ItemRequest::create(['number' => 'REQ/2', 'requester_name' => 'Ani', 'status' => 'MENUNGGU', 'source' => 'APP', 'urgency' => 'URGENT']);
        $verify = collect($this->getJson('/api/reminders?module=request')->json('data'))->firstWhere('key', 'request_verify');
        $this->assertSame([2, 1, 1, 2], [$verify['count'], $verify['overdue'], $verify['urgent'], $verify['oldest_days']]);
        $this->assertSame(['REQ/1 · Budi', 'REQ/2 · Ani'], array_column($verify['items'], 'label'));
    }

    public function test_each_reminder_counts_its_documents_by_when_they_should_be_done(): void
    {
        $this->travelTo(now()->setTime(12, 0));
        $me = $this->actingAsRole('karyawan');
        $boss = User::factory()->create();
        foreach ([-5, -1, 0, 0, 1, 7] as $i => $days) {
            ImportantRequest::create(['number' => "IMP/{$i}", 'title' => 't', 'description' => 'x', 'priority' => 'MEDIUM', 'status' => 'DITUGASKAN',
                'created_by' => $boss->id, 'sent_at' => now()->subDays(10), 'deadline' => now()->addDays($days)])
                ->assignees()->create(['user_id' => $me->id, 'status' => 'DITUGASKAN']);
        }
        $todo = collect($this->getJson('/api/reminders?module=important')->json('data'))->firstWhere('key', 'ir_todo');
        $this->assertSame(['before' => 1, 'yesterday' => 1, 'today' => 2, 'tomorrow' => 1, 'after' => 1], $todo['graph']);
        $this->assertArrayNotHasKey('planned', $todo['items'][0]);
    }

    public function test_the_requester_is_reminded_when_the_goods_are_ready(): void
    {
        $me = $this->actingAsRole('karyawan');
        ItemRequest::create(['number' => 'REQ/9', 'requester_name' => $me->name, 'requester_id' => $me->id, 'status' => 'SIAP_DISERAHKAN', 'source' => 'APP']);
        $pickup = collect($this->getJson('/api/reminders?module=request')->json('data'))->firstWhere('key', 'request_pickup');
        $this->assertSame(1, $pickup['count']);
    }
}
