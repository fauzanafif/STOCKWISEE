import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, Grid3x3, List, Plus, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { DataTable, type Column } from '@/components/DataTable'
import { FilterBar } from '@/components/FilterBar'
import { Pager } from '@/components/InfiniteRows'
import { PageHeader } from '@/components/PageHeader'
import { PriceDialog, StatusBadge, type PriceTarget } from '@/components/priceList/PriceDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useItemOptions } from '@/features/inventory/api'
import { useVendors } from '@/features/purchasing/api'
import { MISSING_LABEL, rupiah, taxShort, usePriceList, usePriceMatrix, type Completeness, type MatrixRow, type PriceCell, type PriceRow } from '@/features/priceList/api'
import { cn } from '@/lib/utils'

const VIEW_KEY = 'sw.priceList.view'

/** a typed search waits a moment before it asks the server */
function useDebounced<T>(value: T, ms = 350) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return v
}

const fmtDate = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')

/** One crossing of the matrix: the vendor's price for the item, coloured by its status. */
function Cell({ cell, lowest, onOpen, onAdd }: { cell?: PriceCell; lowest: boolean; onOpen: (id: number) => void; onAdd?: () => void }) {
  if (!cell) {
    return onAdd
      ? <button type="button" onClick={onAdd} className="group flex h-full min-h-[52px] w-full items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-primary/5 hover:text-primary" aria-label="Add price">
          <span className="group-hover:hidden">—</span><Plus className="hidden size-4 group-hover:block" />
        </button>
      : <span className="flex min-h-[52px] items-center justify-center text-muted-foreground/50">—</span>
  }
  const tone = cell.status === 'EXPIRED' ? 'border-amber-200 bg-amber-50/70 hover:bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30'
    : cell.status === 'DRAFT' ? 'border-dashed border-slate-300 bg-card hover:bg-muted/60'
      : lowest ? 'border-emerald-300 bg-emerald-50 hover:bg-emerald-100/70 dark:border-emerald-800 dark:bg-emerald-950/30'
        : 'border-transparent bg-card hover:border-border hover:bg-muted/50'
  return (
    <button type="button" onClick={() => onOpen(cell.id)} title={`${cell.status}${cell.valid_until ? ` · valid until ${fmtDate(cell.valid_until)}` : ''}`}
      className={cn('flex min-h-[52px] w-full flex-col items-end justify-center rounded-md border px-2.5 py-1.5 text-right transition-colors', tone)}>
      <span className={cn('text-[13.5px] font-semibold tabular-nums', cell.status === 'EXPIRED' && 'text-amber-800 dark:text-amber-300', cell.status === 'DRAFT' && 'text-muted-foreground', lowest && cell.status === 'ACTIVE' && 'text-emerald-700 dark:text-emerald-300')}>
        {rupiah(cell.price)}
      </span>
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
        /{cell.unit ?? '?'}{cell.min_qty > 1 && ` · min ${cell.min_qty}`}
        {cell.status === 'EXPIRED' && <span className="font-medium text-amber-700">· Expired</span>}
        {cell.status === 'DRAFT' && <span className="font-medium">· Draft</span>}
        {lowest && cell.status === 'ACTIVE' && <span className="font-medium text-emerald-700">· Lowest</span>}
        {(cell.tiers ?? 1) > 1 && <span title="More prices (tiers) in the List view">· +{(cell.tiers ?? 1) - 1}</span>}
      </span>
      <span className="flex items-center gap-1 text-[10.5px]">
        {taxShort(cell.price_type, cell.ppn_rate) ? <span className="text-muted-foreground">{taxShort(cell.price_type, cell.ppn_rate)}</span> : null}
        {(cell.missing?.length ?? 0) > 0 && (
          <span className="inline-flex items-center gap-0.5 font-medium text-amber-700" title={`Incomplete: ${cell.missing!.map((m) => MISSING_LABEL[m] ?? m).join(', ')}`}>
            <AlertCircle className="size-3" /> Incomplete
          </span>
        )}
      </span>
      {cell.needs_review && <span className="text-[10.5px] font-medium text-amber-700" title="The item's base unit changed: open and save the price again">⚠ Check unit</span>}
    </button>
  )
}

