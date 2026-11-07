import { useEffect, useRef } from 'react'
import { DateRangeFilter } from '@/components/DateRangeFilter'
import { Link, useSearchParams } from 'react-router-dom'
import { FileStack } from 'lucide-react'
import { lokasiText, useNpbgKlasifikasi, useNpbgList } from '@/features/npbg/api'
import { Select } from '@/components/ui/select'
import { ExportBar } from '@/components/export/ExportBar'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/DataTable'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import type { Npbg } from '@/features/npbg/api'
import { useInfiniteRows } from '@/components/InfiniteRows'
import { useRemembered } from '@/lib/listMemory'
import { KembaliBekasLabel } from '@/components/KembaliBekasToggle'
import { FilterBar } from '@/components/FilterBar'
import { ColumnMenu, useHiddenColumns, visibleColumns } from '@/components/ColumnVisibility'

const VERIFICATION_LABEL: Record<string, string> = {
  DIAJUKAN: 'Submitted', DIPROSES: 'In process', ALTERNATIF_DITAWARKAN: 'Alternative Offered',
  MENUNGGU_RESPON: 'Waiting for Response', PERLU_VERIFIKASI_BOS: 'Needs BOSS Verification',
  DISETUJUI: 'Approved', DITOLAK: 'Rejected', SELESAI: 'Done',
}

function fmtDate(v: string | null) {
  return v ? new Date(v).toLocaleDateString('en-GB') : '—'
}

const columns: Column<Npbg>[] = [
  {
    key: 'no_npbg',
    header: 'Delivery Order No',
    cell: (r) => (
      <span className="inline-flex items-center gap-1.5">
        <Link to={`/npbg/${r.id}`} className="text-[13px] text-primary hover:underline">
          {r.no_npbg ?? '—'}
        </Link>
        {r.is_manual && <Badge variant="neutral">Manual</Badge>}
      </span>
    ),
  },
  { key: 'tgl', header: 'Delivery Order Date', cell: (r) => <span className="whitespace-nowrap">{fmtDate(r.tgl_npbg)}</span> },
  {
    key: 'tipe',
    header: 'Delivery Order Type',
    cell: (r) => r.tipe_npbg
      ? <Badge variant={r.tipe_npbg === 'Penjualan' ? 'default' : 'neutral'} className="whitespace-nowrap">{r.tipe_npbg}</Badge>
      : <span className="text-muted-foreground">—</span>,
  },
  { key: 'kode', header: 'Item Code', cell: (r) => <span className="whitespace-nowrap text-[13px]">{r.kode_barang ?? '—'}</span> },
  {
    key: 'barang',
    header: 'Item Description',
    className: 'max-w-[260px]',
    cell: (r) => (
      <span className="block truncate" title={r.deskripsi_barang ?? undefined}>
        {r.deskripsi_barang ?? '—'}
      </span>
    ),
  },
  {
    key: 'qty',
    header: 'Quantity',
    cell: (r) => <span className="whitespace-nowrap">{r.kuantitas != null ? `${r.kuantitas} ${r.satuan ?? ''}` : '—'}</span>,
  },
  {
    key: 'kembali_bekas',
    header: 'Return Used',
    cell: (r) => <span className="whitespace-nowrap"><KembaliBekasLabel npbg={r} /></span>,
  },
  {
    key: 'keterangan',
    header: 'Remarks',
    className: 'max-w-[220px]',
    cell: (r) => (
      <span className="block truncate" title={r.keterangan ?? undefined}>
        {r.keterangan ?? '—'}
      </span>
    ),
  },
    { key: 'peminta', header: 'Requester', cell: (r) => <span className="whitespace-nowrap">{r.peminta ?? '—'}</span> },
    { key: 'divisi', header: 'Division', cell: (r) => <span className="whitespace-nowrap">{r.divisi ?? '—'}</span> },
    { key: 'lokasi', header: 'Location', cell: (r) => <span className="whitespace-nowrap">{lokasiText(r) ?? '—'}</span> },
  {
    key: 'pelanggan',
    header: 'Customer',
    className: 'max-w-[200px]',
    cell: (r) => (
      <span className="block truncate" title={r.pelanggan ?? undefined}>
        {r.pelanggan ?? '—'}
      </span>
    ),
  },
  { key: 'klasifikasi', header: 'Classification', cell: (r) => <span className="whitespace-nowrap">{r.klasifikasi ?? '—'}</span> },
  {
    key: 'klarifikasi',
    header: 'Clarification',
    cell: (r) =>
      r.latest_verification_status ? (
        <Badge variant={r.latest_verification_status === 'SELESAI' ? 'success' : 'warning'}>
          {VERIFICATION_LABEL[r.latest_verification_status] ?? r.latest_verification_status}
        </Badge>
      ) : (
        '—'
      ),
  },
]

