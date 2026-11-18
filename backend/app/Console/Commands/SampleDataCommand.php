<?php

namespace App\Console\Commands;

use App\Models\Item;
use App\Models\ItemUnitConversion;
use App\Models\Unit;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Inventory\StockLedgerService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Sample data for every feature, reading like real work: seven of each (Item Request, Delivery Order, Purchase
 * Request, Draft Price List, Price Quotation, Purchase Order, Receipt, Return, Physical Inventory, Important
 * Request, Update Alert), at the steps of their flow. Nothing on screen marks it, so what was made is kept in
 * storage/app/sample-data.json and --remove deletes exactly that.
 *
 * Written straight to the tables: no notification goes out. It has its own items, so the stock, on-order and
 * Safety Stock of real items are untouched. Its Update Alerts are inactive: no popup reaches anyone.
 */
class SampleDataCommand extends Command
{
    protected $signature = 'stockwise:sample-data {--remove : Delete what the last run made}';

    protected $description = 'Create (or --remove) sample data for every feature (seven of each)';

    private const FILE = 'sample-data.json';

    /** deleted in this order: children first */
    private const ORDER = ['price_list_draft_cells', 'price_list_draft_vendors', 'price_list_draft_items', 'price_list_drafts', 'vendor_price_histories', 'vendor_prices',
        'purchase_return_lines', 'purchase_returns', 'ri', 'purchase_order_item_vendors', 'purchase_order_quotes', 'purchase_order_items', 'purchase_orders', 'ppb_approvals', 'ppb_draft_lines', 'ppb_saved_drafts', 'ppb_drafts', 'ppb',
        'npbg_approvals', 'npbg', 'item_request_lines', 'item_requests', 'stock_opname_items', 'stock_opnames', 'important_request_activities', 'important_request_assignees', 'important_requests', 'update_alert_views', 'update_alerts', 'item_unit_conversions'];

    /** @var array<string, list<int>> */
    private array $made = [];

    private User $admin;

    private User $staff;

    public function handle(StockLedgerService $ledger): int
    {
        if ($this->option('remove')) {
            return $this->remove();
        }
        if (Storage::disk('local')->exists(self::FILE)) {
            $this->error('Sample data already exists. Remove it first with --remove.');

            return self::FAILURE;
        }
        $this->admin = User::where('username', 'superadmin')->first() ?? User::query()->orderBy('id')->firstOrFail();
        $this->staff = User::where('username', 'fauzan')->first() ?? $this->admin;

        DB::transaction(function () use ($ledger) {
            $items = $this->items($ledger);
            $this->itemRequests($items);
            $this->deliveryOrders($items, $ledger);
            $this->purchaseRequests($items);
            $vendors = DB::table('vendors')->where('is_active', true)->orderBy('id')->limit(3)->pluck('name', 'id')->all();
            if (count($vendors) < 3) {
                foreach (['CV Sumber Teknik', 'PT Mitra Gasindo', 'UD Karya Abadi'] as $i => $name) {
                    $id = $this->insert('vendors', ['code' => 'V9'.$i, 'name' => $name, 'is_active' => true]);
                    $vendors[$id] = $name;
                }
            }
            $vendorIds = array_slice(array_keys($vendors), 0, 3);
            $this->priceList($items, $vendorIds);
            $this->purchasing($items, $vendorIds, $ledger);
            $this->physicalInventory($items);
            $this->importantRequests();
            $this->alerts();
        });
        Storage::disk('local')->put(self::FILE, json_encode($this->made));
        $this->info('Sample data created: '.collect($this->made)->map(fn ($ids) => count($ids))->sum().' rows.');

        return self::SUCCESS;
    }

    private function remove(): int
    {
        if (! Storage::disk('local')->exists(self::FILE)) {
            $this->error('No sample data recorded.');

            return self::FAILURE;
        }
        $made = json_decode(Storage::disk('local')->get(self::FILE), true);
        DB::transaction(function () use ($made) {
            foreach (self::ORDER as $table) {
                if (! empty($made[$table]) && Schema::hasTable($table)) {
                    DB::table($table)->whereIn('id', $made[$table])->delete();
                }
            }
            if (! empty($made['items'])) {
                foreach (['stock_movements', 'inventory'] as $table) {
                    DB::table($table)->whereIn('item_id', $made['items'])->delete();
                }
                DB::table('items')->whereIn('id', $made['items'])->delete();
            }
            if (! empty($made['vendors'])) {
                DB::table('vendors')->whereIn('id', $made['vendors'])->delete();
            }
        });
        Storage::disk('local')->delete(self::FILE);
        $this->info('Sample data removed.');

        return self::SUCCESS;
    }

