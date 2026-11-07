<?php

namespace Tests\Feature\Auth;

use App\Models\User;
use Database\Seeders\RbacSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class LastLogoutTest extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected $seeder = RbacSeeder::class;

    public function test_the_users_list_shows_the_last_login_and_the_last_logout_of_each_account(): void
    {
        $user = User::factory()->create(['username' => 'tes.logout', 'password' => Hash::make('Rahasia123'), 'is_active' => true]);
        $this->assertNull($user->last_logout_at);

        $token = $this->postJson('/api/login', ['username' => 'tes.logout', 'password' => 'Rahasia123'])->assertOk()->json('token');
        $user->refresh();
        $this->assertNotNull($user->last_login_at);
        $this->assertNull($user->last_logout_at, 'signed in, not out');

        $this->travel(1)->hours();
        $this->withToken($token)->postJson('/api/logout')->assertOk();
        $this->assertTrue($user->refresh()->last_logout_at->gt($user->last_login_at));

        app('auth')->forgetGuards();
        $this->actingAsRole('super_admin');
        $row = collect($this->getJson('/api/users?search=tes.logout')->assertOk()->json('data'))->firstWhere('username', 'tes.logout');
        $this->assertNotNull($row['last_login_at']);
        $this->assertNotNull($row['last_logout_at']);

        // signing in again does not erase when they last left
        $before = $user->last_logout_at;
        app('auth')->forgetGuards();
        $this->postJson('/api/login', ['username' => 'tes.logout', 'password' => 'Rahasia123'])->assertOk();
        $this->assertEquals($before, $user->refresh()->last_logout_at);
    }

    public function test_an_admin_ending_someones_sessions_is_not_their_logout(): void
    {
        $user = User::factory()->create(['username' => 'tes.reset', 'is_active' => true]);
        $this->actingAsRole('super_admin');
        $this->postJson("/api/users/{$user->id}/password", ['password' => 'BaruSekali123', 'password_confirmation' => 'BaruSekali123'])->assertOk();
        $this->assertNull($user->refresh()->last_logout_at);
    }
}
