<?php

namespace Tests\Feature;

use App\Models\Employee;
use App\Models\ItemRequest;
use App\Models\Npbg;
use App\Models\User;
use Database\Seeders\RbacSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The warehouse is the only door: no Delivery Order typed by hand — goods leave through Item Request → Delivery
 * Order, and the warehouse admin can make that Item Request for someone else.
 */
class WarehouseGateTest extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected $seeder = RbacSeeder::class;

    public function test_a_manual_delivery_order_is_refused(): void
    {
        $this->actingAsRole('admin_gudang');
        $this->postJson('/api/npbg', ['pelanggan' => 'PT ABC', 'tipe_npbg' => 'Penjualan', 'deskripsi_barang' => 'KERTAS', 'kuantitas' => 1])
            ->assertStatus(422)->assertJsonValidationErrors('npbg');
        $this->assertSame(0, Npbg::count());
    }

    public function test_admin_gudang_makes_a_request_for_a_person_of_data_pekerja_or_by_name(): void
    {
        $budiUser = User::factory()->create(['name' => 'BUDI']);
        $budi = Employee::create(['name' => 'Budi Santoso', 'name_normalized' => 'budi santoso', 'phone_wa' => '0812', 'user_id' => $budiUser->id, 'is_active' => true]);
        $admin = $this->actingAsRole('admin_gudang', ['name' => 'ADMIN GUDANG']);

        $this->getJson('/api/item-requests/requesters?q=bud')->assertOk()->assertJsonPath('data.0.name', 'Budi Santoso')->assertJsonPath('data.0.has_account', true);
        $line = ['deskripsi_barang' => 'kertas hvs a4', 'qty' => 2, 'satuan' => 'RIM'];
        $made = $this->postJson('/api/item-requests', ['on_behalf' => ['employee_id' => $budi->id], 'lines' => [$line]])->assertCreated()->json('data');
        $r = ItemRequest::find($made['id']);
        // it is Budi's request (he follows it in his account), typed by the admin; it starts the normal flow
        $this->assertSame([$budiUser->id, 'Budi Santoso', '0812', $admin->id, 'MENUNGGU'], [$r->requester_id, $r->requester_name, $r->requester_contact, $r->entered_by, $r->status]);
        $this->assertSame('ADMIN GUDANG', $made['entered_by_name']);

        // someone without an account, by name
        $made = $this->postJson('/api/item-requests', ['on_behalf' => ['name' => 'Pak Tukang Las'], 'lines' => [$line]])->assertCreated()->json('data');
        $this->assertSame([null, 'Pak Tukang Las'], [ItemRequest::find($made['id'])->requester_id, ItemRequest::find($made['id'])->requester_name]);
        $this->postJson('/api/item-requests', ['on_behalf' => [], 'lines' => [$line]])->assertCreated(); // empty = for myself
        $this->postJson('/api/item-requests', ['on_behalf' => ['employee_id' => null, 'name' => ''], 'lines' => [$line]])->assertStatus(422);

        // Budi sees it among his own requests
        $this->actingAs($budiUser);
        $budiUser->roles()->attach(\App\Models\Role::where('slug', 'karyawan')->sole());
        $this->getJson("/api/item-requests/{$r->id}")->assertOk();

        // an employee may not make a request in someone else's name
        $this->actingAsRole('karyawan');
        $this->postJson('/api/item-requests', ['on_behalf' => ['name' => 'Orang Lain'], 'lines' => [$line]])->assertForbidden();
        $this->getJson('/api/item-requests/requesters?q=bud')->assertForbidden();
    }
}
