<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ImportantRequest;
use App\Models\PpbDraftLine;
use App\Services\PoDraftService;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * GET /api/module-stats/{module} — the basic analytics of a menu's Dashboard (Request Barang, PPB, PO, RI,
 * Important Request): a few key numbers, documents per day (14 days), the share per status, and the top
 * items / vendors / people. Days are counted in WIB.
 */
class ModuleStatsController extends Controller
{
    private const ACCESS = [
        'request' => ['item_request.view', 'item_request.create', 'item_request.process'],
        'ppb' => ['ppb.view', 'ppb.create'],
        'po' => ['po.view', 'po.create'],
        'ri' => ['ri.view'],
        'important' => ['important_request.access'],
    ];

    private const TZ = 'Asia/Jakarta';

    public function show(Request $request, string $module): JsonResponse
    {
        abort_unless(isset(self::ACCESS[$module]), 404);
        $user = $request->user();
        abort_unless(collect(self::ACCESS[$module])->contains(fn ($p) => $user->hasPermission($p)), 403);
        $today = CarbonImmutable::now(self::TZ)->startOfDay();

        return response()->json(['data' => $this->{$module}($request, $today)]);
    }

    /** 14 days up to today, each with its count (missing days = 0) */
    private function days(CarbonImmutable $today, Collection $countsByDate): array
    {
        return collect(range(13, 0))->map(function ($ago) use ($today, $countsByDate) {
            $d = $today->subDays($ago)->toDateString();

            return ['date' => $d, 'value' => (int) ($countsByDate[$d] ?? 0)];
        })->all();
    }

    /** timestamps (stored UTC) bucketed into WIB days */
    private function byWibDay(Collection $timestamps): Collection
    {
        return $timestamps->filter()->map(fn ($t) => CarbonImmutable::parse($t, 'UTC')->setTimezone(self::TZ)->toDateString())->countBy();
    }

    /** the UTC moment a WIB day starts */
    private function utc(CarbonImmutable $wib): string
    {
        return $wib->setTimezone('UTC')->toDateTimeString();
    }

    private function request(Request $request, CarbonImmutable $today): array
    {
        $month = $this->utc($today->startOfMonth());
        $q = fn () => DB::table('item_requests');
        $groups = [
            ['verify', 'Verifikasi', ['MENUNGGU', 'DIPROSES', 'PERLU_PERBAIKAN'], 'amber'],
            ['approval', 'Approval', ['APPROVAL_MANAGER', 'APPROVAL_DIREKTUR'], 'blue'],
            ['ready', 'Disiapkan gudang', ['DISIAPKAN', 'SIAP_DISERAHKAN'], 'violet'],
            ['waiting', 'Menunggu barang', ['DIPENUHI_SEBAGIAN', 'MENUNGGU_PENGADAAN', 'MENUNGGU_BARANG'], 'indigo'],
            ['done', 'Selesai', ['SELESAI'], 'emerald'],
            ['stopped', 'Ditolak / batal', ['DITOLAK', 'DIBATALKAN'], 'slate'],
        ];
        $byStatus = $q()->selectRaw('status, count(*) c')->groupBy('status')->pluck('c', 'status');
        $sum = fn (array $st) => (int) collect($st)->sum(fn ($s) => $byStatus[$s] ?? 0);
        $since = $this->utc($today->subDays(29));

        return [
            'kpis' => [
                ['key' => 'month', 'label' => 'Request bulan ini', 'value' => $q()->where('created_at', '>=', $month)->count(), 'to' => '/item-requests'],
                ['key' => 'verify', 'label' => 'Menunggu verifikasi', 'value' => $sum($groups[0][2]), 'tone' => 'amber', 'to' => '/item-requests'],
                ['key' => 'approval', 'label' => 'Dalam approval', 'value' => $sum($groups[1][2]), 'tone' => 'blue', 'to' => '/approvals'],
                ['key' => 'done', 'label' => 'Selesai bulan ini', 'value' => $q()->where('status', 'SELESAI')->where('updated_at', '>=', $month)->count(), 'tone' => 'emerald'],
            ],
            'trend' => ['label' => 'Request masuk per hari', 'points' => $this->days($today, $this->byWibDay($q()->where('created_at', '>=', $this->utc($today->subDays(13)))->pluck('created_at')))],
            'status' => array_map(fn ($g) => ['key' => $g[0], 'label' => $g[1], 'value' => $sum($g[2]), 'tone' => $g[3]], $groups),
            'top' => ['label' => 'Barang paling sering diminta (30 hari)', 'unit' => 'qty', 'rows' => DB::table('item_request_lines as l')
                ->join('item_requests as r', 'r.id', '=', 'l.item_request_id')->leftJoin('items as i', 'i.id', '=', 'l.item_id')
                ->where('r.created_at', '>=', $since)
                ->selectRaw('COALESCE(i.description, l.deskripsi_barang) as name, MAX(l.kode_barang) as sub, SUM(l.qty) as value')
                ->groupByRaw('COALESCE(i.description, l.deskripsi_barang)')->orderByDesc('value')->limit(5)->get()
                ->map(fn ($r) => ['name' => $r->name, 'sub' => $r->sub, 'value' => (float) $r->value])->all()],
        ];
    }

