<?php

namespace Tests\Feature\Inventory;

use App\Models\Inventory;
use App\Models\Item;
use App\Models\Ppb;
use App\Models\PurchaseOrder;
use App\Models\PurchaseOrderItem;
use App\Models\Warehouse;
use Database\Seeders\RbacSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** Master Barang: QTY = the STOCKWISE stock, Forecast = QTY + approved PPB / PO still coming in. */
class ItemForecastTest extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected $seeder = RbacSeeder::class;

    private function ppb(Item $item, string $no, float $qty): Ppb
    {
        return Ppb::create(['accurate_reqid' => crc32($no), 'accurate_seq' => 1, 'no_ppb' => $no, 'tgl_ppb' => '2026-10-25', 'kode_barang' => $item->code,
            'deskripsi_barang' => 'X', 'kuantitas' => $qty, 'satuan' => 'PCS', 'status' => 'OPEN', 'qty_dipesan' => 0, 'qty_diterima' => 0, 'peminta' => 'BUDI']);
    }

    private function po(Item $item, string $status, float $qty, float $received): void
    {
        $po = PurchaseOrder::factory()->create(['number' => 'PO/'.$status.'/'.uniqid(), 'status' => $status]);
        PurchaseOrderItem::create(['purchase_order_id' => $po->id, 'item_id' => $item->id, 'description_raw' => 'X', 'qty' => $qty, 'qty_received' => $received]);
    }

    public function test_forecast_counts_only_approved_ppb_and_po_and_an_ri_moves_it_into_qty(): void
    {
        $item = Item::factory()->create(['code' => 'OFN.0999', 'accurate_qty_onhand' => 3, 'accurate_qty_onorder' => 50]);
        $wh = Warehouse::factory()->create();
        Inventory::create(['item_id' => $item->id, 'warehouse_id' => $wh->id, 'actual_qty' => 7, 'reserved_qty' => 0]);
        $admin = $this->actingAsRole('super_admin');

        // PPB: approved by the Direktur counts; waiting / rejected do not
        $this->ppb($item, 'PPB/NA/26/X/101', 5);
        DB::table('ppb_approvals')->insert(['no_ppb' => 'PPB/NA/26/X/101', 'action' => 'APPROVE', 'user_id' => $admin->id, 'user_name' => $admin->name, 'created_at' => now()]);
        $this->ppb($item, 'PPB/NA/26/X/102', 9); // waiting for approval
        $this->ppb($item, 'PPB/NA/26/X/103', 4);
        DB::table('ppb_approvals')->insert(['no_ppb' => 'PPB/NA/26/X/103', 'action' => 'REJECT', 'user_id' => $admin->id, 'user_name' => $admin->name, 'created_at' => now()]);
        // PO: approved / sent count what is not received; waiting for the Direktur does not
        $this->po($item, 'SENT', 10, 4);
        $this->po($item, 'MENUNGGU_PO', 20, 0);

        $row = collect($this->getJson('/api/items?per_page=50')->assertOk()->json('data'))->firstWhere('id', $item->id);
        $this->assertSame(7.0, (float) $row['stock_qty'], 'QTY is the STOCKWISE stock, not the Accurate reference');
        $this->assertSame([5.0, 6.0, 11.0], [(float) $row['incoming']['ppb'], (float) $row['incoming']['po'], (float) $row['incoming']['total']]);
        $this->assertSame(18.0, (float) $row['forecast_qty']);

        // the RI of the PO: the stock grows, what is coming in shrinks, the forecast stays
        PurchaseOrderItem::where('item_id', $item->id)->where('qty', 10)->update(['qty_received' => 10]);
        Inventory::where('item_id', $item->id)->update(['actual_qty' => 13]);
        $row = $this->getJson("/api/items/{$item->id}")->assertOk()->json('data');
        $this->assertSame([13.0, 0.0, 18.0], [(float) $row['stock_qty'], (float) $row['incoming']['po'], (float) $row['forecast_qty']]);
    }
}
