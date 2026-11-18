import { useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Loader2, ShieldAlert } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Button } from '@/components/ui/button'
import { TrackingDashboard } from '@/components/dashboard/OperationsDashboard'
import { ProcurementDashboard } from '@/components/dashboard/ProcurementDashboard'
import { useDashboard } from '@/features/dashboard/api'
import { useDsaDashboard } from '@/features/disassembly/api'
import { useMrpDashboard } from '@/features/mrp/api'
import { exportElementToPdf } from '@/lib/exportDashboardPdf'
import { launcherApps, type LauncherApp } from '@/lib/launcher'
import { useNavCounts } from '@/lib/navCounts'
import { APPS_HOME, visibleNav } from '@/lib/navigation'
import { cn } from '@/lib/utils'
import { useCustomDashboards } from '@/features/customDashboards/api'
import { DashboardIcon } from '@/pages/CustomDashboardPages'
import { ModuleDashboardBody } from '@/pages/ModuleDashboardPage'
import { MrpDashboardBody } from '@/pages/mrp/MrpDashboardPage'
import { DisassemblyDashboardBody } from '@/pages/disassembly/DisassemblyDashboardPage'

/** A part of an app dashboard: shown to who holds one of its permissions (none: everyone in the app). */
interface Part { id: string; title: string; permissions?: string[]; body: ReactNode }

/** Procurement charts: the PO status comes with the main dashboard data. */
function Procurement() {
  const { data } = useDashboard()
  return <ProcurementDashboard poStatus={data?.charts?.po_status} />
}

/**
 * What each app dashboard holds besides its cards. `todo`: the to-do lists of the module dashboards it
 * replaced (Item Request, Receipt, Purchase Request, Purchase Order, Manufacturing, Disassembly), their
 * counts are on the cards. `analysis`: the sections of the former Analytics page that belong to the app.
 */
const PARTS: Record<string, { todo: Part[]; analysis: Part[] }> = {
  inventory: {
    todo: [
      { id: 'request', title: 'Item Request', permissions: ['item_request.create', 'item_request.view'], body: <ModuleDashboardBody module="request" counts={false} /> },
      { id: 'ri', title: 'Receipt', permissions: ['ri.view'], body: <ModuleDashboardBody module="ri" counts={false} /> },
    ],
    analysis: [],
  },
  purchase: {
    todo: [
      { id: 'ppb', title: 'Purchase Request', permissions: ['ppb.view'], body: <ModuleDashboardBody module="ppb" counts={false} /> },
      { id: 'po', title: 'Purchase Order', permissions: ['po.view'], body: <ModuleDashboardBody module="po" counts={false} /> },
    ],
    analysis: [{ id: 'pengadaan', title: 'Procurement', body: <Procurement /> }],
  },
  manufacturing: {
    todo: [
      { id: 'mrp', title: 'Manufacturing Orders', permissions: ['mrp.view'], body: <MrpDashboardBody counts={false} /> },
      { id: 'disassembly', title: 'Disassembly', permissions: ['disassembly.view'], body: <DisassemblyDashboardBody counts={false} /> },
    ],
    analysis: [],
  },
  // Tracking has no to-do of its own: its charts are its analysis
  tracking: { todo: [], analysis: [{ id: 'tracking', title: 'Tracking', body: <TrackingDashboard /> }] },
}

/** a page of the app: one card of the overview */
type Page = { to: string; label: string }

