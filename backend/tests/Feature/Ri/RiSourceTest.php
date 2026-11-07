<?php

namespace Tests\Feature\Ri;

use App\Models\Item;
use App\Models\Npbg;
use App\Models\Warehouse;
use App\Services\Inventory\StockLedgerService;
use App\Services\Tracking\UsedReturnSheets;
use Database\Seeders\RbacSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** A STOCKWISE RI: from a PO, from used goods coming back (Pengembalian Bekas), or manual (tied to nothing). */
class RiSourceTest extends TestCase
{
    use RefreshDatabase;

    protected $seed = true;

    protected $seeder = RbacSeeder::class;

    private const PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

    private Item $item;

    protected function setUp(): void
    {
        parent::setUp();
        $this->item = Item::factory()->create(['code' => 'SPR.0001', 'description' => 'BAN LUAR 7.50-16', 'is_active' => true]);
        app(StockLedgerService::class)->openingBalance($this->item->id, Warehouse::factory()->create()->id, 5);
    }

    private function stock(): float
    {
        return (float) DB::table('inventory')->where('item_id', $this->item->id)->sum('actual_qty');
    }

    /** an NPBG line ticked "Kembali Bekas": a PENDING row in Tracking Pengembalian Bekas */
    private function usedGoodsOut(): int
    {
        $n = Npbg::create(['accurate_arinvoice_id' => 901, 'accurate_seq' => 0, 'no_npbg' => 'NPBG/NA/26/X/090', 'tgl_npbg' => '2026-10-20',
            'kode_barang' => 'SPR.0001', 'deskripsi_barang' => 'BAN LUAR 7.50-16', 'kuantitas' => 2, 'satuan' => 'PCS', 'pelanggan' => 'B 1234 XY']);
        $this->actingAsRole('super_admin');
        $this->putJson("/api/npbg/{$n->id}/kembali-bekas", ['checked' => true])->assertOk()->assertJsonPath('data.kembali_bekas_status', 'PENDING');

        return (int) DB::table(UsedReturnSheets::OTHER)->where('npbg_id', $n->id)->value('id');
    }

    public function test_used_goods_back_clear_their_tracking_row_without_adding_stock(): void
    {
        $row = $this->usedGoodsOut();
        $pick = $this->getJson('/api/ri/used-return-lines?search=7.50')->assertOk()->assertJsonCount(1, 'data')->json('data.0');
        $this->assertSame([$row, 'NPBG/NA/26/X/090', 'SPR.0001', 'B 1234 XY'], [$pick['id'], $pick['npbg_no'], $pick['kode_barang'], $pick['pelanggan']]);

        // a photo is the proof, and which used goods come back is required
        $this->postJson('/api/ri', ['sumber' => 'BEKAS', 'divisi' => 'NV', 'deskripsi_barang' => 'BAN LUAR BEKAS', 'kuantitas' => 2, 'photos' => [self::PHOTO]])
            ->assertStatus(422)->assertJsonValidationErrors('used_return_row_id');
        $ri = $this->postJson('/api/ri', ['sumber' => 'BEKAS', 'used_return_row_id' => $row, 'divisi' => 'NV', 'kode_barang' => 'SPR.0001',
            'deskripsi_barang' => 'BAN LUAR 7.50-16 (BEKAS)', 'kuantitas' => 2, 'photos' => [self::PHOTO]])->assertCreated()->json('data');
        $this->assertSame(['BEKAS', $row, 'Pengembalian bekas NPBG NPBG/NA/26/X/090', 'PCS'], [$ri['sumber'], $ri['used_return_row_id'], $ri['keterangan'], $ri['satuan']]);

        $tracked = DB::table(UsedReturnSheets::OTHER)->find($row);
        $this->assertSame([$ri['no_ri'], 'CLEAR'], [$tracked->ri_no, $tracked->status], 'the RI back and its photo: CLEAR');
        $this->assertSame(5.0, $this->stock(), 'used goods are not new stock');
        $this->getJson('/api/ri/used-return-lines')->assertJsonCount(0, 'data');
        $this->getJson("/api/npbg/{$tracked->npbg_id}")->assertJsonPath('data.kembali_bekas_status', 'CLEAR');
        // only once
        $this->postJson('/api/ri', ['sumber' => 'BEKAS', 'used_return_row_id' => $row, 'divisi' => 'NV', 'deskripsi_barang' => 'X', 'kuantitas' => 1, 'photos' => [self::PHOTO]])
            ->assertStatus(422)->assertJsonValidationErrors('used_return_row_id');
        $this->getJson('/api/ri?sumber=BEKAS')->assertJsonCount(1, 'data');
    }