    private function insert(string $table, array $row, bool $stamps = true): int
    {
        $id = DB::table($table)->insertGetId($row + ($stamps ? ['created_at' => now(), 'updated_at' => now()] : []));
        $this->made[$table][] = $id;

        return $id;
    }

    /** @return array<string, Item> by key */
    private function items(StockLedgerService $ledger): array
    {
        $warehouse = Warehouse::query()->orderBy('id')->value('id');
        $list = [
            // key, code, name, unit, opening stock, ratios
            'cable' => ['ELK.9001', 'Kabel NYA 2,5 mm', 'MTR', 150, ['ROL' => 100]],
            'pump' => ['MKN.9002', 'Pompa air 1 HP', 'PCS', 4, []],
            'oil' => ['OLI.9003', 'Oli mesin 15W-40', 'LTR', 60, ['JRG' => 20]],
            'filter' => ['SPR.9004', 'Filter oli forklift', 'PCS', 8, ['BOX' => 12]],
            'paper' => ['ATK.9005', 'Kertas HVS A4 80 gr', 'LBR', 2000, ['RIM' => 500]],
            'bolt' => ['SPR.9006', 'Baut M12 x 40', 'PCS', 300, ['PCK' => 50]],
            'glove' => ['APD.9007', 'Sarung tangan kerja', 'PSG', 24, []],
            'valve' => ['GAS.9008', 'Regulator gas LPG', 'PCS', 6, []],
        ];
        $out = [];
        foreach ($list as $key => [$code, $name, $unit, $stock, $ratios]) {
            $unitId = Unit::where('code', $unit)->value('id') ?? Unit::create(['code' => $unit, 'name' => $unit, 'is_active' => true])->id;
            $id = DB::table('items')->insertGetId(['code' => $code, 'description' => $name, 'description_normalized' => Str::lower($name), 'unit_id' => $unitId, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
            $this->made['items'][] = $id;
            $item = Item::with('unit')->find($id);
            if ($warehouse) {
                $ledger->openingBalance($id, $warehouse, $stock);
            }
            foreach ($ratios as $code2 => $ratio) {
                $u = Unit::where('code', $code2)->value('id') ?? Unit::create(['code' => $code2, 'name' => $code2, 'is_active' => true])->id;
                $this->made['item_unit_conversions'][] = ItemUnitConversion::create(['item_id' => $id, 'unit_id' => $u, 'ratio' => $ratio, 'created_by' => $this->admin->id])->id;
            }
            $out[$key] = $item;
        }

        return $out;
    }

    /** Seven requests, one at each step: new, to revise, at the Manager, at the Director, done, rejected, cancelled. */
    private function itemRequests(array $i): void
    {
        $rows = [
            ['MENUNGGU', 'ATK', 'IT', [['Kertas A4', 2, 'RIM'], ['Tinta printer hitam', 2, 'PCS']]],
            ['PERLU_PERBAIKAN', 'UMUM', 'Gudang', [['Sarung tangan', 12, 'PSG']]],
            ['APPROVAL_MANAGER', 'MAINTENANCE', 'Maintenance', [[$i['cable'], 2, 'ROL', 100]]],
            ['APPROVAL_DIREKTUR', 'DISTRIBUSI', 'Distribusi', [[$i['oil'], 40, null, null]]],
            ['SELESAI', 'ATK', 'Keuangan', [[$i['paper'], 1, 'RIM', 500]]],
            ['DITOLAK', 'UMUM', 'Umum', [['Kursi kantor', 3, 'PCS']]],
            ['DIBATALKAN', 'ATK', 'IT', [['Spidol papan tulis', 6, 'PCS']]],
        ];
        foreach ($rows as $n => [$status, $form, $divisi, $lines]) {
            $at = now()->subDays($n)->subMinutes(($n + 1) * 7);
            $req = $this->insert('item_requests', ['number' => sprintf('REQ/26/XI/9%02d', $n + 1), 'track_token' => Str::random(32), 'source' => 'APP', 'form_type' => $form, 'requester_id' => $this->staff->id, 'requester_name' => $this->staff->name,
                'divisi' => $divisi, 'needed_date' => now()->addDays(7 - $n)->toDateString(), 'status' => $status, 'created_at' => $at, 'updated_at' => $at], false);
            foreach ($lines as $l) {
                if ($l[0] instanceof Item) {
                    [$item, $qty, $unit, $ratio] = $l;
                    $base = $ratio ? $qty * $ratio : $qty;
                    $this->insert('item_request_lines', ['item_request_id' => $req, 'item_id' => $item->id, 'kode_barang' => $item->code, 'deskripsi_barang' => $item->description, 'deskripsi_peminta' => $item->description, 'qty' => $base, 'satuan' => $item->unit->code,
                        'requested_qty' => $ratio ? $qty : null, 'requested_unit' => $unit, 'unit_ratio' => $ratio, 'decision' => 'NPBG', 'approved_qty' => $base, 'fulfilled_qty' => $status === 'SELESAI' ? $base : 0, 'decided_by' => $this->admin->id, 'decided_at' => $at]);
                } else {
                    $this->insert('item_request_lines', ['item_request_id' => $req, 'deskripsi_barang' => $l[0], 'deskripsi_peminta' => $l[0], 'qty' => $l[1], 'satuan' => $l[2], 'decision' => $status === 'DITOLAK' ? 'TOLAK' : null, 'reject_reason' => $status === 'DITOLAK' ? 'Stok kantor masih cukup.' : null]);
                }
            }
        }
    }

    /** Seven Delivery Orders: waiting for the Manager, at the Director, approved (out of stock). */
    private function deliveryOrders(array $i, StockLedgerService $ledger): void
    {
        $m = ['APPROVE_MANAGER'];
        $ok = ['APPROVE_MANAGER', 'APPROVE'];
        $rows = [['filter', 2, 'PCS', 1, 'Workshop Sidoarjo', []], ['glove', 6, 'PSG', 1, 'Gudang Balikpapan', $m], ['bolt', 1, 'PCK', 50, 'Proyek Trailer', $ok],
            ['paper', 1, 'RIM', 500, 'Kantor Pusat', $ok], ['oil', 1, 'JRG', 20, 'Armada Distribusi', []], ['cable', 10, 'MTR', 1, 'Workshop Sidoarjo', $m], ['valve', 1, 'PCS', 1, 'Depot Gresik', $ok]];
        foreach ($rows as $n => [$key, $qty, $unit, $ratio, $to, $log]) {
            $item = $i[$key];
            $no = sprintf('NPBG/MANUAL/26/XI/9%02d', $n + 1);
            $id = $this->insert('npbg', ['no_npbg' => $no, 'tgl_npbg' => now()->subDays($n)->toDateString(), 'divisi' => 'NA', 'tipe_npbg' => 'Non Penjualan', 'pelanggan' => $to, 'peminta' => $this->staff->name, 'kode_barang' => $item->code, 'deskripsi_barang' => $item->description,
                'kuantitas' => $qty, 'satuan' => $unit, 'unit_ratio' => $ratio, 'base_satuan' => $ratio > 1 ? $item->unit->code : null, 'created_by' => $this->admin->id]);
            foreach ($log as $action) {
                $this->insert('npbg_approvals', ['no_npbg' => $no, 'action' => $action, 'user_id' => $this->admin->id, 'user_name' => $this->admin->name, 'created_at' => now()], false);
            }
            if (in_array('APPROVE', $log, true)) {
                $inv = DB::table('inventory')->where('item_id', $item->id)->first();
                if ($inv) {
                    $ledger->record(['type' => 'STOCK_OUT', 'item_id' => $item->id, 'warehouse_id' => $inv->warehouse_id, 'qty' => $qty * $ratio, 'reference' => \App\Models\Npbg::find($id), 'note' => "NPBG {$no} (disetujui)", 'created_by' => $this->admin->id]);
                }
            }
        }
    }

    /** Seven Draft Purchase Request lines (five ready, two in a saved draft) and six Purchase Requests in approval (the seventh, approved, is in purchasing()). */
    private function purchaseRequests(array $i): void
    {
        $source = $this->insert('ppb_drafts', ['number' => 'RST/26/XI/901', 'status' => 'DRAFT', 'source' => 'RESTOCK', 'created_by' => $this->admin->id]);
        foreach (['pump' => 2, 'valve' => 5, 'oil' => 40, 'glove' => 24, 'cable' => 200] as $key => $qty) {
            $this->insert('ppb_draft_lines', ['ppb_draft_id' => $source, 'item_id' => $i[$key]->id, 'kode_barang' => $i[$key]->code, 'deskripsi_barang' => $i[$key]->description, 'qty' => $qty, 'satuan' => $i[$key]->unit->code, 'basis' => 'Di bawah safety stock']);
        }
        $saved = $this->insert('ppb_saved_drafts', ['name' => 'Kebutuhan workshop November', 'divisi' => 'NA', 'created_by' => $this->admin->id]);
        foreach (['filter' => 12, 'bolt' => 100] as $key => $qty) {
            $this->insert('ppb_draft_lines', ['ppb_draft_id' => $source, 'saved_draft_id' => $saved, 'item_id' => $i[$key]->id, 'kode_barang' => $i[$key]->code, 'deskripsi_barang' => $i[$key]->description, 'qty' => $qty, 'satuan' => $i[$key]->unit->code, 'basis' => 'Kebutuhan workshop']);
        }
        // in approval: waiting for the Manager, then the Director
        $m = ['APPROVE_MANAGER'];
        foreach ([['PPB/NA/26/XI/901', 'cable', 2, 'ROL', 100, []], ['PPB/NA/26/XI/902', 'pump', 1, 'PCS', 1, $m], ['PPB/NA/26/XI/904', 'paper', 5, 'RIM', 500, []],
            ['PPB/NA/26/XI/905', 'filter', 2, 'BOX', 12, $m], ['PPB/NA/26/XI/906', 'glove', 24, 'PSG', 1, []], ['PPB/NA/26/XI/907', 'oil', 3, 'JRG', 20, $m]] as [$no, $key, $qty, $unit, $ratio, $log]) {
            $this->ppb($no, $i[$key], $qty, $unit, $ratio);
            foreach ($log as $action) {
                $this->insert('ppb_approvals', ['no_ppb' => $no, 'action' => $action, 'user_id' => $this->admin->id, 'user_name' => $this->admin->name, 'created_at' => now()], false);
            }
        }
    }

    private function ppb(string $no, Item $item, float $qty, string $unit, float $ratio): int
    {
        return $this->insert('ppb', ['no_ppb' => $no, 'tgl_ppb' => now()->toDateString(), 'divisi' => 'NA', 'kode_barang' => $item->code, 'deskripsi_barang' => $item->description, 'kuantitas' => $qty, 'satuan' => $unit, 'unit_ratio' => $ratio, 'base_satuan' => $ratio != 1 ? $item->unit->code : null,
            'peminta' => $this->staff->name, 'status' => 'OPEN', 'line_status' => 'REQUESTED', 'is_amend' => false, 'created_by' => $this->admin->id]);
    }

    /**
     * Seven Draft Price Lists, one item each with the three vendors: four whose prices are set (in the Master
     * Price List, with their history) and three still being filled. The eighth item is left for a new draft.
     */
    private function priceList(array $i, array $vendors): void
    {
        if (! Schema::hasTable('price_list_drafts') || ! Schema::hasTable('vendor_prices')) {
            return;
        }
        $rows = [['bolt', [1500, 1350, 1420], true], ['filter', [85000, 79000, 82500], true], ['glove', [16000, 15000, null], true], ['pump', [2450000, 2380000, 2300000], true],
            ['oil', [33000, null, 31500], false], ['valve', [null, null, null], false], ['paper', [105, 98, null], false]];
        foreach ($rows as $n => [$key, $prices, $done]) {
            $item = $i[$key];
            $number = sprintf('PL/26/XI/9%02d', $n + 1);
            $draft = $this->insert('price_list_drafts', ['number' => $number, 'note' => $done ? 'Harga kuartal IV' : 'Menunggu penawaran vendor', 'status' => $done ? 'DONE' : 'DRAFT',
                'created_by' => $this->admin->id, 'done_by' => $done ? $this->admin->id : null, 'done_at' => $done ? now()->subDays(7 - $n) : null]);
            $this->insert('price_list_draft_items', ['price_list_draft_id' => $draft, 'item_id' => $item->id, 'created_at' => now()], false);
            foreach ($vendors as $v => $vendorId) {
                $this->insert('price_list_draft_vendors', ['price_list_draft_id' => $draft, 'vendor_id' => $vendorId, 'created_at' => now()], false);
                if ($prices[$v] === null) {
                    continue;
                }
                $this->insert('price_list_draft_cells', ['price_list_draft_id' => $draft, 'item_id' => $item->id, 'vendor_id' => $vendorId, 'price' => $prices[$v], 'updated_by' => $this->admin->id]);
                if ($done) {
                    $price = $this->insert('vendor_prices', ['item_id' => $item->id, 'vendor_id' => $vendorId, 'unit_id' => $item->unit_id, 'unit_ratio' => 1, 'base_unit_id' => $item->unit_id,
                        'price' => $prices[$v], 'min_qty' => 1, 'lead_time_days' => 7, 'status' => 'ACTIVE', 'created_by' => $this->admin->id, 'updated_by' => $this->admin->id]);
                    $this->insert('vendor_price_histories', ['vendor_price_id' => $price, 'item_id' => $item->id, 'vendor_id' => $vendorId, 'action' => 'CREATE', 'new_price' => $prices[$v], 'new_status' => 'ACTIVE',
                        'note' => "Dari Draft Price List {$number}", 'user_id' => $this->admin->id, 'user_name' => $this->admin->name, 'created_at' => now()], false);
                }
            }
        }
    }

    /**
     * One approved Purchase Request, its seven items at each step of Price Quotation (ready, in quotation, at the
     * Director, picked); then seven POs from draft to received, seven receipts and seven returns.
     */
    private function purchasing(array $i, array $vendors, StockLedgerService $ledger): void
    {
        $site = DB::table('sites')->value('id');
        $no = 'PPB/NA/26/XI/903';
        $steps = ['oil' => [null, []], 'valve' => [null, []], 'glove' => ['PENAWARAN', [[0, null], [1, null]]], 'pump' => ['PENAWARAN', [[0, 2450000], [1, null], [2, 2300000]]],
            'paper' => ['PENAWARAN', [[0, 52000], [1, 49500]]], 'filter' => ['MENUNGGU_DIREKTUR', [[0, 85000], [1, 79000]]], 'bolt' => ['DIPILIH', [[0, 1500], [2, 1350]]]];
        $po = fn (string $number, array $extra) => $this->insert('purchase_orders', ['number' => $number, 'prefix' => 'PPB', 'year' => 26, 'month' => 11, 'sequence' => (int) substr($number, -3), 'date' => now()->toDateString(), 'site_id' => $site, 'created_by' => $this->admin->id] + $extra);
        $entry = $po('PO/PPB/26/XI/901', ['vendor_id' => null, 'status' => \App\Services\PpbApprovalService::WAITING, 'from_ppb_approval' => $no, 'subtotal' => 0, 'tax' => 0, 'total' => 0, 'notes' => "Dari PPB {$no}"]);
        foreach ($steps as $key => [$stage, $quotes]) {
            $item = $i[$key];
            $ppb = $this->ppb($no, $item, 10, $item->unit->code, 1);
            $line = $this->insert('purchase_order_items', ['purchase_order_id' => $entry, 'approved_ppb_id' => $ppb, 'item_id' => $item->id, 'description_raw' => $item->description, 'qty' => 10, 'unit_id' => $item->unit_id, 'unit_ratio' => 1, 'unit_price' => 0, 'line_total' => 0, 'qty_received' => 0, 'line_status' => \App\Services\PpbApprovalService::WAITING, 'quote_stage' => $stage, 'quote_submitted_at' => $stage === 'MENUNGGU_DIREKTUR' ? now() : null]);
            foreach ($quotes as $q => [$v, $price]) {
                $this->insert('purchase_order_item_vendors', ['purchase_order_item_id' => $line, 'vendor_id' => $vendors[$v], 'created_by' => $this->admin->id, 'created_at' => now()], false);
                if ($price !== null) {
                    $chosen = $stage === 'DIPILIH' && $q === 1;
                    $this->insert('purchase_order_quotes', ['purchase_order_item_id' => $line, 'vendor_id' => $vendors[$v], 'unit_price' => $price, 'availability' => 'Ready', 'eta' => now()->addDays(7)->toDateString(), 'created_by' => $this->admin->id, 'chosen_at' => $chosen ? now() : null, 'chosen_by' => $chosen ? $this->admin->id : null]);
                }
            }
        }
        foreach (['APPROVE_MANAGER', 'APPROVE'] as $action) {
            $this->insert('ppb_approvals', ['no_ppb' => $no, 'action' => $action, 'user_id' => $this->admin->id, 'user_name' => $this->admin->name, 'created_at' => now()], false);
        }

        // seven POs: [number, vendor, status, item, qty, unit, ratio, price, received]
        $unit = fn (string $code) => Unit::where('code', $code)->value('id');
        $orders = [
            ['PO/PPB/26/XI/902', 0, 'DRAFT', 'filter', 12, 'PCS', 1, 79000, 0],
            ['PO/PPB/26/XI/903', 1, 'APPROVED', 'cable', 3, 'ROL', 100, 1200000, 2],
            ['PO/PPB/26/XI/904', 2, 'RECEIVED', 'pump', 3, 'PCS', 1, 500000, 3],
            ['PO/PPB/26/XI/905', 0, 'PARTIAL_RECEIVED', 'paper', 4, 'RIM', 500, 52000, 2],
            ['PO/PPB/26/XI/906', 1, 'PENDING', 'oil', 2, 'JRG', 20, 640000, 0],
            ['PO/PPB/26/XI/907', 2, 'RECEIVED', 'bolt', 2, 'PCK', 50, 75000, 2],
            ['PO/PPB/26/XI/908', 0, 'RECEIVED', 'glove', 12, 'PSG', 1, 15000, 12],
        ];
        $lines = [];
        foreach ($orders as [$number, $v, $status, $key, $qty, $u, $ratio, $price, $received]) {
            $total = $qty * $price;
            $id = $po($number, ['vendor_id' => $vendors[$v], 'status' => $status, 'subtotal' => $total, 'tax' => 0, 'total' => $total]);
            $lineStatus = $received >= $qty ? 'RECEIVED' : ($received > 0 ? 'PARTIAL_RECEIVED' : 'PENDING');
            $lines[$number] = $this->insert('purchase_order_items', ['purchase_order_id' => $id, 'item_id' => $i[$key]->id, 'vendor_id' => $vendors[$v], 'description_raw' => $i[$key]->description, 'qty' => $qty,
                'unit_id' => $unit($u) ?? $i[$key]->unit_id, 'unit_ratio' => $ratio, 'base_unit' => $ratio > 1 ? $i[$key]->unit->code : null, 'unit_price' => $price, 'line_total' => $total, 'qty_received' => $received, 'line_status' => $lineStatus]);
        }

        // seven receipts: [no, po, item, qty, unit, ratio, price, serials]
        $receipts = [
            ['RI/MANUAL/26/XI/901', 'PO/PPB/26/XI/904', 2, 'pump', 3, 'PCS', 1, 500000, 'PA-24071 ; PA-24072 ; PA-24073'],
            ['RI/MANUAL/26/XI/902', 'PO/PPB/26/XI/903', 1, 'cable', 1, 'ROL', 100, 1200000, null],
            ['RI/MANUAL/26/XI/903', 'PO/PPB/26/XI/903', 1, 'cable', 1, 'ROL', 100, 1200000, null],
            ['RI/MANUAL/26/XI/904', 'PO/PPB/26/XI/905', 0, 'paper', 1, 'RIM', 500, 52000, null],
            ['RI/MANUAL/26/XI/905', 'PO/PPB/26/XI/905', 0, 'paper', 1, 'RIM', 500, 52000, null],
            ['RI/MANUAL/26/XI/906', 'PO/PPB/26/XI/907', 2, 'bolt', 2, 'PCK', 50, 75000, null],
            ['RI/MANUAL/26/XI/907', 'PO/PPB/26/XI/908', 0, 'glove', 12, 'PSG', 1, 15000, null],
        ];
        $wh = Warehouse::query()->orderBy('id')->value('id');
        $ris = [];
        foreach ($receipts as $n => [$riNo, $poNo, $v, $key, $qty, $u, $ratio, $price, $serials]) {
            $item = $i[$key];
            $vendorName = DB::table('vendors')->where('id', $vendors[$v])->value('name');
            $ris[] = [$this->insert('ri', ['no_ri' => $riNo, 'tgl_ri' => now()->subDays(6 - $n)->toDateString(), 'divisi' => 'NA', 'sumber' => 'PO', 'vendor' => $vendorName, 'no_po' => $poNo, 'no_surat_jalan' => sprintf('SJ/%04d/XI', 1187 + $n * 113),
                'accurate_po_item_id' => $lines[$poNo], 'kode_barang' => $item->code, 'deskripsi_barang' => $item->description, 'kuantitas' => $qty, 'satuan' => $u, 'unit_ratio' => $ratio, 'base_satuan' => $ratio > 1 ? $item->unit->code : null,
                'harga_satuan' => $price, 'no_seri' => $serials, 'pemeriksa' => $this->staff->name, 'created_by' => $this->admin->id]), $riNo, $poNo, $vendors[$v], $vendorName, $item, $u, $price];
            if ($wh) {
                $ledger->record(['type' => 'RECEIVING', 'item_id' => $item->id, 'warehouse_id' => $wh, 'qty' => $qty * $ratio, 'note' => "RI {$riNo} · PO {$poNo}".($ratio > 1 ? " · 1 {$u} = {$ratio} {$item->unit->code}" : ''), 'created_by' => $this->admin->id]);
            }
        }

        // seven returns, one per receipt: made (not yet sent) or cancelled, so the stock stays as received
        $why = ['Unit datang dalam kondisi rusak', 'Isolasi kabel terkelupas', 'Panjang gulungan kurang', 'Kertas lembab', 'Kemasan sobek', 'Ulir baut cacat', 'Ukuran tidak sesuai'];
        foreach ($ris as $n => [$riId, $riNo, $poNo, $vendorId, $vendorName, $item, $u, $price]) {
            $status = $n >= 5 ? 'DIBATALKAN' : 'DIBUAT';
            $ret = $this->insert('purchase_returns', ['number' => sprintf('RTR/26/XI/9%02d', $n + 1), 'tgl_retur' => now()->toDateString(), 'no_ri' => $riNo, 'no_po' => $poNo, 'vendor' => $vendorName, 'vendor_id' => $vendorId,
                'resolution' => $n % 2 ? 'POTONG_TAGIHAN' : 'GANTI_BARANG', 'reason' => $why[$n], 'status' => $status, 'created_by' => $this->admin->id]);
            $this->insert('purchase_return_lines', ['purchase_return_id' => $ret, 'ri_id' => $riId, 'kode_barang' => $item->code, 'deskripsi_barang' => $item->description, 'qty' => 1, 'satuan' => $u, 'harga_satuan' => $price, 'ri_qty' => 1]);
        }
    }

    /** Seven Physical Inventories: four scheduled, three being counted. */
    private function physicalInventory(array $i): void
    {
        $wh = Warehouse::query()->orderBy('id')->value('id');
        $site = DB::table('sites')->value('id');
        if (! $wh || ! $site) {
            return;
        }
        $sets = [['pump', 'valve'], ['glove', 'filter'], ['oil', 'bolt'], ['paper', 'cable'], ['pump', 'glove'], ['valve', 'oil'], ['filter', 'bolt']];
        foreach ($sets as $n => $keys) {
            $id = $this->insert('stock_opnames', ['number' => sprintf('SO/26/XI/9%02d', $n + 1), 'warehouse_id' => $wh, 'site_id' => $site, 'scheduled_date' => now()->addDays($n + 1)->toDateString(), 'status' => $n < 4 ? 'SCHEDULED' : 'IN_PROGRESS', 'created_by' => $this->admin->id]);
            foreach ($keys as $key) {
                $this->insert('stock_opname_items', ['stock_opname_id' => $id, 'item_id' => $i[$key]->id, 'warehouse_id' => $wh, 'system_qty' => (float) DB::table('inventory')->where('item_id', $i[$key]->id)->sum('actual_qty')]);
            }
        }
    }

    private function importantRequests(): void
    {
        $rows = [['Susun jadwal physical inventory Desember', 'MEDIUM', 'DRAFT', 10], ['Rekap pemakaian ATK bulan ini', 'LOW', 'DITUGASKAN', 3], ['Cek stok spare part forklift', 'HIGH', 'DITUGASKAN', 1], ['Perbaiki data vendor yang ganda', 'URGENT', 'DITUGASKAN', 0],
            ['Laporan barang slow moving', 'MEDIUM', 'DIBATALKAN', 2], ['Evaluasi vendor kuartal ini', 'HIGH', 'DITUGASKAN', 5], ['Perbarui daftar harga vendor', 'MEDIUM', 'DITUGASKAN', 7]];
        foreach ($rows as $n => [$title, $priority, $status, $days]) {
            $id = $this->insert('important_requests', ['number' => sprintf('IMP/26/XI/9%02d', $n + 1), 'title' => $title, 'description' => "Mohon dikerjakan: {$title}.", 'category' => 'Operasional', 'priority' => $priority, 'deadline' => now()->addDays($days)->setTime(17, 0), 'requires_approval' => true, 'assignment_mode' => 'INDIVIDUAL', 'status' => $status,
                'created_by' => $this->admin->id, 'sent_at' => $status === 'DRAFT' ? null : now(), 'cancelled_at' => $status === 'DIBATALKAN' ? now() : null, 'cancel_reason' => $status === 'DIBATALKAN' ? 'Sudah tidak diperlukan.' : null, 'reminded_soon_at' => now(), 'reminded_overdue_at' => now()]);
            $this->insert('important_request_assignees', ['important_request_id' => $id, 'user_id' => $this->staff->id, 'status' => 'DITUGASKAN', 'progress' => 0]);
            $this->insert('important_request_activities', ['important_request_id' => $id, 'user_id' => $this->admin->id, 'action' => 'CREATED', 'created_at' => now()], false);
        }
    }

    /** Inactive: they show on the page and in the history, and pop up for nobody. */
    private function alerts(): void
    {
        $people = User::where('is_active', true)->orderBy('id')->limit(6)->pluck('id');
        $rows = [
            ['Fitur baru: nomor seri per unit di Receipt', "Nomor seri kini bisa diisi per unit:\n- Ketik atau scan\n- Export dan import Excel", 'feature'],
            ['Pemeliharaan server Sabtu malam', 'Aplikasi tidak bisa diakses pukul 22.00 sampai 23.00 WIB.', 'warning'],
            ['Pengingat pengisian Physical Inventory', 'Mohon selesaikan penghitungan sebelum tanggal 25.', 'info'],
            ['Fitur baru: Draft Price List', "Harga vendor kini dibuat lewat draft:\n- Pilih item dan vendor\n- Isi matrix harga\n- Set Harga ke Master Price List", 'feature'],
            ['Menu baru per aplikasi', 'Setiap aplikasi kini punya satu dashboard dan menu sesuai alur kerja.', 'info'],
            ['Batas pengajuan PR akhir bulan', 'Purchase Request bulan ini diajukan paling lambat tanggal 28.', 'warning'],
            ['Catatan per harga di Price Quotation', 'Klik ikon kertas di kotak harga untuk menulis catatan.', 'feature'],
        ];
        foreach ($rows as $n => [$title, $message, $type]) {
            $id = $this->insert('update_alerts', ['title' => $title, 'message' => $message, 'type' => $type, 'display_mode' => 'once', 'is_active' => false, 'created_by' => $this->admin->id]);
            foreach ($people->take(max(1, 6 - $n)) as $k => $user) {
                $this->insert('update_alert_views', ['update_alert_id' => $id, 'user_id' => $user, 'last_seen_at' => now()->subHours($k + 1), 'thumbed_up_at' => $k % 3 === 2 ? null : now()->subHours($k + 1)], false);
            }
        }
    }
}
