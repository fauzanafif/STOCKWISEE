import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { MO_STATUS, fmtDate, fmtQty, useMos, useMrpDashboard, type Mo, type MoStatus } from '@/features/mrp/api'
import { MoStatusBadge } from '@/components/mrp/MrpParts'
import { COUNT_TILE, TodoSection } from '@/pages/ModuleDashboardPage'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

const SHOWN = 8
const STATUSES: MoStatus[] = ['DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'TO_CLOSE', 'DONE', 'CANCELLED']

/** One to-do group: the first orders, a link to the whole filtered list. Hidden when empty. */
function Group({ title, query, to }: { title: string; query: { status?: string; not_in_accurate?: boolean }; to: string }) {
  const { data, isLoading } = useMos(query)
  const rows = data?.data ?? []
  const total = data?.meta.total ?? rows.length
  if (isLoading || rows.length === 0) return null
  return (
    <TodoSection title={<span>{title} <span className="ml-1 font-normal text-muted-foreground">{total}</span></span>}>
      <ul className="-mx-4 -my-4 divide-y">
        {rows.slice(0, SHOWN).map((m: Mo) => (
          <li key={m.id}>
            <Link to={`/mrp/orders/${m.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-muted/40">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{m.product_name}</div>
                <div className="text-xs text-muted-foreground">{m.number} · {fmtQty(m.output_qty, 2)} / {fmtQty(m.planned_qty, 2)} {m.base_unit} · finish {fmtDate(m.planned_finish)}</div>
              </div>
              <div className="flex shrink-0 gap-1">{m.priority === 'URGENT' && <Badge variant="danger">Urgent</Badge>}<MoStatusBadge status={m.status} /></div>
            </Link>
          </li>
        ))}
        {total > SHOWN && <li><Link to={to} className="block px-4 py-2 text-xs text-primary hover:underline">View all {total}</Link></li>}
      </ul>
    </TodoSection>
  )
}

/** The Manufacturing Orders' counts and to-do, most pressing first (a part of the Manufacturing app dashboard). */
export function MrpDashboardBody({ counts = true }: { counts?: boolean }) {
  const { data, isLoading } = useMrpDashboard()
  const c = data?.counts
  const nothing = !!data && !c?.TO_CLOSE && !c?.IN_PROGRESS && !c?.CONFIRMED && !c?.DRAFT && !data.not_in_accurate && !data.boms.draft

  return (
    <div className="space-y-4">
      {counts && <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {STATUSES.map((st) => (
          <Link key={st} to={`/mrp/orders?status=${st}`} className={cn(COUNT_TILE, 'transition-colors hover:bg-muted/40')}>
            <div className="text-xs font-medium text-muted-foreground">{MO_STATUS[st].label}</div>
            <div className={cn('mt-0.5 text-lg font-semibold tabular-nums', st === 'TO_CLOSE' && (c?.TO_CLOSE ?? 0) > 0 && 'text-amber-600')}>{c?.[st] ?? '–'}</div>
          </Link>
        ))}
        <Link to="/mrp/orders?not_in_accurate=1" className={cn(COUNT_TILE, 'transition-colors hover:bg-muted/40')}>
          <div className="truncate text-xs font-medium text-muted-foreground" title="Done, not yet entered in Accurate">Not in Accurate</div>
          <div className={cn('mt-0.5 text-lg font-semibold tabular-nums', (data?.not_in_accurate ?? 0) > 0 && 'text-amber-600')}>{data?.not_in_accurate ?? '–'}</div>
        </Link>
      </div>}
      {isLoading && <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />}
      {nothing && <TodoSection title="To do"><p className="text-[13px] text-muted-foreground">Nothing to do right now.</p></TodoSection>}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Group title="To close" query={{ status: 'TO_CLOSE' }} to="/mrp/orders?status=TO_CLOSE" />
        <Group title="In progress" query={{ status: 'IN_PROGRESS' }} to="/mrp/orders?status=IN_PROGRESS" />
        <Group title="Ready to start" query={{ status: 'CONFIRMED' }} to="/mrp/orders?status=CONFIRMED" />
        <Group title="Draft, to confirm" query={{ status: 'DRAFT' }} to="/mrp/orders?status=DRAFT" />
        <Group title="Done, not yet entered in Accurate" query={{ not_in_accurate: true }} to="/mrp/orders?not_in_accurate=1" />
        {(data?.boms.draft ?? 0) > 0 && (
          <TodoSection title="Draft BoMs">
            <Link to="/mrp/boms?status=DRAFT" className="text-sm text-primary hover:underline">{data!.boms.draft} BoM waiting to be completed →</Link>
          </TodoSection>
        )}
      </div>
    </div>
  )
}
