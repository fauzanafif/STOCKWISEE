<?php

namespace App\Console\Commands;

use App\Models\ItemRequest;
use App\Models\PpbDraft;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * 10 PPB drafts to look at and try, numbered DUMMY/PPB/... and written straight to the tables.
 *
 * The lines carry no item_id or kode_barang on purpose: a draft line tied to an item counts as "on order",
 * which would skew Safety Stock and the restock suggestions for real items.
 * Submitting one makes a real PPB row, which --remove does not delete.
 */
class DummyPpbDraftsCommand extends Command
{
    protected $signature = 'stockwise:dummy-ppb-drafts {--remove : Delete the dummy drafts instead of creating them}';

    protected $description = 'Create (or --remove) 10 dummy PPB drafts';

    private const PREFIX = 'DUMMY/PPB/';

    public function handle(): int
    {
        if ($this->option('remove')) {
            $removed = PpbDraft::where('number', 'like', self::PREFIX.'%')->delete(); // lines go with it (foreign key)
            $this->info("Removed {$removed} PPB drafts.");

            return self::SUCCESS;
        }
        if (PpbDraft::where('number', 'like', self::PREFIX.'%')->exists()) {
            $this->error('Dummy drafts already exist. Remove them first with --remove.');

            return self::FAILURE;
        }

        $creator = User::where('username', 'superadmin')->firstOrFail();

        // source, the dummy Item Request it came from, divisi, days ago, needed in days, lines
        $rows = [
            ['RESTOCK', null, 'GUDANG', 0, 14, [['Oli mesin 15W-40', 40, 'LTR', 'Di bawah safety stock'], ['Filter oli', 12, 'PCS', 'Di bawah safety stock']]],
            ['RESTOCK', null, 'GUDANG', 0, 10, [['Baut M12', 200, 'PCS', 'Stok habis']]],
            ['RESTOCK', null, 'GUDANG', 1, 14, [['Kawat las', 25, 'KG', 'Di bawah safety stock'], ['Plat besi 6 mm', 10, 'LBR', 'Di bawah safety stock']]],
            ['RESTOCK', null, 'GUDANG', 1, 21, [['Sarung tangan kerja', 48, 'PSG', 'Pemakaian naik']]],
            ['RESTOCK', null, 'GUDANG', 2, 7, [['Kampas rem forklift', 4, 'SET', 'Stok habis'], ['Tali pengikat 10 m', 20, 'PCS', 'Di bawah safety stock']]],
            ['RESTOCK', null, 'GUDANG', 3, 30, [['Terpal 4x6', 6, 'PCS', 'Di bawah safety stock']]],
            ['REQUEST', 'DUMMY/REQ/001', 'IT', 0, 5, [['Kertas A4 80gr', 10, 'RIM', 'Stok tidak cukup'], ['Tinta printer hitam', 2, 'PCS', 'Stok tidak cukup']]],
            ['REQUEST', 'DUMMY/REQ/002', 'IT', 1, 4, [['Map plastik', 25, 'PCS', 'Stok tidak cukup']]],
            ['REQUEST', 'DUMMY/REQ/003', 'MAINTENANCE', 1, 3, [['Filter oli genset', 2, 'PCS', 'Stok tidak cukup']]],
            ['REQUEST', 'DUMMY/REQ/004', 'MAINTENANCE', 2, 2, [['Kampas rem', 1, 'SET', 'Stok tidak cukup']]],
        ];

        DB::transaction(function () use ($rows, $creator) {
            foreach ($rows as $i => [$source, $requestNumber, $divisi, $daysAgo, $neededIn, $lines]) {
                $at = now()->subDays($daysAgo)->subMinutes(($i + 1) * 7);
                $draft = PpbDraft::create([
                    'number' => self::PREFIX.sprintf('%03d', $i + 1), 'status' => 'DRAFT', 'source' => $source,
                    'item_request_id' => $requestNumber ? ItemRequest::where('number', $requestNumber)->value('id') : null,
                    'divisi' => $divisi, 'tgl_diperlukan' => now()->addDays($neededIn)->toDateString(),
                    'peminta' => "DUMMY - {$creator->name}", 'keterangan' => 'DUMMY: contoh data, boleh dihapus.',
                    'created_by' => $creator->id, 'created_at' => $at, 'updated_at' => $at,
                ]);
                foreach ($lines as [$name, $qty, $unit, $basis]) {
                    $draft->lines()->create([
                        'deskripsi_barang' => "DUMMY - {$name}", 'qty' => $qty, 'satuan' => $unit,
                        'basis' => "DUMMY: {$basis}", 'created_at' => $at, 'updated_at' => $at,
                    ]);
                }
            }
        });
        $this->info('Created 10 PPB drafts (DUMMY/PPB/...).');

        return self::SUCCESS;
    }
}