    public function test_a_manual_ri_is_tied_to_nothing_and_adds_its_master_item_to_stock(): void
    {
        $this->actingAsRole('super_admin');
        $ri = $this->postJson('/api/ri', ['sumber' => 'MANUAL', 'divisi' => 'NV', 'kode_barang' => 'SPR.0001', 'deskripsi_barang' => 'BAN LUAR 7.50-16',
            'kuantitas' => 3, 'keterangan' => 'Titipan cabang', 'used_return_row_id' => null, 'photos' => [self::PHOTO]])->assertCreated()->json('data');
        $this->assertSame(['MANUAL', null], [$ri['sumber'], $ri['used_return_row_id']]);
        $this->assertSame(8.0, $this->stock());
        // free goods, not a master item: no stock, still an RI
        $this->postJson('/api/ri', ['divisi' => 'ATK', 'deskripsi_barang' => 'Sample brosur vendor', 'kuantitas' => 10, 'photos' => [self::PHOTO]])
            ->assertCreated()->assertJsonPath('data.sumber', 'MANUAL');
        $this->getJson('/api/ri?sumber=MANUAL')->assertJsonCount(2, 'data');
        $this->getJson('/api/ri?sumber=PO')->assertJsonCount(0, 'data');
        // "Dari PO" needs its PO line
        $this->postJson('/api/ri', ['sumber' => 'PO', 'divisi' => 'NV', 'deskripsi_barang' => 'X', 'kuantitas' => 1, 'photos' => [self::PHOTO]])
            ->assertStatus(422)->assertJsonValidationErrors('purchase_order_item_id');
    }

    public function test_ri_from_a_po_takes_its_item_list_and_may_receive_part_of_it(): void
    {
        $po = \App\Models\PurchaseOrder::factory()->create(['status' => 'APPROVED', 'number' => 'PO/MANUAL/26/X/001']);
        $ban = \App\Models\PurchaseOrderItem::create(['purchase_order_id' => $po->id, 'item_id' => $this->item->id, 'description_raw' => 'BAN LUAR 7.50-16', 'qty' => 10, 'unit_price' => 1500000, 'line_total' => 15000000]);
        $velg = \App\Models\PurchaseOrderItem::create(['purchase_order_id' => $po->id, 'description_raw' => 'VELG 16', 'qty' => 4, 'unit_price' => 500000, 'line_total' => 2000000]);
        $this->actingAsRole('super_admin');

        // search the PO: all its lines, with how much is left
        $found = $this->getJson('/api/ri/po-orders?search=velg')->assertOk()->assertJsonCount(1, 'data')->json('data.0');
        $this->assertEquals([$po->number, 2, 10, 0], [$found['number'], count($found['lines']), $found['lines'][0]['remaining'], $found['lines'][0]['received']]);

        $body = ['purchase_order_id' => $po->id, 'divisi' => 'NA', 'no_surat_jalan' => 'SJ-001',
            'documents' => [['data' => 'data:application/pdf;base64,JVBERi0xLjQK', 'name' => 'surat-jalan.pdf']]];
        // the proof is per item: no photo for the tyres, refused
        $this->postJson('/api/ri/from-po', $body + ['lines' => [['purchase_order_item_id' => $ban->id, 'qty' => 5]]])->assertStatus(422)->assertJsonValidationErrors('photos');
        $this->postJson('/api/ri/from-po', $body + ['lines' => [['purchase_order_item_id' => $ban->id, 'qty' => 0]]])->assertStatus(422)->assertJsonValidationErrors('lines');
        // half of the tyres came, the rims not yet: one RI of one line
        $ri = $this->postJson('/api/ri/from-po', $body + ['lines' => [['purchase_order_item_id' => $ban->id, 'qty' => 5, 'photos' => [self::PHOTO]], ['purchase_order_item_id' => $velg->id, 'qty' => 0]]])
            ->assertCreated()->json('data');
        $this->assertSame(['PO', $po->number, 'SJ-001', ['foto1']], [$ri['sumber'], $ri['no_po'], $ri['no_surat_jalan'], $ri['photos']]);
        $this->assertSame('surat-jalan.pdf', $ri['documents'][0]['file_name']);
        $this->assertSame(['PARTIAL_RECEIVED', 5.0, 10.0], [$po->refresh()->status, (float) $ban->refresh()->qty_received, $this->stock()]);
        $this->get("/api/ri/{$ri['id']}/photo/doc1")->assertOk();
        // the PO list says it: ordered 10, received 5 ("10/5")
        $row = collect($this->getJson('/api/purchase-orders?search=BAN')->json('data'))->firstWhere('id', $ban->id);
        $this->assertEquals([10, 5], [$row['qty'], $row['received']]);

        // the rest with a second delivery note: one RI of two lines, the PO is done
        $two = $this->postJson('/api/ri/from-po', ['no_surat_jalan' => 'SJ-002'] + $body + ['lines' => [['purchase_order_item_id' => $ban->id, 'qty' => 5, 'photos' => [self::PHOTO]], ['purchase_order_item_id' => $velg->id, 'qty' => 4, 'no_seri' => 'V1-V4', 'photos' => [self::PHOTO, self::PHOTO]]]])
            ->assertCreated()->json('data');
        $shown = $this->getJson("/api/ri/{$two['id']}")->json('data');
        $this->assertCount(2, $shown['lines']);
        $this->assertSame([['foto1'], ['foto1', 'foto2']], array_column($shown['lines'], 'photos'), 'each item its own proof');
        $this->get("/api/ri/{$shown['lines'][1]['id']}/photo/foto2")->assertOk();
        $this->assertSame('RECEIVED', $po->refresh()->status);
        $this->getJson('/api/ri/po-orders')->assertJsonCount(0, 'data');
        // the same delivery note again: never
        $po->update(['status' => 'PARTIAL_RECEIVED']);
        $ban->update(['qty_received' => 9]);
        $this->postJson('/api/ri/from-po', ['no_surat_jalan' => 'SJ-002'] + $body + ['lines' => [['purchase_order_item_id' => $ban->id, 'qty' => 1, 'photos' => [self::PHOTO]]], 'allow_duplicate' => true])
            ->assertStatus(422)->assertJsonValidationErrors('duplicate');
    }