export function NpbgListPage() {
  // ?search=<no. dokumen> — opened from a document link elsewhere (DocLink)
  const [params] = useSearchParams()
  const urlSearch = params.get('search') ?? ''
  const [search, setSearch] = useRemembered('npbg', 'search', urlSearch)
  // ?date_from= / ?date_to= — e.g. from the stock opname NPBG / PPB columns
  const urlFrom = params.get('date_from') ?? ''
  const urlTo = params.get('date_to') ?? ''
  const [dateFrom, setDateFrom] = useRemembered('npbg', 'dateFrom', urlFrom)
  const [dateTo, setDateTo] = useRemembered('npbg', 'dateTo', urlTo)
  const [klasifikasi, setKlasifikasi] = useRemembered('npbg', 'klasifikasi', '')
  const [tipe, setTipe] = useRemembered('npbg', 'tipe', '')
  const [kembaliBekas, setKembaliBekas] = useRemembered('npbg', 'kembaliBekas', '')
  const klasifikasiOptions = useNpbgKlasifikasi()
  const [page, setPage] = useRemembered('npbg', 'page', 1)
  // first render: the state above already starts from the URL (or is restored after Back);
  // only later URL changes (a document link opened while here) reset the filters
  const lastUrl = useRef([urlSearch, urlFrom, urlTo].join('|'))
  useEffect(() => {
    const now = [urlSearch, urlFrom, urlTo].join('|')
    if (now === lastUrl.current) return
    lastUrl.current = now
    setSearch(urlSearch)
    setDateFrom(urlFrom)
    setDateTo(urlTo)
    setPage(1)
  }, [urlSearch, urlFrom, urlTo])
  const activeFilters = {
    search: search || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    tipe_npbg: tipe || undefined,
    klasifikasi: klasifikasi || undefined,
    kembali_bekas: kembaliBekas || undefined,
  }
  const { data, isLoading } = useNpbgList({ ...activeFilters, page })
  // scroll to the end instead of Sebelumnya/Berikutnya (pages appended while scrolling)
  const { rows: scrollRows, footer: scrollFooter } = useInfiniteRows(data, page, setPage, 'npbg')
  const [hiddenCols, toggleCol] = useHiddenColumns('stockwise:npbg-hidden-columns')
  const shownColumns = visibleColumns(columns, hiddenCols, ['no_npbg'])


  return (
    <div className="space-y-4">
      <PageHeader
        title="Delivery Order"
        subtitle="Warehouse goods issue note (items out)"
        icon={<FileStack className="size-5" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ExportBar dataset="npbg" filters={activeFilters} filenameBase="npbg" viewPermission="report.npbg" />
          </div>
        }
      />


      <FilterBar end={<ColumnMenu columns={columns} hiddenCols={hiddenCols} onToggle={toggleCol} alwaysVisible={['no_npbg']} hint="Select the columns shown in the table." />}>
        <Input
          placeholder="Search Delivery Order no., item code, description, remarks, requester, division, customer, rack, serial no…"
          className="max-w-sm"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
        />
        <DateRangeFilter className="lg:w-72" from={dateFrom} to={dateTo} onFrom={(v) => { setDateFrom(v); setPage(1) }} onTo={(v) => { setDateTo(v); setPage(1) }} />
        <div>
          <Select aria-label="Delivery Order Type" title="Delivery Order Type" value={tipe} onChange={(e) => { setTipe(e.target.value); setPage(1) }} className="w-44">
            <option value="">All types</option>
            <option value="Penjualan">Penjualan</option>
            <option value="Non Penjualan">Non Penjualan</option>
          </Select>
        </div>
        <div>
          <Select aria-label="Classification" title="Classification" value={klasifikasi} onChange={(e) => { setKlasifikasi(e.target.value); setPage(1) }} className="w-56">
            <option value="">All classifications</option>
            {(klasifikasiOptions.data ?? []).map((j) => <option key={j} value={j}>{j}</option>)}
          </Select>
        </div>
        <div>
          <Select aria-label="Used item returned" title="Used item returned" value={kembaliBekas} onChange={(e) => { setKembaliBekas(e.target.value); setPage(1) }} className="w-52">
            <option value="">Return used: all</option>
            <option value="1">Ticked</option>
            <option value="0">Unticked</option>
          </Select>
        </div>
      </FilterBar>

      <DataTable columns={shownColumns} rows={scrollRows} scrollMemoryKey="npbg"
        footer={scrollFooter} notes={{ entity: 'npbg' }} rowKey={(r) => r.id} isLoading={isLoading}
 emptyText="No Delivery Order data yet; run Accurate Sync." />

    </div>
  )
}