    private function ppb(Request $request, CarbonImmutable $today): array
    {
        $month = $today->startOfMonth()->toDateString();
        $q = fn () => DB::table('ppb')->where('is_amend', false);
        $since90 = $today->subDays(89)->toDateString();
        $byStatus = $q()->where('tgl_ppb', '>=', $since90)->selectRaw('line_status, count(*) c')->groupBy('line_status')->pluck('c', 'line_status');
        $labels = [['REQUESTED', 'Belum dipesan', 'amber'], ['SHORTAGE', 'Kurang', 'orange'], ['COMPLETED', 'Terpenuhi', 'emerald'], ['CLOSE', 'Ditutup', 'slate']];

        return [
            'kpis' => [
                ['key' => 'month', 'label' => 'PPB bulan ini', 'value' => $q()->where('tgl_ppb', '>=', $month)->distinct()->count('no_ppb'), 'to' => '/ppb'],
                ['key' => 'open', 'label' => 'Barang belum dipesan', 'value' => $q()->whereIn('line_status', ['REQUESTED', 'SHORTAGE'])->count(), 'tone' => 'amber', 'to' => '/ppb'],
                ['key' => 'draft', 'label' => 'Barang perlu PPB', 'value' => PpbDraftLine::whereNull('ppb_id')->whereHas('draft', fn ($d) => $d->where('status', 'DRAFT'))->count(), 'tone' => 'indigo', 'to' => '/ppb/drafts'],
                ['key' => 'ready_po', 'label' => 'Siap di-PO', 'value' => PoDraftService::waiting()->count(), 'tone' => 'emerald', 'to' => '/purchase-orders/draft'],
            ],
            'trend' => ['label' => 'PPB per hari', 'points' => $this->days($today, $q()->where('tgl_ppb', '>=', $today->subDays(13)->toDateString())
                ->selectRaw('tgl_ppb as d, COUNT(DISTINCT no_ppb) as c')->groupBy('tgl_ppb')->get()->mapWithKeys(fn ($r) => [substr((string) $r->d, 0, 10) => $r->c]))],
            'status' => array_map(fn ($l) => ['key' => strtolower($l[0]), 'label' => $l[1], 'value' => (int) ($byStatus[$l[0]] ?? 0), 'tone' => $l[2]], $labels),
            'status_label' => 'Baris PPB 90 hari',
            'top' => ['label' => 'Barang paling banyak di-PPB (30 hari)', 'unit' => 'qty', 'rows' => $q()->where('tgl_ppb', '>=', $today->subDays(29)->toDateString())
                ->selectRaw('MAX(deskripsi_barang) as name, kode_barang as sub, SUM(kuantitas) as value')->whereNotNull('kode_barang')
                ->groupBy('kode_barang')->orderByDesc('value')->limit(5)->get()
                ->map(fn ($r) => ['name' => $r->name, 'sub' => $r->sub, 'value' => (float) $r->value])->all()],
        ];
    }