    public function test_goods_ordered_in_packs_enter_stock_in_the_items_own_unit(): void
    {
        $pcs = \App\Models\Unit::factory()->create(['code' => 'PCS']);
        $pck = \App\Models\Unit::factory()->create(['code' => 'PCK']);
        $this->item->update(['unit_id' => $pcs->id]);
        $start = $this->stock();
        $po = \App\Models\PurchaseOrder::factory()->create(['status' => 'APPROVED', 'accurate_po_id' => null]);
        $line = \App\Models\PurchaseOrderItem::create(['purchase_order_id' => $po->id, 'item_id' => $this->item->id, 'description_raw' => 'BAN LUAR 7.50-16', 'qty' => 5, 'unit_id' => $pck->id, 'unit_price' => 100, 'line_total' => 500]);
        $this->actingAsRole('super_admin');
        $body = ['purchase_order_id' => $po->id, 'divisi' => 'NA', 'no_surat_jalan' => 'SJ-UOM', 'lines' => [['purchase_order_item_id' => $line->id, 'qty' => 3, 'photos' => [self::PHOTO]]]];

        // without a ratio the goods cannot be counted: the form says so, the RI stops, nothing moves
        $shown = $this->getJson('/api/ri/po-orders')->assertOk()->json('data.0.lines.0');
        $this->assertNotNull($shown['unit_problem']);
        $this->postJson('/api/ri/from-po', $body)->assertStatus(422)->assertJsonValidationErrors('lines');
        $this->assertSame([0.0, $start], [(float) $line->refresh()->qty_received, $this->stock()]);

        // 1 PCK = 10 PCS for this item
        \App\Models\ItemUnitConversion::create(['item_id' => $this->item->id, 'unit_id' => $pck->id, 'ratio' => 10]);
        $shown = $this->getJson('/api/ri/po-orders')->assertOk()->json('data.0.lines.0');
        $this->assertEquals([10, 'PCS', null], [$shown['unit_ratio'], $shown['base_unit'], $shown['unit_problem']]);
        // what is still coming counts in the item's unit
        $this->assertEquals(50, \App\Services\Inventory\OnOrder::approvedByItem([$this->item->id])[$this->item->id]['po']);

        // 3 packs received: the document says 3 PCK, stock takes 30 PCS, the PO counts in packs
        $ri = $this->postJson('/api/ri/from-po', $body)->assertCreated()->json('data');
        $this->assertEquals([3, 'PCK', 10, 'PCS'], [$ri['kuantitas'], $ri['satuan'], $ri['unit_ratio'], $ri['base_satuan']]);
        $this->assertEquals($start + 30, $this->stock());
        $this->assertSame([3.0, 'PARTIAL_RECEIVED'], [(float) $line->refresh()->qty_received, $po->refresh()->status]);
        $this->assertEquals(20, \App\Services\Inventory\OnOrder::approvedByItem([$this->item->id])[$this->item->id]['po']);
        $this->assertEquals(30, \App\Services\Inventory\StockwiseNet::byItem()[$this->item->id] ?? null);
        $note = DB::table('stock_movements')->where('item_id', $this->item->id)->where('movement_type', 'RECEIVING')->value('note');
        $this->assertStringContainsString('3 PCK = 30 PCS', (string) $note);

        // a later change of the ratio does not rewrite what was received
        \App\Models\ItemUnitConversion::where('item_id', $this->item->id)->update(['ratio' => 12]);
        $this->assertEquals(30, \App\Services\Inventory\StockwiseNet::byItem()[$this->item->id] ?? null);
        \App\Models\ItemUnitConversion::where('item_id', $this->item->id)->update(['ratio' => 10]);

        // the same for an RI written by hand; a unit the master does not know counts as before
        $this->postJson('/api/ri', ['sumber' => 'MANUAL', 'divisi' => 'NV', 'kode_barang' => 'SPR.0001', 'deskripsi_barang' => 'BAN', 'kuantitas' => 2, 'satuan' => 'pck', 'photos' => [self::PHOTO]])
            ->assertCreated()->assertJsonPath('data.base_satuan', 'PCS');
        $this->assertEquals($start + 50, $this->stock());
        $this->postJson('/api/ri', ['sumber' => 'MANUAL', 'divisi' => 'NV', 'kode_barang' => 'SPR.0001', 'deskripsi_barang' => 'BAN', 'kuantitas' => 1, 'satuan' => 'BIJI', 'no_surat_jalan' => 'SJ-X', 'photos' => [self::PHOTO]])->assertCreated();
        $this->assertEquals($start + 51, $this->stock());
        // a unit with no ratio for this item stops a hand-written one too
        $box = \App\Models\Unit::factory()->create(['code' => 'BOX']);
        $this->postJson('/api/ri', ['sumber' => 'MANUAL', 'divisi' => 'NV', 'kode_barang' => 'SPR.0001', 'deskripsi_barang' => 'BAN', 'kuantitas' => 1, 'satuan' => 'BOX', 'no_surat_jalan' => 'SJ-Y', 'photos' => [self::PHOTO]])->assertStatus(422)->assertJsonValidationErrors('satuan');
        $this->assertEquals($start + 51, $this->stock());
    }