function Legend() {
  const dot = 'inline-block size-2.5 rounded-sm border'
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5"><span className={cn(dot, 'border-emerald-300 bg-emerald-50')} /> Lowest active price</span>
      <span className="flex items-center gap-1.5"><span className={cn(dot, 'bg-card')} /> Active</span>
      <span className="flex items-center gap-1.5"><span className={cn(dot, 'border-dashed border-slate-400 bg-card')} /> Draft</span>
      <span className="flex items-center gap-1.5"><span className={cn(dot, 'border-amber-300 bg-amber-50')} /> Expired</span>
      <span className="flex items-center gap-1.5"><span className="text-muted-foreground/60">—</span> No price yet</span>
      <span className="flex items-center gap-1.5 text-amber-700"><AlertCircle className="size-3" /> Incomplete: PPN or PI / quotation no. missing</span>
    </div>
  )
}

/** "62 of 65 complete": how many current prices have their PPN and their PI / quotation; a click shows the others. */
function CompletenessChip({ c, active, onToggle }: { c?: Completeness; active: boolean; onToggle: () => void }) {
  if (!c || c.total === 0) return null
  const all = c.incomplete === 0
  return (
    <button type="button" onClick={onToggle} disabled={all && !active} aria-pressed={active}
      title={all ? 'Every price has its PPN and its PI / quotation no.' : 'Show the prices that still lack their PPN or PI / quotation no.'}
      className={cn('inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-[13px] font-medium tabular-nums transition-colors',
        all ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'
          : active ? 'border-amber-400 bg-amber-100 text-amber-900' : 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300')}>
      {all ? <CheckCircle2 className="size-4" /> : <AlertCircle className="size-4" />}
      {c.complete.toLocaleString('id-ID')} of {c.total.toLocaleString('id-ID')} complete
      {!all && <span className="font-normal">· {active ? 'showing incomplete' : `${c.incomplete} to complete`}</span>}
    </button>
  )
}

/** Purchase Information: the standing purchase prices, Item × Vendor (Matrix View) or one row per price (List View). */
export function PriceListPage() {
  const { hasPermission } = useAuth()
  const canCreate = hasPermission('rfq.create')
  const [view, setView] = useState<'matrix' | 'list'>(() => {
    try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'matrix' } catch { return 'matrix' }
  })
  const switchView = (v: 'matrix' | 'list') => { setView(v); try { localStorage.setItem(VIEW_KEY, v) } catch { /* private mode */ } }

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState('')
  const [vendorIds, setVendorIds] = useState<number[]>([])
  const [page, setPage] = useState(1)
  // the page sizes the Pager offers: 10 / 20 / 50 / 100
  const [perPage, setPerPage] = useState(20)
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'updated_at', dir: 'desc' })
  const [open, setOpen] = useState<PriceTarget | null>(null)
  const q = useDebounced(search)
  useEffect(() => setPage(1), [q, category, status, vendorIds, view, perPage])

  const { data: options } = useItemOptions()
  const vendors = useVendors({ is_active: 'true', limit: 2000 })
  const vendorName = useMemo(() => new Map((vendors.data ?? []).map((v) => [v.id, v.name])), [vendors.data])

  // the matrix status filter speaks of items (no price / has a price of this status); the list of prices
  const matrix = usePriceMatrix({ search: q, category, status: status.toLowerCase(), vendor_ids: vendorIds, page, per_page: perPage })
  const list = usePriceList({ search: q, category, status: ['NONE', 'PRICED', 'INCOMPLETE'].includes(status) ? '' : status, incomplete: status === 'INCOMPLETE', vendor_id: vendorIds.length === 1 ? vendorIds[0] : '', sort: sort.key, dir: sort.dir, page, per_page: perPage })
  const meta = view === 'matrix' ? matrix.data?.meta : list.data?.meta
  const completeness = (view === 'matrix' ? matrix.data?.completeness : list.data?.meta.completeness) ?? matrix.data?.completeness ?? list.data?.meta.completeness

  const sortBy = (key: string) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))
  const SortHead = ({ k, children, right }: { k: string; children: string; right?: boolean }) => (
    <button type="button" onClick={() => sortBy(k)} className={cn('inline-flex items-center gap-1 hover:text-foreground', right && 'ml-auto')}>
      {children}{sort.key === k ? (sort.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />) : <ArrowUpDown className="size-3 opacity-40" />}
    </button>
  )
  const columns: Column<PriceRow>[] = [
    { key: 'code', header: <SortHead k="item_code">Item Code</SortHead>, cell: (r) => <span className="font-medium tabular-nums">{r.item_code}</span>, className: 'whitespace-nowrap' },
    { key: 'name', header: <SortHead k="item_name">Item Name</SortHead>, cell: (r) => <span className="line-clamp-2 min-w-[14rem]">{r.item_name}</span> },
    { key: 'vendor', header: <SortHead k="vendor">Vendor</SortHead>, cell: (r) => r.vendor },
    { key: 'price', header: <SortHead k="price" right>Vendor Price</SortHead>, cell: (r) => <span className="font-semibold tabular-nums">{rupiah(r.price)}</span>, className: 'text-right whitespace-nowrap' },
    { key: 'tax', header: 'PPN', cell: (r) => taxShort(r.price_type, r.ppn_rate) ?? <span className="text-amber-700">not set</span>, className: 'whitespace-nowrap text-xs' },
    { key: 'final', header: 'Final Price', cell: (r) => (r.final_price != null ? <span className="tabular-nums">{rupiah(r.final_price)}</span> : '—'), className: 'text-right whitespace-nowrap' },
    { key: 'unit', header: 'Purchase UOM', cell: (r) => <span>{r.unit}{r.unit_ratio !== 1 && <span className="text-xs text-muted-foreground"> (= {r.unit_ratio} {r.base_unit})</span>}</span>, className: 'whitespace-nowrap' },
    { key: 'min', header: <SortHead k="min_qty" right>Min. Qty</SortHead>, cell: (r) => <span className="tabular-nums">{r.min_qty}</span>, className: 'text-right' },
    { key: 'lead', header: <SortHead k="lead_time_days" right>Lead Time</SortHead>, cell: (r) => (r.lead_time_days != null ? `${r.lead_time_days} d` : '—'), className: 'text-right whitespace-nowrap' },
    { key: 'until', header: <SortHead k="valid_until">Valid Until</SortHead>, cell: (r) => fmtDate(r.valid_until), className: 'whitespace-nowrap' },
    { key: 'pi', header: 'No PI', cell: (r) => (r.pi ? <Link to={`/price-list/drafts/${r.pi.id}`} onClick={(e) => e.stopPropagation()} className="whitespace-nowrap text-primary hover:underline">{r.pi.number}</Link>
      : r.vendor_ref ? <span className="text-xs" title="Vendor quotation no.">{r.vendor_ref}</span> : <span className="text-muted-foreground">—</span>), className: 'whitespace-nowrap' },
    { key: 'updated', header: <SortHead k="updated_at">Last Updated</SortHead>, cell: (r) => <span className="text-xs text-muted-foreground">{r.updated_at ? new Date(r.updated_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}{r.updated_by && <><br />{r.updated_by}</>}</span>, className: 'whitespace-nowrap' },
    { key: 'status', header: <SortHead k="status">Status</SortHead>, cell: (r) => <span className="flex flex-col items-start gap-0.5"><StatusBadge status={r.status} />{r.needs_review && <span className="text-[11px] font-medium text-amber-700">⚠ Check unit</span>}
      {(r.missing?.length ?? 0) > 0 && <span className="text-[11px] font-medium text-amber-700" title={r.missing!.map((m) => MISSING_LABEL[m] ?? m).join(', ')}>⚠ Incomplete</span>}</span> },
    { key: 'action', header: '', cell: (r) => <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setOpen({ id: r.id }) }}>Open</Button>, className: 'text-right' },
  ]

  const statusOptions = view === 'matrix'
    ? [['', 'All items'], ['PRICED', 'Has a price'], ['NONE', 'No price yet'], ['ACTIVE', 'Has an active price'], ['EXPIRED', 'Has an expired price'], ['DRAFT', 'Has a draft price'], ['INCOMPLETE', 'Has an incomplete price']]
    : [['', 'All current prices'], ['ACTIVE', 'Active'], ['EXPIRED', 'Expired'], ['DRAFT', 'Draft'], ['ARCHIVED', 'Archived'], ['INCOMPLETE', 'Incomplete']]
  useEffect(() => { if (!statusOptions.some(([v]) => v === status)) setStatus('') }, [view]) // eslint-disable-line react-hooks/exhaustive-deps

  const m = matrix.data
  const empty = view === 'matrix' ? !matrix.isLoading && (m?.rows.length ?? 0) === 0 : false

  return (
    <div className="space-y-4">
      <PageHeader title="Purchase Information" actions={<>
        <CompletenessChip c={completeness} active={status === 'INCOMPLETE'} onToggle={() => setStatus((s) => (s === 'INCOMPLETE' ? '' : 'INCOMPLETE'))} />
        <div className="flex rounded-md border bg-card p-0.5" role="tablist" aria-label="View">
          {([['matrix', 'Matrix', Grid3x3], ['list', 'List', List]] as const).map(([v, label, Icon]) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => switchView(v)}
              className={cn('flex h-8 items-center gap-1.5 rounded px-3 text-[13px] font-medium transition-colors', view === v ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground')}>
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>
        {canCreate && <Button onClick={() => setOpen({})}><Plus className="size-4" /> Add Price</Button>}
      </>} />

      <FilterBar>
        <Input placeholder="Search item code or name…" className="w-72 max-w-full" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
        <Select className="w-56" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {(options?.induk ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <Select className="w-60" value="" onChange={(e) => { const v = Number(e.target.value); if (v) setVendorIds((l) => (l.includes(v) ? l : [...l, v])) }} aria-label="Vendor">
          <option value="">{vendorIds.length ? 'Add another vendor…' : 'All vendors'}</option>
          {(vendors.data ?? []).filter((v) => !vendorIds.includes(v.id)).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </Select>
        <Select className="w-52" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Price status">
          {statusOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </FilterBar>

      {vendorIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Vendors:</span>
          {vendorIds.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 rounded-full border bg-card py-0.5 pl-2.5 pr-1 text-xs">
              {vendorName.get(v) ?? `#${v}`}
              <button type="button" onClick={() => setVendorIds((l) => l.filter((x) => x !== v))} aria-label={`Remove ${vendorName.get(v)}`} className="rounded-full p-0.5 hover:bg-muted"><X className="size-3" /></button>
            </span>
          ))}
          <button type="button" onClick={() => setVendorIds([])} className="text-xs font-medium text-primary hover:underline">Clear</button>
          {view === 'list' && vendorIds.length > 1 && <span className="text-xs text-muted-foreground">(the List view filters by one vendor: keep only one to filter it)</span>}
        </div>
      )}

      {view === 'matrix' ? (
        <div className="overflow-hidden rounded-lg border bg-card shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2"><Legend />
            {m && m.vendors.length === 0 && m.rows.length > 0 && <span className="text-xs text-muted-foreground">No prices on this page yet. Pick a vendor in the filter to add its column.</span>}
          </div>
          {empty ? <p className="px-3 py-14 text-center text-sm text-muted-foreground">No items match the filters.</p> : (
            <div className="max-h-[68vh] overflow-auto">
              <table className="w-full border-separate border-spacing-0 text-[13px]">
                <thead>
                  <tr>
                    <th className="sticky left-0 top-0 z-20 min-w-[10.5rem] sm:min-w-[16rem] border-b border-r bg-slate-100 px-3 py-2.5 text-left dark:bg-slate-900">Item</th>
                    {m?.vendors.map((v) => (
                      <th key={v.id} className="sticky top-0 z-10 min-w-[9.5rem] max-w-[12rem] border-b bg-slate-100 px-3 py-2.5 text-right align-bottom dark:bg-slate-900">
                        <span className="line-clamp-2 leading-snug" title={v.name}>{v.name}</span>
                      </th>
                    ))}
                    {m && m.vendors.length === 0 && <th className="sticky top-0 border-b bg-slate-100 px-3 py-2.5 text-left font-normal text-muted-foreground dark:bg-slate-900">Vendors</th>}
                  </tr>
                </thead>
                <tbody>
                  {matrix.isLoading && !m && Array.from({ length: 8 }, (_, i) => (
                    <tr key={i}><td className="border-b px-3 py-4"><div className="h-3.5 w-48 animate-pulse rounded bg-muted" /></td><td className="border-b px-3"><div className="ml-auto h-3.5 w-20 animate-pulse rounded bg-muted" /></td></tr>
                  ))}
                  {m?.rows.map((r: MatrixRow) => (
                    <tr key={r.item.id} className="group">
                      <td className="sticky left-0 z-[5] border-b border-r bg-card px-3 py-2 group-hover:bg-muted/40">
                        <div className="text-[13px] font-medium tabular-nums">{r.item.code}</div>
                        <div className="line-clamp-2 max-w-[11rem] text-xs sm:max-w-[22rem] text-muted-foreground" title={r.item.description}>{r.item.description}</div>
                        {r.price_count === 0 && <span className="mt-0.5 inline-block rounded bg-muted px-1.5 text-[10.5px] text-muted-foreground">No price yet</span>}
                      </td>
                      {m.vendors.map((v) => (
                        <td key={v.id} className="border-b p-1 align-middle">
                          <Cell cell={r.cells[v.id]} lowest={r.cells[v.id]?.id === r.lowest_price_id} onOpen={(id) => setOpen({ id })}
                            onAdd={canCreate ? () => setOpen({ item: r.item, vendorId: v.id }) : undefined} />
                        </td>
                      ))}
                      {m.vendors.length === 0 && (
                        <td className="border-b px-3 text-xs text-muted-foreground">
                          {canCreate && <button type="button" className="font-medium text-primary hover:underline" onClick={() => setOpen({ item: r.item })}>+ Add price</button>}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {meta && <div className="border-t"><Pager page={meta.current_page} lastPage={meta.last_page} total={meta.total} perPage={meta.per_page} onPage={setPage} onPerPage={setPerPage} loading={matrix.isFetching} /></div>}
        </div>
      ) : (
        <div className="space-y-0">
          <DataTable columns={columns} rows={list.data?.data ?? []} rowKey={(r) => r.id} isLoading={list.isLoading} onRowClick={(r) => setOpen({ id: r.id })}
            emptyText="No prices match the filters." containerClassName="rounded-b-none" />
          {meta && <Pager page={meta.current_page} lastPage={meta.last_page} total={meta.total} perPage={meta.per_page} onPage={setPage} onPerPage={setPerPage} loading={list.isFetching} className="rounded-b-lg border border-t-0 bg-card" />}
        </div>
      )}

      {open && <PriceDialog key={JSON.stringify(open)} target={open} onClose={() => setOpen(null)} onAddTier={(t) => setOpen(t)} />}
    </div>
  )
}
