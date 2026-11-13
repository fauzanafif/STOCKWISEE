<?php

namespace Tests\Feature\ItemRequest;

use App\Models\Item;
use App\Models\Npbg;
use App\Models\Warehouse;
use App\Services\Inventory\StockLedgerService;
use App\Services\SerialStock;
use Database\Seeders\RbacSeeder;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/** An item with serial numbers is handed over (its NPBG leaves) only with the serials of those units, from stock. */
class ItemRequestSerialHandoverTest extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected $seeder = RbacSeeder::class;

    private const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

    public function test_serials_are_picked_while_verifying_held_and_handed_over(): void
    {
        Cache::flush();
        Storage::fake('local');
        config(['stockwise.stockwise_ledger_since' => now()->subDay()->toDateTimeString()]);
        $item = Item::factory()->create(['code' => 'REG.01', 'description' => 'REGULATOR O2', 'is_active' => true, 'manage_sn' => true]);
        $wh = Warehouse::factory()->create();
        app(StockLedgerService::class)->record(['type' => 'STOCK_IN', 'item_id' => $item->id, 'warehouse_id' => $wh->id, 'qty' => 5]);
        Schema::create('accurate_serialnumbers', function (Blueprint $t) {
            $t->integer('SNID'); $t->string('SERIALNUMBER'); $t->string('ITEMNO'); $t->date('EXPIREDDATE')->nullable(); $t->integer('SNTYPE')->nullable();
        });
        Schema::create('accurate_snhistory', function (Blueprint $t) {
            $t->integer('ITEMHISTID'); $t->integer('SNID'); $t->decimal('QUANTITY', 18, 4); $t->integer('SNSIGN');
        });
        foreach ([1, 2, 3] as $i) {
            DB::table('accurate_serialnumbers')->insert(['SNID' => $i, 'SERIALNUMBER' => "RG-00{$i}", 'ITEMNO' => 'REG.01', 'SNTYPE' => 1]);
            DB::table('accurate_snhistory')->insert(['ITEMHISTID' => 1, 'SNID' => $i, 'QUANTITY' => 1, 'SNSIGN' => 1]);
        }

        $this->actingAsRole('karyawan', ['name' => 'SITI']);
        $req = $this->postJson('/api/item-requests', ['divisi' => 'HRD', 'lines' => [['deskripsi_barang' => 'regulator', 'qty' => 2, 'satuan' => 'PCS']]])->assertCreated()->json('data');
        $this->actingAsRole('admin_gudang');
        $process = "/api/item-requests/{$req['id']}/process";
        $lineId = $req['lines'][0]['id'];
        $npbg = ['pelanggan' => 'HRD'];
        // verifying an item with serial numbers: its serials are picked here, one per unit, from stock
        $this->postJson($process, ['lines' => [$lineId => ['item_id' => $item->id]], 'npbg' => $npbg])->assertStatus(422)->assertJsonValidationErrors("lines.{$lineId}.serials");
        $this->postJson($process, ['lines' => [$lineId => ['item_id' => $item->id, 'serials' => ['RG-001', 'RG-404']]], 'npbg' => $npbg])->assertStatus(422);
        $this->postJson($process, ['lines' => [$lineId => ['items' => [['item_id' => $item->id, 'qty' => 2, 'serials' => ['RG-001', 'RG-003']]]]], 'npbg' => $npbg])
            ->assertOk()->assertJsonPath('data.lines.0.serials', ['RG-001', 'RG-003']);
        // held for this request: no other request or NPBG sees them in stock
        $this->assertSame(['RG-002'], array_column(app(SerialStock::class)->available('REG.01'), 'serial'));
        $this->assertSame(['RG-001', 'RG-002', 'RG-003'], array_column(app(SerialStock::class)->available('REG.01', null, $req['id']), 'serial'));
        // the item's serial list: where each one is
        $this->actingAsRole('super_admin');
        $list = $this->getJson("/api/items/{$item->id}/serials")->assertOk()->assertJsonPath('meta.in_stock', 1)->assertJsonPath('meta.held', 2)->json('data');
        $this->assertSame([['RG-002', 'IN_STOCK'], ['RG-001', 'HELD'], ['RG-003', 'HELD']], array_map(fn ($r) => [$r['serial'], $r['status']], $list));
        $this->assertSame($req['number'], $list[1]['request']['number']);
        $this->actingAsRole('manager');
        $this->postJson("/api/item-requests/{$req['id']}/approval", ['action' => 'APPROVE'])->assertOk();
        $this->actingAsRole('direktur');
        $this->postJson("/api/item-requests/{$req['id']}/approval", ['action' => 'APPROVE'])->assertOk();

        $this->actingAsRole('lapangan_gudang');
        $f = $this->getJson("/api/item-requests/{$req['id']}")->assertOk()->json('data.fulfillments.0');
        $fl = $f['lines'][0];
        // the handover starts with the serials picked while verifying
        $this->assertSame(['REG.01', true, ['RG-001', 'RG-003']], [$fl['kode_barang'], $fl['manage_sn'], $fl['serials']]);
        $this->getJson('/api/approvals')->assertOk()->assertJsonPath('data.0.fulfillments.0.lines.0.manage_sn', true);

        $url = "/api/item-requests/{$req['id']}/fulfillments/{$f['id']}/handover";
        $body = ['photo' => self::PNG, 'signature' => self::PNG, 'received_by' => 'Siti'];
        $this->postJson($url, $body + ['serials' => [$fl['id'] => ['RG-001', 'RG-404']]])->assertStatus(422)->assertJsonValidationErrors("serials.{$fl['id']}");
        $this->assertSame('DISIAPKAN', DB::table('item_request_fulfillments')->value('status'), 'nothing handed over on a refusal');

        // nothing sent: the serials picked while verifying go out
        $this->postJson($url, $body)->assertOk()->assertJsonPath('data.status', 'SELESAI');
        $this->assertSame('RG-001 ; RG-003', Npbg::sole()->no_seri);
        $this->assertSame(['RG-002'], array_column(app(SerialStock::class)->available('REG.01'), 'serial'));
        $this->actingAsRole('super_admin');
        $out = collect($this->getJson("/api/items/{$item->id}/serials")->assertOk()->assertJsonPath('meta.out', 2)->json('data'))->firstWhere('serial', 'RG-001');
        $this->assertSame(['OUT', Npbg::sole()->no_npbg], [$out['status'], $out['out_doc']]);
    }
}
