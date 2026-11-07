<?php

namespace App\Console\Commands;

use App\Models\ImportantRequest;
use App\Models\ImportantRequestActivity;
use App\Models\ImportantRequestSubmission;
use App\Models\Item;
use App\Models\ItemRequest;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * 10 Item Requests and 10 Important Requests to look at and try, numbered DUMMY/... (real document
 * numbers stay untouched) and written straight to the tables, so no notification goes out.
 *
 * Item Requests stop before approval: approving one past the Direktur allocates real stock.
 * Important Requests go from the Super Admin account to the "fauzan" account only.
 */
class DummyRequestsCommand extends Command
{
    protected $signature = 'stockwise:dummy-requests {--remove : Delete the dummy data instead of creating it}';

    protected $description = 'Create (or --remove) 10 dummy Item Requests and 10 dummy Important Requests';

    private const PREFIX = 'DUMMY/';

    public function handle(): int
    {
        if ($this->option('remove')) {
            return $this->remove();
        }
        if (ItemRequest::where('number', 'like', self::PREFIX.'%')->exists() || ImportantRequest::where('number', 'like', self::PREFIX.'%')->exists()) {
            $this->error('Dummy data already exists. Remove it first with --remove.');

            return self::FAILURE;
        }

        $creator = User::where('username', 'superadmin')->firstOrFail();
        $assignee = User::where('username', 'fauzan')->firstOrFail();
        $item = Item::with('unit:id,code')->where('is_active', true)->whereNotNull('code')->orderBy('id')->firstOrFail();

        DB::transaction(function () use ($creator, $assignee, $item) {
            $this->itemRequests($assignee, $creator, $item);
            $this->importantRequests($creator, $assignee);
        });
        $this->info('Created 10 Item Requests and 10 Important Requests (DUMMY/...).');

        return self::SUCCESS;
    }

    private function remove(): int
    {
        DB::transaction(function () use (&$items, &$important) {
            // lines, assignees, submissions and activities go with their request (foreign keys)
            $items = ItemRequest::where('number', 'like', self::PREFIX.'%')->delete();
            $important = ImportantRequest::where('number', 'like', self::PREFIX.'%')->delete();
        });
        $this->info("Removed {$items} Item Requests and {$important} Important Requests.");

        return self::SUCCESS;
    }

    private function itemRequests(User $requester, User $admin, Item $item): void
    {
        $rows = [
            ['ATK', null, 'MENUNGGU', 0, null, [['Kertas A4 80gr', 10, 'RIM'], ['Tinta printer hitam', 2, 'PCS']]],
            ['ATK', null, 'MENUNGGU', 1, 'URGENT', [['Map plastik', 25, 'PCS']]],
            ['MAINTENANCE', 'Genset gudang utama', 'MENUNGGU', 1, null, [['Filter oli', 2, 'PCS'], ['Oli mesin 15W-40', 8, 'LTR']]],
            ['MAINTENANCE', 'Forklift 02', 'MENUNGGU', 2, 'URGENT', [['Kampas rem', 1, 'SET']]],
            ['DISTRIBUSI', 'Armada Balikpapan', 'MENUNGGU', 3, null, [['Tali pengikat 10 m', 6, 'PCS'], ['Terpal 4x6', 2, 'PCS']]],
            ['MANUFAKTUR', 'Proyek rangka trailer', 'DIPROSES', 2, 'NORMAL', [['Plat besi 6 mm', 4, 'LBR'], ['Kawat las', 5, 'KG']]],
            ['UMUM', null, 'PERLU_PERBAIKAN', 4, null, [['Sarung tangan kerja', 12, 'PSG']]],
            ['MANUFAKTUR', 'Assembly dudukan mesin', 'PERLU_PERBAIKAN', 5, 'NORMAL', [['Baut M12', 40, 'PCS'], ['Mur M12', 40, 'PCS']]],
            ['UMUM', null, 'DITOLAK', 6, null, [['Kursi kantor', 3, 'PCS']]],
            ['ATK', null, 'DIBATALKAN', 7, null, [['Spidol papan tulis', 6, 'PCS']]],
        ];

        foreach ($rows as $i => [$form, $detail, $status, $daysAgo, $urgency, $lines]) {
            $at = now()->subDays($daysAgo)->subMinutes(($i + 1) * 7);
            $request = ItemRequest::create([
                'number' => self::PREFIX.sprintf('REQ/%03d', $i + 1), 'track_token' => Str::random(32), 'source' => 'APP',
                'form_type' => $form, 'form_detail' => $detail, 'urgency' => $urgency,
                'requester_id' => $requester->id, 'requester_name' => $requester->name,
                'divisi' => $form === 'ATK' || $form === 'UMUM' ? 'IT' : $form,
                'needed_date' => now()->addDays(7 - $i)->toDateString(),
                'note' => 'DUMMY: contoh data, boleh dihapus.', 'status' => $status,
                'verify_note' => $status === 'PERLU_PERBAIKAN' ? 'DUMMY: dikembalikan untuk diperbaiki.' : null,
                'created_at' => $at, 'updated_at' => $at,
            ]);
            foreach ($lines as $l => [$name, $qty, $unit]) {
                $rejected = $status === 'DITOLAK';
                $matched = $status === 'DIPROSES' && $l === 0;
                $request->lines()->create([
                    'item_id' => $matched ? $item->id : null,
                    'kode_barang' => $matched ? $item->code : null,
                    'deskripsi_barang' => $matched ? $item->description : "DUMMY - {$name}",
                    'deskripsi_peminta' => "DUMMY - {$name}",
                    'qty' => $qty, 'satuan' => $matched ? ($item->unit?->code ?? $unit) : $unit,
                    'decision' => $rejected ? 'TOLAK' : ($matched ? 'NPBG' : null),
                    'approved_qty' => $matched ? $qty : null,
                    'reject_reason' => $rejected ? 'DUMMY: tidak disetujui.' : null,
                    'decided_by' => $rejected || $matched ? $admin->id : null,
                    'decided_at' => $rejected || $matched ? $at : null,
                ]);
            }
        }
    }

