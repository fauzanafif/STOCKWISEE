<?php

namespace Tests;

use App\Models\Permission;
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

    /**
     * Runs after the app boots but before RefreshDatabase wipes the database. With the
     * config cache on (bootstrap/cache/config.php), phpunit.xml's sqlite settings are
     * ignored and the tests would migrate:fresh the PRODUCTION database — refuse that.
     */
    protected function setUpTraits()
    {
        $connection = config('database.default');
        $driver = config("database.connections.{$connection}.driver");
        $database = (string) config("database.connections.{$connection}.database");
        if ($driver !== 'sqlite' && ! str_ends_with($database, '_test')) {
            throw new \RuntimeException("Tes ditolak: koneksi '{$connection}' ke database '{$database}' bukan database uji (cache konfigurasi aktif?). Jalankan tes di salinan tanpa bootstrap/cache/config.php.");
        }

        return parent::setUpTraits();
    }

    /**
     * Roles merged away on 2026-11-20 (Anak Gudang, Lapangan Gudang -> Gudang; BOS -> Direktur), kept here
     * with their old permissions so the tests of narrow, field-level access still have such a user.
     */
    protected const RETIRED_ROLES = [
            'lapangan_gudang' => [
                'profile.view_own', 'profile.update_own', 'notification.view_own',
                'important_request.access',
                'inventory.view', 'stock_movement.view',
                'npbg.view', 'item_request.handover',
                'npbg.verification.view', 'npbg.verification.manage', 'npbg.verification.respond',
                // Stock opname: admin gudang menjadwalkan, admin lapangan yang turun hitung fisik & input hasilnya.
                'opname.view', 'opname.count', 'opname.submit',
                'lend.view', 'lend.create', 'lend.update', 'lend.return',
                'borrow.view', 'borrow.create', 'borrow.update', 'borrow.return',
                'stpp.view', 'stpp.create', 'stpp.update', 'stpp.return',
                'tyre.view', 'tyre.create', 'tyre.update', 'tyre.close',
                'maintenance.view', 'maintenance.create', 'maintenance.update', 'maintenance.complete',
                'manufacturing.view', 'manufacturing.create', 'manufacturing.update', 'manufacturing.complete',
                'used_return.view', 'used_return.create', 'used_return.update', 'used_return.close',
                'mrp.view', 'mrp.record',
                'disassembly.view', 'disassembly.record',
                'dashboard.gudang', 'dashboard.lapangan', 'dashboard.opname',
                'report.npbg', 'report.opname', 'export.excel', 'export.csv', 'export.pdf',
            ],
            'anak_gudang' => [
                'profile.view_own', 'profile.update_own', 'notification.view_own',
                'important_request.access',
                'inventory.view', 'stock_movement.view', 'item.view', 'item.alias.view',
                'opname.view', 'opname.count', 'opname.submit',
                'stpp.view',
                'dashboard.gudang', 'dashboard.opname',
                'report.opname', 'export.excel', 'export.csv', 'export.pdf',
            ],
            'bos' => [
                'profile.view_own', 'profile.update_own', 'notification.view_own',
                'important_request.access', 'important_request.create', 'important_request.view_all', 'important_request.analytics',
                'inventory.view', 'inventory.view_analysis', 'stock_movement.view', 'item.view',
                'npbg.view', 'npbg.verification.view', 'npbg.verification.bos_decide',
                'ppb.view', 'ri.view', 'po.view', 'purchase_return.view',
                'opname.view', 'opname.view_variance',
                'lend.view', 'borrow.view', 'stpp.view', 'tyre.view', 'maintenance.view',
                'manufacturing.view', 'used_return.view', 'mrp.view', 'disassembly.view',
                'dashboard.executive',
                'report.items', 'report.inventory', 'report.npbg', 'report.ppb', 'report.ri', 'report.opname',
                'report.stock_movement', 'report.procurement',
                'export.excel', 'export.csv', 'export.pdf',
                'audit_log.view',
            ],
    ];

    /** A role by slug; a retired one is created on demand from RETIRED_ROLES. */
    protected function role(string $slug): Role
    {
        $role = Role::where('slug', $slug)->first();
        if ($role || ! isset(self::RETIRED_ROLES[$slug])) {
            return $role ?? Role::where('slug', $slug)->firstOrFail();
        }
        $role = Role::create(['slug' => $slug, 'name' => $slug, 'is_system' => false]);
        $role->permissions()->sync(Permission::whereIn('slug', self::RETIRED_ROLES[$slug])->pluck('id'));

        return $role;
    }

    /** Create a user with the given role slug and authenticate as them (Sanctum). */
    protected function actingAsRole(string $roleSlug, array $attributes = []): User
    {
        $user = User::factory()->create($attributes);
        $user->roles()->attach($this->role($roleSlug));

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
