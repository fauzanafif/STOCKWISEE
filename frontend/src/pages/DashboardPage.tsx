import { useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { useReminders } from '@/features/reminders/api'
import { TodoBoard } from '@/components/dashboard/todo/TodoBoard'
import { DASHBOARD_MODULES, ModuleSelect, useDashboardModule } from '@/components/dashboard/ModulePicker'
import { AnalyticsBody, SECTIONS } from '@/pages/AnalyticsPage'
import { AppOverview, type OverviewApp } from '@/pages/AppDashboardPage'
import { ModuleDashboardBody } from '@/pages/ModuleDashboardPage'
import { cn } from '@/lib/utils'

export type DashboardView = 'overview' | 'todo' | 'analytics'

const VIEWS: { key: DashboardView; label: string; to: string }[] = [
  { key: 'overview', label: 'Overview', to: '/overview' },
  { key: 'todo', label: 'To-Do', to: '/todo' },
  { key: 'analytics', label: 'Analytics', to: '/analytics' },
]

const OVERVIEW_APPS: OverviewApp[] = ['inventory', 'purchase', 'manufacturing', 'tracking']

/**
 * The Dashboard app, the one place every dashboard lives (the other apps have none of their own): Overview (a card
 * per feature of each app), To-Do and Analytics, each its own page of the menu; a button per app picks what they show,
 * and the choice goes along from one page to the next.
 */
export function DashboardPage({ view }: { view: DashboardView }) {
  const { user, hasPermission } = useAuth()
  const [params] = useSearchParams()
  const { data: waiting } = useReminders()
  const meta = waiting?.meta
  const [module, setModule] = useDashboardModule()
  const chosen = DASHBOARD_MODULES.find((m) => m.key === module)
  const list = Array.isArray(waiting?.data) ? waiting.data : []
  const countOf = (mods: string[]) => list.filter((r) => r.modules?.some((m) => mods.includes(m))).reduce((n, r) => n + r.count, 0)

  // an old Analytics link (?tab= a section) scrolls to it
  useEffect(() => {
    const tab = params.get('tab')
    if (!tab || view !== 'analytics') return
    const id = SECTIONS.some((s) => s.id === tab) ? tab : 'analytics'
    const t = setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }), 400)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!user) return null
  const hour = new Date().getHours()
  const greet = hour < 11 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  // what each page has of an app
  const has = (m: (typeof DASHBOARD_MODULES)[number]) => (view === 'overview' ? m.overview : view === 'todo' ? m.reminders.length > 0 : m.analytics.length > 0)
  const nothing = chosen && !has(chosen)
  const search = module === 'all' ? '' : `?module=${module}`

  return (
    <div className="space-y-5 pb-6">
      <div className="rounded-xl bg-gradient-to-r from-[#1e3a8a] via-[#1d4ed8] to-[#2563eb] p-4 text-white sm:p-5">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{greet}, {user.name.split(' ')[0]}</h1>
          <p className="mt-0.5 text-[13px] text-blue-100">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · {user.roles.join(', ')}</p>
        </div>
        <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
          {[['To do', chosen ? countOf(chosen.reminders) : meta?.total ?? 0], ['Late', meta?.overdue ?? 0], ['Urgent', meta?.urgent ?? 0]].filter(([k]) => !chosen || k === 'To do').map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-2"><dd className="text-2xl font-semibold tabular-nums">{Number(v).toLocaleString('id-ID')}</dd><dt className="text-[13px] text-blue-100">{k}{chosen ? ` · ${chosen.label}` : ''}</dt></div>
          ))}
        </dl>
      </div>

      {/* one row: the three pages of the Dashboard in their order, then which module (kept from page to page) */}
      <div className="sticky top-[var(--sw-header,3.5rem)] z-20 -mx-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-background/95 px-3 py-2 backdrop-blur sm:-mx-5 sm:px-5 print:hidden">
        <nav aria-label="Dashboard" className="inline-flex rounded-lg border bg-muted/40 p-0.5">
          {VIEWS.map((v) => (
            <Link key={v.key} to={`${v.to}${search}`} aria-current={view === v.key ? 'page' : undefined}
              className={cn('rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-colors', view === v.key ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
              {v.label}
            </Link>
          ))}
        </nav>
        <ModuleSelect value={module} onChange={setModule} has={has}
          counts={view === 'todo' ? Object.fromEntries([['all', meta?.total ?? 0], ...DASHBOARD_MODULES.map((m) => [m.key, countOf(m.reminders)])]) : undefined} />
      </div>

      {nothing && (
        <p className="rounded-lg border border-dashed bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          {chosen.label} has no {VIEWS.find((v) => v.key === view)?.label} here.
        </p>
      )}

      {view === 'overview' && !nothing && (
        <div className="space-y-8">
          {(chosen ? [chosen.key] : [...OVERVIEW_APPS, 'important' as const]).map((k) => (k === 'important'
            ? hasPermission('important_request.access') && <section key={k} className="space-y-2"><h2 className="text-sm font-semibold">Overview · Important Request</h2><ModuleDashboardBody module="important" /></section>
            : <AppOverview key={k} appKey={k as OverviewApp} />))}
        </div>
      )}
      {view === 'todo' && !nothing && <TodoBoard modules={chosen ? chosen.reminders : null} />}
      {view === 'analytics' && !nothing && <AnalyticsBody module={module} />}
    </div>
  )
}
