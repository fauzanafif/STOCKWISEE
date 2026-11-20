import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FileText, LayoutDashboard, PackageCheck, Plus, Rows3, Search, X } from 'lucide-react'
import { useOpnameLines, useOpnames, type Opname, type OpnameLineRow, type UsagePeriod } from '@/features/opname/api'
import { FLOW_FILTERS, OpnameStatusBadge, isFromAccurate, typeLabel } from '@/features/opname/status'
import { useAuth } from '@/auth/AuthContext'
import { cn } from '@/lib/utils'
import { ExportBar } from '@/components/export/ExportBar'
import { PageHeader } from '@/components/PageHeader'
import { ColumnMenu, useHiddenColumns, visibleColumns } from '@/components/ColumnVisibility'
import { DataTable, type Column } from '@/components/DataTable'
import { useInfiniteRows } from '@/components/InfiniteRows'
import { ItemUsageCount } from '@/components/ItemUsageCount'
import { usagePeriodPresets } from '@/components/UsagePeriodFilter'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useRemembered, useScrollMemory } from '@/lib/listMemory'

type Source = 'internal' | 'accurate'
type View = 'items' | 'docs'

const fmtDate = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

const fmtQty = (v: number | string | null | undefined) =>
  v == null ? '—' : Number(v).toLocaleString('id-ID', { maximumFractionDigits: 2 })

function DiffValue({ line }: { line: Pick<OpnameLineRow, 'difference' | 'diff_label'> }) {
  if (line.difference == null) return <span className="text-muted-foreground">—</span>
  const d = Number(line.difference)
  if (Math.abs(d) < 0.001) return <span className="text-muted-foreground">0</span>
  return (
    <span className={cn('font-semibold tabular-nums', d > 0 ? 'text-emerald-600' : 'text-red-600')}>
      {line.diff_label ?? (d > 0 ? `+${fmtQty(d)}` : fmtQty(d))}
    </span>
  )
}

function Progress({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div className="min-w-28">
      <div className="flex justify-between text-xs">
        <span className="tabular-nums">{done}/{total}</span>
        <span className="text-muted-foreground">{pct}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full', pct === 100 ? 'bg-emerald-500' : 'bg-primary')} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<[T, string, React.ReactNode?]>; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border bg-muted/40 p-1 text-sm">
      {options.map(([v, label, icon]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors',
            value === v ? 'bg-card' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {icon}
          {label}
        </button>
      ))}
    </div>
  )
}

/** A labelled filter control — every control in the filter panel has its label above it, so they line up. */
function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('space-y-1', className)}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  )
}

/** "from – to" date pair under one label (instead of two separately labelled boxes). */
function DateRange({ label, from, to, onFrom, onTo }: { label: string; from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void }) {
  return (
    <Field label={label} className="w-full sm:w-auto">
      <div className="flex items-center gap-1.5">
        <Input type="date" aria-label={`${label}: from`} className="h-9 min-w-0 flex-1 sm:w-40 sm:flex-none" value={from} max={to || undefined} onChange={(e) => onFrom(e.target.value)} />
        <span className="text-sm text-muted-foreground">–</span>
        <Input type="date" aria-label={`${label}: until`} className="h-9 min-w-0 flex-1 sm:w-40 sm:flex-none" value={to} min={from || undefined} onChange={(e) => onTo(e.target.value)} />
      </div>
    </Field>
  )
}

