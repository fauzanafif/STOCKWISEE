import { Badge } from './badge'

const MAP: Record<string, { label: string; variant: 'default' | 'neutral' | 'success' | 'warning' | 'danger' }> = {
  DRAFT: { label: 'Draft', variant: 'neutral' },
  SUBMITTED: { label: 'Sent', variant: 'default' },
  UNDER_REVIEW: { label: 'In review', variant: 'default' },
  READY: { label: 'Ready', variant: 'success' },
  PARTIAL: { label: 'Partial', variant: 'warning' },
  NEED_PURCHASE: { label: 'Needs Purchase', variant: 'warning' },
  RESERVED: { label: 'Reserved', variant: 'success' },
  PREPARING: { label: 'Prepared', variant: 'default' },
  READY_TO_PICKUP: { label: 'Ready to Collect', variant: 'success' },
  PICKED_UP: { label: 'Picked up', variant: 'success' },
  COMPLETED: { label: 'Done', variant: 'success' },
  CANCELLED: { label: 'Cancelled', variant: 'danger' },
  // line statuses
  PENDING: { label: 'Waiting', variant: 'neutral' },
  // PO table entry made by a PPB approval, until Accurate's real PO is synced
  MENUNGGU_PO: { label: 'Waiting for PO', variant: 'warning' },
  ISSUED: { label: 'Out', variant: 'success' },
  // ppb / po / receiving
  REVIEW: { label: 'In review', variant: 'default' },
  APPROVED: { label: 'Approved', variant: 'success' },
  REJECTED: { label: 'Rejected', variant: 'danger' },
  PURCHASING: { label: 'Purchasing', variant: 'default' },
  ORDERED: { label: 'Ordered', variant: 'default' },
  SENT: { label: 'Sent to Vendor', variant: 'default' },
  // STOCKWISE PO: approved and its proof of purchase uploaded
  DIBELI: { label: 'Purchased', variant: 'success' },
  PARTIAL_RECEIVED: { label: 'Partly Received', variant: 'warning' },
  RECEIVED: { label: 'Received', variant: 'success' },
  CHECKING: { label: 'Inspection', variant: 'default' },
  CONFIRMED: { label: 'Confirmed', variant: 'success' },
  CLOSED: { label: 'Closed', variant: 'neutral' },
  // lend / borrow
  ON_LOAN: { label: 'Lent', variant: 'default' },
  PARTIAL_RETURN: { label: 'Partly returned', variant: 'warning' },
  RETURNED: { label: 'Returned', variant: 'success' },
  OVERDUE: { label: 'Overdue', variant: 'danger' },
  BORROWED: { label: 'Borrowed', variant: 'default' },
  // ban luar / maintenance / manufaktur
  PENDING_RI: { label: 'Waiting for used tyre to return', variant: 'warning' },
  CLEAR: { label: 'Clear', variant: 'success' },
  OPEN: { label: 'New', variant: 'neutral' },
  ON_GOING: { label: 'In progress', variant: 'default' },
  REQUESTED: { label: 'Submitted', variant: 'neutral' },
}

/** Plain-language label of a status code (for filters/dropdowns). */
export function statusLabel(status: string): string {
  return MAP[status]?.label ?? status
}

export function RequestStatusBadge({ status }: { status: string }) {
  const s = MAP[status] ?? { label: status, variant: 'neutral' as const }
  return <Badge variant={s.variant}>{s.label}</Badge>
}
