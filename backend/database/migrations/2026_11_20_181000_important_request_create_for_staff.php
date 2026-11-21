<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Important Request is where any transaction is talked about (2026-11-20): Gudang and Purchasing, who work the
 * transactions, may start a topic (important_request.create), as the Manager and the Direktur already could.
 */
return new class extends Migration
{
    private const ROLES = ['admin_gudang', 'purchasing'];

    public function up(): void
    {
        $perm = DB::table('permissions')->where('slug', 'important_request.create')->value('id');
        foreach (DB::table('roles')->whereIn('slug', self::ROLES)->pluck('id') as $roleId) {
            if ($perm && ! DB::table('permission_role')->where(['role_id' => $roleId, 'permission_id' => $perm])->exists()) {
                DB::table('permission_role')->insert(['role_id' => $roleId, 'permission_id' => $perm]);
            }
        }
    }

    public function down(): void
    {
        $perm = DB::table('permissions')->where('slug', 'important_request.create')->value('id');
        DB::table('permission_role')->where('permission_id', $perm)->whereIn('role_id', DB::table('roles')->whereIn('slug', self::ROLES)->pluck('id'))->delete();
    }
};