/** One card: the feature's name and one button, to what waits to be processed or to open it. Nothing else. */
function Card({ page, todo }: { page: Page; todo?: number }) {
  return (
    <article aria-label={page.label} className="flex flex-col justify-between gap-4 rounded-md border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgb(15_23_42/0.04)] transition-shadow hover:shadow-[0_4px_12px_rgb(15_23_42/0.08)] dark:border-slate-800 dark:bg-slate-900">
      <Link to={page.to} className="truncate text-[15px] font-semibold text-slate-800 hover:text-primary dark:text-slate-100">{page.label}</Link>
      <Link to={page.to} className={cn('inline-flex h-8 w-fit items-center rounded px-3 text-[13px] font-medium transition-colors',
        todo ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800')}>
        {todo ? `${todo > 99 ? '99+' : todo} To Process` : 'Open'}
      </Link>
    </article>
  )
}

function MrpCard({ page }: { page: Page }) {
  const c = useMrpDashboard().data?.counts
  return <Card page={page} todo={c ? c.CONFIRMED + c.IN_PROGRESS + c.TO_CLOSE : undefined} />
}

function DsaCard({ page }: { page: Page }) {
  return <Card page={page} todo={useDsaDashboard().data?.waiting.length} />
}

/** A page's card, with what waits in it where the module counts it. */
function PageCard({ page }: { page: Page }) {
  const countOf = useNavCounts()
  if (page.label === 'Manufacturing Orders') return <MrpCard page={page} />
  if (page.label === 'Disassembly Orders') return <DsaCard page={page} />
  return <Card page={page} todo={countOf({ to: page.to, label: page.label })} />
}

/** The app's features in the order of its menu bar: one card each. */
function pagesOf(app: LauncherApp): Page[] {
  const entries = app.menus ?? app.items
  return entries.flatMap((m) => (m.children?.length ? m.children : [m])).map((p) => ({ to: p.to, label: p.label }))
}

function Section({ part }: { part: Part }) {
  return (
    <section id={part.id} aria-labelledby={`${part.id}-title`} className="scroll-mt-[calc(var(--sw-header)+1rem)] space-y-3">
      <h2 id={`${part.id}-title`} className="flex items-center gap-3 text-[15px] font-semibold text-slate-800 dark:text-slate-100">
        {part.title}<span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" aria-hidden />
      </h2>
      {part.body}
    </section>
  )
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

type View = 'overview' | 'todo' | 'analysis'

/**
 * An app's one dashboard: a control panel (the app and its views) over simple cards, one per feature of the
 * app in the order of its menu bar, each leading to its work. The to-do lists and the analysis are views of their own.
 */
export function AppDashboardPage({ appKey }: { appKey: keyof typeof PARTS }) {
  const { hasPermission, hasRole } = useAuth()
  const [params, setParams] = useSearchParams()
  const exportRef = useRef<HTMLDivElement>(null)
  const [exporting, setExporting] = useState(false)

  const app = launcherApps(visibleNav(hasPermission, hasRole('super_admin')), hasPermission).apps.find((a) => a.key === appKey)
  const can = (p: Part) => !p.permissions || p.permissions.some(hasPermission)
  const todo = PARTS[appKey].todo.filter(can)
  const analysis = PARTS[appKey].analysis.filter(can)
  const views = ([['overview', 'Overview'], ['todo', 'To do'], ['analysis', 'Analysis']] as const)
    .filter(([k]) => k === 'overview' || (k === 'todo' ? todo.length > 0 : analysis.length > 0))
  const asked = params.get('tab')
  const view: View = views.some(([k]) => k === asked) ? (asked as View) : 'overview'

  if (!app) {
    return (
      <div className="mx-auto mt-10 flex max-w-md flex-col items-center gap-2 rounded-lg border bg-card px-6 py-12 text-center">
        <ShieldAlert className="size-9 text-muted-foreground" />
        <p className="font-medium">You have no access to this app</p>
        <Link to={APPS_HOME} className="mt-2 text-sm font-medium text-primary hover:underline">Back to Apps</Link>
      </div>
    )
  }

  const pages = pagesOf(app)

  async function exportPdf() {
    if (!exportRef.current || exporting) return
    setExporting(true)
    try {
      await exportElementToPdf(exportRef.current, {
        title: `STOCKWISE ${app!.label} Analysis`, subtitle: 'PT Surya Inti Gas',
        filename: `${app!.label}-Analysis-${new Date().toISOString().slice(0, 10)}.pdf`,
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="-mx-3 -my-4 min-h-[calc(100vh-var(--sw-header,3.5rem))] bg-slate-50 px-3 pb-8 sm:-mx-5 sm:-my-5 sm:px-5 dark:bg-slate-950">
      {/* the control panel: where you are, a search, the views */}
      <div className="-mx-3 mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-card px-3 py-2.5 sm:-mx-5 sm:px-5 print:hidden">
        <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight">{app.label} <span className="font-normal text-muted-foreground">/ {views.find(([k]) => k === view)![1]}</span></h1>
        <div className="ml-auto flex items-center gap-2">
          <CustomDashboardsMenu appKey={appKey} />
          {view === 'analysis' && (
            <>
              <Button size="sm" variant="outline" onClick={exportPdf} disabled={exporting}>
                {exporting && <Loader2 className="size-4 animate-spin" />}{exporting ? 'Creating PDF…' : 'Download PDF'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => window.print()}>Print</Button>
            </>
          )}
          {views.length > 1 && (
            <div role="tablist" aria-label="Views" className="inline-flex rounded border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900">
              {views.map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setParams(k === 'overview' ? {} : { tab: k }, { replace: true })}
                  className={cn('rounded-sm px-2.5 py-1 text-[13px] transition-colors', view === k ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:text-foreground')}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {view === 'overview' && (
        <nav aria-label={`Menu ${app.label}`} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">{pages.map((p) => <PageCard key={p.to + p.label} page={p} />)}</nav>
      )}
      {view === 'todo' && <div className="space-y-8">{todo.map((p) => <Section key={p.id} part={p} />)}</div>}
      {view === 'analysis' && <div ref={exportRef} className="space-y-10">{analysis.map((p) => <Section key={p.id} part={p} />)}</div>}
    </div>
  )
}
