import { Badge } from '@/components/ui/badge'
import type { Opname } from './api'

type Variant = 'default' | 'neutral' | 'success' | 'warning' | 'danger'

/** Internal (STOCKWISE) opname flow, in order. */
export const OPNAME_STEPS = [
  { status: 'SCHEDULED', label: 'Scheduled' },
  { status: 'IN_PROGRESS', label: 'Counted' },
  { status: 'PENDING_REVIEW', label: 'In review' },
  { status: 'COMPLETED', label: 'Done' },
] as const

const INTERNAL: Record<string, { label: string; variant: Variant; hint: string }> = {
  SCHEDULED: { label: 'Scheduled', variant: 'neutral', hint: 'Counting not started' },
  IN_PROGRESS: { label: 'Counting', variant: 'default', hint: 'Staff is filling in the physical quantity' },
  PENDING_REVIEW: { label: 'Waiting for Review', variant: 'warning', hint: 'Count result waiting for warehouse admin decision' },
  RECOUNT_REQUIRED: { label: 'Needs Recount', variant: 'danger', hint: 'Some items must be recounted' },
  COMPLETED: { label: 'Done', variant: 'success', hint: 'Reviewed; stock adjusted' },
}

// Accurate ITEMADJ: ADJCHECK = 1 only on the 2.111 opening-balance documents (all dated
// 31/12/2024); every day-to-day adjustment has 0. It is NOT a "checked" flag — verified
// against live data 2026-09-29. Both kinds are finished documents in Accurate.
const ACCURATE: Record<string, { label: string; variant: Variant; hint: string }> = {
  PENDING_REVIEW: { label: 'Stock adjustment', variant: 'default', hint: 'Inventory adjustment in Accurate — already recorded' },
  COMPLETED: { label: 'Opening balance', variant: 'neutral', hint: 'Opening inventory balance when Accurate started (31/12/2024)' },
}

export const isFromAccurate = (o: Pick<Opname, 'accurate_itemadj_id'>) => o.accurate_itemadj_id != null

export function opnameStatus(o: Pick<Opname, 'status' | 'accurate_itemadj_id'>) {
  if (isFromAccurate(o)) return ACCURATE[o.status] ?? INTERNAL[o.status] ?? { label: o.status, variant: 'neutral' as Variant, hint: '' }
  // an internal document is shown in the controlled workflow's terms (its earlier status mapped)
  return FLOW[toFlow(o.status)] ?? INTERNAL[o.status] ?? { label: o.status, variant: 'neutral' as Variant, hint: '' }
}

export function OpnameStatusBadge({ opname }: { opname: Pick<Opname, 'status' | 'accurate_itemadj_id'> }) {
  const s = opnameStatus(opname)
  return <Badge variant={s.variant} title={s.hint}>{s.label}</Badge>
}

/** Status filter options (internal flow). */
export const STATUS_FILTERS = Object.entries(INTERNAL).map(([value, s]) => ({ value, label: s.label }))

export const REVIEW_LABELS: Record<string, { label: string; variant: Variant }> = {
  PENDING: { label: 'Not reviewed', variant: 'neutral' },
  APPROVED: { label: 'Approved', variant: 'success' },
  REJECTED: { label: 'Rejected', variant: 'danger' },
  RECOUNT: { label: 'Recount', variant: 'warning' },
}

export function typeLabel(type: string) {
  return type === 'FULL' ? 'All items' : 'Selected items'
}

// ---------------------------------------------------------------- the controlled workflow

/** The workflow's steps, in order (Recount loops back into Review; Cancelled is off the line). */
export const FLOW_STEPS = [
  { status: 'DRAFT', label: 'Draft' },
  { status: 'CONFIRMED', label: 'Confirmed' },
  { status: 'COUNTING', label: 'Counting' },
  { status: 'REVIEW', label: 'Review' },
  { status: 'WAITING_APPROVAL', label: 'Approval' },
  { status: 'POSTED', label: 'Posted' },
  { status: 'DONE', label: 'Done' },
] as const

export const FLOW: Record<string, { label: string; variant: Variant; hint: string }> = {
  DRAFT: { label: 'Draft', variant: 'neutral', hint: 'Order being prepared — items and team can still change' },
  CONFIRMED: { label: 'Confirmed', variant: 'default', hint: 'Item list fixed, waiting for counting to start' },
  COUNTING: { label: 'Counting', variant: 'default', hint: 'Staff are counting (blind: no book quantity shown)' },
  REVIEW: { label: 'Review', variant: 'warning', hint: 'Variances are being reviewed' },
  RECOUNT: { label: 'Recount', variant: 'danger', hint: 'Some items must be counted again' },
  WAITING_APPROVAL: { label: 'Waiting Approval', variant: 'warning', hint: 'Waiting for the supervisor to approve and post' },
  POSTED: { label: 'Posted', variant: 'success', hint: 'Adjustments recorded in the Stock Ledger' },
  DONE: { label: 'Done', variant: 'success', hint: 'Closed and locked' },
  CANCELLED: { label: 'Cancelled', variant: 'neutral', hint: 'Cancelled — stock unchanged' },
}

/** What a stored status (earlier flow or new) is in the controlled workflow. */
const LEGACY: Record<string, string> = { SCHEDULED: 'CONFIRMED', IN_PROGRESS: 'COUNTING', PENDING_REVIEW: 'REVIEW', RECOUNT_REQUIRED: 'RECOUNT', COMPLETED: 'DONE' }
export const toFlow = (status: string) => LEGACY[status] ?? status

export function FlowBadge({ status, className }: { status: string; className?: string }) {
  const s = FLOW[toFlow(status)] ?? { label: status, variant: 'neutral' as Variant, hint: '' }
  return <Badge variant={s.variant} title={s.hint} className={className}>{s.label}</Badge>
}

/** Status filter of the internal documents (controlled workflow). */
export const FLOW_FILTERS = Object.entries(FLOW).map(([value, s]) => ({ value, label: s.label }))
