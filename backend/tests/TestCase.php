<?php

namespace Tests;

use App\Models\Role;
use App\Models\User;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\Cache;
use Laravel\Sanctum\Sanctum;

abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        // Reset the (array) cache so per-route rate limiters don't leak across tests.
        Cache::flush();
    }

    /** Create a user with the given role slug and authenticate as them (Sanctum). */
    protected function actingAsRole(string $roleSlug, array $attributes = []): User
    {
        $user = User::factory()->create($attributes);
        $user->roles()->attach(Role::where('slug', $roleSlug)->firstOrFail());

        Sanctum::actingAs($user);

        return $user;
    }

    /** A karyawan account named $name signs in to a Request Barang share link; returns the form session. */
    protected function linkSession(string $linkToken, string $name): string
    {
        $username = strtolower(str_replace(' ', '', $name)).'_'.User::count();
        User::factory()->create(['name' => $name, 'username' => $username, 'password' => 'rahasia123'])
            ->roles()->attach(Role::where('slug', 'karyawan')->firstOrFail());

        return $this->postJson("/api/public/item-request/{$linkToken}/login", ['username' => $username, 'password' => 'rahasia123'])
            ->assertOk()->json('data.session');
    }
}
