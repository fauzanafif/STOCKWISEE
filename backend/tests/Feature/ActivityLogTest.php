<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\UserActivityLog;
use Database\Seeders\RbacSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** User Log: logins, pages opened, every change, to the second; readable only with audit_log.view. */
class ActivityLogTest extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected $seeder = RbacSeeder::class;

    public function test_login_failed_login_and_logout_are_logged(): void
    {
        $u = User::factory()->create(['username' => 'budi', 'password' => 'rahasia123', 'is_active' => true]);

        $this->postJson('/api/login', ['username' => 'budi', 'password' => 'salah'])->assertStatus(422);
        $this->postJson('/api/login', ['username' => 'tidakada', 'password' => 'x'])->assertStatus(422);
        $token = $this->postJson('/api/login', ['username' => 'budi', 'password' => 'rahasia123'])->assertOk()->json('token');
        $this->withToken($token)->postJson('/api/logout')->assertOk();

        $logs = UserActivityLog::orderBy('id')->get();
        $this->assertSame(['LOGIN_FAILED', 'LOGIN_FAILED', 'LOGIN', 'LOGOUT'], $logs->pluck('event')->all());
        $this->assertSame($u->id, $logs[0]->user_id);
        $this->assertSame($u->name, $logs[0]->user_name);
        $this->assertSame('tidakada', $logs[1]->user_name);
        $this->assertNull($logs[1]->user_id);
        $this->assertSame($u->id, $logs[3]->user_id);
        $this->assertNotNull($logs[2]->ip);
        $this->assertStringNotContainsString('rahasia123', json_encode($logs->toArray()));
    }

    public function test_every_change_and_page_view_is_logged_without_secrets(): void
    {
        $this->actingAsRole('karyawan', ['name' => 'Siti']);

        $id = $this->postJson('/api/dashboard-notes', ['title' => 'Catatan A', 'password' => 'jangan-disimpan'])->assertCreated()->json('data.id');
        $this->putJson("/api/dashboard-notes/{$id}", ['pinned' => true])->assertOk();
        $this->putJson("/api/dashboard-notes/{$id}", ['color' => 'hitam'])->assertStatus(422);
        $this->deleteJson("/api/dashboard-notes/{$id}")->assertOk();
        $this->getJson('/api/dashboard-notes')->assertOk();
        $this->postJson('/api/activity/page-view', ['path' => '/item-requests?tab=proses', 'title' => 'Item Request'])->assertOk();

        $logs = UserActivityLog::orderBy('id')->get();
        $this->assertSame(['CREATE', 'UPDATE', 'UPDATE', 'DELETE', 'PAGE_VIEW'], $logs->pluck('event')->all(), 'GET requests are not logged');
        $this->assertSame('Dashboard Notes', $logs[0]->module);
        $this->assertSame('Create', $logs[0]->description);
        $this->assertSame('Catatan A', $logs[0]->subject);
        $this->assertSame(201, $logs[0]->status);
        $this->assertSame('***', $logs[0]->details['input']['password']);
        $this->assertSame('Siti', $logs[0]->user_name);
        $this->assertSame(422, $logs[2]->status);
        $this->assertArrayHasKey('color', $logs[2]->details['errors']);
        $this->assertSame('/item-requests?tab=proses', $logs[4]->path);
        $this->assertSame('Membuka Item Request', $logs[4]->description);
    }

    public function test_the_log_is_only_for_audit_log_viewers_with_filters_and_seconds(): void
    {
        $staff = $this->actingAsRole('karyawan', ['username' => 'staf']);
        $this->postJson('/api/activity/page-view', ['path' => '/'])->assertOk();
        $this->postJson('/api/activity/page-view', ['path' => 'no-slash'])->assertStatus(422);
        $this->getJson('/api/activity-logs')->assertForbidden();

        $this->actingAsRole('super_admin', ['username' => 'boss']);
        $this->postJson('/api/activity/page-view', ['path' => '/settings/users', 'title' => 'Users'])->assertOk();

        $all = $this->getJson('/api/activity-logs')->assertOk();
        $all->assertJsonPath('meta.total', 2);
        $this->assertMatchesRegularExpression('/T\d{2}:\d{2}:\d{2}/', $all->json('data.0.at'));
        $this->getJson('/api/activity-logs?user_id='.$staff->id)->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.path', '/');
        $this->getJson('/api/activity-logs?event=LOGIN')->assertJsonPath('meta.total', 0);
        $this->getJson('/api/activity-logs?search=settings')->assertJsonPath('meta.total', 1);
        $this->getJson('/api/activity-logs?event=BOGUS')->assertStatus(422);
    }
}
