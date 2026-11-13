<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Disassembly (unbuild): one finished product taken apart into its BoM components — see
 * App\Services\Disassembly\DisassemblyService.
 *
 * Additive only. Reads the Manufacturing BoMs (mrp_boms) without changing them; every stock change goes
 * through StockLedgerService (stock_movements + inventory). Product / component columns are named item_id
 * so StockwisePurge never removes an item still used here.
 */
return new class extends Migration
{
    private const PERMISSIONS = [
        'disassembly.view' => 'Disassembly: lihat Disassembly Order, riwayat & laporan pembongkaran',
        'disassembly.create' => 'Disassembly: buat & ubah Disassembly Order draft',
        'disassembly.confirm' => 'Disassembly: konfirmasi pembongkaran (produk dipesan dari stok)',
        'disassembly.record' => 'Disassembly: mulai pembongkaran, catat hasil baik, scrap & hilang',
        'disassembly.validate' => 'Disassembly: validasi & posting, izinkan hasil di luar rencana, tandai sudah dicatat di Accurate',
        'disassembly.cancel' => 'Disassembly: batalkan & balik posting pembongkaran selesai',
    ];

    /** role => permissions it gets by default (super_admin gets all) — the same split as Manufacturing */
    private const GRANTS = [
        'admin_gudang' => ['disassembly.view', 'disassembly.create', 'disassembly.confirm', 'disassembly.record', 'disassembly.validate', 'disassembly.cancel'],
        'lapangan_gudang' => ['disassembly.view', 'disassembly.record'],
        'bos' => ['disassembly.view'],
    ];

    public function up(): void
    {
        Schema::create('disassembly_orders', function (Blueprint $table) {
            $table->id();
            $table->string('number', 40)->unique(); // DSA/26/XI/001
            $table->foreignId('mrp_bom_id')->constrained('mrp_boms')->restrictOnDelete();
            $table->string('bom_code', 40);
            $table->unsignedInteger('bom_revision');
            $table->foreignId('item_id')->constrained('items')->restrictOnDelete(); // the product taken apart
            $table->string('product_code', 60)->nullable();
            $table->string('product_name', 255)->nullable();
            $table->string('base_unit', 20)->nullable();
            $table->decimal('planned_qty', 14, 2);
            $table->decimal('done_qty', 14, 2)->nullable(); // actually taken apart, set when finished
            $table->decimal('reserved_qty', 14, 2)->default(0); // product held for this order right now
            $table->foreignId('source_warehouse_id')->constrained('warehouses')->restrictOnDelete();
            $table->foreignId('dest_warehouse_id')->nullable()->constrained('warehouses')->restrictOnDelete(); // null = source
            $table->foreignId('responsible_id')->nullable()->constrained('users')->nullOnDelete();
            $table->text('notes')->nullable();
            $table->string('status', 12)->default('DRAFT')->index(); // DRAFT/CONFIRMED/IN_PROGRESS/TO_CLOSE/DONE/CANCELLED
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            foreach (['confirmed', 'started', 'finished', 'done', 'cancelled', 'reversed', 'accurate_recorded'] as $step) {
                $table->timestamp("{$step}_at")->nullable();
                $table->foreignId("{$step}_by")->nullable()->constrained('users')->nullOnDelete();
            }
            $table->string('cancel_reason', 255)->nullable();
            $table->text('accurate_refs')->nullable(); // JSON list of the Accurate document numbers
            $table->string('posting_batch', 36)->nullable(); // stock_movements.batch_uuid of the posting
            $table->timestamps();
        });

        Schema::create('disassembly_components', function (Blueprint $table) {
            $table->id();
            $table->foreignId('disassembly_order_id')->constrained('disassembly_orders')->cascadeOnDelete();
            $table->foreignId('item_id')->constrained('items')->restrictOnDelete();
            $table->string('product_code', 60)->nullable();
            $table->string('description', 255)->nullable();
            $table->string('base_unit', 20)->nullable();
            $table->decimal('qty_per_unit', 18, 6)->default(0); // BoM snapshot
            $table->decimal('planned_qty', 18, 6)->default(0); // qty_per_unit × planned_qty of the order
            $table->boolean('is_extra')->default(false); // not in the BoM: added through an authorised entry
            $table->unsignedSmallInteger('sort')->default(0);
            $table->timestamps();
            $table->unique(['disassembly_order_id', 'item_id'], 'dsa_comp_unique');
        });

        Schema::create('disassembly_entries', function (Blueprint $table) {
            $table->id();
            $table->foreignId('disassembly_order_id')->constrained('disassembly_orders')->cascadeOnDelete();
            $table->foreignId('component_id')->constrained('disassembly_components')->restrictOnDelete();
            $table->foreignId('item_id')->constrained('items')->restrictOnDelete();
            $table->string('kind', 10); // GOOD (enters stock) / SCRAP (damaged) / MISSING (not found) — only GOOD moves stock
            $table->decimal('qty', 18, 6); // as typed, in `unit`
            $table->string('unit', 20)->nullable();
            $table->decimal('unit_ratio', 18, 6)->default(1); // 1 unit = ratio Base UOM, frozen
            $table->decimal('base_qty', 14, 2);
            $table->string('base_unit', 20)->nullable();
            $table->date('entry_date');
            $table->string('reason', 255)->nullable();
            $table->text('note')->nullable();
            $table->boolean('over_plan')->default(false);
            $table->string('client_key', 64)->nullable()->unique(); // a resent form is not recorded twice
            $table->foreignId('recorded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('posted_at')->nullable();
            $table->timestamp('voided_at')->nullable();
            $table->foreignId('voided_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->index(['disassembly_order_id', 'kind']);
        });

        Schema::create('disassembly_activities', function (Blueprint $table) {
            $table->id();
            $table->foreignId('disassembly_order_id')->constrained('disassembly_orders')->cascadeOnDelete();
            $table->string('action', 30);
            $table->string('from_status', 12)->nullable();
            $table->string('to_status', 12)->nullable();
            $table->text('note')->nullable();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('created_at')->nullable();
        });

        $this->grantPermissions();
    }

    /** Additive, like the MRP migration: never re-runs RbacSeeder (that resets every role). */
    private function grantPermissions(): void
    {
        if (! Schema::hasTable('permissions') || ! Schema::hasTable('roles')) {
            return;
        }
        $now = now();
        $ids = [];
        foreach (self::PERMISSIONS as $slug => $name) {
            $ids[$slug] = DB::table('permissions')->where('slug', $slug)->value('id')
                ?? DB::table('permissions')->insertGetId(['slug' => $slug, 'name' => $name, 'group' => 'disassembly', 'created_at' => $now, 'updated_at' => $now]);
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
        if (Schema::hasTable('permissions')) {
            $ids = DB::table('permissions')->whereIn('slug', array_keys(self::PERMISSIONS))->pluck('id');
            DB::table('permission_role')->whereIn('permission_id', $ids)->delete();
            DB::table('permissions')->whereIn('id', $ids)->delete();
        }
        Schema::dropIfExists('disassembly_activities');
        Schema::dropIfExists('disassembly_entries');
        Schema::dropIfExists('disassembly_components');
        Schema::dropIfExists('disassembly_orders');
    }
};
