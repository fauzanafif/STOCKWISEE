import { apiErrorMessage } from '@/lib/api'
import { useInventoryDashboard, useOperationsDashboard } from '@/features/dashboard/api'
import { statusLabel } from '@/components/ui/request-badge'
import { ChartCard } from './ChartCard'
import { PpbAging, PpbOldestCard, PurchaseFlow } from './OperationsDashboard'
import { StatusBreakdown, type StateTone, type StatusRow } from './DashboardParts'

/**
 * Pengadaan in one place: where the PPB lines and the POs stand (Accurate), how
 * many lines flow PPB → PO → RI each month, and which PPB lines are still
 * waiting for their goods. Statuses are listed in workflow order with fixed
 * meaning colors (blue = berjalan, amber = sebagian, green = selesai, gray = ditutup).
 */

/** PPB per-line status (Excel "1. PPB - RI"), in workflow order. */
const PPB_ROWS: { key: string; label: string; hint: string; tone: StateTone }[] = [
  { key: 'REQUESTED', label: 'Requested', hint: 'Requested, no items received yet', tone: 'running' },
  { key: 'SHORTAGE', label: 'Shortage', hint: 'Partly received, the rest to follow', tone: 'partial' },
  { key: 'COMPLETED', label: 'Completed', hint: 'Items fully received', tone: 'done' },
  { key: 'CLOSE', label: 'Close', hint: 'Closed in Accurate, the rest not delivered', tone: 'closed' },
  { key: 'AMEND', label: 'Amend', hint: 'Purchase changed / cancelled', tone: 'closed' },
  { key: 'ERROR', label: 'Needs checking', hint: 'Status does not match Accurate data', tone: 'attention' },
]

/** Purchase Order status (Accurate POs), in workflow order. */
const PO_ROWS: { key: string; hint: string; tone: StateTone }[] = [
  { key: 'SENT', hint: 'Sent to vendor, no items received yet', tone: 'running' },
  { key: 'DIBELI', hint: 'STOCKWISE PO with purchase proof, waiting for Receipt', tone: 'running' },
  { key: 'PARTIAL_RECEIVED', hint: 'Some items received', tone: 'partial' },
  { key: 'RECEIVED', hint: 'All items received', tone: 'done' },
  { key: 'CLOSED', hint: 'Closed in Accurate', tone: 'closed' },
  { key: 'CANCELLED', hint: 'Cancelled', tone: 'closed' },
]

/** Known statuses in their fixed order; anything unexpected is still shown (gray), never dropped. */
function toRows(data: { name: string; value: number }[] | undefined, known: StatusRow[]): StatusRow[] {
  const counts = new Map((data ?? []).map((d) => [String(d.name).toUpperCase(), Number(d.value)]))
  const rows = known.filter((k) => counts.has(k.key) || ['done', 'running'].includes(k.tone)).map((k) => ({ ...k, value: counts.get(k.key) ?? 0 }))
  for (const [name, value] of counts) {
    if (!known.some((k) => k.key === name)) rows.push({ key: name, label: statusLabel(name), value, tone: 'closed' })
  }
  return rows
}

export function ProcurementDashboard({ poStatus }: { poStatus?: { name: string; value: number }[] }) {
  const ops = useOperationsDashboard()
  // PPB line status comes with the stock analysis (same cached request as the Kondisi Stok section when it has no filter)
  const inv = useInventoryDashboard({})

  const ppbRows = toRows(inv.data?.charts.ppb_status, PPB_ROWS.map((r) => ({ ...r, value: 0 })))
  const poRows = toRows(poStatus, PO_ROWS.map((r) => ({ ...r, label: statusLabel(r.key), value: 0 })))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Purchase Request Row Status" subtitle="Each Purchase Request item row in Accurate, in procurement order"
          empty={!inv.isLoading && ppbRows.every((r) => r.value === 0)}>
          {inv.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : <StatusBreakdown rows={ppbRows} unit="Purchase Request rows" />}
        </ChartCard>
        <ChartCard title="Status Purchase Order" subtitle="PO documents from Accurate, in procurement order"
          empty={poRows.every((r) => r.value === 0)}>
          <StatusBreakdown rows={poRows} unit="dokumen PO" />
        </ChartCard>
      </div>

      {ops.isLoading && <p className="text-sm text-muted-foreground">Loading purchasing flow…</p>}
      {ops.error && <p className="text-sm text-red-600">{apiErrorMessage(ops.error)}</p>}
      {ops.data && (
        <>
          <PurchaseFlow data={ops.data.purchase_flow} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <PpbAging data={ops.data.ppb_aging} />
            <PpbOldestCard ppb={ops.data.attention.ppb_oldest} />
          </div>
        </>
      )}
    </div>
  )
}