    private function importantRequests(User $creator, User $assignee): void
    {
        // title, priority, status, the recipient's status, sent days ago, deadline in days
        $rows = [
            ['Susun jadwal stock opname Desember', 'MEDIUM', 'DRAFT', 'DITUGASKAN', null, 10],
            ['Rekap pemakaian ATK bulan ini', 'LOW', 'DITUGASKAN', 'DITUGASKAN', 0, 3],
            ['Cek stok spare part forklift', 'MEDIUM', 'DITUGASKAN', 'DITUGASKAN', 1, 2],
            ['Laporan barang slow moving', 'HIGH', 'DITUGASKAN', 'DITUGASKAN', 1, 1],
            ['Perbaiki data vendor yang ganda', 'URGENT', 'DITUGASKAN', 'DITUGASKAN', 0, 0],
            ['Verifikasi saldo gudang Balikpapan', 'HIGH', 'DITUGASKAN', 'DITUGASKAN', 4, -1],
            ['Foto kondisi rak gudang utama', 'MEDIUM', 'MENUNGGU_REVIEW', 'DISERAHKAN', 3, 2],
            ['Daftar barang tanpa kode kategori', 'HIGH', 'MENUNGGU_REVIEW', 'DISERAHKAN_TERLAMBAT', 5, -1],
            ['Dokumentasi alur Request Barang', 'LOW', 'SELESAI', 'SELESAI', 7, -3],
            ['Survey harga oli mesin', 'MEDIUM', 'DIBATALKAN', 'DITUGASKAN', 6, 1],
        ];

        foreach ($rows as $i => [$title, $priority, $status, $part, $sentAgo, $deadline]) {
            $sent = $sentAgo === null ? null : now()->subDays($sentAgo)->subMinutes(($i + 1) * 5);
            $at = $sent ?? now();
            $done = $status === 'SELESAI';
            $request = ImportantRequest::create([
                'number' => self::PREFIX.sprintf('IMP/%03d', $i + 1), 'title' => "DUMMY - {$title}",
                'description' => "DUMMY: contoh instruksi kerja untuk \"{$title}\". Boleh dihapus.",
                'category' => 'Dummy', 'priority' => $priority, 'deadline' => now()->addDays($deadline)->setTime(17, 0),
                'requires_approval' => true, 'assignment_mode' => 'INDIVIDUAL', 'status' => $status, 'created_by' => $creator->id,
                'sent_at' => $sent, 'completed_at' => $done ? now()->subDays(4) : null,
                'cancelled_at' => $status === 'DIBATALKAN' ? now()->subDays(5) : null,
                'cancel_reason' => $status === 'DIBATALKAN' ? 'DUMMY: tidak jadi dikerjakan.' : null,
                // already "reminded", so the deadline reminders stay quiet about these
                'reminded_soon_at' => now(), 'reminded_overdue_at' => now(),
                'created_at' => $at, 'updated_at' => $at,
            ]);
            $handedIn = in_array($part, ['DISERAHKAN', 'DISERAHKAN_TERLAMBAT', 'SELESAI'], true);
            $assigned = $request->assignees()->create([
                'user_id' => $assignee->id, 'status' => $part, 'progress' => $handedIn ? 100 : 0,
                'submitted_at' => $handedIn ? now()->subDay() : null, 'completed_at' => $done ? now()->subDays(4) : null,
            ]);
            if ($handedIn) {
                ImportantRequestSubmission::create([
                    'important_request_id' => $request->id, 'assignee_id' => $assigned->id, 'user_id' => $assignee->id, 'round' => 1,
                    'note' => 'DUMMY: contoh hasil pekerjaan.', 'status' => $done ? 'DISETUJUI' : 'MENUNGGU_REVIEW',
                    'reviewed_by' => $done ? $creator->id : null, 'reviewed_at' => $done ? now()->subDays(4) : null,
                ]);
            }
            ImportantRequestActivity::create(['important_request_id' => $request->id, 'user_id' => $creator->id, 'action' => 'CREATED', 'meta' => ['assignees' => [$assignee->name]], 'created_at' => $at]);
        }
    }
}
