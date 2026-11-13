<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Manufacturing (MRP): Bills of Materials and Manufacturing Orders — see App\Services\Mrp.
 *
 * Additive only. Kept apart from the Tracking "Manufaktur & Assembly" sheet (manufacturing_orders,
 * manufacturing.* permissions), which is untouched. Every quantity is in the item's Base UOM;
 * a recorded entry also keeps what was typed (qty + unit) and the ratio frozen at that moment.
 * Product / component columns are named item_id on purpose: StockwisePurge never removes an item
 * that a table with an item_id column still uses.
 */
return new class extends Migration
{
    private const PERMISSIONS = [
        'mrp.view' => 'Manufacturing: lihat BoM, Manufacturing Order, riwayat & laporan produksi',
        'mrp.bom.manage' => 'Manufacturing: buat, ubah, aktifkan & arsipkan BoM',
        'mrp.create' => 'Manufacturing: buat & ubah Manufacturing Order draft',
        'mrp.confirm' => 'Manufacturing: konfirmasi MO (komponen dipesan dari stok)',
        'mrp.record' => 'Manufacturing: mulai produksi, catat pemakaian komponen, hasil & scrap',
        'mrp.validate' => 'Manufacturing: validasi & posting MO, izinkan pemakaian/hasil di luar rencana, tandai sudah dicatat di Accurate',
        'mrp.cancel' => 'Manufacturing: batalkan MO & balik posting MO selesai',
    ];

    /** role => permissions it gets by default (super_admin gets all) */
    private const GRANTS = [
        'admin_gudang' => ['mrp.view', 'mrp.bom.manage', 'mrp.create', 'mrp.confirm', 'mrp.record', 'mrp.validate', 'mrp.cancel'],
        'lapangan_gudang' => ['mrp.view', 'mrp.record'],
        'bos' => ['mrp.view'],
    ];

    public function up(): void
    {
        Schema::create('mrp_boms', function (Blueprint $table) {
            $table->id();
            $table->string('code', 40)->unique(); // BOM/26/XI/001
            $table->foreignId('item_id')->constrained('items')->restrictOnDelete(); // the finished product
            $table->unsignedInteger('revision');
            $table->string('name', 200)->nullable();
            $table->string('status', 12)->default('DRAFT')->index(); // DRAFT / ACTIVE / ARCHIVED
            $table->string('base_unit', 20)->nullable(); // the product's Base UOM when the BoM was saved
            $table->date('effective_date')->nullable();
            $table->text('notes')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('activated_at')->nullable();
            $table->foreignId('activated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('archived_at')->nullable();
            $table->foreignId('archived_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->unique(['item_id', 'revision']);
        });

        Schema::create('mrp_bom_lines', function (Blueprint $table) {
            $table->id();
            $table->foreignId('mrp_bom_id')->constrained('mrp_boms')->cascadeOnDelete();
            $table->foreignId('item_id')->constrained('items')->restrictOnDelete();
            $table->decimal('qty', 18, 6); // per 1 finished product, in the component's Base UOM
            $table->string('base_unit', 20)->nullable();
            $table->string('note', 255)->nullable();
            $table->unsignedSmallInteger('sort')->default(0);
            $table->timestamps();
            $table->unique(['mrp_bom_id', 'item_id']);
        });

        Schema::create('mrp_productions', function (Blueprint $table) {
            $table->id();
            $table->string('number', 40)->unique(); // MO/26/XI/001
            $table->foreignId('mrp_bom_id')->constrained('mrp_boms')->restrictOnDelete();
            $table->string('bom_code', 40);
            $table->unsignedInteger('bom_revision');
            $table->foreignId('item_id')->constrained('items')->restrictOnDelete(); // the finished product
            $table->string('product_code', 60)->nullable();
            $table->string('product_name', 255)->nullable();
            $table->string('base_unit', 20)->nullable();
            $table->decimal('planned_qty', 14, 2);
            $table->date('planned_start')->nullable();
            $table->date('planned_finish')->nullable();
            $table->foreignId('responsible_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('priority', 10)->default('NORMAL'); // NORMAL / URGENT
            $table->text('notes')->nullable();
            $table->string('status', 12)->default('DRAFT')->index(); // DRAFT/CONFIRMED/IN_PROGRESS/TO_CLOSE/DONE/CANCELLED
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            foreach (['confirmed', 'started', 'finished', 'done', 'cancelled', 'reversed', 'accurate_recorded'] as $step) {
                $table->timestamp("{$step}_at")->nullable();
                $table->foreignId("{$step}_by")->nullable()->constrained('users')->nullOnDelete();
            }
            $table->string('cancel_reason', 255)->nullable();
            $table->string('accurate_refs', 255)->nullable(); // the Accurate documents the production was entered with
            $table->string('posting_batch', 36)->nullable(); // stock_movements.batch_uuid of the posting
            $table->timestamps();
        });

        Schema::create('mrp_production_components', function (Blueprint $table) {
            $table->id();
            $table->foreignId('mrp_production_id')->constrained('mrp_productions')->cascadeOnDelete();
            $table->foreignId('item_id')->constrained('items')->restrictOnDelete();
            $table->string('product_code', 60)->nullable();
            $table->string('description', 255)->nullable();
            $table->string('base_unit', 20)->nullable();
            $table->decimal('qty_per_unit', 18, 6)->default(0); // BoM snapshot
            $table->decimal('required_qty', 18, 6)->default(0); // qty_per_unit × planned_qty
            $table->decimal('reserved_qty', 14, 2)->default(0); // held for this MO right now
            $table->boolean('is_extra')->default(false); // not in the BoM: added through an authorised entry
            $table->unsignedSmallInteger('sort')->default(0);
            $table->timestamps();
            $table->unique(['mrp_production_id', 'item_id'], 'mrp_prod_comp_unique');
        });

        Schema::create('mrp_production_entries', function (Blueprint $table) {
            $table->id();
            $table->foreignId('mrp_production_id')->constrained('mrp_productions')->cascadeOnDelete();
            $table->string('kind', 10); // CONSUME / OUTPUT / SCRAP
            $table->foreignId('item_id')->constrained('items')->restrictOnDelete();
            $table->foreignId('component_id')->nullable()->constrained('mrp_production_components')->nullOnDelete();
            $table->decimal('qty', 18, 6); // as typed, in `unit`
            $table->string('unit', 20)->nullable();
            $table->decimal('unit_ratio', 18, 6)->default(1); // 1 unit = ratio Base UOM, frozen
            $table->decimal('base_qty', 14, 2); // what moves in stock
            $table->string('base_unit', 20)->nullable();
            $table->date('entry_date');
            $table->string('reason', 255)->nullable();
            $table->text('note')->nullable();
            $table->boolean('over_plan')->default(false); // beyond the plan, allowed by someone with mrp.validate
            $table->string('client_key', 64)->nullable()->unique(); // a resent form is not recorded twice
            $table->foreignId('recorded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('posted_at')->nullable();
            $table->timestamp('voided_at')->nullable();
            $table->foreignId('voided_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->index(['mrp_production_id', 'kind']);
        });

        Schema::create('mrp_activities', function (Blueprint $table) {
            $table->id();
            $table->string('subject_type', 10); // BOM / MO
            $table->unsignedBigInteger('subject_id');
            $table->string('action', 30);
            $table->string('from_status', 12)->nullable();
            $table->string('to_status', 12)->nullable();
            $table->text('note')->nullable();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('created_at')->nullable();
            $table->index(['subject_type', 'subject_id']);
        });

        $this->grantPermissions();
    }

    /** Additive, like add_accurate_session_permissions: never re-runs RbacSeeder (that resets every role). */
    private function grantPermissions(): void
    {
        if (! Schema::hasTable('permissions') || ! Schema::hasTable('roles')) {
            return;
        }
        $now = now();
        $ids = [];
        foreach (self::PERMISSIONS as $slug => $name) {
            $ids[$slug] = DB::table('permissions')->where('slug', $slug)->value('id')
                ?? DB::table('permissions')->insertGetId(['slug' => $slug, 'name' => $name, 'group' => 'mrp', 'created_at' => $now, 'updated_at' => $now]);
        }
        $grants = self::GRANTS + ['super_admin' => array_keys(self::PERMISSIONS)];
        foreach ($grants as $role => $slugs) {
            $roleId = DB::table('roles')->where('slug', $role)->value('id');
            if (! $roleId) {
                continue;
            }
            foreach ($slugs as $slug) {
                if (! DB::table('permission_role')->where(['permission_id' => $ids[$slug], 'role_id' => $roleId])->exists()) {
                    DB::table('permission_role')->insert(['permission_id' => $ids[$slug], 'role_id' => $roleId]);
                }
            }
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('mrp_activities');
        Schema::dropIfExists('mrp_production_entries');
        Schema::dropIfExists('mrp_production_components');
        Schema::dropIfExists('mrp_productions');
        Schema::dropIfExists('mrp_bom_lines');
        Schema::dropIfExists('mrp_boms');
        if (Schema::hasTable('permissions')) {
            $ids = DB::table('permissions')->whereIn('slug', array_keys(self::PERMISSIONS))->pluck('id');
            DB::table('permission_role')->whereIn('permission_id', $ids)->delete();
            DB::table('permissions')->whereIn('id', $ids)->delete();
        }
    }
};
