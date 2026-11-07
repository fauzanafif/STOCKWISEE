import { useEffect, useRef, useState } from 'react'
import { DateRangeFilter } from '@/components/DateRangeFilter'
import { PpbApprovalBadge } from '@/components/PpbApproval'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { usePoDivisiOptions, usePoList, useVendors, type PoListRow } from '@/features/purchasing/api'
import { Plus, Search, ShoppingCart, X } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { PoFormModal } from '@/components/PoFormModal'
import { ExportBar } from '@/components/export/ExportBar'
import { PageHeader } from '@/components/PageHeader'
import { ColumnMenu, useHiddenColumns, visibleColumns } from '@/components/ColumnVisibility'
import { DataTable, type Column } from '@/components/DataTable'
import { DocCell, DocText } from '@/components/DocLink'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { RequestStatusBadge, statusLabel } from '@/components/ui/request-badge'
import { useInfiniteRows } from '@/components/InfiniteRows'
import { useRemembered } from '@/lib/listMemory'
import { FilterBar } from '@/components/FilterBar'
import { QtyProgress } from '@/components/QtyProgress'

const fmtDate = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString('en-GB') : '—')
const ALWAYS_VISIBLE = ['number']

/**
 * Satu baris per barang (seperti PPB/RI) — PO dengan beberapa barang tampil
 * sebagai beberapa baris senomor PO yang sama, bukan satu baris dengan semua
 * kode/deskripsinya ditumpuk jadi satu sel. Urutan baca: identitas PO dulu
 * (nomor+tanggal), lalu dengan siapa (vendor) dan beli apa (barang+qty), baru
 * status baris & rantai dokumennya (PPB -> RI), dan catatan di akhir.
 */
const columns: Column<PoListRow>[] = [
  {
    key: 'number',
    header: 'PO Number',
    cell: (r) => (
      <DocCell date={fmtDate(r.po_date)}>
        <span className="inline-flex items-center gap-1.5">
          <Link to={`/purchase-orders/${r.po_id}`} onClick={(e) => e.stopPropagation()} className="text-[13px] font-medium text-primary hover:underline">
            {r.po_number}
          </Link>
          {r.is_manual && <Badge variant="neutral">Manual</Badge>}
        </span>
      </DocCell>
    ),
  },
  { key: 'vendor', header: 'Vendor', cell: (r) => <span className="whitespace-nowrap">{r.vendor_name ?? '—'}</span> },
  {
    key: 'barang',
    header: 'Item',
    className: 'max-w-[260px]',
    cell: (r) => (
      <div className="leading-tight">
        <div className="truncate text-[13px] text-muted-foreground">{r.item_code ?? '—'}</div>
        <div className="truncate" title={r.description ?? undefined}>{r.description ?? '—'}</div>
      </div>
    ),
  },
  { key: 'qty', header: 'Qty', className: 'text-right', cell: (r) => <span className="whitespace-nowrap tabular-nums">{r.qty} {r.unit ?? ''}</span> },
  // ordered / received so far (RI): a partial delivery reads "10/5"
  { key: 'diterima', header: 'Ordered/Received', cell: (r) => <QtyProgress total={r.qty} done={r.received} unit={r.unit} /> },
  { key: 'status', header: 'Status', cell: (r) => <RequestStatusBadge status={r.status} /> },
  {
    key: 'ppb',
    header: 'Purchase Request',
    cell: (r) => (
      <DocCell date={fmtDate(r.ppb_date)}>
        <DocText text={r.ppb_no} className="text-[13px]" />
        {r.ppb_approval?.po_without_approval && <span className="mt-0.5 block"><PpbApprovalBadge approval={r.ppb_approval} /></span>}
      </DocCell>
    ),
  },
  {
    key: 'ri',
    header: 'Receipt',
    cell: (r) => <DocCell date={fmtDate(r.ri_date)}><DocText text={r.ri_no} className="text-[13px]" /></DocCell>,
  },
  { key: 'divisi', header: 'Division', cell: (r) => <span className="whitespace-nowrap">{r.divisi ?? '—'}</span> },
  {
    key: 'keterangan',
    header: 'Remarks',
    className: 'max-w-[220px]',
    cell: (r) => <span className="block truncate" title={r.keterangan ?? undefined}>{r.keterangan ?? '—'}</span>,
  },
]

