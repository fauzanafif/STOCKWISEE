import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { History, X } from 'lucide-react'
import { MOVEMENT_LABEL, MO_STATUS, fmtDate, fmtQty, useMrpReport, type MoStatus, type MrpItem, type ReportType } from '@/features/mrp/api'
import { MoStatusBadge, MrpItemPicker, Tabs } from '@/components/mrp/MrpParts'
import { PageHeader } from '@/components/PageHeader'
import { FilterBar } from '@/components/FilterBar'
import { DocSection } from '@/components/doc/DocLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type Row = Record<string, unknown>
const n = (v: unknown) => Number(v ?? 0)
const s = (v: unknown) => (v == null ? '' : String(v))
/** one table row: its cells (keyed by position in Table) */
const row = (...cells: ReactNode[]) => cells
const ago = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)

function Table({ head, rows, empty }: { head: { label: string; right?: boolean }[]; rows: ReactNode[][]; empty: string }) {
  return (
    <div className="max-h-[65vh] overflow-auto">
      <table className="w-full text-[13px]">
        <thead className="sticky top-0 bg-slate-100 text-left text-xs text-slate-600"><tr>{head.map((h) => <th key={h.label} className={cn('whitespace-nowrap px-3 py-2', h.right && 'text-right')}>{h.label}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={head.length} className="px-3 py-10 text-center text-muted-foreground">{empty}</td></tr>}
          {rows.map((r, i) => <tr key={i} className="border-t">{r.map((c, j) => <td key={j} className={cn('px-3 py-2', head[j]?.right && 'text-right tabular-nums')}>{c}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  )
}

/** Searchable production history and the Manufacturing reports. No cost figures: STOCKWISE has no reliable item cost. */
export function ProductionHistoryPage() {
  const [tab, setTab] = useState<ReportType>('summary')
  const [from, setFrom] = useState(ago(90))
  const [to, setTo] = useState(ago(0))
  const [item, setItem] = useState<MrpItem | null>(null)
  const [search, setSearch] = useState('')
  const { data, isFetching } = useMrpReport<Row>(tab, { from, to, item_id: item?.id ?? null })
  const rows = (data ?? []).filter((r) => !search || JSON.stringify(r).toLowerCase().includes(search.toLowerCase()))
  const moLink = (id: unknown, number: unknown) => <Link to={`/mrp/orders/${s(id)}`} className="whitespace-nowrap text-primary hover:underline">{s(number)}</Link>

  return (
    <div className="space-y-4">
      <PageHeader title="Production History" icon={<History className="size-5" />} />
      <Tabs<ReportType> value={tab} onChange={setTab} tabs={[
        { key: 'summary', label: 'Production summary' }, { key: 'consumption', label: 'Material consumption' },
        { key: 'output', label: 'Finished goods output' }, { key: 'scrap', label: 'Scrap / waste' }, { key: 'trace', label: 'Traceability' },
      ]} />
      <FilterBar>
        {tab !== 'trace' && <>
          <label className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">From</span><Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">To</span><Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <Input className="w-full sm:max-w-xs" placeholder="Search in results…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </>}
        {tab === 'trace' && (item
          ? <div className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm"><span className="text-muted-foreground">{item.code}</span> {item.description}<Button variant="ghost" size="sm" onClick={() => setItem(null)}><X className="size-4" /></Button></div>
          : <div className="w-full sm:max-w-md"><MrpItemPicker onPick={setItem} placeholder="Item to trace (finished product or component)…" /></div>)}
        {isFetching && <span className="text-xs text-muted-foreground">Loading…</span>}
      </FilterBar>

      {tab === 'summary' && (
        <DocSection title="Manufacturing Orders" count={rows.length} flush>
          <Table empty="No Manufacturing Orders in this period." head={[{ label: 'MO' }, { label: 'Finished product' }, { label: 'Planned', right: true }, { label: 'Output', right: true }, { label: 'Consumed', right: true }, { label: 'Scrap', right: true }, { label: 'Responsible' }, { label: 'Started' }, { label: 'Done' }, { label: 'Status' }]}
            rows={rows.map((r) => row(moLink(r.id, r.number), <div><div>{s(r.product_name)}</div><div className="text-xs text-muted-foreground">{s(r.product_code)}</div></div>,
              `${fmtQty(n(r.planned_qty), 2)} ${s(r.base_unit)}`, <b>{fmtQty(n(r.output_qty), 2)}</b>, fmtQty(n(r.consumed_qty), 2), fmtQty(n(r.scrap_qty), 2), s(r.responsible) || '-',
              fmtDate(s(r.started_at) || null), fmtDate(s(r.done_at) || null),
              <div className="flex flex-wrap gap-1"><MoStatusBadge status={s(r.status) as MoStatus} />{s(r.status) === 'DONE' && !r.accurate_recorded_at && <Badge variant="warning">Not in Accurate</Badge>}</div>))} />
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">Consumed and scrap are totals over all components, each in its own Base UOM.</p>
        </DocSection>
      )}
      {tab === 'consumption' && (
        <DocSection title="Material consumption (MOs done in the period)" count={rows.length} flush>
          <Table empty="Nothing consumed in this period." head={[{ label: 'Component' }, { label: 'MOs', right: true }, { label: 'Required', right: true }, { label: 'Consumed', right: true }, { label: 'Scrap', right: true }, { label: 'Variance', right: true }, { label: 'UOM' }]}
            rows={rows.map((r) => row(<div><div>{s(r.description)}</div><div className="text-xs text-muted-foreground">{s(r.code)}</div></div>, n(r.orders), fmtQty(n(r.required)), fmtQty(n(r.consumed)), fmtQty(n(r.scrapped)),
              <span className={cn(n(r.variance) > 0 ? 'text-red-700' : n(r.variance) < 0 ? 'text-emerald-700' : '')}>{n(r.variance) > 0 ? '+' : ''}{fmtQty(n(r.variance))}</span>, s(r.base_unit)))} />
        </DocSection>
      )}
      {tab === 'output' && (
        <DocSection title="Finished goods output (MOs done in the period)" count={rows.length} flush>
          <Table empty="No output in this period." head={[{ label: 'Finished product' }, { label: 'MOs', right: true }, { label: 'Planned', right: true }, { label: 'Good output', right: true }, { label: 'Rejected', right: true }, { label: 'UOM' }]}
            rows={rows.map((r) => row(<div><div>{s(r.description)}</div><div className="text-xs text-muted-foreground">{s(r.code)}</div></div>, n(r.orders), fmtQty(n(r.planned), 2), <b>{fmtQty(n(r.output), 2)}</b>, fmtQty(n(r.rejected), 2), s(r.base_unit)))} />
        </DocSection>
      )}
      {tab === 'scrap' && (
        <DocSection title="Scrap / waste" count={rows.length} flush>
          <Table empty="No scrap in this period." head={[{ label: 'Date' }, { label: 'MO' }, { label: 'Item' }, { label: 'Quantity', right: true }, { label: 'Base UOM', right: true }, { label: 'Reason' }, { label: 'Recorded by' }, { label: 'Stock' }]}
            rows={rows.map((r) => row(fmtDate(s(r.entry_date)), moLink(r.mo_id, r.number), <div><div>{s(r.description)}</div><div className="text-xs text-muted-foreground">{s(r.code)}{r.is_product ? ' · finished product' : ''}</div></div>,
              `${fmtQty(n(r.qty))} ${s(r.unit)}`, `${fmtQty(n(r.base_qty))} ${s(r.base_unit)}`, s(r.reason), s(r.recorded_by) || '-',
              r.is_product ? <Badge variant="neutral">Never in stock</Badge> : r.posted_at ? <Badge variant="success">Posted</Badge> : <Badge variant="warning">Not posted</Badge>))} />
        </DocSection>
      )}
      {tab === 'trace' && (
        !item ? <p className="py-6 text-center text-sm text-muted-foreground">Select an item: the Manufacturing Orders that produced or used it, and the stock movements they posted.</p> : (
          <div className="space-y-3">
            {rows.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No Manufacturing Order produced or used this item.</p>}
            {rows.map((r) => {
              const moves = (r.movements as Row[]) ?? []
              return (
                <DocSection key={s(r.id)} title={<span className="flex flex-wrap items-center gap-2">{moLink(r.id, r.number)}<Badge variant={r.role === 'PRODUCED' ? 'success' : 'default'}>{r.role === 'PRODUCED' ? 'Produced' : 'Used as component'}</Badge><MoStatusBadge status={s(r.status) as MoStatus} /></span>} flush>
                  <div className="px-4 py-2 text-xs text-muted-foreground">{s(r.product_code)} · {s(r.product_name)} · done {fmtDate(s(r.done_at) || null)}{r.accurate_refs ? ` · Accurate: ${s(r.accurate_refs)}` : ''}</div>
                  <Table empty={MO_STATUS[s(r.status) as MoStatus]?.label === 'Done' ? 'No movements.' : 'Nothing posted (not validated).'} head={[{ label: 'Movement' }, { label: 'Item' }, { label: 'Warehouse' }, { label: 'Qty', right: true }]}
                    rows={moves.map((m) => row(MOVEMENT_LABEL[s(m.type)] ?? s(m.type), <span>{s(m.code)} · {s(m.description)}</span>, s(m.warehouse), <span className={n(m.direction) > 0 ? 'text-emerald-700' : 'text-red-700'}>{n(m.direction) > 0 ? '+' : '−'}{fmtQty(n(m.qty), 2)}</span>))} />
                </DocSection>
              )
            })}
          </div>
        )
      )}
    </div>
  )
}
