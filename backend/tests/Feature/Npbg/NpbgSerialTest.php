<?php

namespace Tests\Feature\Npbg;

use App\Models\Item;
use App\Services\SerialStock;
use Database\Seeders\RbacSeeder;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/** An item with serial numbers (Accurate MANAGESN) goes out by NPBG only with its serials picked from those in stock. */
class NpbgSerialTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        config(['stockwise.manual_npbg' => true]); // the closed manual Delivery Order, for documents already pending
    }

    use RefreshDatabase;

    protected $seed = true;

    protected $seeder = RbacSeeder::class;

    private function mirror(): void
    {
        if (! Schema::hasTable('accurate_serialnumbers')) {
            Schema::create('accurate_serialnumbers', function (Blueprint $t) {
                $t->integer('SNID'); $t->string('SERIALNUMBER'); $t->string('ITEMNO'); $t->date('EXPIREDDATE')->nullable(); $t->integer('SNTYPE')->nullable();
            });
            Schema::create('accurate_snhistory', function (Blueprint $t) {
                $t->integer('ITEMHISTID'); $t->integer('SNID'); $t->decimal('QUANTITY', 18, 4); $t->integer('SNSIGN');
            });
        }
        // SN-A1 and SN-A2 are in stock in Accurate; SN-A3 came in and went out
        DB::table('accurate_serialnumbers')->insert([
            ['SNID' => 1, 'SERIALNUMBER' => 'SN-A1', 'ITEMNO' => 'REG.01', 'EXPIREDDATE' => '2027-01-31', 'SNTYPE' => 1],
            ['SNID' => 2, 'SERIALNUMBER' => 'SN-A2', 'ITEMNO' => 'REG.01', 'EXPIREDDATE' => null, 'SNTYPE' => 1],
            ['SNID' => 3, 'SERIALNUMBER' => 'SN-A3', 'ITEMNO' => 'REG.01', 'EXPIREDDATE' => null, 'SNTYPE' => 1],
        ]);
        DB::table('accurate_snhistory')->insert([
            ['ITEMHISTID' => 10, 'SNID' => 1, 'QUANTITY' => 1, 'SNSIGN' => 1],
            ['ITEMHISTID' => 10, 'SNID' => 2, 'QUANTITY' => 1, 'SNSIGN' => 1],
            ['ITEMHISTID' => 10, 'SNID' => 3, 'QUANTITY' => 1, 'SNSIGN' => 1],
            ['ITEMHISTID' => 11, 'SNID' => 3, 'QUANTITY' => 1, 'SNSIGN' => -1],
        ]);
    }

    private function npbg(array $extra): \Illuminate\Testing\TestResponse
    {
        return $this->postJson('/api/npbg', array_merge([
            'pelanggan' => 'Gudang', 'tipe_npbg' => 'Non Penjualan', 'kode_barang' => 'REG.01', 'deskripsi_barang' => 'Regulator O2',
            'kuantitas' => 2, 'satuan' => 'PCS', 'allow_duplicate' => true,
        ], $extra));
    }

    public function test_serials_in_stock_follow_accurate_and_stockwise(): void
    {
        $this->mirror();
        Item::factory()->create(['code' => 'REG.01', 'description' => 'Regulator O2', 'manage_sn' => true]);
        DB::table('ri')->insert(['kode_barang' => 'REG.01', 'deskripsi_barang' => 'Regulator O2', 'kuantitas' => 1, 'no_seri' => 'SN-R9', 'accurate_apinvoice_id' => null, 'accurate_seq' => null, 'created_at' => now(), 'updated_at' => now()]);

        $serials = collect(app(SerialStock::class)->available('REG.01'));
        $this->assertSame(['SN-A1', 'SN-A2', 'SN-R9'], $serials->pluck('serial')->all());
        $this->assertSame('2027-01-31', $serials->firstWhere('serial', 'SN-A1')['expired']);
        $this->assertSame('RI', $serials->firstWhere('serial', 'SN-R9')['source']);

        $this->actingAsRole('admin_gudang');
        $this->getJson('/api/npbg/serials?kode_barang=REG.01')->assertOk()->assertJsonPath('meta.manage_sn', true)->assertJsonCount(3, 'data');
        $this->getJson('/api/items?manage_sn=1')->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.manage_sn', true);
    }

    public function test_npbg_of_a_serial_item_requires_serials_from_stock(): void
    {
        $this->mirror();
        Item::factory()->create(['code' => 'REG.01', 'description' => 'Regulator O2', 'manage_sn' => true]);
        $this->actingAsRole('admin_gudang');

        $this->npbg([])->assertStatus(422)->assertJsonValidationErrors('serials');
        $this->npbg(['serials' => ['SN-A1']])->assertStatus(422)->assertJsonValidationErrors('serials');
        $this->npbg(['serials' => ['SN-A1', 'SN-A1']])->assertStatus(422)->assertJsonValidationErrors('serials');
        $this->npbg(['serials' => ['SN-A1', 'SN-A3']])->assertStatus(422)->assertJsonValidationErrors('serials');
        $this->npbg(['kuantitas' => 1.5, 'serials' => ['SN-A1']])->assertStatus(422)->assertJsonValidationErrors('serials');

        $this->npbg(['serials' => ['SN-A1', 'sn-a2'], 'no_seri' => 'diabaikan'])->assertCreated()->assertJsonPath('data.no_seri', 'SN-A1 ; sn-a2');

        // they left the stock: not available any more, not twice
        $this->assertSame([], app(SerialStock::class)->available('REG.01'));
        $this->npbg(['kuantitas' => 1, 'serials' => ['SN-A1']])->assertStatus(422)->assertJsonValidationErrors('serials');
    }

    public function test_items_without_serials_keep_the_free_serial_field(): void
    {
        Item::factory()->create(['code' => 'REG.01', 'description' => 'Regulator O2', 'manage_sn' => false]);
        $this->actingAsRole('admin_gudang');
        $this->npbg(['no_seri' => 'bebas'])->assertCreated()->assertJsonPath('data.no_seri', 'bebas');
    }
}
