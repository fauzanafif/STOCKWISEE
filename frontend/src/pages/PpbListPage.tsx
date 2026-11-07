import { useEffect, useRef, useState } from 'react'
import { DateRangeFilter } from '@/components/DateRangeFilter'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { FileStack, Plus, X } from 'lucide-react'
import { PPB_LINE_STATUS, ppbDivisi, usePpbDivisiOptions, usePpbList, usePpbVendorOptions, type Ppb } from '@/features/ppb/api'
import { useAuth } from '@/auth/AuthContext'
import { PpbStatusBadges } from '@/components/PpbStatusBadges'
import { PpbApprovalBadge } from '@/components/PpbApproval'
import { PpbFormModal } from '@/components/PpbFormModal'
import { ExportBar } from '@/components/export/ExportBar'
import { PageHeader } from '@/components/PageHeader'
import { ColumnMenu, useHiddenColumns, visibleColumns } from '@/components/ColumnVisibility'
import { DataTable, type Column } from '@/components/DataTable'
import { DocCell, DocText } from '@/components/DocLink'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useInfiniteRows } from '@/components/InfiniteRows'
import { useRemembered } from '@/lib/listMemory'
import { FilterBar } from '@/components/FilterBar'
import { QtyProgress } from '@/components/QtyProgress'

function fmtDate(v: string | null | undefined) {
  return v ? new Date(v).toLocaleDateString('en-GB') : '—'
}

const ALWAYS_VISIBLE = ['no_ppb']

/** Diterima vs diminta sebagai bar kecil — lebih cepat dibaca sekilas daripada "12/20". */

/** Nomor + tanggal dipasangkan satu sel, dan Keterangan + Catatan Baris digabung satu kolom — tabel tetap ringkas tanpa kehilangan data. */
const columns: Column<Ppb>[] = [
  {
    key: 'no_ppb',
    header: 'Purchase Request No',
    cell: (r) => (
      <DocCell date={fmtDate(r.tgl_ppb)}>
        <span className="inline-flex items-center gap-1.5">
          <Link to={`/ppb/${r.id}`} onClick={(e) => e.stopPropagation()} className="text-[13px] font-medium text-primary hover:underline">
            {r.no_ppb ?? '—'}
          </Link>
          {r.is_manual && <Badge variant="neutral">Manual</Badge>}
        </span>
      </DocCell>
    ),
  },
  { key: 'status', header: 'Status', cell: (r) => <PpbStatusBadges ppb={r} /> },
  { key: 'approval', header: 'Approval', cell: (r) => <span className="whitespace-nowrap"><PpbApprovalBadge approval={r.approval} /></span> },
  { key: 'divisi', header: 'Division', cell: (r) => <span className="whitespace-nowrap">{ppbDivisi(r.divisi) ?? '—'}</span> },
  { key: 'kode', header: 'Item Code', cell: (r) => <span className="whitespace-nowrap text-[13px]">{r.kode_barang ?? '—'}</span> },
  {
    key: 'barang',
    header: 'Item Description',
    className: 'max-w-[260px]',
    cell: (r) => <span className="block truncate" title={r.deskripsi_barang ?? undefined}>{r.deskripsi_barang ?? '—'}</span>,
  },
  {
    key: 'qty',
    header: 'Quantity',
    className: 'text-right',
    cell: (r) => <span className="whitespace-nowrap tabular-nums">{r.kuantitas != null ? `${r.kuantitas} ${r.satuan ?? ''}` : '—'}</span>,
  },
  // asked / received by RI so far: a partial delivery reads "10/5"
  { key: 'diterima', header: 'Requested/Received (Receipt)', cell: (r) => <QtyProgress total={r.kuantitas} done={r.qty_diterima ?? 0} unit={r.satuan} /> },
  { key: 'peminta', header: 'Requester', cell: (r) => <span className="whitespace-nowrap">{r.peminta ?? '—'}</span> },
  // Rantai dokumen PPB -> PO -> RI, dikelompokkan sebagai dua sel (bukan empat
  // kolom) agar alur pembelian tetap terbaca tanpa membuat tabel melebar.
  {
    key: 'vendor',
    header: 'Vendor',
    className: 'max-w-[220px]',
    cell: (r) => r.vendor
      ? <span className="block truncate" title={r.vendor}>{r.vendor}</span>
      : <span className="whitespace-nowrap text-xs text-muted-foreground">{r.po_no ? '' : 'No PO yet'}</span>,
  },
  { key: 'po', header: 'PO', cell: (r) => <DocCell date={fmtDate(r.po_date)}><DocText text={r.po_no} className="text-[13px]" /></DocCell> },
  { key: 'ri', header: 'Receipt', cell: (r) => <DocCell date={fmtDate(r.ri_date)}><DocText text={r.ri_no} className="text-[13px]" /></DocCell> },
  {
    key: 'catatan',
    header: 'Notes',
    className: 'max-w-[220px]',
    cell: (r) => (
      <div className="leading-tight">
        <div className="truncate" title={r.keterangan ?? undefined}>{r.keterangan ?? '—'}</div>
        {r.catatan_baris && r.catatan_baris !== r.keterangan && (
          <div className="truncate text-xs text-muted-foreground" title={r.catatan_baris}>{r.catatan_baris}</div>
        )}
      </div>
    ),
  },
]

