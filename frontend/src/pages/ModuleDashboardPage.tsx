import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { useAuth } from '@/auth/AuthContext'
import { type ReminderModule } from '@/features/reminders/api'
import { useIrSummary } from '@/features/importantRequests/api'
import { useModuleStats, type ModuleStats, type Tone } from '@/features/moduleStats/api'
import { cn } from '@/lib/utils'

/** The "Perlu dikerjakan" reminder center (shared with the main dashboard). */
export { ReminderList } from '@/components/reminders/ReminderCenter'
import { ReminderList } from '@/components/reminders/ReminderCenter'
import { DraftLinesList } from '@/pages/PpbDraftPage'
import { PoTodoList } from '@/pages/PoFlowPages'

const MODULES: Record<ReminderModule, { title: string; subtitle: string }> = {
  request: { title: 'Item Request', subtitle: 'What needs to be done on item requests.' },
  ppb: { title: 'Purchase Request', subtitle: 'What needs to be done on purchase requests.' },
  po: { title: 'Purchase Order', subtitle: 'What needs to be done on purchase orders.' },
  ri: { title: 'Receipt', subtitle: 'What needs to be done on receipts.' },
  important: { title: 'Important Request', subtitle: 'Tasks that need to be done.' },
}

const TONE: Record<Tone, string> = {
  amber: 'text-amber-600', blue: 'text-blue-700', violet: 'text-violet-700', indigo: 'text-indigo-700', emerald: 'text-emerald-700',
  slate: 'text-slate-600', orange: 'text-orange-600', teal: 'text-teal-700', red: 'text-red-600',
}
const num = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 2 })
const rupiah = (n: number) => 'Rp ' + n.toLocaleString('id-ID', { notation: 'compact', maximumFractionDigits: 1 })
export const COUNT_TILE = 'block rounded-lg border bg-card px-3 py-2.5 shadow-[0_1px_2px_rgb(15_23_42/0.05)]'

/** The count cards on top: one number each, a link where it leads somewhere. */
function Counts({ s }: { s: ModuleStats }) {
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {s.kpis.map((k) => {
        const body = (
          <>
            <div className="text-xs font-medium text-muted-foreground">{k.label}</div>
            <div className={cn('mt-0.5 truncate text-lg font-semibold tabular-nums', k.tone ? TONE[k.tone] : 'text-foreground')} title={k.format === 'rupiah' ? 'Rp ' + num(k.value) : undefined}>{k.format === 'rupiah' ? rupiah(k.value) : num(k.value)}</div>
          </>
        )
        return k.to
          ? <Link key={k.key} to={k.to} className={cn(COUNT_TILE, 'transition-colors hover:bg-muted/40')}>{body}</Link>
          : <div key={k.key} className={COUNT_TILE}>{body}</div>
      })}
    </div>
  )
}

/** One plain block: a title and its list. */
export function TodoSection({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('min-w-0 rounded-lg border bg-card', className)}>
      <h2 className="border-b px-4 py-2.5 text-sm font-semibold">{title}</h2>
      <div className="p-4">{children}</div>
    </section>
  )
}

/** Important Request: the next due dates. */
function Upcoming() {
  const { data: s } = useIrSummary()
  const list = s ? [...s.near_deadline, ...s.urgent].filter((r, i, all) => all.findIndex((x) => x.id === r.id) === i && !['SELESAI', 'DIBATALKAN', 'DRAFT'].includes(r.status)).slice(0, 6) : []
  if (!s) return <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
  if (list.length === 0) return <p className="text-[13px] text-muted-foreground">No deadlines coming up.</p>
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

/**
 * A menu's Dashboard: only what has to be done now (a to-do list of the documents waiting for this user),
 * no charts. Each row opens the document or list where it is done.
 */
export function ModuleDashboardPage({ module }: { module: ReminderModule }) {
  const m = MODULES[module]
  return (
    <div className="space-y-4">
      <PageHeader title={m.title} subtitle={m.subtitle} />
      <ModuleDashboardBody module={module} />
    </div>
  )
}

/** A module's key figures and to-do, without a page title: its page, or a section of an app dashboard. */
export function ModuleDashboardBody({ module, counts = true }: { module: ReminderModule; counts?: boolean }) {
  const { hasPermission } = useAuth()
  const stats = useModuleStats(module)

  // Purchase Request / Purchase Order: the items ready to process first, the other reminders under them
  const todo = module === 'po' && hasPermission('po.create')
    ? <div className="space-y-4"><PoTodoList /><ReminderList module={module} exclude={['po_draft']} /></div>
    : module === 'ppb' && hasPermission('ppb.create')
      ? <div className="space-y-4"><DraftLinesList /><ReminderList module={module} exclude={['ppb_draft']} /></div>
      : <ReminderList module={module} />

  return (
    <div className="space-y-4">
      {counts && (stats.data
        ? <Counts s={stats.data} />
        : !stats.isError && <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-[62px] animate-pulse rounded-lg border bg-muted/40" />)}</div>)}
      {module === 'important' ? (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <TodoSection title="To do">{todo}</TodoSection>
          <TodoSection title="Upcoming deadlines"><Upcoming /></TodoSection>
        </div>
      ) : (
        <TodoSection title="To do">{todo}</TodoSection>
      )}
    </div>
  )
}