export function OpnameListPage() {
  const { hasPermission } = useAuth()
  const navigate = useNavigate()
  const canReview = hasPermission('opname.review')
  const [source, setSource] = useRemembered<Source>('stock-opnames', 'source', 'accurate')
  const [view, setView] = useRemembered<View>('stock-opnames', 'view', 'items')
  const [status, setStatus] = useRemembered('stock-opnames', 'status', '')
  const [search, setSearch] = useRemembered('stock-opnames', 'search', '')
  const [dateFrom, setDateFrom] = useRemembered('stock-opnames', 'dateFrom', '')
  // "Per item": period of the NPBG / PPB columns (apart from the opname date above)
  const [period, setPeriod] = useRemembered<UsagePeriod>('stock-opnames', 'period', {})
  const [dateTo, setDateTo] = useRemembered('stock-opnames', 'dateTo', '')
  const [onlyDiff, setOnlyDiff] = useRemembered('stock-opnames', 'onlyDiff', false)
  const [page, setPage] = useRemembered('stock-opnames', 'page', 1)
  // the dashboard's KPI tiles open the list on a status (?source=internal&status=REVIEW&view=docs)
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    if (!params.toString()) return
    const src = params.get('source')
    if (src === 'internal' || src === 'accurate') setSource(src)
    const v = params.get('view')
    if (v === 'docs' || v === 'items') setView(v)
    setStatus(params.get('status') ?? '')
    setPage(1)
    setParams({}, { replace: true })
  }, [params]) // eslint-disable-line react-hooks/exhaustive-deps

  const filters = {
    source,
    status: status || undefined,
    search: search.trim() || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    page,
  }
  const docs = useOpnames(filters, view === 'docs')
  const lines = useOpnameLines({ ...filters, only_diff: onlyDiff, usage_from: period.from, usage_to: period.to }, view === 'items')
  // scroll to the end instead of Sebelumnya/Berikutnya
  const lineScroll = useInfiniteRows(lines.data, page, setPage, 'stock-opnames:lines')
  const docScroll = useInfiniteRows(docs.data, page, setPage, 'stock-opnames:docs')
  const mobileScroll = useScrollMemory('stock-opnames:lines-phone', lineScroll.rows.length > 0)

  const acc = source === 'accurate'
  const hasFilters = !!(search || dateFrom || dateTo || status || onlyDiff)

  const resetPage = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setPage(1)
  }
  const clearFilters = () => {
    setSearch('')
    setDateFrom('')
    setDateTo('')
    setStatus('')
    setOnlyDiff(false)
    setPage(1)
  }
  const open = (id: number) => navigate(`/stock-opnames/${id}`)

  // ---- "Per item": one row per item, no need to open each document
  const lineColumns: Column<OpnameLineRow>[] = [
    {
      key: 'date',
      header: 'Date',
      className: 'whitespace-nowrap',
      cell: (r) => fmtDate(r.opname.date),
    },
    {
      key: 'doc',
      header: 'Document No.',
      cell: (r) => <span className="text-[13px] font-medium text-primary">{r.opname.number}</span>,
    },
    {
      key: 'item',
      header: 'Item',
      cell: (r) => (
        <div className="min-w-56">
          <div className="text-[13px] text-muted-foreground">{r.item_code}</div>
          <div className="leading-snug">{r.description}</div>
        </div>
      ),
    },
    { key: 'unit', header: 'Unit', cell: (r) => r.unit ?? '—' },
    { key: 'npbg', header: 'Delivery Order', className: 'text-right', cell: (r) => <ItemUsageCount kind="npbg" code={r.item_code} count={r.npbg_count} period={period} /> },
    { key: 'ppb', header: 'Purchase Request', className: 'text-right', cell: (r) => <ItemUsageCount kind="ppb" code={r.item_code} count={r.ppb_count} period={period} /> },
    ...(canReview
      ? [{ key: 'before', header: acc ? 'Qty before' : 'System stock', className: 'text-right', cell: (r: OpnameLineRow) => <span className="tabular-nums">{fmtQty(r.system_qty)}</span> }]
      : []),
    { key: 'after', header: acc ? 'Qty after' : 'Physical quantity', className: 'text-right', cell: (r) => <span className="tabular-nums font-medium">{fmtQty(r.physical_qty)}</span> },
    ...(canReview ? [{ key: 'diff', header: 'Difference', className: 'text-right', cell: (r: OpnameLineRow) => <DiffValue line={r} /> }] : []),
    ...(!acc ? [{ key: 'note', header: 'Notes', cell: (r: OpnameLineRow) => <span className={cn(!r.note && 'text-muted-foreground')}>{r.note ?? '—'}</span> }] : []),
    { key: 'status', header: 'Status', cell: (r) => <OpnameStatusBadge opname={r.opname} /> },
  ]

  // ---- "Per dokumen"
  const docColumns: Column<Opname>[] = [
    { key: 'date', header: 'Date', className: 'whitespace-nowrap', cell: (r) => fmtDate(r.scheduled_date) },
    { key: 'number', header: 'Document No.', cell: (r) => <span className="text-[13px] font-medium text-primary">{r.number}</span> },
    {
      key: 'items',
      header: 'Item',
      cell: (r) => (
        <div className="min-w-56">
          {r.first_item ? (
            <>
              <div className="leading-snug">{r.first_item.description}</div>
              {(r.items_count ?? 0) > 1 && <div className="text-xs text-muted-foreground">+{(r.items_count ?? 0) - 1} other items</div>}
            </>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </div>
      ),
    },
    { key: 'wh', header: 'Warehouse', cell: (r) => r.warehouse?.code ?? '—' },
    ...(!acc ? [{ key: 'type', header: 'Coverage', cell: (r: Opname) => typeLabel(r.type) }] : []),
    {
      key: 'prog',
      header: acc ? 'Item count' : 'Count progress',
      cell: (r) => (isFromAccurate(r) ? <span className="tabular-nums">{r.items_count ?? 0}</span> : <Progress done={r.counted_count ?? 0} total={r.items_count ?? 0} />),
    },
    ...(canReview && !acc
      ? [{
          key: 'diff',
          header: 'Difference',
          cell: (r: Opname) => ((r.diff_count ?? 0) > 0 ? <Badge variant="warning">{r.diff_count} items</Badge> : <span className="text-muted-foreground">—</span>),
        }]
      : []),
    { key: 'status', header: 'Status', cell: (r) => <OpnameStatusBadge opname={r} /> },
  ]

  const emptyText = hasFilters
    ? 'No data for this filter.'
    : acc
      ? 'No opname data from Accurate yet.'
      : 'No stock opname yet. Click "New Stock Opname" to create an order.'

  // Hide-kolom terpisah untuk tiap tampilan ("Per item" vs "Per dokumen") —
  // juga menentukan kolom apa yang ikut ke export/cetak (lihat ExportBar di bawah).
  const [hiddenLineCols, toggleLineCol] = useHiddenColumns('stockwise:opname-line-hidden-columns')
  const [hiddenDocCols, toggleDocCol] = useHiddenColumns('stockwise:opname-doc-hidden-columns')
  const shownLineColumns = visibleColumns(lineColumns, hiddenLineCols, ['doc'])
  const shownDocColumns = visibleColumns(docColumns, hiddenDocCols, ['number'])
  const exportDataset = view === 'items' ? 'stock-opname-lines' : 'stock-opnames'
  const exportColumns = (view === 'items' ? shownLineColumns : shownDocColumns).map((c) => c.key).join(',')
  const exportFilters = view === 'items' ? { ...filters, only_diff: onlyDiff, usage_from: period.from, usage_to: period.to } : filters

  return (
    <div className="space-y-4">
      <PageHeader
        title="Physical Inventory"
        subtitle="Physical count of warehouse items and stock adjustment"
        icon={<PackageCheck className="size-5" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ExportBar dataset={exportDataset} filters={exportFilters} filenameBase="stock-opname" viewPermission="report.opname" columns={exportColumns} />
            <Button size="sm" variant="outline" onClick={() => navigate('/stock-opnames/dashboard')}>
              <LayoutDashboard className="size-4" /> Dashboard
            </Button>
            {hasPermission('opname.schedule') && (
              <Button size="sm" onClick={() => navigate('/stock-opnames/new')}>
                <Plus className="size-4" /> New Stock Opname
              </Button>
            )}
          </div>
        }
      />

      {/* what to look at: source + layout */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented<Source>
          value={source}
          options={[['accurate', 'From Accurate'], ['internal', 'Opname STOCKWISE']]}
          onChange={(v) => {
            setSource(v)
            setView(v === 'accurate' ? 'items' : 'docs')
            setStatus('')
            setPage(1)
          }}
        />
        <Segmented<View>
          value={view}
          options={[['items', 'Per item', <Rows3 key="i" className="size-4" />], ['docs', 'Per dokumen', <FileText key="d" className="size-4" />]]}
          onChange={resetPage(setView)}
        />
      </div>


      {/* filters: one panel, every control labelled, the two date ranges told apart */}
      <div className="card-surface space-y-3 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Search" className="min-w-0 basis-full sm:basis-72 sm:flex-1">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-9 pl-9"
                placeholder={view === 'items' ? 'Code / item name / document no…' : 'Document no…'}
                value={search}
                onChange={(e) => resetPage(setSearch)(e.target.value)}
              />
            </div>
          </Field>
          <DateRange label="Opname date" from={dateFrom} to={dateTo} onFrom={resetPage(setDateFrom)} onTo={resetPage(setDateTo)} />
          {!acc && (
            <Field label="Status" className="w-full sm:w-52">
              <Select className="h-9" value={status} onChange={(e) => resetPage(setStatus)(e.target.value)}>
                <option value="">All statuses</option>
                {FLOW_FILTERS.map((st) => <option key={st.value} value={st.value}>{st.label}</option>)}
              </Select>
            </Field>
          )}
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            {view === 'items' && canReview && !acc && (
              <label className="flex h-9 items-center gap-2 text-sm">
                <input type="checkbox" className="size-4" checked={onlyDiff} onChange={(e) => resetPage(setOnlyDiff)(e.target.checked)} />
                Differences only
              </label>
            )}
            {hasFilters && (
              <Button variant="ghost" size="sm" className="h-9" onClick={clearFilters}>
                <X className="size-4" /> Reset
              </Button>
            )}
            {view === 'items'
              ? <ColumnMenu columns={lineColumns} hiddenCols={hiddenLineCols} onToggle={toggleLineCol} alwaysVisible={['doc']} />
              : <ColumnMenu columns={docColumns} hiddenCols={hiddenDocCols} onToggle={toggleDocCol} alwaysVisible={['number']} />}
          </div>
        </div>

        {view === 'items' && (
          <div className="flex flex-wrap items-end gap-3 border-t pt-3">
            <DateRange label="Delivery Order / Purchase Request column period" from={period.from ?? ''} to={period.to ?? ''}
              onFrom={(v) => setPeriod({ ...period, from: v || undefined })} onTo={(v) => setPeriod({ ...period, to: v || undefined })} />
            <div className="inline-flex flex-wrap rounded-lg border bg-muted/40 p-1 text-sm" role="group" aria-label="Delivery Order / Purchase Request quick period">
              {usagePeriodPresets().map((p) => {
                const on = (p.period.from ?? '') === (period.from ?? '') && (p.period.to ?? '') === (period.to ?? '')
                return (
                  <button key={p.label} type="button" onClick={() => setPeriod(p.period)} aria-pressed={on}
                    className={cn('rounded-md px-3 py-1 font-medium transition-colors', on ? 'bg-card' : 'text-muted-foreground hover:text-foreground')}>
                    {p.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {view === 'items' ? (
        <>
          {/* tablet / desktop */}
          <div className="hidden md:block">
            <DataTable
              columns={shownLineColumns}
              rows={lineScroll.rows} scrollMemoryKey="stock-opnames:lines"
              notes={{ entity: 'opname_line' }} rowKey={(r) => r.id}
              isLoading={lines.isLoading}
              onRowClick={(r) => open(r.opname.id)}
              emptyText={emptyText}
              containerClassName="max-h-[70vh] overflow-y-auto"
              stickyHeader
              footer={lineScroll.footer}
            />
          </div>
          {/* phone */}
          <div ref={mobileScroll} className="max-h-[75vh] space-y-2 overflow-y-auto md:hidden">
            {lines.isLoading && <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>}
            {!lines.isLoading && lineScroll.rows.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>}
            {lineScroll.rows.map((r) => (
              <button key={r.id} type="button" onClick={() => open(r.opname.id)} className="w-full space-y-2 rounded-lg border bg-card p-3 text-left text-sm active:bg-muted">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[13px] text-muted-foreground">{r.item_code}</div>
                    <div className="font-medium leading-snug">{r.description}</div>
                  </div>
                  <OpnameStatusBadge opname={r.opname} />
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {canReview && <span><span className="text-muted-foreground">{acc ? 'Before' : 'System'}:</span> <b className="tabular-nums">{fmtQty(r.system_qty)}</b></span>}
                  <span><span className="text-muted-foreground">{acc ? 'After' : 'Physical'}:</span> <b className="tabular-nums">{fmtQty(r.physical_qty)}</b> {r.unit}</span>
                  {canReview && <span><span className="text-muted-foreground">Difference:</span> <DiffValue line={r} /></span>}
                  <span><span className="text-muted-foreground">Delivery Order:</span> <b className="tabular-nums">{r.npbg_count ?? 0}</b></span>
                  <span><span className="text-muted-foreground">Purchase Request:</span> <b className="tabular-nums">{r.ppb_count ?? 0}</b></span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {fmtDate(r.opname.date)} · <span className="">{r.opname.number}</span>
                  {r.note && <> · {r.note}</>}
                </div>
              </button>
            ))}
            {lineScroll.footer}
          </div>
        </>
      ) : (
        <DataTable
          columns={shownDocColumns}
          rows={docScroll.rows} scrollMemoryKey="stock-opnames:docs"
          notes={{ entity: 'opname' }} rowKey={(r) => r.id}
          isLoading={docs.isLoading}
          onRowClick={(r) => open(r.id)}
          emptyText={emptyText}
          containerClassName="max-h-[70vh] overflow-y-auto"
          stickyHeader
          footer={docScroll.footer}
        />
      )}


    </div>
  )
}
