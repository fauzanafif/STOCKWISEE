<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * ppb.create, npbg.create and ri.create are in the RBAC catalog (Rbac::PERMISSIONS) but went missing
 * from the `permissions` table, so nobody held them: even Super Admin got "no access" on
 * Draft Purchase Request, and Admin Gudang could not create a PPB, a manual NPBG or a RI.
 *
 * Only adds: each permission is inserted when missing and granted to Super Admin and Admin Gudang
 * (their default in Rbac::ROLE_PERMISSIONS). Grants a role already has are left alone.
 */
return new class extends Migration
{
    private const PERMISSIONS = [
        'ppb.create' => ['Draft PPB & ajukan PPB (dari Request Barang / Restock)', 'ppb'],
        'npbg.create' => ['Buat NPBG manual (perlu approval Manager & Direktur)', 'npbg'],
        'ri.create' => ['Buat RI dari PO (partial atau selesai), dari pengembalian bekas, atau manual', 'ri'],
    ];

    private const ROLES = ['super_admin', 'admin_gudang'];

    public function up(): void
    {
        if (! Schema::hasTable('permissions') || ! Schema::hasTable('roles')) {
            return;
        }
        $now = now();
        $roleIds = DB::table('roles')->whereIn('slug', self::ROLES)->pluck('id');

        foreach (self::PERMISSIONS as $slug => [$name, $group]) {
            $id = DB::table('permissions')->where('slug', $slug)->value('id')
                ?? DB::table('permissions')->insertGetId(['slug' => $slug, 'name' => $name, 'group' => $group, 'created_at' => $now, 'updated_at' => $now]);
            foreach ($roleIds as $roleId) {
                if (! DB::table('permission_role')->where(['permission_id' => $id, 'role_id' => $roleId])->exists()) {
                    DB::table('permission_role')->insert(['permission_id' => $id, 'role_id' => $roleId]);
                }
            }
        }
    }

    public function down(): void
    {
        // the permissions belong to the catalog; rolling back only takes back the grants made here
        if (! Schema::hasTable('permissions') || ! Schema::hasTable('roles')) {
            return;
        }
        $ids = DB::table('permissions')->whereIn('slug', array_keys(self::PERMISSIONS))->pluck('id');
        $roleIds = DB::table('roles')->whereIn('slug', self::ROLES)->pluck('id');
        DB::table('permission_role')->whereIn('permission_id', $ids)->whereIn('role_id', $roleIds)->delete();
    }
};
