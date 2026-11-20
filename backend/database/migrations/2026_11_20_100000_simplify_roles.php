<?php

use App\Support\Rbac\Rbac;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Nine roles became six, one per job, so assigning access is no longer confusing:
 *   Anak Gudang + Lapangan Gudang -> Gudang (slug admin_gudang), BOS / Management -> Direktur.
 * Their users move to the new role first, then the old roles go. Afterwards every system role gets
 * exactly the permissions of Rbac::MATRIX (the database had drifted: modules removed long ago still
 * held permissions, newer ones such as Retur Pembelian were missing), and permissions that are no
 * longer in the catalog are removed.
 */
return new class extends Migration
{
    private const MERGE = ['anak_gudang' => 'admin_gudang', 'lapangan_gudang' => 'admin_gudang', 'bos' => 'direktur'];

    public function up(): void
    {
        DB::transaction(function () {
            $now = now();

            // 1. the catalog's permissions
            $permissionIds = [];
            foreach (Rbac::PERMISSIONS as $group => $slugs) {
                foreach ($slugs as $slug => $name) {
                    DB::table('permissions')->updateOrInsert(['slug' => $slug], ['name' => $name, 'group' => $group, 'updated_at' => $now]);
                    $permissionIds[$slug] = DB::table('permissions')->where('slug', $slug)->value('id');
                }
            }
            DB::table('permissions')->whereNull('created_at')->update(['created_at' => $now]);

            // 2. the six roles
            $roleIds = [];
            foreach (Rbac::ROLES as $slug => [$name, $description]) {
                DB::table('roles')->updateOrInsert(['slug' => $slug], ['name' => $name, 'description' => $description, 'is_system' => true, 'updated_at' => $now]);
                $roleIds[$slug] = DB::table('roles')->where('slug', $slug)->value('id');
            }
            DB::table('roles')->whereNull('created_at')->update(['created_at' => $now]);

            // 3. users of a retired role move to its replacement, then the retired role goes
            foreach (self::MERGE as $old => $new) {
                $oldId = DB::table('roles')->where('slug', $old)->value('id');
                if (! $oldId) {
                    continue;
                }
                foreach (DB::table('role_user')->where('role_id', $oldId)->pluck('user_id') as $userId) {
                    if (! DB::table('role_user')->where(['user_id' => $userId, 'role_id' => $roleIds[$new]])->exists()) {
                        DB::table('role_user')->insert(['user_id' => $userId, 'role_id' => $roleIds[$new]]);
                    }
                }
                DB::table('role_user')->where('role_id', $oldId)->delete();
                DB::table('permission_role')->where('role_id', $oldId)->delete();
                DB::table('roles')->where('id', $oldId)->delete();
            }

            // 4. every system role gets exactly its matrix
            foreach ($roleIds as $slug => $roleId) {
                $want = array_values(array_intersect_key($permissionIds, array_flip(Rbac::permissionsForRole($slug))));
                DB::table('permission_role')->where('role_id', $roleId)->delete();
                DB::table('permission_role')->insert(array_map(fn ($id) => ['role_id' => $roleId, 'permission_id' => $id], $want));
            }

            // 5. permissions no longer in the catalog (old modules) go, with their grants
            $stale = DB::table('permissions')->whereNotIn('slug', array_keys($permissionIds))->pluck('id');
            DB::table('permission_role')->whereIn('permission_id', $stale)->delete();
            DB::table('permissions')->whereIn('id', $stale)->delete();
        });
    }

    public function down(): void
    {
        // the merge cannot be undone automatically (who held which old role is gone); restore from the backup
    }
};