    private function po(Request $request, CarbonImmutable $today): array
    {
        $month = $today->startOfMonth()->toDateString();
        $q = fn () => DB::table('purchase_orders')->where('status', '!=', 'CANCELLED')->where('status', '!=', 'MENUNGGU_PO');
        $since90 = $today->subDays(89)->toDateString();
        $byStatus = $q()->where('date', '>=', $since90)->selectRaw('status, count(*) c')->groupBy('status')->pluck('c', 'status');
        $labels = [['DRAFT', 'Menunggu approval', 'amber'], ['APPROVED', 'Disetujui', 'blue'], ['SENT', 'Dikirim', 'blue'], ['DIBELI', 'Sudah dibeli', 'indigo'],
            ['PARTIAL_RECEIVED', 'Diterima sebagian', 'violet'], ['RECEIVED', 'Diterima', 'emerald'], ['CLOSED', 'Ditutup', 'slate']];

        return [
            'kpis' => [
                ['key' => 'month', 'label' => 'PO bulan ini', 'value' => $q()->where('date', '>=', $month)->count(), 'to' => '/purchase-orders'],
                ['key' => 'value', 'label' => 'Nilai PO bulan ini', 'value' => (float) $q()->where('date', '>=', $month)->sum('total'), 'format' => 'rupiah', 'tone' => 'emerald'],
                ['key' => 'ready_po', 'label' => 'Barang siap di-PO', 'value' => PoDraftService::waiting()->count(), 'tone' => 'indigo', 'to' => '/purchase-orders/draft'],
                ['key' => 'open', 'label' => 'PO belum diterima penuh', 'value' => $q()->whereIn('status', ['APPROVED', 'SENT', 'DIBELI', 'PARTIAL_RECEIVED'])->count(), 'tone' => 'amber', 'to' => '/purchase-orders'],
            ],
            'trend' => ['label' => 'PO per hari', 'points' => $this->days($today, $q()->where('date', '>=', $today->subDays(13)->toDateString())
                ->selectRaw('date as d, COUNT(*) as c')->groupBy('date')->get()->mapWithKeys(fn ($r) => [substr((string) $r->d, 0, 10) => $r->c]))],
            'status' => array_values(array_filter(array_map(fn ($l) => ['key' => strtolower($l[0]), 'label' => $l[1], 'value' => (int) ($byStatus[$l[0]] ?? 0), 'tone' => $l[2]], $labels), fn ($x) => $x['value'] > 0 || in_array($x['key'], ['draft', 'received'], true))),
            'status_label' => 'PO 90 hari',
            'top' => ['label' => 'Vendor dengan nilai PO terbesar (30 hari)', 'unit' => 'rupiah', 'rows' => DB::table('purchase_orders as p')->join('vendors as v', 'v.id', '=', 'p.vendor_id')
                ->where('p.status', '!=', 'CANCELLED')->where('p.date', '>=', $today->subDays(29)->toDateString())
                ->selectRaw('v.name as name, COUNT(*) as n, SUM(p.total) as value')->groupBy('v.id', 'v.name')->orderByDesc('value')->limit(5)->get()
                ->map(fn ($r) => ['name' => $r->name, 'sub' => "{$r->n} PO", 'value' => (float) $r->value])->all()],
        ];
    }

