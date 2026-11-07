<?php

namespace Tests\Feature;

use Database\Seeders\RbacSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** Each menu's Dashboard: its basic analytics (by permission) and the user's own layout. */
class ModuleDashboardTest extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected $seeder = RbacSeeder::class;

    public function test_analytics_of_each_module_by_permission(): void
    {
        DB::table('ppb')->insert([
            ['no_ppb' => 'PPB/1', 'tgl_ppb' => now()->toDateString(), 'kode_barang' => 'ATK.1', 'deskripsi_barang' => 'KERTAS', 'kuantitas' => 5, 'line_status' => 'REQUESTED', 'status' => 'OPEN', 'is_amend' => false, 'created_at' => now(), 'updated_at' => now()],
            ['no_ppb' => 'PPB/1', 'tgl_ppb' => now()->toDateString(), 'kode_barang' => 'ATK.2', 'deskripsi_barang' => 'TINTA', 'kuantitas' => 2, 'line_status' => 'COMPLETED', 'status' => 'OPEN', 'is_amend' => false, 'created_at' => now(), 'updated_at' => now()],
        ]);

        $this->actingAsRole('purchasing');
        $d = $this->getJson('/api/module-stats/ppb')->assertOk()->json('data');
        $this->assertSame(['month' => 1, 'open' => 1], collect($d['kpis'])->whereIn('key', ['month', 'open'])->pluck('value', 'key')->all());
        $this->assertCount(14, $d['trend']['points']);
        $this->assertSame(1, end($d['trend']['points'])['value'], 'today: one PPB');
        $this->assertSame('KERTAS', $d['top']['rows'][0]['name']);
        foreach (['po', 'ri'] as $m) {
            $this->getJson("/api/module-stats/{$m}")->assertOk()->assertJsonStructure(['data' => ['kpis', 'trend' => ['points'], 'status', 'top' => ['rows']]]);
        }
        $this->getJson('/api/module-stats/nothing')->assertNotFound();

        // a karyawan: their requests and tasks, not the purchasing ones
        $this->actingAsRole('karyawan');
        $this->getJson('/api/module-stats/request')->assertOk();
        $this->getJson('/api/module-stats/important')->assertOk();
        $this->getJson('/api/module-stats/po')->assertForbidden();
    }

    public function test_each_user_keeps_their_own_layout(): void
    {
        $a = $this->actingAsRole('purchasing');
        $this->getJson('/api/preferences/dashboard:po')->assertOk()->assertJsonPath('data', null);
        $layout = ['order' => ['kpis', 'todo', 'trend'], 'hidden' => ['top'], 'size' => ['trend' => 12]];
        $this->putJson('/api/preferences/dashboard:po', ['value' => $layout])->assertOk();
        $this->assertSame($layout, $this->getJson('/api/preferences/dashboard:po')->json('data'));
        $this->getJson('/api/preferences/bad key!')->assertNotFound();

        $this->actingAsRole('purchasing', ['username' => 'lain']);
        $this->getJson('/api/preferences/dashboard:po')->assertJsonPath('data', null);
        $this->actingAs($a, 'sanctum');
        $this->putJson('/api/preferences/dashboard:po', ['value' => null])->assertOk();
        $this->getJson('/api/preferences/dashboard:po')->assertJsonPath('data', null);
    }
}
