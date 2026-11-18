import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Loader2, ShieldAlert } from 'lucide-react'
import { api } from '@/lib/api'
import { useModuleStats, type Tone } from '@/features/moduleStats/api'
import { useReminders, type ReminderModule } from '@/features/reminders/api'
import { APPROVAL_PERMISSIONS, useApprovals } from '@/features/itemRequests/api'
import { useActivityLogs } from '@/features/activityLogs/api'
import { MO_STATUS, useMrpDashboard, type MoStatus } from '@/features/mrp/api'
import { DSA_STATUS, useDsaDashboard } from '@/features/disassembly/api'
import { cn } from '@/lib/utils'
import type { Widget, WidgetType } from './api'

/**
 * The sources a widget can read: each one an API STOCKWISE already has, read with the viewer's token (so the
 * data follows the viewer's permissions). `permissions`: who is offered the source in the picker (any one of
 * them); the server checks again when the data is read. The types match CustomDashboardController::SOURCES.
 */
export const SOURCES: { key: string; label: string; group: string; types: WidgetType[]; permissions?: string[] }[] = [
  { key: 'stats.request', label: 'Item Request statistics', group: 'Inventory', types: ['kpi', 'line', 'pie', 'bar', 'table'], permissions: ['item_request.view', 'item_request.create', 'item_request.process'] },
  { key: 'stats.ri', label: 'Receipt statistics', group: 'Inventory', types: ['kpi', 'line', 'pie', 'bar', 'table'], permissions: ['ri.view'] },
  { key: 'recent.item_requests', label: 'Recent Item Requests', group: 'Inventory', types: ['table'], permissions: ['item_request.view', 'item_request.create'] },
  { key: 'recent.npbg', label: 'Recent Delivery Orders', group: 'Inventory', types: ['table'], permissions: ['npbg.view'] },
  { key: 'recent.ri', label: 'Recent Receipts', group: 'Inventory', types: ['table'], permissions: ['ri.view'] },
  { key: 'stats.ppb', label: 'Purchase Request statistics', group: 'Purchase', types: ['kpi', 'line', 'pie', 'bar', 'table'], permissions: ['ppb.view', 'ppb.create'] },
  { key: 'stats.po', label: 'Purchase Order statistics', group: 'Purchase', types: ['kpi', 'line', 'pie', 'bar', 'table'], permissions: ['po.view', 'po.create'] },
  { key: 'recent.po', label: 'Recent Purchase Orders', group: 'Purchase', types: ['table'], permissions: ['po.view'] },
  { key: 'mrp', label: 'Manufacturing Orders by status', group: 'Manufacturing', types: ['kpi', 'bar', 'pie'], permissions: ['mrp.view'] },
  { key: 'disassembly', label: 'Disassembly Orders by status', group: 'Manufacturing', types: ['kpi', 'bar', 'pie'], permissions: ['disassembly.view'] },
  { key: 'stats.important', label: 'Important Request statistics', group: 'Tasks', types: ['kpi', 'line', 'pie', 'bar', 'table'], permissions: ['important_request.access'] },
  { key: 'todo.all', label: 'To do: everything waiting for me', group: 'Tasks', types: ['list'] },
  { key: 'todo.request', label: 'To do: Item Request', group: 'Tasks', types: ['list'], permissions: ['item_request.view', 'item_request.create', 'item_request.process'] },
  { key: 'todo.ppb', label: 'To do: Purchase Request', group: 'Tasks', types: ['list'], permissions: ['ppb.view', 'ppb.create'] },
  { key: 'todo.po', label: 'To do: Purchase Order', group: 'Tasks', types: ['list'], permissions: ['po.view', 'po.create'] },
  { key: 'todo.ri', label: 'To do: Receipt', group: 'Tasks', types: ['list'], permissions: ['ri.view'] },
  { key: 'todo.important', label: 'To do: Important Request', group: 'Tasks', types: ['list'], permissions: ['important_request.access'] },
  { key: 'approvals', label: 'Pending Approvals', group: 'Tasks', types: ['list'], permissions: APPROVAL_PERMISSIONS },
  { key: 'activity', label: 'Activity summary (user log)', group: 'System', types: ['list'], permissions: ['audit_log.view'] },
]