export function PoListPage() {
  const navigate = useNavigate()
  const { hasPermission } = useAuth()
  const [formOpen, setFormOpen] = useState(false)
  // ?search=<no. dokumen> — opened from a document link elsewhere (DocLink)
  const [params] = useSearchParams()
  const urlSearch = params.get('search') ?? ''
  const [search, setSearch] = useRemembered('purchase-orders', 'search', urlSearch)
  const [status, setStatus] = useRemembered('purchase-orders', 'status', '')
  const [vendorId, setVendorId] = useRemembered('purchase-orders', 'vendorId', '')
  const [divisi, setDivisi] = useRemembered('purchase-orders', 'divisi', '')
  const [dateFrom, setDateFrom] = useRemembered('purchase-orders', 'dateFrom', '')
  const [dateTo, setDateTo] = useRemembered('purchase-orders', 'dateTo', '')
  const [source, setSource] = useRemembered('purchase-orders', 'source', '')
  const [page, setPage] = useRemembered('purchase-orders', 'page', 1)
  // first render: the state above already starts from the URL (or is restored after Back);
  // only later URL changes (a document link opened while here) reset the filters
  const lastUrl = useRef([urlSearch].join('|'))
  useEffect(() => {
    const now = [urlSearch].join('|')
    if (now === lastUrl.current) return
    lastUrl.current = now
    setSearch(urlSearch)
    setPage(1)
  }, [urlSearch])
  const activeFilters = {
    search: search.trim() || undefined, status: status || undefined,
    vendor_id: vendorId || undefined, divisi: divisi || undefined,
    date_from: dateFrom || undefined, date_to: dateTo || undefined, source: source || undefined,
  }
  const { data, isLoading } = usePoList({ ...activeFilters, page })
  const { data: vendors } = useVendors()
  const { data: divisiOptions } = usePoDivisiOptions()
  // every filter change starts again from the first page
  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setPage(1) }
  const hasFilters = !!(search || status || vendorId || divisi || dateFrom || dateTo || source)
  const clearFilters = () => { setSearch(''); setStatus(''); setVendorId(''); setDivisi(''); setDateFrom(''); setDateTo(''); setSource(''); setPage(1) }
  // scroll to the end instead of Sebelumnya/Berikutnya (pages appended while scrolling)
  const { rows: scrollRows, footer: scrollFooter } = useInfiniteRows(data, page, setPage, 'purchase-orders')

  const [hiddenCols, toggleCol] = useHiddenColumns('stockwise:po-hidden-columns')
  const shownColumns = visibleColumns(columns, hiddenCols, ALWAYS_VISIBLE)
  const visibleKeys = shownColumns.map((c) => c.key).join(',')

  return (
    <div className="space-y-4">
      <PageHeader
        title="Purchase Order"
        subtitle="Purchase orders to vendors"
        icon={<ShoppingCart className="size-5" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ExportBar dataset="purchase-orders" filters={activeFilters} filenameBase="purchase-order" viewPermission="po.view" columns={visibleKeys} />
            {hasPermission('po.create') && (
              <Button size="sm" onClick={() => setFormOpen(true)}>
                <Plus className="size-4" />
                Add PO
              </Button>
            )}
          </div>
        }
      />

      <FilterBar className="grid gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end" end={<>
        {data && <span className="text-xs text-muted-foreground">{data.meta.total.toLocaleString('id-ID')} items</span>}
        <ColumnMenu columns={columns} hiddenCols={hiddenCols} onToggle={toggleCol} alwaysVisible={ALWAYS_VISIBLE} />
      </>}>
        <div className="relative sm:col-span-2 lg:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search PO no., vendor, item, Purchase Request / Receipt no., division, remarks…"
            title="Several words at once, e.g. “sinar kabel”; every word must match, in any column"
            className="pl-9"
            value={search}
            onChange={(e) => resetPage(setSearch)(e.target.value)}
          />
        </div>
        <div className="lg:w-44">
          <Select value={status} onChange={(e) => resetPage(setStatus)(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {['MENUNGGU_PO', 'PENDING', 'DIBELI', 'PARTIAL_RECEIVED', 'RECEIVED', 'CLOSED'].map((s) => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </Select>
        </div>
        <div className="lg:w-48">
          <Select value={vendorId} onChange={(e) => resetPage(setVendorId)(e.target.value)} aria-label="Vendor">
            <option value="">All vendors</option>
            {vendors?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </Select>
        </div>
        <div className="lg:w-44">
          <Select value={divisi} onChange={(e) => resetPage(setDivisi)(e.target.value)} aria-label="Division">
            <option value="">All divisions</option>
            {divisiOptions?.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
        </div>
        <div className="lg:w-36">
          <Select value={source} onChange={(e) => resetPage(setSource)(e.target.value)} aria-label="Source">
            <option value="">All sources</option>
            <option value="accurate">Accurate</option>
            <option value="internal">Internal</option>
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
        rows={scrollRows} scrollMemoryKey="purchase-orders"
        footer={scrollFooter}
        notes={{ entity: 'po', key: (r) => r.po_id }}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        onRowClick={(r) => navigate(`/purchase-orders/${r.po_id}`)}
        emptyText={hasFilters ? 'No PO items for this filter.' : 'No PO data yet.'}
      />

      <PoFormModal open={formOpen} onClose={() => setFormOpen(false)} />
    </div>
  )
}
