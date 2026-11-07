<?php

namespace Tests\Feature;

use App\Models\User;
use Database\Seeders\RbacSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** Settings · Auto Refresh: one interval for every open tab, set by the Super Admin. */
class AutoRefreshTest extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected $seeder = RbacSeeder::class;

    public function test_only_the_super_admin_role_changes_it(): void
    {
        Sanctum::actingAs(User::factory()->create());

        $this->getJson('/api/settings/auto-refresh')->assertForbidden();
        $this->putJson('/api/settings/auto-refresh', ['enabled' => true, 'seconds' => 3])->assertForbidden();
    }

    public function test_starts_at_the_old_15_seconds_and_keeps_what_is_saved(): void
    {
        $this->actingAsRole('super_admin');

        $this->getJson('/api/settings/auto-refresh')->assertOk()->assertJsonPath('data', ['enabled' => true, 'seconds' => 15]);
        $this->putJson('/api/settings/auto-refresh', ['enabled' => true, 'seconds' => 3])->assertOk()->assertJsonPath('data.seconds', 3);
        $this->putJson('/api/settings/auto-refresh', ['enabled' => true, 'seconds' => 45])->assertOk();
        $this->getJson('/api/settings/auto-refresh')->assertJsonPath('data', ['enabled' => true, 'seconds' => 45]);
    }

    public function test_refuses_an_interval_outside_its_limits(): void
    {
        $this->actingAsRole('super_admin');

        foreach ([0, 2, 601, 'x', 1.5] as $seconds) {
            $this->putJson('/api/settings/auto-refresh', ['enabled' => true, 'seconds' => $seconds])->assertStatus(422)->assertJsonValidationErrors('seconds');
        }
    }

    public function test_live_tells_every_user_the_interval_and_goes_quiet_when_off(): void
    {
        $this->actingAsRole('super_admin');
        $this->putJson('/api/settings/auto-refresh', ['enabled' => true, 'seconds' => 3])->assertOk();

        Sanctum::actingAs(User::factory()->create());
        $on = $this->getJson('/api/live')->assertOk();
        $on->assertJsonPath('meta.refresh', ['enabled' => true, 'seconds' => 3]);
        $this->assertArrayHasKey('request', $on->json('data'));

        $this->actingAsRole('super_admin');
        $this->putJson('/api/settings/auto-refresh', ['enabled' => false, 'seconds' => 3])->assertOk();
        $off = $this->getJson('/api/live')->assertOk();
        $off->assertJsonPath('meta.refresh.enabled', false);
        $this->assertSame([], $off->json('data'));
    }
}
