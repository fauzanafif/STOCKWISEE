import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Boxes, CheckCircle2, Clock, HeartPulse, PackageX, ShoppingCart, Truck } from 'lucide-react'
import { useDashboard, useInventoryDashboard, useInventoryDashboardFilters, useOperationsDashboard, type InventoryDashboardFilters } from '@/features/dashboard/api'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { GroupedBars, MixBar, RankedBars, StackedBars, Trend, Columns } from './charts'
import { fmt, Kpi, KpiRow, ModuleSection, Panel, STATUS, useViz } from './viz'

/** 2026-01 → "Jan 26" */
const month = (s: string) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(s))
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) : String(s)
}

/** the stock states (status colours, each with its word) */
const STOCK = [
  { key: 'AMAN', label: 'Safe', color: STATUS.good },
  { key: 'TIDAK_AMAN', label: 'Not safe (to buy)', color: STATUS.critical },
  { key: 'BEP', label: 'Empty, no usage', color: '#9a9890' },
] as const

function Loading() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-[86px] animate-pulse rounded-xl border bg-muted/40" />)}</div>
      <div className="grid gap-4 lg:grid-cols-2">{Array.from({ length: 4 }, (_, i) => <div key={i} className="h-72 animate-pulse rounded-xl border bg-muted/40" />)}</div>
    </div>
  )
}

function PanelLoading() {
  return <div className="h-72 animate-pulse rounded-xl border bg-muted/40" aria-label="Loading" />
}

/* ------------------------------------------------------------------ Inventory */

