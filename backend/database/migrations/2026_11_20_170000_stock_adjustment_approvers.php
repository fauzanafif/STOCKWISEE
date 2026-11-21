<?php

use App\Support\Rbac\Rbac;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A Stock Adjustment (the variances of a Stock Opname posted to the Stock Ledger) is approved by the Manager or the
 * Direktur (decided 2026-11-20): Gudang counts, reviews and sends it for approval, but no longer approves or sends it
 * back itself. The roles' permissions and descriptions follow Rbac::MATRIX / ROLES.
 */
return new class extends Migration
{
    private const GRANT = ['manager' => ['opname.view', 'opname.view_variance', 'opname.approve', 'opname.reject'], 'direktur' => ['opname.approve', 'opname.reject']];

    private const REVOKE = ['admin_gudang' => ['opname.approve', 'opname.reject']];

    public function up(): void
    {
        DB::transaction(function () {
            $perm = fn (string $slug) => DB::table('permissions')->where('slug', $slug)->value('id');
            $role = fn (string $slug) => DB::table('roles')->where('slug', $slug)->value('id');
            foreach (self::GRANT as $r => $slugs) {
                if (! $roleId = $role($r)) {
                    continue;
                }
                foreach ($slugs as $s) {
                    if (($pid = $perm($s)) && ! DB::table('permission_role')->where(['role_id' => $roleId, 'permission_id' => $pid])->exists()) {
                        DB::table('permission_role')->insert(['role_id' => $roleId, 'permission_id' => $pid]);
                    }
                }
            }
            foreach (self::REVOKE as $r => $slugs) {
                if ($roleId = $role($r)) {
                    DB::table('permission_role')->where('role_id', $roleId)->whereIn('permission_id', DB::table('permissions')->whereIn('slug', $slugs)->pluck('id'))->delete();
                }
            }
            foreach (['admin_gudang', 'manager', 'direktur'] as $r) {
                DB::table('roles')->where('slug', $r)->update(['description' => Rbac::ROLES[$r][1], 'updated_at' => now()]);
            }
        });
    }

    public function down(): void
    {
        DB::transaction(function () {
            foreach (self::GRANT as $r => $slugs) {
                $roleId = DB::table('roles')->where('slug', $r)->value('id');
                $keep = $r === 'direktur' ? ['opname.view', 'opname.view_variance'] : [];
                DB::table('permission_role')->where('role_id', $roleId)->whereIn('permission_id', DB::table('permissions')->whereIn('slug', array_diff($slugs, $keep))->pluck('id'))->delete();
            }
            $gudang = DB::table('roles')->where('slug', 'admin_gudang')->value('id');
            foreach (DB::table('permissions')->whereIn('slug', self::REVOKE['admin_gudang'])->pluck('id') as $pid) {
                DB::table('permission_role')->insertOrIgnore(['role_id' => $gudang, 'permission_id' => $pid]);
            }
        });
    }
};
