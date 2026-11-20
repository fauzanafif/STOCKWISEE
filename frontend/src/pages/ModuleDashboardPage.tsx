import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { type ReminderModule } from '@/features/reminders/api'
import { IR_SCOPES, useIrList, useIrSummary, type IrRow } from '@/features/importantRequests/api'
import { useModuleStats, type ModuleStats, type Tone } from '@/features/moduleStats/api'
import { IrItem } from '@/pages/importantRequests/IrListPages'
import { cn } from '@/lib/utils'

const MODULES: Record<ReminderModule, { title: string; subtitle: string }> = {
  request: { title: 'Item Request', subtitle: 'What needs to be done on item requests.' },
  ppb: { title: 'Purchase Request', subtitle: 'What needs to be done on purchase requests.' },
  po: { title: 'Purchase Order', subtitle: 'What needs to be done on purchase orders.' },
  ri: { title: 'Receipt', subtitle: 'What needs to be done on receipts.' },
  important: { title: 'Important Request', subtitle: 'Overview of tasks and requests, the nearest deadline first.' },
  opname: { title: 'Stock Opname', subtitle: 'Stock opnames waiting for your step.' },
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

/** Nearest deadline on top: late ones first, then by date; no deadline at the bottom (never by title). */
export function byDeadline(rows: IrRow[]): IrRow[] {
  const at = (r: IrRow) => (r.deadline ? new Date(r.deadline).getTime() : Infinity)
  return [...rows].sort((a, b) => at(a) - at(b) || b.id - a.id)
}

/** One list of open Important Requests, the nearest deadline first, with a link to the whole list. */
function DeadlineList({ title, to, rows, loading, empty, scope }: { title: string; to: string; rows: IrRow[]; loading: boolean; empty: string; scope: 'tasks' | 'mine' }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title} <span className="ml-1 font-normal text-muted-foreground">{rows.length}</span></h2>
        <Link to={to} className="inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline">See all <ChevronRight className="size-3.5" /></Link>
      </div>
      {loading ? <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        : rows.length === 0 ? <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">{empty}</p>
        : <div className="divide-y">{rows.map((r) => <IrItem key={r.id} r={r} scope={scope} />)}</div>}
    </section>
  )
}

/** Important Request overview: my open tasks and my open requests, each sorted by the nearest deadline. */
function IrDeadlines() {
  const summary = useIrSummary()
  const tasks = useIrList({ scope: 'tasks', part: 'open', sort: 'deadline' })
  const mine = useIrList({ scope: 'mine', status: 'DITUGASKAN,MENUNGGU_REVIEW', sort: 'deadline' }, !!summary.data?.can_create)
  const canCreate = !!summary.data?.can_create
  return (
    <div className={cn('grid items-start gap-4', canCreate && 'xl:grid-cols-2')}>
      <DeadlineList title={IR_SCOPES.tasks.label} to={IR_SCOPES.tasks.path} scope="tasks" loading={tasks.isLoading}
        rows={byDeadline(tasks.data?.data ?? []).slice(0, 10)} empty="No open tasks for you." />
      {canCreate && (
        <DeadlineList title={IR_SCOPES.mine.label} to={IR_SCOPES.mine.path} scope="mine" loading={mine.isLoading}
          rows={byDeadline(mine.data?.data ?? []).slice(0, 10)} empty="No open requests from you." />
      )}
    </div>
  )
}

/**
 * A menu's Dashboard: its overview (the key figures, each a link to its list). Important Request also lists
 * the open work with the nearest deadline on top. No to-do lists.
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

/** A module's overview, without a page title: its key figures (and, for Important Request, the work by deadline). */
export function ModuleDashboardBody({ module, counts = true }: { module: ReminderModule; counts?: boolean }) {
  const stats = useModuleStats(module)
  return (
    <div className="space-y-4">
      {counts && (stats.data
        ? <Counts s={stats.data} />
        : !stats.isError && <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-[62px] animate-pulse rounded-lg border bg-muted/40" />)}</div>)}
      {module === 'important' && <IrDeadlines />}
    </div>
  )
}