export function InventoryAnalytics() {
  const v = useViz()
  const [f, setF] = useState<InventoryDashboardFilters>({})
  const options = useInventoryDashboardFilters()
  const { data: d, isLoading } = useInventoryDashboard(f)
  const k = d?.kpis
  const c = d?.charts
  const total = k?.total_barang ?? 0
  const pct = (n: number) => (total ? `${fmt((n / total) * 100, 1)}% of the items` : '')

  return (
    <ModuleSection id="inventory" title="Inventory" description="Stock health against safety stock, usage through Delivery Orders, and what to buy first."
      filters={<>
        <Select className="h-9 w-44" aria-label="Warehouse" value={f.warehouse_id ?? ''} onChange={(e) => setF((x) => ({ ...x, warehouse_id: e.target.value ? Number(e.target.value) : undefined }))}>
          <option value="">All warehouses</option>
          {options.data?.warehouses.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}
        </Select>
        <Select className="h-9 w-52" aria-label="Category" value={f.accurate_category_induk ?? ''} onChange={(e) => setF((x) => ({ ...x, accurate_category_induk: e.target.value || undefined }))}>
          <option value="">All categories</option>
          {options.data?.categories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
        </Select>
      </>}>
      {isLoading || !d || !k || !c ? <Loading /> : (
        <>
          <KpiRow>
            <Kpi label="Items" icon={<Boxes className="size-3.5" />} value={fmt(total)} sub={`${fmt(k.total_stok)} in stock · safety ${fmt(k.total_batas_aman)}`} />
            <Kpi label="Safe" icon={<CheckCircle2 className="size-3.5" />} tone="good" value={fmt(k.barang_aman)} sub={pct(k.barang_aman)} />
            <Kpi label="Not safe" icon={<AlertTriangle className="size-3.5" />} tone="critical" value={fmt(k.perlu_dibeli)} sub="below safety stock: to buy" />
            <Kpi label="Shortage" icon={<ShoppingCart className="size-3.5" />} tone={k.total_kekurangan > 0 ? 'warning' : null} value={fmt(k.total_kekurangan)} sub="units missing to safety stock" />
            <Kpi label="Empty, no usage" icon={<PackageX className="size-3.5" />} value={fmt(k.barang_bep)} sub="stock and safety stock 0 (not to buy)" />
            <Kpi label="Health score" icon={<HeartPulse className="size-3.5" />} tone={d.health_score.category === 'Sehat' ? 'good' : d.health_score.category === 'Kritis' ? 'critical' : 'warning'}
              value={`${fmt(d.health_score.value, 1)}`} sub={d.health_score.category === 'Sehat' ? 'Healthy' : d.health_score.category === 'Kritis' ? 'Critical' : 'Needs attention'} />
          </KpiRow>

          <Panel title="Stock status mix" subtitle="Every item by its state against safety stock"
            table={{ columns: ['State', 'Items'], rows: STOCK.map((s) => [s.label, c.status_distribution.find((x) => x.name === s.key)?.value ?? 0]) }}>
            <MixBar parts={STOCK.map((s) => ({ label: s.label, color: s.color, value: c.status_distribution.find((x) => x.name === s.key)?.value ?? 0 }))} />
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Stock health per warehouse" subtitle="Share of items in each state" legend={STOCK.map((s) => ({ name: s.label, color: s.color }))} empty={!c.per_warehouse.length}
              table={{ columns: ['Warehouse', ...STOCK.map((s) => s.label)], rows: c.per_warehouse.map((r) => [r.name, r.AMAN, r.TIDAK_AMAN, r.BEP]) }}>
              <StackedBars data={c.per_warehouse} percent series={STOCK.map((s) => ({ key: s.key, label: s.label, color: s.color }))} />
            </Panel>
            <Panel title="Stock health per category" subtitle="Share of items in each state, the largest categories" legend={STOCK.map((s) => ({ name: s.label, color: s.color }))} empty={!c.per_category.length}
              table={{ columns: ['Category', ...STOCK.map((s) => s.label)], rows: c.per_category.map((r) => [r.name, r.AMAN, r.TIDAK_AMAN, r.BEP]) }}>
              <StackedBars data={c.per_category.slice(0, 10)} percent series={STOCK.map((s) => ({ key: s.key, label: s.label, color: s.color }))} />
            </Panel>
            <Panel title="Largest shortages" subtitle="Units missing to reach safety stock" empty={!c.top_deficit.length}
              table={{ columns: ['Item', 'Shortage'], rows: c.top_deficit.map((r) => [`${r.code} ${r.description}`, r.deficit]) }}>
              <RankedBars data={c.top_deficit.slice(0, 10).map((r) => ({ name: `${r.code} · ${r.description}`, deficit: r.deficit }))} value="deficit" label="Shortage" color={v.series[1]} />
            </Panel>
            <Panel title="Stock vs safety stock per warehouse" subtitle="Total units on hand against the safety stock they should hold" empty={!c.stock_vs_safety_per_warehouse.length}
              legend={[{ name: 'In stock', color: v.series[0] }, { name: 'Safety stock', color: v.series[1] }]}
              table={{ columns: ['Warehouse', 'In stock', 'Safety stock'], rows: c.stock_vs_safety_per_warehouse.map((r) => [r.name, r.total_stok, r.total_batas_aman]) }}>
              <GroupedBars data={c.stock_vs_safety_per_warehouse} series={[{ key: 'total_stok', label: 'In stock', color: v.series[0] }, { key: 'total_batas_aman', label: 'Safety stock', color: v.series[1] }]} />
            </Panel>
            <Panel title="Delivery Orders per month" subtitle="Documents issued (goods out of the warehouse)" empty={!c.npbg_per_month.length}
              table={{ columns: ['Month', 'Documents', 'Qty'], rows: c.npbg_per_month.map((r) => [month(r.name), r.count, r.qty]) }}>
              <Columns data={c.npbg_per_month.map((r) => ({ ...r, name: month(r.name) }))} value="count" label="Delivery Orders" color={v.series[0]} />
            </Panel>
            <Panel title="Most used items" subtitle="By Delivery Order lines" empty={!c.npbg_top_usage.length}
              table={{ columns: ['Item', 'Lines', 'Qty'], rows: c.npbg_top_usage.map((r) => [r.name, r.count, r.qty]) }}>
              <RankedBars data={c.npbg_top_usage.slice(0, 10)} value="count" label="Lines" color={v.series[2]} />
            </Panel>
            <Panel title="Divisions using the most" subtitle="Delivery Order lines per division" empty={!c.npbg_top_divisi.length}
              table={{ columns: ['Division', 'Lines', 'Qty'], rows: c.npbg_top_divisi.map((r) => [r.name, r.count, r.qty]) }}>
              <RankedBars data={c.npbg_top_divisi.slice(0, 10)} value="count" label="Lines" color={v.series[6]} />
            </Panel>
            <Panel title="Buy first" subtitle="Items below safety stock, the highest priority (shortage × lead time)" empty={!d.priority_items.length}>
              <div className="max-h-72 overflow-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/80 text-left text-muted-foreground backdrop-blur">
                    <tr><th className="px-2.5 py-1.5 font-medium">Item</th><th className="px-2.5 py-1.5 text-right font-medium">Shortage</th><th className="px-2.5 py-1.5 text-right font-medium">Lead time</th><th className="px-2.5 py-1.5 font-medium">Priority</th></tr>
                  </thead>
                  <tbody className="divide-y">
                    {d.priority_items.slice(0, 15).map((p) => (
                      <tr key={p.code}>
                        <td className="px-2.5 py-1.5"><span className="block font-medium">{p.code}</span><span className="line-clamp-1 text-muted-foreground">{p.description}</span></td>
                        <td className="px-2.5 py-1.5 text-right tabular-nums">{fmt(p.deficit)}</td>
                        <td className="px-2.5 py-1.5 text-right tabular-nums">{p.lead_time_days} d</td>
                        <td className="px-2.5 py-1.5"><PriorityWord level={p.priority_level} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
          {d.notes.length > 0 && (
            <ul className="space-y-1 rounded-xl border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
              {d.notes.map((n) => <li key={n} className="flex gap-2"><span aria-hidden>•</span>{n}</li>)}
            </ul>
          )}
        </>
      )}
    </ModuleSection>
  )
}

function PriorityWord({ level }: { level: string }) {
  const tone = level === 'HIGH' ? STATUS.critical : level === 'MEDIUM' ? STATUS.warning : STATUS.good
  return <span className="inline-flex items-center gap-1.5 font-medium"><span className="size-2 rounded-full" style={{ background: tone }} aria-hidden />{level === 'HIGH' ? 'High' : level === 'MEDIUM' ? 'Medium' : 'Low'}</span>
}

/* ------------------------------------------------------------------ Purchase */

export function PurchaseAnalytics() {
  const v = useViz()
  const ops = useOperationsDashboard()
  const inv = useInventoryDashboard({})
  const main = useDashboard()
  const o = ops.data
  const c = inv.data?.charts
  const poStatus = main.data?.charts?.po_status ?? []
  const last = o?.purchase_flow.at(-1)
  const prev = o?.purchase_flow.at(-2)
  const open = c ? (c.ppb_status.find((x) => x.name === 'REQUESTED')?.value ?? 0) + (c.ppb_status.find((x) => x.name === 'SHORTAGE')?.value ?? 0) : 0
  const old = o ? o.ppb_aging.filter((a) => /> 90|61/.test(a.name)).reduce((t, a) => t + a.requested + a.shortage, 0) : 0
  const flowSeries = [{ key: 'ppb', label: 'Purchase Requests', color: v.series[0] }, { key: 'po', label: 'Purchase Orders', color: v.series[1] }, { key: 'ri', label: 'Receipts', color: v.series[2] }]

  return (
    <ModuleSection id="purchase" title="Purchase" description="From Purchase Request to Purchase Order to Receipt: volume, what waits and for how long.">
      {!o ? <Loading /> : (
        <>
          <KpiRow>
            <Kpi label="Open requests" icon={<Clock className="size-3.5" />} value={c ? fmt(open) : '…'} sub="Purchase Request lines not yet received" />
            <Kpi label="Waiting > 60 days" icon={<AlertTriangle className="size-3.5" />} tone={old > 0 ? 'critical' : 'good'} value={fmt(old)} sub="lines still open after two months" />
            <Kpi label="Requests this month" value={fmt(last?.ppb)} sub={prev ? `${fmt(prev.ppb)} last month` : undefined} />
            <Kpi label="POs this month" icon={<ShoppingCart className="size-3.5" />} value={fmt(last?.po)} sub={prev ? `${fmt(prev.po)} last month` : undefined} />
            <Kpi label="Receipts this month" icon={<Truck className="size-3.5" />} value={fmt(last?.ri)} sub={prev ? `${fmt(prev.ri)} last month` : undefined} />
            <Kpi label="POs in progress" value={fmt(poStatus.filter((p) => !['RECEIVED', 'CLOSED', 'CANCELLED'].includes(p.name)).reduce((t, p) => t + p.value, 0))} sub="sent, bought or partly received" />
          </KpiRow>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Purchase flow per month" subtitle="Documents made each month, request → order → receipt" className="lg:col-span-2" legend={flowSeries.map((s) => ({ name: s.label, color: s.color }))} empty={!o.purchase_flow.length}
              table={{ columns: ['Month', 'Purchase Requests', 'Purchase Orders', 'Receipts'], rows: o.purchase_flow.map((r) => [month(r.month), r.ppb, r.po, r.ri]) }}>
              <Trend data={o.purchase_flow.map((r) => ({ ...r, name: month(r.month) }))} series={flowSeries} height={260} />
            </Panel>
            <Panel title="How long requests wait" subtitle="Open Purchase Request lines by age" legend={[{ name: 'Requested', color: v.series[0] }, { name: 'Shortage (partly received)', color: STATUS.serious }]}
              table={{ columns: ['Age', 'Requested', 'Shortage'], rows: o.ppb_aging.map((r) => [r.name, r.requested, r.shortage]) }}>
              <GroupedBars data={o.ppb_aging} series={[{ key: 'requested', label: 'Requested', color: v.series[0] }, { key: 'shortage', label: 'Shortage', color: STATUS.serious }]} />
            </Panel>
            <Panel title="Purchase Orders by status" empty={!poStatus.length} table={{ columns: ['Status', 'POs'], rows: poStatus.map((r) => [r.name, r.value]) }}>
              <RankedBars data={[...poStatus].sort((a, b) => b.value - a.value)} value="value" label="POs" color={v.series[1]} />
            </Panel>
            {/* these two read the (slower) inventory analysis: they wait on their own, the rest is already there */}
            {!c ? <><PanelLoading /><PanelLoading /></> : (
              <>
                <Panel title="Purchase Request lines by status" empty={!c.ppb_status.length} table={{ columns: ['Status', 'Lines'], rows: c.ppb_status.map((r) => [r.name, r.value]) }}>
                  <RankedBars data={[...c.ppb_status].sort((a, b) => b.value - a.value)} value="value" label="Lines" color={v.series[0]} />
                </Panel>
                <Panel title="Requests per division" empty={!c.ppb_per_divisi.length} table={{ columns: ['Division', 'Lines'], rows: c.ppb_per_divisi.map((r) => [r.name, r.value]) }}>
                  <RankedBars data={c.ppb_per_divisi.slice(0, 10)} value="value" label="Lines" color={v.series[6]} />
                </Panel>
              </>
            )}
            {o.attention.ppb_oldest && (
              <Panel title="Oldest open requests" subtitle="Still not received, the longest waiting first" className="lg:col-span-2" empty={!o.attention.ppb_oldest.length}>
                <div className="max-h-72 overflow-auto rounded-md border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/80 text-left text-muted-foreground backdrop-blur">
                      <tr><th className="px-2.5 py-1.5 font-medium">Purchase Request</th><th className="px-2.5 py-1.5 font-medium">Item</th><th className="px-2.5 py-1.5 text-right font-medium">Received</th><th className="px-2.5 py-1.5 text-right font-medium">Waiting</th></tr>
                    </thead>
                    <tbody className="divide-y">
                      {o.attention.ppb_oldest.map((p) => (
                        <tr key={p.id}>
                          <td className="whitespace-nowrap px-2.5 py-1.5"><Link to={`/ppb/${p.id}`} className="font-medium text-primary hover:underline">{p.no_ppb}</Link></td>
                          <td className="px-2.5 py-1.5"><span className="line-clamp-1">{p.item}</span></td>
                          <td className="px-2.5 py-1.5 text-right tabular-nums">{fmt(p.received)} / {fmt(p.qty)} {p.unit ?? ''}</td>
                          <td className={cn('px-2.5 py-1.5 text-right font-medium tabular-nums', p.age_days > 60 && 'text-red-600')}>{p.age_days} d</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            )}
          </div>
        </>
      )}
    </ModuleSection>
  )
}

/* ------------------------------------------------------------------ Tracking */

export function TrackingAnalytics() {
  const v = useViz()
  const { data: o } = useOperationsDashboard()
  const t = o?.tracking ?? []
  const sum = (k: 'done' | 'running' | 'attention') => t.reduce((n, r) => n + r[k], 0)
  const states = [
    { key: 'done', label: 'Done', color: STATUS.good },
    { key: 'running', label: 'Running', color: v.series[0] },
    { key: 'attention', label: 'Needs attention', color: STATUS.warning },
  ]

  return (
    <ModuleSection id="tracking" title="Tracking" description="Lending, borrowing, serial items, maintenance, tyres and used items: what is out, running or needs a look.">
      {!o ? <Loading /> : (
        <>
          <KpiRow>
            <Kpi label="Records" value={fmt(t.reduce((n, r) => n + r.total, 0))} sub={`${t.length} tracking modules`} />
            <Kpi label="Done" tone="good" icon={<CheckCircle2 className="size-3.5" />} value={fmt(sum('done'))} />
            <Kpi label="Running" icon={<Clock className="size-3.5" />} value={fmt(sum('running'))} />
            <Kpi label="Needs attention" tone={sum('attention') > 0 ? 'warning' : 'good'} icon={<AlertTriangle className="size-3.5" />} value={fmt(sum('attention'))} />
            <Kpi label="Loans past due" tone={(o.attention.lend_overdue?.length ?? 0) > 0 ? 'critical' : 'good'} value={fmt(o.attention.lend_overdue?.length ?? 0)} />
            <Kpi label="Tyres changed" value={fmt(o.tyre_per_month.reduce((n, r) => n + r.count, 0))} sub="in the months shown" />
          </KpiRow>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Each tracking module" subtitle="Records by state (each module's own words in the table)" className="lg:col-span-2" legend={states.map((s) => ({ name: s.label, color: s.color }))} empty={!t.some((r) => r.total)}
              table={{ columns: ['Module', 'Done', 'Running', 'Needs attention', 'Total'], rows: t.map((r) => [r.label, r.done, r.running, r.attention, r.total]) }}>
              <StackedBars data={t.filter((r) => r.total).map((r) => ({ name: r.label, done: r.done, running: r.running, attention: r.attention }))} series={states} />
            </Panel>
            <Panel title="Vehicles with the most maintenance" legend={[{ name: 'Completed', color: STATUS.good }, { name: 'Open', color: v.series[0] }]} empty={!o.maintenance_top_vehicles.length}
              table={{ columns: ['Vehicle', 'Completed', 'Open'], rows: o.maintenance_top_vehicles.map((r) => [r.name, r.completed, r.open]) }}>
              <StackedBars data={o.maintenance_top_vehicles} series={[{ key: 'completed', label: 'Completed', color: STATUS.good }, { key: 'open', label: 'Open', color: v.series[0] }]} />
            </Panel>
            <Panel title="Tyre changes per month" empty={!o.tyre_per_month.some((r) => r.count)} table={{ columns: ['Month', 'Changes'], rows: o.tyre_per_month.map((r) => [month(r.month), r.count]) }}>
              <Columns data={o.tyre_per_month.map((r) => ({ ...r, name: month(r.month) }))} value="count" label="Tyre changes" color={v.series[3]} />
            </Panel>
            {o.attention.lend_overdue && (
              <Panel title="Loans past their due date" className="lg:col-span-2" empty={!o.attention.lend_overdue.length}>
                <div className="max-h-72 overflow-auto rounded-md border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/80 text-left text-muted-foreground backdrop-blur">
                      <tr><th className="px-2.5 py-1.5 font-medium">Loan</th><th className="px-2.5 py-1.5 font-medium">Item</th><th className="px-2.5 py-1.5 font-medium">Borrower</th><th className="px-2.5 py-1.5 text-right font-medium">Late</th></tr>
                    </thead>
                    <tbody className="divide-y">
                      {o.attention.lend_overdue.map((l) => (
                        <tr key={l.id}>
                          <td className="whitespace-nowrap px-2.5 py-1.5 font-medium">{l.number}</td>
                          <td className="px-2.5 py-1.5"><span className="line-clamp-1">{l.item}</span></td>
                          <td className="px-2.5 py-1.5">{l.borrower ?? '—'}</td>
                          <td className="px-2.5 py-1.5 text-right font-medium tabular-nums text-red-600">{l.late_days ?? '—'} d</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            )}
          </div>
        </>
      )}
    </ModuleSection>
  )
}