export function PpbListPage() {
  const navigate = useNavigate()
  const { hasPermission } = useAuth()
  const [formOpen, setFormOpen] = useState(false)
  // ?search=<no. dokumen> — opened from a document link elsewhere (DocLink)
  const [params] = useSearchParams()
  const urlSearch = params.get('search') ?? ''
  const [search, setSearch] = useRemembered('ppb', 'search', urlSearch)
  const [lineStatus, setLineStatus] = useRemembered('ppb', 'lineStatus', '')
  const [divisi, setDivisi] = useRemembered('ppb', 'divisi', '')
  const [vendorId, setVendorId] = useRemembered('ppb', 'vendorId', '')
  // ?approval=MENUNGGU — opened from an approval notification
  const urlApproval = params.get('approval') ?? ''
  const [approval, setApproval] = useRemembered('ppb', 'approval', urlApproval)
  // ?date_from= / ?date_to= — e.g. from the stock opname NPBG / PPB columns
  const urlFrom = params.get('date_from') ?? ''
  const urlTo = params.get('date_to') ?? ''
  const [dateFrom, setDateFrom] = useRemembered('ppb', 'dateFrom', urlFrom)
  const [dateTo, setDateTo] = useRemembered('ppb', 'dateTo', urlTo)
  const [page, setPage] = useRemembered('ppb', 'page', 1)
  // first render: the state above already starts from the URL (or is restored after Back);
  // only later URL changes (a document link opened while here) reset the filters
  const lastUrl = useRef([urlSearch, urlFrom, urlTo, urlApproval].join('|'))
  useEffect(() => {
    const now = [urlSearch, urlFrom, urlTo, urlApproval].join('|')
    if (now === lastUrl.current) return
    lastUrl.current = now
    setSearch(urlSearch)
    setDateFrom(urlFrom)
    setDateTo(urlTo)
    setApproval(urlApproval)
    setPage(1)
  }, [urlSearch, urlFrom, urlTo, urlApproval])
  const activeFilters = {
    search: search || undefined,
    line_status: lineStatus || undefined,
    divisi: divisi || undefined,
    vendor_id: vendorId || undefined,
    approval: approval || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
  }
  const { data, isLoading } = usePpbList({ ...activeFilters, page })
  // approvers: PPB lines still waiting for them — sent along with the list (no extra request)
  const { data: divisiOptions } = usePpbDivisiOptions()
  const { data: vendorOptions } = usePpbVendorOptions()
  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setPage(1) }
  const hasFilters = !!(search || lineStatus || divisi || vendorId || approval || dateFrom || dateTo)
  const clearFilters = () => { setSearch(''); setLineStatus(''); setDivisi(''); setVendorId(''); setApproval(''); setDateFrom(''); setDateTo(''); setPage(1) }
  // scroll to the end instead of Sebelumnya/Berikutnya (pages appended while scrolling)
  const { rows: scrollRows, footer: scrollFooter } = useInfiniteRows(data, page, setPage, 'ppb')

  const [hiddenCols, toggleCol] = useHiddenColumns('stockwise:ppb-hidden-columns')
  const shownColumns = visibleColumns(columns, hiddenCols, ALWAYS_VISIBLE)
  const visibleKeys = shownColumns.map((c) => c.key).join(',')

  return (
    <div className="space-y-4">
      <PageHeader
        title="Purchase Request"
        subtitle="Purchase requests"
        icon={<FileStack className="size-5" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ExportBar dataset="ppb" filters={activeFilters} filenameBase="ppb" viewPermission="report.ppb" columns={visibleKeys} />
            {hasPermission('ppb.create') && (
              <Button size="sm" onClick={() => setFormOpen(true)}>
                <Plus className="size-4" />
                Add Purchase Request
              </Button>
            )}
          </div>
        }
      />

      <FilterBar className="grid gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end" end={<>
        {data && <span className="text-xs text-muted-foreground">{data.meta.total.toLocaleString('id-ID')} Purchase Request</span>}
        <ColumnMenu columns={columns} hiddenCols={hiddenCols} onToggle={toggleCol} alwaysVisible={ALWAYS_VISIBLE} />
      </>}>
        <div className="sm:col-span-2 lg:w-72">
          <Input
            placeholder="Search Purchase Request no., item, requester, vendor, notes, PO/Receipt no…"
            title="Several words at once; every word must match, in any column"
            value={search}
            onChange={(e) => resetPage(setSearch)(e.target.value)}
          />
        </div>
        <div className="lg:w-48">
          <Select value={lineStatus} onChange={(e) => resetPage(setLineStatus)(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {Object.entries(PPB_LINE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            <option value="AMEND">Amend (status apa pun)</option>
          </Select>
        </div>
        <div className="lg:w-44">
          <Select value={divisi} onChange={(e) => resetPage(setDivisi)(e.target.value)} aria-label="Division">
            <option value="">All divisions</option>
            {divisiOptions?.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
        </div>
        <div className="lg:w-60">
          <Select value={vendorId} onChange={(e) => resetPage(setVendorId)(e.target.value)} aria-label="Vendor" title="Vendor of the PO made for this Purchase Request; select &quot;No PO yet&quot; for a Purchase Request without a PO">
            <option value="">All vendors</option>
            <option value="none">No PO yet</option>
            {vendorOptions?.map((v) => <option key={v.id} value={String(v.id)}>{v.name}</option>)}
          </Select>
        </div>
        <div className="lg:w-52">
          <Select value={approval} onChange={(e) => resetPage(setApproval)(e.target.value)} aria-label="Approval">
            <option value="">All approvals</option>
            <option value="MENUNGGU">Waiting for approval</option>
            <option value="MENUNGGU_DIREKTUR">Waiting for Director</option>
            <option value="DISETUJUI">Approved</option>
            <option value="DITOLAK">Rejected</option>
            <option value="PO_TANPA_APPROVAL">PO without approval</option>
          </Select>
        </div>
        <DateRangeFilter className="lg:w-72" from={dateFrom} to={dateTo} onFrom={resetPage(setDateFrom)} onTo={resetPage(setDateTo)} />
        {hasFilters && (
          <Button variant="ghost" size="sm" className="h-9" onClick={clearFilters}>
            <X className="size-4" /> Reset filter
          </Button>
        )}
      </FilterBar>


      <DataTable
        columns={shownColumns}
        rows={scrollRows} scrollMemoryKey="ppb"
        footer={scrollFooter}
        notes={{ entity: 'ppb' }}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        onRowClick={(r) => navigate(`/ppb/${r.id}`)}
        emptyText={hasFilters ? 'No Purchase Request for this filter.' : 'No Purchase Request data yet; run Accurate Sync.'}
      />

      <PpbFormModal open={formOpen} onClose={() => setFormOpen(false)} />
    </div>
  )
}
