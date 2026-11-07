import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '@/components/PageHeader'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  ArrowDown, ArrowUp, CheckCircle2, ChevronRight, ClipboardList, ClipboardPen, Eye, EyeOff, GripVertical, LayoutGrid, Loader2, PackageOpen, Plus, RotateCcw, ShoppingCart, Truck,
} from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { type ReminderModule } from '@/features/reminders/api'
import { useModuleStats, usePreference, useSavePreference, type ModuleStats, type Tone } from '@/features/moduleStats/api'
import { useIrSummary } from '@/features/importantRequests/api'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** [bar / dot, number text] per tone */
const TONE: Record<Tone, [string, string]> = {
  amber: ['bg-amber-500', 'text-amber-600'], blue: ['bg-blue-500', 'text-blue-700'], violet: ['bg-violet-500', 'text-violet-700'], indigo: ['bg-indigo-500', 'text-indigo-700'],
  emerald: ['bg-emerald-500', 'text-emerald-700'], slate: ['bg-slate-400', 'text-slate-600'], orange: ['bg-orange-500', 'text-orange-600'], teal: ['bg-teal-500', 'text-teal-700'], red: ['bg-red-500', 'text-red-600'],
}

const num = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 2 })
/** Rp 1,2 M / Rp 350 jt — short enough for a tile */
const rupiah = (n: number) => 'Rp ' + n.toLocaleString('id-ID', { notation: 'compact', maximumFractionDigits: 1 })
const fmt = (n: number, f?: string) => (f === 'rupiah' ? rupiah(n) : num(n))
const day = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

/** The "Perlu dikerjakan" reminder center (shared with the main dashboard). */
export { ReminderList } from '@/components/reminders/ReminderCenter'
import { ReminderList } from '@/components/reminders/ReminderCenter'
import { DraftLinesList } from '@/pages/PpbDraftPage'
import { PoTodoList } from '@/pages/PoFlowPages'

// ------------------------------------------------------------------ widgets

/** Odoo-like key numbers: one tile each, a link where it leads somewhere. */
function Kpis({ s }: { s: ModuleStats }) {
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {s.kpis.map((k) => {
        const body = (
          <>
            <div className="text-xs font-medium text-muted-foreground">{k.label}</div>
            <div className={cn('mt-0.5 truncate text-lg font-semibold tabular-nums', k.tone ? TONE[k.tone][1] : 'text-foreground')} title={k.format === 'rupiah' ? 'Rp ' + num(k.value) : undefined}>{fmt(k.value, k.format)}</div>
          </>
        )
        const cls = 'block rounded-lg border bg-card px-3 py-2.5 shadow-[0_1px_2px_rgb(15_23_42/0.05)]'
        return k.to
          ? <Link key={k.key} to={k.to} className={cn(cls, 'transition-colors hover:bg-muted/40')}>{body}</Link>
          : <div key={k.key} className={cls}>{body}</div>
      })}
    </div>
  )
}