export const TYPE_LABEL: Record<WidgetType, string> = { kpi: 'KPI cards', line: 'Line chart', bar: 'Bar chart', pie: 'Pie chart', table: 'Data table', list: 'List' }

export const sourceOf = (key: string) => SOURCES.find((s) => s.key === key)
export const canUse = (key: string, has: (p: string) => boolean) => { const s = sourceOf(key); return !!s && (!s.permissions || s.permissions.some(has)) }

const TONE: Record<Tone, string> = { amber: '#f59e0b', blue: '#3b82f6', violet: '#8b5cf6', indigo: '#6366f1', emerald: '#10b981', slate: '#64748b', orange: '#f97316', teal: '#14b8a6', red: '#ef4444' }
const PALETTE = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#14b8a6', '#ef4444', '#6366f1', '#64748b']
const num = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 2 })
const rupiah = (n: number) => 'Rp ' + n.toLocaleString('id-ID', { notation: 'compact', maximumFractionDigits: 1 })
const fmtDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '')

/** what a widget shows when its data is out of reach for this viewer, still loading, or empty */
function State({ q, empty, children }: { q: { isLoading: boolean; isError: boolean; error: unknown }; empty?: boolean; children: ReactNode }) {
  if (q.isLoading) return <div className="flex h-full items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
  if (q.isError) {
    const status = (q.error as { response?: { status?: number } })?.response?.status
    return <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-sm text-muted-foreground"><ShieldAlert className="size-5" />{status === 403 ? 'No access to this data' : 'Could not load the data'}</div>
  }
  if (empty) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No data yet.</div>
  return <>{children}</>
}

type Series = { name: string; value: number; color?: string }[]

function Kpis({ items }: { items: { label: string; value: number; to?: string; rupiah?: boolean; warn?: boolean }[] }) {
  return (
    <div className="grid h-full auto-rows-min grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((k) => {
        const body = <><div className="truncate text-xs text-muted-foreground">{k.label}</div><div className={cn('mt-0.5 truncate text-lg font-semibold tabular-nums', k.warn && k.value > 0 && 'text-amber-600')}>{k.rupiah ? rupiah(k.value) : num(k.value)}</div></>
        return k.to
          ? <Link key={k.label} to={k.to} className="rounded-md border bg-muted/30 px-3 py-2 hover:bg-muted/60">{body}</Link>
          : <div key={k.label} className="rounded-md border bg-muted/30 px-3 py-2">{body}</div>
      })}
    </div>
  )
}

function BarSeries({ data }: { data: Series }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} height={36} />
        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
        <Tooltip />
        <Bar dataKey="value" radius={[3, 3, 0, 0]}>{data.map((d, i) => <Cell key={d.name} fill={d.color ?? PALETTE[i % PALETTE.length]} />)}</Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function PieSeries({ data }: { data: Series }) {
  const shown = data.filter((d) => d.value > 0)
  return (
    <div className="flex h-full items-center gap-3">
      <ResponsiveContainer width="55%" height="100%">
        <PieChart><Pie data={shown} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2}>{shown.map((d, i) => <Cell key={d.name} fill={d.color ?? PALETTE[i % PALETTE.length]} />)}</Pie><Tooltip /></PieChart>
      </ResponsiveContainer>
      <ul className="min-w-0 flex-1 space-y-1 text-xs">
        {shown.map((d, i) => <li key={d.name} className="flex items-center gap-1.5"><span className="size-2.5 shrink-0 rounded-full" style={{ background: d.color ?? PALETTE[i % PALETTE.length] }} /><span className="min-w-0 flex-1 truncate">{d.name}</span><span className="tabular-nums">{num(d.value)}</span></li>)}
      </ul>
    </div>
  )
}

