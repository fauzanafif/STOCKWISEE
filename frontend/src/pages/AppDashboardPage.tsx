import { createContext, useContext, useRef, useState, type RefObject } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { Button } from '@/components/ui/button'
import { useDsaDashboard } from '@/features/disassembly/api'
import { useMrpDashboard } from '@/features/mrp/api'
import { launcherApps, type LauncherApp } from '@/lib/launcher'
import { CardNoteButton, FloatingCardNotes, cardAnchor } from '@/components/dashboard/CardStickyNotes'
import { useCardStats, useNavCounts, type CardStats } from '@/lib/navCounts'
import { GRAPH_BUCKETS, type ReminderGraph } from '@/features/reminders/api'
import { visibleNav } from '@/lib/navigation'
import { cn } from '@/lib/utils'
import { useCustomDashboards } from '@/features/customDashboards/api'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { DashboardIcon } from '@/pages/CustomDashboardPages'

/**
 * The apps with a dashboard of their own (their Overview cards). Their to-do and analyses moved to the one
 * Dashboard (To-Do / Analytics), where a button picks the app: `module` is that button.
 */
const APPS = { inventory: 'inventory', purchase: 'purchase', manufacturing: 'manufacturing', tracking: 'tracking' } as const

/** a page of the app: one card of the overview */
type Page = { to: string; label: string }

const BAR_LABELS: Record<(typeof GRAPH_BUCKETS)[number], string> = { before: 'Before', yesterday: 'Yesterday', today: 'Today', tomorrow: 'Tomorrow', after: 'After' }

/**
 * The card's bar chart, as on Odoo's Inventory Overview: what waits, by when it should be done. Bars before
 * today are late. With nothing waiting, faint placeholder bars (Odoo's sample graph) keep the cards even.
 */
