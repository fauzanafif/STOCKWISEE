<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\UpdateAlert;
use App\Models\User;
use Database\Seeders\RbacSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** Update Alert: Super Admin writes a notice, every user gets it as a popup on its schedule. */
class UpdateAlertTest extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected $seeder = RbacSeeder::class;

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow('2026-11-05 08:00:00');
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function alert(array $attrs = []): UpdateAlert
    {
        return UpdateAlert::create($attrs + ['title' => 'New PO flow', 'message' => 'Read this.', 'type' => 'feature', 'display_mode' => 'once', 'is_active' => true]);
    }

    private function dueIds(): array
    {
        return collect($this->getJson('/api/update-alerts/due')->assertOk()->json('data'))->pluck('id')->all();
    }

    private function user(array $attrs = []): User
    {
        $user = User::factory()->create($attrs);
        Sanctum::actingAs($user);

        return $user;
    }

    public function test_only_the_super_admin_role_manages_alerts(): void
    {
        $alert = $this->alert();
        // even a role holding every permission of Settings is not enough
        $role = Role::create(['slug' => 'user_admin', 'name' => 'User Admin']);
        $user = User::factory()->create();
        $user->roles()->attach($role);
        Sanctum::actingAs($user);

        $this->getJson('/api/update-alerts')->assertForbidden();
        $this->postJson('/api/update-alerts', [])->assertForbidden();
        $this->putJson("/api/update-alerts/{$alert->id}", ['is_active' => false])->assertForbidden();
        $this->deleteJson("/api/update-alerts/{$alert->id}")->assertForbidden();
        // but it still reaches them
        $this->assertSame([$alert->id], $this->dueIds());
    }

    public function test_guests_get_nothing(): void
    {
        $this->getJson('/api/update-alerts/due')->assertUnauthorized();
    }

    public function test_super_admin_creates_edits_and_deletes(): void
    {
        $this->actingAsRole('super_admin');

        $made = $this->postJson('/api/update-alerts', [
            'title' => '  Server maintenance ', 'message' => 'Saturday night.', 'type' => 'warning',
            'display_mode' => 'interval', 'interval_minutes' => 90,
            // 09:00 in Balikpapan (WITA, +08:00) is 01:00 UTC
            'starts_at' => '2026-11-06T09:00:00+08:00',
        ])->assertCreated()->json('data');
        $this->assertSame('Server maintenance', $made['title']);
        $this->assertSame('scheduled', $made['status']);
        $this->assertTrue(Carbon::parse($made['starts_at'])->eq(Carbon::parse('2026-11-06T01:00:00Z')));

        // an interval needs its length; the end comes after the start
        $base = ['title' => 'A', 'message' => 'B', 'type' => 'info', 'display_mode' => 'interval'];
        $this->postJson('/api/update-alerts', $base)->assertStatus(422)->assertJsonValidationErrors('interval_minutes');
        $this->postJson('/api/update-alerts', ['interval_minutes' => 0] + $base)->assertStatus(422)->assertJsonValidationErrors('interval_minutes');
        $this->postJson('/api/update-alerts', ['interval_minutes' => 5, 'starts_at' => '2026-11-06 10:00', 'ends_at' => '2026-11-06 09:00'] + $base)
            ->assertStatus(422)->assertJsonValidationErrors('ends_at');
        $this->postJson('/api/update-alerts', ['title' => '   ', 'type' => 'nope', 'display_mode' => 'once', 'message' => 'x'])->assertStatus(422);

        // the on/off switch alone keeps the rest; leaving interval mode clears its length
        $this->putJson("/api/update-alerts/{$made['id']}", ['is_active' => false])->assertOk()
            ->assertJsonPath('data.status', 'inactive')->assertJsonPath('data.interval_minutes', 90);
        $this->putJson("/api/update-alerts/{$made['id']}", ['display_mode' => 'login'])->assertOk()->assertJsonPath('data.interval_minutes', null);

        $this->assertCount(1, $this->getJson('/api/update-alerts')->assertOk()->json('data'));
        $this->deleteJson("/api/update-alerts/{$made['id']}")->assertOk();
        $this->assertSame(0, UpdateAlert::count());
    }

    public function test_once_shows_until_closed_then_never_again(): void
    {
        $alert = $this->alert();
        $this->user();

        // not closed yet: a reload shows it again
        $this->assertSame([$alert->id], $this->dueIds());
        $this->assertSame([$alert->id], $this->dueIds());

        $this->postJson("/api/update-alerts/{$alert->id}/seen")->assertOk();
        $this->postJson("/api/update-alerts/{$alert->id}/seen")->assertOk();
        $this->assertSame([], $this->dueIds());
        Carbon::setTestNow(now()->addYear());
        $this->assertSame([], $this->dueIds());

        // another user still gets it
        $this->user();
        $this->assertSame([$alert->id], $this->dueIds());
    }

    public function test_login_mode_shows_once_per_sign_in(): void
    {
        // signed in before the alert was made: waits for the next sign-in
        $user = $this->user(['last_login_at' => now()->subHour()]);
        $alert = $this->alert(['display_mode' => 'login']);
        $this->assertSame([], $this->dueIds());

        Carbon::setTestNow(now()->addHour());
        $user->forceFill(['last_login_at' => now()])->save();
        $this->assertSame([$alert->id], $this->dueIds());

        Carbon::setTestNow(now()->addMinute());
        $this->postJson("/api/update-alerts/{$alert->id}/seen")->assertOk();
        $this->assertSame([], $this->dueIds());

        // reloading is not signing in; signing in again is
        Carbon::setTestNow(now()->addHours(5));
        $this->assertSame([], $this->dueIds());
        $user->forceFill(['last_login_at' => now()])->save();
        $this->assertSame([$alert->id], $this->dueIds());
    }

    public function test_interval_mode_returns_after_its_time_and_says_when(): void
    {
        $alert = $this->alert(['display_mode' => 'interval', 'interval_minutes' => 30]);
        $this->user();
        $this->assertSame([$alert->id], $this->dueIds());

        $this->postJson("/api/update-alerts/{$alert->id}/seen")->assertOk();
        $this->getJson('/api/update-alerts/due')->assertJsonPath('data', [])->assertJsonPath('meta.next_in', 1800);

        Carbon::setTestNow(now()->addMinutes(29));
        $this->assertSame([], $this->dueIds());
        Carbon::setTestNow(now()->addMinute());
        $this->assertSame([$alert->id], $this->dueIds());
    }

    public function test_only_inside_its_active_period_and_while_switched_on(): void
    {
        $alert = $this->alert(['starts_at' => now()->addHour(), 'ends_at' => now()->addHours(3)]);
        $off = $this->alert(['is_active' => false]);
        $this->user();

        $this->getJson('/api/update-alerts/due')->assertJsonPath('data', [])->assertJsonPath('meta.next_in', 3600);

        Carbon::setTestNow(now()->addHour());
        // one on screen is taken away when it ends
        $this->getJson('/api/update-alerts/due')->assertJsonPath('data.0.id', $alert->id)->assertJsonPath('meta.next_in', 7200);

        Carbon::setTestNow(now()->addHours(2));
        $this->assertSame([], $this->dueIds());
        $this->assertNotContains($off->id, $this->dueIds());
    }

    public function test_warnings_come_first_then_the_newest(): void
    {
        $old = $this->alert(['type' => 'info']);
        Carbon::setTestNow(now()->addMinute());
        $new = $this->alert(['type' => 'feature']);
        Carbon::setTestNow(now()->addMinute());
        $warning = $this->alert(['type' => 'warning']);
        Carbon::setTestNow(now()->addMinute());
        $this->user();

        $this->assertSame([$warning->id, $new->id, $old->id], $this->dueIds());
    }

    public function test_the_live_stamp_changes_with_a_new_alert(): void
    {
        $this->user();
        $before = $this->getJson('/api/live')->assertOk()->json('data.alerts');
        $this->alert();
        $this->assertNotSame($before, $this->getJson('/api/live')->assertOk()->json('data.alerts'));
    }
}