    private function ri(Request $request, CarbonImmutable $today): array
    {
        $month = $today->startOfMonth()->toDateString();
        $q = fn () => DB::table('ri');
        $since30 = $today->subDays(29)->toDateString();

        return [
            'kpis' => [
                ['key' => 'month', 'label' => 'RI bulan ini', 'value' => $q()->where('tgl_ri', '>=', $month)->distinct()->count('no_ri'), 'to' => '/ri'],
                ['key' => 'lines', 'label' => 'Baris barang diterima bulan ini', 'value' => $q()->where('tgl_ri', '>=', $month)->count(), 'tone' => 'emerald'],
                ['key' => 'value', 'label' => 'Nilai diterima bulan ini', 'value' => (float) $q()->where('tgl_ri', '>=', $month)->sum(DB::raw('COALESCE(kuantitas, 0) * COALESCE(harga_satuan, 0)')), 'format' => 'rupiah', 'tone' => 'teal'],
                ['key' => 'waiting', 'label' => 'Menunggu diterima', 'value' => DB::table('purchase_order_items as i')->join('purchase_orders as p', 'p.id', '=', 'i.purchase_order_id')
                    ->whereNull('p.accurate_po_id')->whereIn('p.status', ['DIBELI', 'PARTIAL_RECEIVED'])->whereIn('i.line_status', ['PENDING', 'PARTIAL_RECEIVED'])->count(), 'tone' => 'amber', 'to' => '/ri'],
            ],
            'trend' => ['label' => 'RI per hari', 'points' => $this->days($today, $q()->where('tgl_ri', '>=', $today->subDays(13)->toDateString())
                ->selectRaw('tgl_ri as d, COUNT(DISTINCT no_ri) as c')->groupBy('tgl_ri')->get()->mapWithKeys(fn ($r) => [substr((string) $r->d, 0, 10) => $r->c]))],
            'status' => $q()->where('tgl_ri', '>=', $since30)->whereNotNull('divisi')->selectRaw('divisi, COUNT(*) as c')->groupBy('divisi')->orderByDesc('c')->limit(5)->get()
                ->values()->map(fn ($r, $i) => ['key' => 'd'.$i, 'label' => $r->divisi, 'value' => (int) $r->c, 'tone' => ['teal', 'blue', 'indigo', 'violet', 'slate'][$i] ?? 'slate'])->all(),
            'status_label' => 'Baris RI per divisi (30 hari)',
            'top' => ['label' => 'Barang paling banyak diterima (30 hari)', 'unit' => 'qty', 'rows' => $q()->where('tgl_ri', '>=', $since30)->whereNotNull('kode_barang')
                ->selectRaw('MAX(deskripsi_barang) as name, kode_barang as sub, SUM(kuantitas) as value')->groupBy('kode_barang')->orderByDesc('value')->limit(5)->get()
                ->map(fn ($r) => ['name' => $r->name, 'sub' => $r->sub, 'value' => (float) $r->value])->all()],
        ];
    }

    private function important(Request $request, CarbonImmutable $today): array
    {
        $user = $request->user();
        $q = fn () => ImportantRequest::query()->visibleTo($user)->where('status', '!=', 'DRAFT');
        $byStatus = $q()->selectRaw('status, count(*) c')->groupBy('status')->pluck('c', 'status');
        $labels = [['DITUGASKAN', 'Ditugaskan', 'blue'], ['MENUNGGU_REVIEW', 'Perlu ditinjau', 'amber'], ['SELESAI', 'Selesai', 'emerald'], ['DIBATALKAN', 'Dibatalkan', 'slate']];
        $open = $q()->whereNotIn('status', ImportantRequest::CLOSED)->pluck('id');

        return [
            'kpis' => [
                ['key' => 'active', 'label' => 'Tugas aktif', 'value' => $open->count(), 'to' => '/important-requests/tugas'],
                ['key' => 'late', 'label' => 'Terlambat', 'value' => $q()->overdue()->count(), 'tone' => 'red'],
                ['key' => 'review', 'label' => 'Perlu ditinjau', 'value' => (int) ($byStatus['MENUNGGU_REVIEW'] ?? 0), 'tone' => 'amber'],
                ['key' => 'done', 'label' => 'Selesai bulan ini', 'value' => $q()->where('status', 'SELESAI')->where('completed_at', '>=', $this->utc($today->startOfMonth()))->count(), 'tone' => 'emerald'],
            ],
            'trend' => ['label' => 'Tugas diberikan per hari', 'points' => $this->days($today, $this->byWibDay($q()->where('created_at', '>=', $this->utc($today->subDays(13)))->pluck('created_at')))],
            'status' => array_map(fn ($l) => ['key' => strtolower($l[0]), 'label' => $l[1], 'value' => (int) ($byStatus[$l[0]] ?? 0), 'tone' => $l[2]], $labels),
            'top' => ['label' => 'Penerima dengan tugas aktif terbanyak', 'unit' => 'tugas', 'rows' => DB::table('important_request_assignees as a')->join('users as u', 'u.id', '=', 'a.user_id')
                ->whereIn('a.important_request_id', $open)->whereIn('a.status', ['DITUGASKAN', 'REVISI'])
                ->selectRaw('u.name as name, COUNT(*) as value')->groupBy('u.id', 'u.name')->orderByDesc('value')->limit(5)->get()
                ->map(fn ($r) => ['name' => $r->name, 'sub' => null, 'value' => (int) $r->value])->all()],
        ];
    }
}