    public function test_a_po_of_12_units_takes_one_serial_per_unit_by_hand_or_from_excel(): void
    {
        $po = \App\Models\PurchaseOrder::factory()->create(['status' => 'APPROVED', 'accurate_po_id' => null]);
        $ban = \App\Models\PurchaseOrderItem::create(['purchase_order_id' => $po->id, 'item_id' => $this->item->id, 'description_raw' => 'BAN LUAR 7.50-16', 'qty' => 12, 'unit_price' => 100, 'line_total' => 1200]);
        $this->actingAsRole('super_admin');
        $twelve = array_map(fn ($i) => sprintf('0890%02d', $i), range(1, 12));
        $body = fn (array $serials, float $qty = 12, string $sj = 'SJ-S1', array $extra = []) => ['purchase_order_id' => $po->id, 'divisi' => 'NA', 'no_surat_jalan' => $sj,
            'lines' => [['purchase_order_item_id' => $ban->id, 'qty' => $qty, 'serials' => $serials, 'photos' => [self::PHOTO]]]] + $extra;

        // all or none, one per unit, no repeats, whole units only; nothing is received when refused
        $this->postJson('/api/ri/from-po', $body(array_slice($twelve, 0, 11)))->assertStatus(422)->assertJsonValidationErrors('serials');
        $this->postJson('/api/ri/from-po', $body([...array_slice($twelve, 0, 11), $twelve[0]]))->assertStatus(422)->assertJsonValidationErrors('serials');
        $this->postJson('/api/ri/from-po', $body(['A;B'], 1))->assertStatus(422)->assertJsonValidationErrors('serials');
        $this->postJson('/api/ri/from-po', $body(['A', 'B'], 1.5))->assertStatus(422)->assertJsonValidationErrors('serials');
        $this->assertSame(0.0, (float) $ban->refresh()->qty_received);

        // the template has a row per unit; the filled file comes back per line, zeros kept, nothing saved
        $file = $this->postJson('/api/ri/serials/template', ['name' => $po->number, 'lines' => [['key' => $ban->id, 'kode' => 'SPR.0001', 'deskripsi' => '=1+1', 'satuan' => 'PCS', 'qty' => 12]]])->assertOk();
        $path = tempnam(sys_get_temp_dir(), 'ri').'.xlsx';
        file_put_contents($path, $file->streamedContent());
        $book = \PhpOffice\PhpSpreadsheet\IOFactory::load($path);
        $sheet = $book->getActiveSheet();
        $this->assertSame([13, '=1+1', \PhpOffice\PhpSpreadsheet\Cell\DataType::TYPE_STRING], [$sheet->getHighestDataRow(), $sheet->getCell('D2')->getValue(), $sheet->getCell('D2')->getDataType()]);
        foreach ($twelve as $i => $s) {
            $sheet->setCellValueExplicit('G'.($i + 2), $s, \PhpOffice\PhpSpreadsheet\Cell\DataType::TYPE_STRING);
        }
        (new \PhpOffice\PhpSpreadsheet\Writer\Xlsx($book))->save($path);
        $upload = fn (string $from) => new \Illuminate\Http\UploadedFile($from, 'serial.xlsx', null, null, true);
        $read = $this->post('/api/ri/serials/import', ['file' => $upload($path)], ['Accept' => 'application/json'])->assertOk()->json('data');
        $this->assertSame([['key' => $ban->id, 'serials' => $twelve]], $read);
        $this->assertSame(0.0, (float) $ban->refresh()->qty_received);

        // a repeated serial, a foreign workbook and an empty one are told apart
        $sheet->setCellValueExplicit('G5', $twelve[0], \PhpOffice\PhpSpreadsheet\Cell\DataType::TYPE_STRING);
        (new \PhpOffice\PhpSpreadsheet\Writer\Xlsx($book))->save($path);
        $this->assertStringContainsString('baris 2 dan 5', $this->post('/api/ri/serials/import', ['file' => $upload($path)], ['Accept' => 'application/json'])->assertStatus(422)->json('errors.file.0'));
        $foreign = new \PhpOffice\PhpSpreadsheet\Spreadsheet;
        $foreign->getActiveSheet()->setCellValue('A1', 'Hello');
        (new \PhpOffice\PhpSpreadsheet\Writer\Xlsx($foreign))->save($path);
        $this->post('/api/ri/serials/import', ['file' => $upload($path)], ['Accept' => 'application/json'])->assertStatus(422)->assertJsonValidationErrors('file');

        // saved the way Accurate keeps them; the printed cell stays one row, the Excel has them all
        $ri = $this->postJson('/api/ri/from-po', $body($twelve))->assertCreated()->json('data');
        $this->assertSame(implode(' ; ', $twelve), $ri['no_seri']);
        $this->assertSame([12.0, 'RECEIVED'], [(float) $ban->refresh()->qty_received, $po->refresh()->status]);
        $this->assertStringContainsString('089001 +11', $this->get("/api/ri/{$ri['id']}/print")->assertOk()->getContent());
        $out = tempnam(sys_get_temp_dir(), 'ri').'.xlsx';
        file_put_contents($out, $this->get("/api/ri/{$ri['id']}/serials-export")->assertOk()->streamedContent());
        $this->assertSame('089012', \PhpOffice\PhpSpreadsheet\IOFactory::load($out)->getActiveSheet()->getCell('G13')->getValue());

        // the same serial of this item on another delivery: asked first, then allowed
        $po->update(['status' => 'PARTIAL_RECEIVED']);
        $ban->update(['qty_received' => 11]);
        $this->postJson('/api/ri/from-po', $body(['089003'], 1, 'SJ-S2'))->assertStatus(422)->assertJsonValidationErrors('duplicate');
        $this->postJson('/api/ri/from-po', $body(['089003'], 1, 'SJ-S2', ['allow_duplicate' => true]))->assertCreated();

        // no serials at all is still fine, and a manual RI counts the same way
        $this->postJson('/api/ri', ['sumber' => 'MANUAL', 'divisi' => 'NV', 'deskripsi_barang' => 'POMPA', 'kuantitas' => 2, 'serials' => ['P1'], 'photos' => [self::PHOTO]])->assertStatus(422)->assertJsonValidationErrors('serials');
        $manual = $this->postJson('/api/ri', ['sumber' => 'MANUAL', 'divisi' => 'NV', 'deskripsi_barang' => 'POMPA', 'kuantitas' => 2, 'serials' => ['P1', ' ', 'P2'], 'photos' => [self::PHOTO]])->assertCreated()->json('data');
        $this->assertSame('P1 ; P2', $manual['no_seri']);
    }
}