function CardGraph({ graph }: { graph: ReminderGraph }) {
  const max = Math.max(...GRAPH_BUCKETS.map((b) => graph[b]))
  const empty = max === 0
  return (
    <div className="relative" role="img" aria-label={empty ? 'Nothing to process' : GRAPH_BUCKETS.map((b) => `${BAR_LABELS[b]}: ${graph[b]}`).join(', ')}>
      <div className="flex h-20 items-end gap-2 border-b border-slate-200 dark:border-slate-700">
        {GRAPH_BUCKETS.map((b, i) => {
          const n = graph[b]
          const pct = empty ? [35, 55, 80, 45, 25][i] : Math.max(n ? 6 : 0, (n / max) * 100)
          const late = b === 'before' || b === 'yesterday'
          return (
            <div key={b} className="flex h-full flex-1 flex-col items-center justify-end" title={empty ? undefined : `${BAR_LABELS[b]}: ${n}`}>
              {!empty && n > 0 && <span className="mb-0.5 text-[11px] tabular-nums text-slate-500 dark:text-slate-400">{n}</span>}
              <div style={{ height: `${pct}%` }} className={cn('w-full max-w-9 rounded-t-sm',
                empty ? 'bg-slate-100 dark:bg-slate-800' : late ? 'bg-red-400/80 dark:bg-red-500/70' : b === 'today' ? 'bg-primary' : 'bg-primary/55')} />
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex gap-2">
        {GRAPH_BUCKETS.map((b) => <span key={b} className="flex-1 truncate text-center text-[11px] text-slate-500 dark:text-slate-400">{BAR_LABELS[b]}</span>)}
      </div>
      {empty && <span className="absolute inset-x-0 top-6 text-center text-xs text-slate-400">Nothing to process</span>}
    </div>
  )
}

/** the overview board the cards sit on: which app, and the element sticky notes float over */
const Board = createContext<{ appKey: string; ref: RefObject<HTMLElement | null> } | null>(null)

/** One card: the feature's name, one button to what waits to be processed (or to open it) and, for an operation, its late / urgent counts and the bars by date. */
type Figure = { label: string; value: number; tone: 'warn' | 'bad' | 'ok' | null }

/** The figures of every feature card (GET /api/dashboard/feature-stats), keyed by the feature's menu path. */
function useFeatureStats() {
  return useQuery({
    queryKey: ['dashboard', 'feature-stats'],
    staleTime: 60_000,
    queryFn: async () => (await api.get<{ data: Record<string, Figure[]> }>('/api/dashboard/feature-stats')).data.data,
  })
}

const FIGURE_TONE = { warn: 'text-amber-700 dark:text-amber-400', bad: 'text-red-600 dark:text-red-400', ok: 'text-emerald-700 dark:text-emerald-400' } as const

/** A feature's own figures (how many, what needs a look): a warning figure only shows its colour when it is not 0. */
function Figures({ figures }: { figures: Figure[] }) {
  return (
    <dl className="grid grid-cols-2 gap-3">
      {figures.map((f) => (
        <div key={f.label} className="min-w-0">
          <dd className={cn('text-xl font-semibold tabular-nums leading-tight text-slate-800 dark:text-slate-100', f.tone && f.value > 0 && FIGURE_TONE[f.tone])}>{f.value.toLocaleString('id-ID')}</dd>
          <dt className="truncate text-xs text-slate-500 dark:text-slate-400" title={f.label}>{f.label}</dt>
        </div>
      ))}
    </dl>
  )
}

function Card({ page, todo, stats, figures }: { page: Page; todo?: number; stats?: CardStats; figures?: Figure[] }) {
  const board = useContext(Board)
  return (
    <article aria-label={page.label} className="flex flex-col justify-between gap-4 rounded-md border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgb(15_23_42/0.04)] transition-shadow hover:shadow-[0_4px_12px_rgb(15_23_42/0.08)] dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-2">
        <Link to={page.to} className="min-w-0 truncate text-[15px] font-semibold text-slate-800 hover:text-primary dark:text-slate-100">{page.label}</Link>
        {board && <CardNoteButton anchor={cardAnchor(board.appKey, page.to)} label={page.label} boardRef={board.ref} />}
      </div>
      <div className="flex items-start justify-between gap-3">
        <Link to={page.to} className={cn('inline-flex h-8 w-fit shrink-0 items-center rounded px-3 text-[13px] font-medium transition-colors',
          todo ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800')}>
          {todo ? `${todo > 99 ? '99+' : todo} To Process` : 'Open'}
        </Link>
        {stats && (stats.late > 0 || stats.urgent > 0) && (
          <div className="flex flex-col items-end gap-0.5 text-[13px]">
            {stats.late > 0 && <Link to={page.to} className="text-red-600 hover:underline dark:text-red-400">{stats.late} Late</Link>}
            {stats.urgent > 0 && <Link to={page.to} className="text-amber-700 hover:underline dark:text-amber-400">{stats.urgent} Urgent</Link>}
          </div>
        )}
      </div>
      {figures && figures.length > 0 && <Figures figures={figures} />}
      {stats && <CardGraph graph={stats.graph} />}
    </article>
  )
}

function MrpCard({ page }: { page: Page }) {
  const c = useMrpDashboard().data?.counts
  return <Card page={page} todo={c ? c.CONFIRMED + c.IN_PROGRESS + c.TO_CLOSE : undefined}
    figures={c ? [{ label: 'In progress', value: c.IN_PROGRESS ?? 0, tone: null }, { label: 'Draft', value: c.DRAFT ?? 0, tone: null }] : undefined} />
}

function DsaCard({ page }: { page: Page }) {
  const waiting = useDsaDashboard().data?.waiting.length
  return <Card page={page} todo={waiting} figures={waiting != null ? [{ label: 'Waiting', value: waiting, tone: null }] : undefined} />
}

/** A page's card, with what waits in it where the module counts it. */
function PageCard({ page }: { page: Page }) {
  const countOf = useNavCounts()
  const statsOf = useCardStats()
  const figures = useFeatureStats().data?.[page.to]
  if (page.label === 'Manufacturing Orders') return <MrpCard page={page} />
  if (page.label === 'Disassembly Orders') return <DsaCard page={page} />
  return <Card page={page} todo={countOf({ to: page.to, label: page.label })} stats={statsOf(page.label)} figures={figures} />
}

/** The app's features in the order of its menu bar: one card each. */
function pagesOf(app: LauncherApp): Page[] {
  const entries = app.menus ?? app.items
  return entries.flatMap((m) => (m.children?.length ? m.children : [m])).map((p) => ({ to: p.to, label: p.label }))
}

/** The custom dashboards of this workspace (mine and shared), and a way to add one; the built-in one stays first. */
function CustomDashboardsMenu({ appKey }: { appKey: string }) {
  const { data } = useCustomDashboards(appKey)
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <Button size="sm" variant="outline" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((v) => !v)}>Dashboards{data?.length ? ` (${data.length})` : ''}</Button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-64 rounded-md border bg-card p-1 shadow-lg" onMouseLeave={() => setOpen(false)}>
          {(data ?? []).map((d) => (
            <Link key={d.id} role="menuitem" to={`/dashboards/${d.id}`} className="flex items-center gap-2 rounded px-2.5 py-2 text-sm hover:bg-muted">
              <DashboardIcon name={d.icon} className="size-4 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{d.name}</span>
            </Link>
          ))}
          {(data?.length ?? 0) > 0 && <div className="my-1 border-t" />}
          <Link role="menuitem" to={`/dashboards?new=1&app=${appKey}`} className="flex items-center gap-2 rounded px-2.5 py-2 text-sm font-medium text-primary hover:bg-muted">+ Add New Dashboard</Link>
        </div>
      )}
    </div>
  )
}

/** The apps whose Overview cards the one Dashboard shows (their own dashboards are gone: 2026-11-21). */
export type OverviewApp = keyof typeof APPS

/**
 * An app's Overview: simple cards, one per feature of the app in the order of its menu bar, each with what waits
 * to be processed and its bars by date, and sticky notes on them. Shown on the one Dashboard when the app's button
 * is chosen; nothing shows when the user may open nothing of the app.
 */
export function AppOverview({ appKey }: { appKey: OverviewApp }) {
  const { hasPermission, hasRole } = useAuth()
  const boardRef = useRef<HTMLDivElement>(null)
  const app = launcherApps(visibleNav(hasPermission, hasRole('super_admin')), hasPermission).apps.find((a) => a.key === appKey)
  if (!app) return null
  const pages = pagesOf(app)

  return (
    <section aria-label={`${app.label} overview`} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Overview · {app.label}</h2>
        <div className="ml-auto print:hidden"><CustomDashboardsMenu appKey={appKey} /></div>
      </div>
      <Board.Provider value={{ appKey, ref: boardRef }}>
        {/* the cards, and the sticky notes stuck on them floating over the board */}
        <div ref={boardRef} className="relative">
          <nav aria-label={`Menu ${app.label}`} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">{pages.map((p) => <PageCard key={p.to + p.label} page={p} />)}</nav>
          <FloatingCardNotes appKey={appKey} boardRef={boardRef} labels={Object.fromEntries(pages.map((p) => [cardAnchor(appKey, p.to), p.label]))} />
        </div>
      </Board.Provider>
    </section>
  )
}

/** The former app dashboard (/inventory, /purchase, /mrp, /tracking): it opens the one Dashboard on that app. */
export function AppDashboardPage({ appKey }: { appKey: OverviewApp }) {
  return <Navigate to={`/overview?module=${appKey}`} replace />
}