/** Documents per day, 14 days: one series, thin rounded bars, a tooltip on hover. */
function Trend({ s }: { s: ModuleStats }) {
  const data = s.trend.points.map((p) => ({ ...p, label: day(p.date) }))
  const total = data.reduce((n, p) => n + p.value, 0)
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">{s.trend.label} · 14-day total <b className="text-foreground">{num(total)}</b></div>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 6, right: 4, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ fill: 'hsl(var(--muted))' }} formatter={(v) => [num(Number(v)), 'Quantity']} labelFormatter={(l) => String(l)} />
            <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/** The share per status: one stacked bar, a legend with counts and percentages. */
function Status({ s }: { s: ModuleStats }) {
  const total = s.status.reduce((n, x) => n + x.value, 0)
  return (
    <div className="space-y-4">
      {s.status_label && <div className="text-xs text-muted-foreground">{s.status_label}</div>}
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-muted">
        {total > 0 && s.status.filter((x) => x.value > 0).map((x) => (
          <div key={x.key} className={cn('h-full first:rounded-l-full last:rounded-r-full', TONE[x.tone][0])} style={{ width: `${(x.value / total) * 100}%` }} title={`${x.label}: ${num(x.value)}`} />
        ))}
      </div>
      <ul className="space-y-1.5 text-sm">
        {s.status.map((x) => (
          <li key={x.key} className="flex items-center gap-2">
            <span className={cn('size-2.5 shrink-0 rounded-full', TONE[x.tone][0])} />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{x.label}</span>
            <span className="tabular-nums font-medium">{num(x.value)}</span>
            <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{total ? Math.round((x.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The top five: name, a bar against the biggest, the value. */
function Top({ s }: { s: ModuleStats }) {
  const max = Math.max(1, ...s.top.rows.map((r) => r.value))
  if (s.top.rows.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">No data yet.</p>
  return (
    <ol className="space-y-3">
      {s.top.rows.map((r, i) => (
        <li key={i} className="space-y-1">
          <div className="flex items-baseline gap-2 text-sm">
            <span className="w-4 shrink-0 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate font-medium" title={r.name}>{r.name}</span>
            <span className="shrink-0 tabular-nums font-semibold">{s.top.unit === 'rupiah' ? rupiah(r.value) : num(r.value)}</span>
          </div>
          <div className="ml-6 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary/70" style={{ width: `${(r.value / max) * 100}%` }} /></div>
            {r.sub && <span className="w-24 shrink-0 truncate text-right text-xs text-muted-foreground">{r.sub}</span>}
          </div>
        </li>
      ))}
    </ol>
  )
}

/** Important Request: the next due dates (Classroom's "Mendatang"). */
function Upcoming() {
  const { data: s } = useIrSummary()
  const list = s ? [...s.near_deadline, ...s.urgent].filter((r, i, all) => all.findIndex((x) => x.id === r.id) === i && !['SELESAI', 'DIBATALKAN', 'DRAFT'].includes(r.status)).slice(0, 6) : []
  if (!s) return <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
  if (list.length === 0) return <p className="text-sm text-muted-foreground">No deadlines coming up.</p>
  return (
    <ul className="space-y-3">
      {list.map((r) => (
        <li key={r.id} className="text-sm">
          <Link to={`/important-requests/${r.id}`} className="line-clamp-2 font-medium hover:text-primary hover:underline">{r.title}</Link>
          <div className={cn('text-xs', r.overdue ? 'font-medium text-red-600' : 'text-muted-foreground')}>
            {r.deadline ? `${r.overdue ? 'Late · ' : 'Deadline '}${new Date(r.deadline).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'No deadline'}
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Important Request: the latest tasks, as stream posts. */
function Latest() {
  const { data: s } = useIrSummary()
  if (!s) return <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
  if (s.latest.length === 0) return <p className="text-sm text-muted-foreground">No tasks yet.</p>
  return (
    <ul className="-mx-4 divide-y">
      {s.latest.slice(0, 6).map((r) => (
        <li key={r.id}>
          <Link to={`/important-requests/${r.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40">
            <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-full text-white', r.status === 'SELESAI' ? 'bg-emerald-500' : r.overdue ? 'bg-red-500' : 'bg-primary')}><ClipboardList className="size-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm"><b className="font-medium">{r.creator ?? '-'}</b> → {r.assignee_names.join(', ') || '-'}: {r.title}</span>
              <span className="block text-xs text-muted-foreground">{r.status_label}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

// ------------------------------------------------------------------ the modules

type Size = 4 | 6 | 8 | 12
type WidgetId = 'todo' | 'kpis' | 'trend' | 'status' | 'top' | 'links' | 'upcoming' | 'latest'
interface Layout { order: WidgetId[]; hidden: WidgetId[]; size: Partial<Record<WidgetId, Size>> }

const MODULES: Record<ReminderModule, {
  title: string; subtitle: string; icon: typeof ClipboardList; banner: string
  links: { to: string; label: string; hint: string; perms: string[] }[]
  widgets: WidgetId[]; size: Partial<Record<WidgetId, Size>>
}> = {
  request: {
    title: 'Item Request', subtitle: 'Employee item requests: verification, approval, then handover.', icon: ClipboardList, banner: 'from-primary to-blue-700',
    links: [
      { to: '/item-requests', label: 'List Request', hint: 'all item requests', perms: ['item_request.create', 'item_request.view'] },
      { to: '/approvals', label: 'Approval', hint: 'manager, director, handover', perms: ['item_request.approve_manager', 'item_request.approve_director', 'item_request.handover', 'npbg.approve_manager', 'npbg.approve_director'] },
      { to: '/npbg', label: 'Delivery Order', hint: 'items out', perms: ['npbg.view'] },
    ],
    widgets: ['kpis', 'todo', 'trend', 'status', 'top', 'links'], size: { kpis: 12, todo: 12, trend: 8, status: 4, top: 6, links: 6 },
  },
  ppb: {
    title: 'Purchase Request', subtitle: 'Purchase request: short items become a Purchase Request, get approved, then go to Draft PO.', icon: PackageOpen, banner: 'from-indigo-600 to-violet-700',
    links: [
      { to: '/ppb', label: 'List Purchase Request', hint: 'all Purchase Requests', perms: ['ppb.view'] },
      { to: '/ppb/drafts', label: 'Draft Purchase Request', hint: 'items needing a Purchase Request', perms: ['ppb.create'] },
      { to: '/purchase-orders/siap-po', label: 'Approved Purchase Request Items', hint: 'items with an approved Purchase Request', perms: ['po.create'] },
    ],
    widgets: ['kpis', 'todo', 'trend', 'status', 'top', 'links'], size: { kpis: 12, todo: 12, trend: 8, status: 4, top: 6, links: 6 },
  },
  po: {
    title: 'Purchase Order', subtitle: 'Approved Purchase Request Items → RFQ → Director picks the vendor → Draft PO, then buy.', icon: ShoppingCart, banner: 'from-emerald-600 to-teal-700',
    links: [
      { to: '/purchase-orders', label: 'List PO', hint: 'all POs', perms: ['po.view'] },
      { to: '/purchase-orders/siap-po', label: 'Approved Purchase Request Items', hint: 'items with an approved Purchase Request', perms: ['po.create'] },
      { to: '/purchase-orders/penawaran', label: 'RFQ', hint: 'vendor price, Director pick', perms: ['po.create', 'po.approve_director'] },
      { to: '/purchase-orders/draft', label: 'Draft PO', hint: 'Director-picked vendor → PO', perms: ['po.create'] },
    ],
    widgets: ['kpis', 'todo', 'trend', 'status', 'top', 'links'], size: { kpis: 12, todo: 12, trend: 8, status: 4, top: 6, links: 6 },
  },
  ri: {
    title: 'Receipt', subtitle: 'Receiving: purchased items received at the warehouse.', icon: Truck, banner: 'from-teal-600 to-cyan-700',
    links: [
      { to: '/ri', label: 'List Receipt', hint: 'all goods receipts', perms: ['ri.view'] },
      { to: '/purchase-orders', label: 'Purchase Order', hint: 'POs awaiting items', perms: ['po.view'] },
    ],
    widgets: ['kpis', 'todo', 'trend', 'status', 'top', 'links'], size: { kpis: 12, todo: 12, trend: 8, status: 4, top: 6, links: 6 },
  },
  important: {
    title: 'Important Request', subtitle: 'Work instructions and tasks: assigned, submitted, then approved.', icon: ClipboardPen, banner: 'from-teal-600 to-emerald-700',
    links: [
      { to: '/important-requests/tugas', label: 'My Tasks', hint: 'work on & submit', perms: ['important_request.access'] },
      { to: '/important-requests/saya', label: 'My Requests', hint: 'tasks you gave', perms: ['important_request.create'] },
      { to: '/important-requests/persetujuan', label: 'Needs Approval', hint: 'results waiting for review', perms: ['important_request.create'] },
    ],
    widgets: ['kpis', 'todo', 'upcoming', 'latest', 'trend', 'status', 'top', 'links'], size: { kpis: 12, todo: 12, upcoming: 4, latest: 8, trend: 8, status: 4, top: 6, links: 6 },
  },
}

const TITLES: Record<WidgetId, string> = {
  todo: 'To do', kpis: 'Summary', trend: '14-day trend', status: 'Per status', top: 'Top', links: 'Shortcuts', upcoming: 'Upcoming', latest: 'Latest',
}
const SPAN: Record<Size, string> = { 4: 'lg:col-span-4', 6: 'lg:col-span-6', 8: 'lg:col-span-8', 12: 'lg:col-span-12' }
const SIZES: [Size, string][] = [[4, '⅓'], [6, '½'], [8, '⅔'], [12, 'Penuh']]

/** the saved layout over the module's default (a widget added later still shows up) */
function merge(saved: Layout | null | undefined, widgets: WidgetId[], size: Layout['size']): Layout {
  const order = [...(saved?.order ?? []).filter((w) => widgets.includes(w)), ...widgets.filter((w) => !saved?.order?.includes(w))]
  return { order, hidden: (saved?.hidden ?? []).filter((w) => widgets.includes(w)), size: { ...size, ...(saved?.size ?? {}) } }
}

/**
 * A menu's Dashboard — Classroom's "what to do" with Odoo's key numbers: reminders, KPI tiles, a 14-day
 * trend, the share per status, the top five and shortcuts. Every user arranges it their way ("Atur
 * tampilan": drag or ▲▼ to move, ⅓ ½ ⅔ Penuh, hide / show), kept on the server; one column on a phone.
 */
export function ModuleDashboardPage({ module }: { module: ReminderModule }) {
  const { hasPermission } = useAuth()
  const canDraftPr = hasPermission('ppb.create')
  const canCreatePo = hasPermission('po.create')
  const m = MODULES[module]
  const stats = useModuleStats(module)
  const prefKey = `dashboard:${module}`
  const saved = usePreference<Layout>(prefKey)
  const save = useSavePreference<Layout>(prefKey)
  const [layout, setLayout] = useState<Layout>(() => merge(null, m.widgets, m.size))
  const [editing, setEditing] = useState(false)
  const [dragging, setDragging] = useState<WidgetId | null>(null)
  useEffect(() => { if (saved.isSuccess) setLayout(merge(saved.data, m.widgets, m.size)) }, [saved.isSuccess, saved.data]) // eslint-disable-line react-hooks/exhaustive-deps

  const links = m.links.filter((l) => l.perms.some((p) => hasPermission(p)))
  const visible = layout.order.filter((w) => !layout.hidden.includes(w) && (w !== 'links' || links.length > 0))
  const hidden = layout.order.filter((w) => layout.hidden.includes(w))

  const change = (next: Layout) => setLayout(next)
  const move = (w: WidgetId, by: -1 | 1) => {
    const order = [...layout.order]
    // step over hidden ones: move among what is shown
    let i = order.indexOf(w), j = i + by
    while (j >= 0 && j < order.length && layout.hidden.includes(order[j])) j += by
    if (j < 0 || j >= order.length) return
    ;[order[i], order[j]] = [order[j], order[i]]
    i = j
    change({ ...layout, order })
  }
  const dropOn = (target: WidgetId) => {
    if (!dragging || dragging === target) return
    const order = layout.order.filter((w) => w !== dragging)
    order.splice(order.indexOf(target), 0, dragging)
    change({ ...layout, order })
  }
  const done = () => { setEditing(false); save.mutate(layout) }
  const reset = () => { const d = merge(null, m.widgets, m.size); setLayout(d); save.mutate(null) }

  const body = useMemo(() => (w: WidgetId) => {
    // Purchase Request: To do is the items ready to process; approvals and drafts stay as reminders below them
    // Purchase Order likewise: the items ready to process, then their vendors
    if (w === 'todo' && module === 'po' && canCreatePo) return <div className="space-y-4"><PoTodoList /><ReminderList module={module} exclude={['po_draft']} /></div>
    if (w === 'todo') return module === 'ppb' && canDraftPr ? <div className="space-y-4"><DraftLinesList /><ReminderList module={module} exclude={['ppb_draft']} /></div> : <ReminderList module={module} />
    if (w === 'upcoming') return <Upcoming />
    if (w === 'latest') return <Latest />
    if (w === 'links') {
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          {links.map((l) => (
            <Link key={l.to} to={l.to} className="group flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors hover:border-primary/40 hover:bg-primary/5">
              <span className="min-w-0 flex-1"><span className="block text-sm font-medium group-hover:text-primary">{l.label}</span><span className="block truncate text-xs text-muted-foreground">{l.hint}</span></span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          ))}
        </div>
      )
    }
    if (!stats.data) return stats.isError ? <p className="text-sm text-destructive">Failed to load data.</p> : <div className="flex h-24 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
    if (w === 'kpis') return <Kpis s={stats.data} />
    if (w === 'trend') return <Trend s={stats.data} />
    if (w === 'status') return <Status s={stats.data} />
    return <Top s={stats.data} />
  }, [module, links, stats.data, stats.isError, canDraftPr, canCreatePo])

  const title = (w: WidgetId) => (w === 'top' && stats.data ? stats.data.top.label : TITLES[w])

  return (
    <div className="space-y-3">
      <PageHeader title={m.title} subtitle={m.subtitle} actions={<>
        {editing ? (
          <Button size="sm" onClick={done} disabled={save.isPending}>{save.isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Done</Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}><LayoutGrid className="size-4" /> Arrange view</Button>
        )}
      </>} />

      {editing && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-4 py-3 text-sm">
          <span className="mr-auto text-muted-foreground">Drag <GripVertical className="inline size-4" /> or use ▲▼ to move, pick a width, or hide a widget.</span>
          {hidden.map((w) => (
            <button key={w} type="button" onClick={() => change({ ...layout, hidden: layout.hidden.filter((x) => x !== w) })}
              className="inline-flex items-center gap-1 rounded-full border bg-card px-3 py-1 text-xs font-medium hover:border-primary hover:text-primary">
              <Plus className="size-3.5" /> {TITLES[w]}
            </button>
          ))}
          <Button size="sm" variant="ghost" className="h-8" onClick={reset}><RotateCcw className="size-4" /> Reset to default</Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {visible.map((w, idx) => {
          const size = layout.size[w] ?? 12
          // the KPI tiles are cards already: no frame around them (except while arranging)
          const bare = w === 'kpis' && !editing
          return (
            <section key={w} className={cn('min-w-0 transition-opacity', SPAN[size],
              bare ? '' : 'overflow-hidden rounded border bg-card',
              editing && 'rounded-lg ring-1 ring-dashed ring-primary/30', dragging === w && 'opacity-40')}
              draggable={editing} onDragStart={() => setDragging(w)} onDragEnd={() => setDragging(null)}
              onDragOver={(e) => { if (editing) e.preventDefault() }} onDrop={() => { dropOn(w); setDragging(null) }}>
              <div className={cn('flex flex-wrap items-center gap-2', bare ? 'sr-only' : 'border-b px-4 py-2.5')}>
                {editing && <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground" aria-hidden />}
                <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title(w)}</h2>
                {editing && (
                  // its own row under the title, so a narrow widget keeps its name readable
                  <div className="flex w-full flex-wrap items-center justify-end gap-1 border-t pt-2">
                    <div className="hidden rounded-lg border bg-muted/40 p-0.5 lg:flex" role="radiogroup" aria-label={`Width ${TITLES[w]}`}>
                      {SIZES.map(([sz, label]) => (
                        <button key={sz} type="button" role="radio" aria-checked={size === sz} onClick={() => change({ ...layout, size: { ...layout.size, [w]: sz } })}
                          className={cn('rounded-md px-2 py-0.5 text-xs font-medium', size === sz ? 'bg-card text-primary' : 'text-muted-foreground hover:text-foreground')}>{label}</button>
                      ))}
                    </div>
                    <Button size="sm" variant="ghost" className="size-8 p-0" disabled={idx === 0} onClick={() => move(w, -1)} aria-label={`Move up ${TITLES[w]}`}><ArrowUp className="size-4" /></Button>
                    <Button size="sm" variant="ghost" className="size-8 p-0" disabled={idx === visible.length - 1} onClick={() => move(w, 1)} aria-label={`Move down ${TITLES[w]}`}><ArrowDown className="size-4" /></Button>
                    <Button size="sm" variant="ghost" className="size-8 p-0" onClick={() => change({ ...layout, hidden: [...layout.hidden, w] })} aria-label={`Hide ${TITLES[w]}`}><EyeOff className="size-4" /></Button>
                  </div>
                )}
              </div>
              <div className={bare ? '' : 'p-4'}>{body(w)}</div>
            </section>
          )
        })}
        {visible.length === 0 && (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground lg:col-span-12">
            All widgets are hidden. <button type="button" className="font-medium text-primary hover:underline" onClick={() => change({ ...layout, hidden: [] })}><Eye className="mr-1 inline size-4" />Show all</button>
          </div>
        )}
      </div>
    </div>
  )
}