function Rows({ rows }: { rows: { key: string | number; title: string; sub?: string | null; right?: string | null; to?: string }[] }) {
  return (
    <ul className="-mx-1 divide-y overflow-y-auto text-sm">
      {rows.map((r) => {
        const body = <><span className="min-w-0 flex-1"><span className="block truncate font-medium">{r.title}</span>{r.sub && <span className="block truncate text-xs text-muted-foreground">{r.sub}</span>}</span>{r.right && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{r.right}</span>}</>
        return <li key={r.key}>{r.to ? <Link to={r.to} className="flex items-center gap-3 rounded px-1 py-1.5 hover:bg-muted/50">{body}</Link> : <div className="flex items-center gap-3 px-1 py-1.5">{body}</div>}</li>
      })}
    </ul>
  )
}

function StatsWidget({ module, type }: { module: ReminderModule; type: WidgetType }) {
  const q = useModuleStats(module)
  const s = q.data
  return (
    <State q={q} empty={!!s && type !== 'kpi' && (type === 'line' ? s.trend.points.length === 0 : type === 'table' ? s.top.rows.length === 0 : s.status.every((x) => !x.value))}>
      {s && type === 'kpi' && <Kpis items={s.kpis.map((k) => ({ label: k.label, value: k.value, to: k.to, rupiah: k.format === 'rupiah' }))} />}
      {s && type === 'line' && (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={s.trend.points.map((p) => ({ name: fmtDate(p.date), value: p.value }))} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} minTickGap={16} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip /><Line type="monotone" dataKey="value" name={s.trend.label} stroke="#3b82f6" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
      {s && type === 'bar' && <BarSeries data={s.status.map((x) => ({ name: x.label, value: x.value, color: TONE[x.tone] }))} />}
      {s && type === 'pie' && <PieSeries data={s.status.map((x) => ({ name: x.label, value: x.value, color: TONE[x.tone] }))} />}
      {s && type === 'table' && <Rows rows={s.top.rows.map((r, i) => ({ key: i, title: r.name, sub: r.sub, right: s.top.unit === 'rupiah' ? rupiah(r.value) : num(r.value) }))} />}
    </State>
  )
}

function TodoWidget({ module }: { module?: ReminderModule }) {
  const q = useReminders(module, true)
  const rows = q.data?.data ?? []
  return <State q={q} empty={rows.length === 0}><Rows rows={rows.map((r) => ({ key: r.key, title: `${r.count} ${r.text}`, sub: r.overdue ? `${r.overdue} late` : null, to: r.to }))} /></State>
}

function ApprovalsWidget() {
  const q = useApprovals('todo')
  const rows = q.data?.data ?? []
  return <State q={q} empty={rows.length === 0}><Rows rows={rows.slice(0, 20).map((r) => ({ key: r.id, title: r.number, sub: [r.requester_name, r.status_label].filter(Boolean).join(' · '), to: '/approvals' }))} /></State>
}

function ActivityWidget() {
  const q = useActivityLogs({})
  const rows = q.data?.data ?? []
  return <State q={q} empty={rows.length === 0}><Rows rows={rows.slice(0, 20).map((r) => ({ key: r.id, title: r.description ?? r.event, sub: [r.user_name, r.module].filter(Boolean).join(' · '), right: fmtDate(r.at) }))} /></State>
}

function StatusCounts({ counts, labels, to, type, extra }: { counts: Record<string, number>; labels: Record<string, { label: string }>; to: string; type: WidgetType; extra?: { label: string; value: number; to: string } }) {
  const data = Object.entries(labels).map(([k, v]) => ({ name: v.label, value: counts[k] ?? 0, key: k }))
  if (type === 'kpi') return <Kpis items={[...data.map((d) => ({ label: d.name, value: d.value, to: `${to}?status=${d.key}`, warn: d.key === 'TO_CLOSE' })), ...(extra ? [{ ...extra, warn: true }] : [])]} />
  return type === 'pie' ? <PieSeries data={data} /> : <BarSeries data={data} />
}

function MrpWidget({ type }: { type: WidgetType }) {
  const q = useMrpDashboard()
  return <State q={q}>{q.data && <StatusCounts counts={q.data.counts as Record<MoStatus, number>} labels={MO_STATUS} to="/mrp/orders" type={type} extra={{ label: 'Not in Accurate', value: q.data.not_in_accurate, to: '/mrp/orders?not_in_accurate=1' }} />}</State>
}

function DsaWidget({ type }: { type: WidgetType }) {
  const q = useDsaDashboard()
  return <State q={q}>{q.data && <StatusCounts counts={q.data.counts} labels={DSA_STATUS} to="/disassembly/orders" type={type} extra={{ label: 'Not in Accurate', value: q.data.not_in_accurate, to: '/disassembly/orders?not_in_accurate=1' }} />}</State>
}

/** The latest documents of a list the user already opens elsewhere (its own API, its own permissions). */
const RECENT: Record<string, { url: string; row: (r: Record<string, never>) => { key: number; title: string; sub?: string | null; right?: string | null; to?: string } }> = {
  'recent.item_requests': { url: '/api/item-requests', row: (r) => ({ key: r.id, title: r.number, sub: [r.requester_name, r.status_label].filter(Boolean).join(' · '), right: fmtDate(r.created_at), to: `/item-requests/${r.id}` }) },
  'recent.npbg': { url: '/api/npbg', row: (r) => ({ key: r.id, title: r.no_npbg ?? '-', sub: r.deskripsi_barang, right: fmtDate(r.tgl_npbg), to: '/npbg' }) },
  'recent.po': { url: '/api/purchase-orders', row: (r) => ({ key: r.id, title: r.po_number, sub: [r.vendor_name, r.description].filter(Boolean).join(' · '), right: fmtDate(r.po_date), to: `/purchase-orders/${r.po_id}` }) },
  'recent.ri': { url: '/api/ri', row: (r) => ({ key: r.id, title: r.no_ri ?? '-', sub: [r.vendor, r.deskripsi_barang].filter(Boolean).join(' · '), right: fmtDate(r.tgl_ri), to: `/ri/${r.id}` }) },
}

function RecentWidget({ source }: { source: string }) {
  const def = RECENT[source]
  const q = useQuery({
    queryKey: ['custom-dashboard', 'recent', source],
    queryFn: async () => (await api.get<{ data: Record<string, never>[] }>(def.url, { params: { per_page: 10, page: 1 } })).data.data,
    refetchInterval: 120_000,
  })
  const rows = q.data ?? []
  return <State q={q} empty={rows.length === 0}><Rows rows={rows.slice(0, 10).map(def.row)} /></State>
}

/** The body of one widget, from its source and type. */
export function WidgetBody({ widget }: { widget: Widget }) {
  const { source, type } = widget
  if (source.startsWith('stats.')) return <StatsWidget module={source.slice(6) as ReminderModule} type={type} />
  if (source === 'todo.all') return <TodoWidget />
  if (source.startsWith('todo.')) return <TodoWidget module={source.slice(5) as ReminderModule} />
  if (source === 'approvals') return <ApprovalsWidget />
  if (source === 'activity') return <ActivityWidget />
  if (source === 'mrp') return <MrpWidget type={type} />
  if (source === 'disassembly') return <DsaWidget type={type} />
  if (RECENT[source]) return <RecentWidget source={source} />
  return <p className="text-sm text-muted-foreground">This data source is no longer available.</p>
}

/** A widget's own title, or what it shows by default. */
export const widgetTitle = (w: Widget) => w.title || `${sourceOf(w.source)?.label ?? w.source}${sourceOf(w.source)?.types.length === 1 ? '' : ` · ${TYPE_LABEL[w.type]}`}`
