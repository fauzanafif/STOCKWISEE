<?php

namespace Tests\Feature\Dashboard;

use App\Models\ItemRequest;
use Database\Seeders\RbacSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** The main dashboard's To-Do board: system cards (from the reminders), private sticky notes, the user's own layout. */
class PersonalTodoTest extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected $seeder = RbacSeeder::class;

    public function test_notes_crud_with_checklist_pin_done_color_and_reminder(): void
    {
        $this->getJson('/api/dashboard-notes')->assertUnauthorized();
        $this->actingAsRole('karyawan');

        $id = $this->postJson('/api/dashboard-notes', [
            'title' => '  Cek stok oli ', 'body' => 'sebelum rapat', 'color' => 'green', 'pinned' => true,
            'remind_at' => '2026-11-12 09:30:00',
            'checklist' => [['text' => 'Gudang A'], ['text' => '  '], ['text' => 'Gudang B', 'done' => true]],
        ])->assertCreated()
            ->assertJsonPath('data.title', 'Cek stok oli')
            ->assertJsonPath('data.pinned', true)
            ->assertJsonPath('data.done', false)
            ->assertJsonCount(2, 'data.checklist')
            ->assertJsonPath('data.checklist.1.done', true)
            ->json('data.id');
        $this->assertNotNull($this->getJson('/api/dashboard-notes')->json('data.0.remind_at'));

        $this->putJson("/api/dashboard-notes/{$id}", ['done' => true, 'checklist' => [['text' => 'Gudang A', 'done' => true]]])->assertOk()
            ->assertJsonPath('data.done', true)->assertJsonPath('data.checklist.0.done', true)->assertJsonPath('data.body', 'sebelum rapat');
        $this->putJson("/api/dashboard-notes/{$id}", ['done' => false, 'pinned' => false, 'remind_at' => null])->assertOk()
            ->assertJsonPath('data.done', false)->assertJsonPath('data.remind_at', null);

        $this->postJson('/api/dashboard-notes', ['title' => '', 'body' => ' '])->assertStatus(422);
        $this->postJson('/api/dashboard-notes', ['title' => 'x', 'color' => 'black'])->assertStatus(422);
        $this->putJson("/api/dashboard-notes/{$id}", ['title' => null, 'body' => null, 'checklist' => []])->assertStatus(422);

        $this->deleteJson("/api/dashboard-notes/{$id}")->assertOk();
        $this->getJson('/api/dashboard-notes')->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_notes_never_leak_between_users(): void
    {
        $this->actingAsRole('karyawan', ['username' => 'satu']);
        $id = $this->postJson('/api/dashboard-notes', ['title' => 'rahasia'])->assertCreated()->json('data.id');

        $this->actingAsRole('super_admin', ['username' => 'dua']);
        $this->getJson('/api/dashboard-notes')->assertOk()->assertJsonCount(0, 'data');
        $this->putJson("/api/dashboard-notes/{$id}", ['title' => 'diubah'])->assertNotFound();
        $this->deleteJson("/api/dashboard-notes/{$id}")->assertNotFound();
        $this->assertDatabaseHas('dashboard_notes', ['id' => $id, 'title' => 'rahasia']);
    }

    public function test_layout_is_kept_per_user_and_reset(): void
    {
        $a = $this->actingAsRole('karyawan', ['username' => 'a']);
        $layout = ['v' => 1, 'cards' => [['id' => 'notes', 'w' => 2, 'h' => 3, 'hidden' => false], ['id' => 'sys:request_verify', 'w' => 1, 'h' => 1, 'hidden' => true]]];
        $this->putJson('/api/preferences/dashboard:home', ['value' => $layout])->assertOk();
        $this->assertSame($layout, $this->getJson('/api/preferences/dashboard:home')->json('data'));

        $this->actingAsRole('karyawan', ['username' => 'b']);
        $this->getJson('/api/preferences/dashboard:home')->assertJsonPath('data', null);

        $this->actingAs($a, 'sanctum');
        $this->putJson('/api/preferences/dashboard:home', ['value' => null])->assertOk();
        $this->getJson('/api/preferences/dashboard:home')->assertJsonPath('data', null);
    }

    public function test_system_todo_follows_role_and_the_transaction_status(): void
    {
        $req = ItemRequest::create(['number' => 'REQ/77', 'requester_name' => 'Budi', 'status' => 'MENUNGGU', 'source' => 'APP']);
        $keys = fn () => collect($this->getJson('/api/reminders')->assertOk()->json('data'))->pluck('key');

        $this->actingAsRole('karyawan', ['username' => 'staf']);
        $this->assertNotContains('request_verify', $keys());

        $this->actingAsRole('admin_gudang', ['username' => 'gudang']);
        $verify = collect($this->getJson('/api/reminders')->json('data'))->firstWhere('key', 'request_verify');
        $this->assertSame(1, $verify['count']);
        $this->assertStringStartsWith('REQ/77', $verify['items'][0]['label']);
        $this->assertStringContainsString((string) $req->id, $verify['items'][0]['to']);

        $req->update(['status' => 'DIBATALKAN']);
        $this->assertNotContains('request_verify', $keys());
        $this->assertSame('DIBATALKAN', $req->fresh()->status);
    }
}
