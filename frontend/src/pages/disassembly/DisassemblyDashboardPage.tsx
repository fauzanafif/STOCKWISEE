import { Link, useNavigate } from 'react-router-dom'
import { PackageOpen } from 'lucide-react'
import { DSA_STATUS, useDsaDashboard, type Dsa, type DsaStatus } from '@/features/disassembly/api'
import { COUNT_TILE } from '@/pages/ModuleDashboardPage'
import { cn } from '@/lib/utils'
import { fmtDate, fmtQty } from '@/features/mrp/api'
import { DsaStatusBadge } from '@/components/disassembly/DsaParts'
import { PageHeader } from '@/components/PageHeader'
import { DocSection } from '@/components/doc/DocLayout'

function OrderList({ rows, empty }: { rows: Dsa[]; empty: string }) {
  const navigate = useNavigate()
  if (rows.length === 0) return <p className="px-4 py-6 text-center text-sm text-muted-foreground">{empty}</p>
  return (
    <ul className="divide-y">
      {rows.map((o) => (
        <li key={o.id}>
          <button type="button" onClick={() => navigate(`/disassembly/orders/${o.id}`)} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-muted/40">
            <div className="min-w-0">
              <div className="font-medium">{o.product_name}</div>
              <div className="text-xs text-muted-foreground">{o.number} · {fmtQty(o.done_qty ?? o.planned_qty, 2)} {o.base_unit} · {o.source_warehouse} · {fmtDate(o.done_at ?? o.created_at)}</div>
            </div>
            <DsaStatusBadge status={o.status} />
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Disassembly Dashboard: only what has to be done: orders waiting for this user, Done not yet in Accurate. */
export function DisassemblyDashboardPage() {
  const { data } = useDsaDashboard()
  const statuses: DsaStatus[] = ['DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'TO_CLOSE', 'DONE', 'CANCELLED']
  const tile = cn(COUNT_TILE, 'transition-colors hover:bg-muted/40')
  return (
    <div className="space-y-4">
      <PageHeader title="Disassembly" subtitle="What needs to be done on disassembly orders." icon={<PackageOpen className="size-5" />} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Link to="/disassembly/orders" className={tile}><div className="text-xs font-medium text-muted-foreground">Total</div><div className="mt-0.5 text-lg font-semibold tabular-nums">{data?.total ?? '–'}</div></Link>
        {statuses.map((s) => (
          <Link key={s} to={`/disassembly/orders?status=${s}`} className={tile}>
            <div className="text-xs font-medium text-muted-foreground">{DSA_STATUS[s].label}</div>
            <div className={cn('mt-0.5 text-lg font-semibold tabular-nums', s === 'TO_CLOSE' && (data?.counts.TO_CLOSE ?? 0) > 0 && 'text-amber-600')}>{data?.counts[s] ?? '–'}</div>
          </Link>
        ))}
        <Link to="/disassembly/orders?not_in_accurate=1" className={tile}>
          <div className="truncate text-xs font-medium text-muted-foreground" title="Done, not yet entered in Accurate">Not in Accurate</div>
          <div className={cn('mt-0.5 text-lg font-semibold tabular-nums', (data?.not_in_accurate ?? 0) > 0 && 'text-amber-600')}>{data?.not_in_accurate ?? '–'}</div>
        </Link>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <DocSection title="Waiting for you" count={data?.waiting.length} flush>
          <OrderList rows={data?.waiting ?? []} empty="Nothing waiting for you." />
        </DocSection>
        <DocSection title="Done, not yet entered in Accurate" count={data?.not_in_accurate_list.length} flush>
          <OrderList rows={data?.not_in_accurate_list ?? []} empty="Nothing to enter in Accurate." />
        </DocSection>
      </div>
    </div>
  )
}
