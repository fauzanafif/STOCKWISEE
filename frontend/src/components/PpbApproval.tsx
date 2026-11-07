import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Check, X, Undo2 } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { apiErrorMessage } from '@/lib/api'
import { APPROVAL_STATUS, useDecidePpb, useResubmitPpb, type Ppb, type PpbApproval } from '@/features/ppb/api'
import { ResubmitPanel } from '@/components/approval/ResubmitPanel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { BYPASS_TEXT, isAutoApproval } from '@/lib/approval'
import { invalidTo } from '@/lib/notify'
import { TONE_EDGE, type ActivityItem } from '@/components/doc/DocLayout'

const fmt = (v: string | null) => (v ? new Date(v).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '')

/** Approval of a PPB before PO; red when Accurate made a PO before anyone approved. */
export function PpbApprovalBadge({ approval }: { approval?: PpbApproval | null }) {
  if (!approval) return <span className="text-muted-foreground">-</span>
  if (approval.po_without_approval) {
    return <Badge variant="danger" title="PO made in Accurate before the Purchase Request was approved"><AlertTriangle className="mr-1 size-3" />PO without approval</Badge>
  }
  // PPBs from before the approval rule: nothing to act on, so no badge competing for attention
  if (approval.status === 'TIDAK_PERLU') return <span className="text-muted-foreground" title="Purchase Request made before the approval rule applied">-</span>
  const s = APPROVAL_STATUS[approval.status]
  return <Badge variant={s.variant} title={approval.by ? `${s.label} by ${approval.by}${approval.at ? `, ${fmt(approval.at)}` : ''}` : undefined}>{s.label}</Badge>
}

const LOG_LABEL: Record<string, { label: string; tone: ActivityItem['tone'] }> = {
  DIAJUKAN: { label: 'In, waiting for approval', tone: 'wait' },
  APPROVE_MANAGER: { label: 'Approved by Manager', tone: 'ok' },
  APPROVE: { label: 'Approved', tone: 'ok' },
  RETURN: { label: 'Returned for revision', tone: 'warn' },
  DIAJUKAN_ULANG: { label: 'Resubmitted (revised)', tone: 'wait' },
  REJECT: { label: 'Rejected', tone: 'bad' },
  PO_TANPA_APPROVAL: { label: 'PO made without approval', tone: 'bad' },
}

/** The PPB's approval log, for the detail page's activity panel. */
export function ppbActivity(ppb: Ppb): ActivityItem[] {
  return (ppb.approval_log ?? []).map((l) => {
    const meta = l.action === 'APPROVE_MANAGER' && isAutoApproval(l.note) ? { label: BYPASS_TEXT, tone: 'info' as const } : LOG_LABEL[l.action] ?? { label: l.action, tone: 'info' as const }
    return { id: l.id, label: meta.label, tone: meta.tone, who: l.user_name ?? 'Sistem', at: l.created_at, note: isAutoApproval(l.note) ? null : l.note }
  })
}

/** PPB detail: approve / reject the whole PPB document in one click. */
export function PpbApprovalCard({ ppb }: { ppb: Ppb }) {
  const { hasPermission } = useAuth()
  const decide = useDecidePpb(ppb.id)
  const resubmit = useResubmitPpb(ppb.id)
  // reject, or send back to admin for a revision: both need a note
  const [rejecting, setRejecting] = useState<false | 'REJECT' | 'RETURN'>(false)
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const approval = ppb.approval
  if (!approval || !ppb.no_ppb) return null
  const before = approval.status === 'TIDAK_PERLU'
  // a PPB from before the rule: only worth a card when it lists several items
  if (before && (ppb.document_items?.length ?? 0) <= 1) return null

  // STOCKWISE PPB: Manager then Direktur (the server says whose step it is); Accurate's: one step
  const can = ppb.can_decide ?? (hasPermission('ppb.approve') && approval.status !== 'TIDAK_PERLU')
  const stepLabel = approval.stockwise ? (approval.status === 'MENUNGGU_DIREKTUR' || (approval.status === 'MENUNGGU' && !hasPermission('ppb.approve_manager') && hasPermission('ppb.approve_director')) ? ' (Director)' : approval.status === 'MENUNGGU' ? ' (Manager)' : '') : ''
  const send = (action: 'APPROVE' | 'REJECT' | 'RETURN') => {
    setErr(null)
    if (action === 'REJECT' && !note.trim()) return invalidTo(setErr, 'Fill in the rejection reason.')
    if (action === 'RETURN' && !note.trim()) return invalidTo(setErr, 'A note is required: write why it is revised.')
    decide.mutate({ action, note: note.trim() || null }, {
      onSuccess: () => { setRejecting(false); setNote('') },
      onError: (e) => setErr(apiErrorMessage(e)),
    })
  }

  return (
    <Card className={approval.po_without_approval ? TONE_EDGE.bad : ['MENUNGGU', 'MENUNGGU_DIREKTUR'].includes(approval.status) ? TONE_EDGE.wait
      : approval.status === 'DIKEMBALIKAN' ? TONE_EDGE.warn : approval.status === 'DITOLAK' ? TONE_EDGE.bad : approval.status === 'DISETUJUI' ? TONE_EDGE.ok : undefined}>
      <CardContent className="space-y-3 p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 font-medium">{before ? 'Purchase Request Document' : <>Approval before PO <PpbApprovalBadge approval={approval} /></>}</div>
            <div className="text-xs text-muted-foreground">
              {approval.status === 'TIDAK_PERLU'
                ? 'This Purchase Request was made before the approval rule applied.'
                : `Applies to the whole Purchase Request ${ppb.no_ppb}${ppb.document_lines && ppb.document_lines > 1 ? ` (${ppb.document_lines} items)` : ''}.${approval.stockwise ? ' STOCKWISE Purchase Request: approved by Manager, then Director.' : ''}`}
              {approval.status === 'DISETUJUI' && ppb.approval_po && (
                <> Goes to the PO table as <Link to={`/purchase-orders/${ppb.approval_po.id}`} className=" text-primary hover:underline">{ppb.approval_po.number}</Link>{approval.stockwise ? ' — complete the vendor & price there, then the Director approves.' : ' (Waiting for PO, until the PO is made in Accurate).'}</>
              )}
            </div>
          </div>
          {can && !rejecting && (
            <div className="flex gap-2">
              {approval.stockwise && ['MENUNGGU', 'MENUNGGU_DIREKTUR'].includes(approval.status) && (
                <Button size="sm" variant="outline" className="border-orange-300 text-orange-700 hover:bg-orange-50" disabled={decide.isPending} onClick={() => { setRejecting('RETURN'); setErr(null) }}><Undo2 className="size-4" /> Revise</Button>
              )}
              {approval.status !== 'DITOLAK' && (
                <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => { setRejecting('REJECT'); setErr(null) }}><X className="size-4" /> Reject</Button>
              )}
              {approval.status !== 'DISETUJUI' && (
                <Button size="sm" disabled={decide.isPending} onClick={() => send('APPROVE')}><Check className="size-4" /> Approve{stepLabel}</Button>
              )}
            </div>
          )}
        </div>
        {rejecting && (
          <div className="flex flex-wrap gap-2">
            <Input className="min-w-0 flex-1" autoFocus placeholder={rejecting === 'RETURN' ? 'Why revise? What needs changing? (required)' : 'Rejection reason (required)'} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
            <Button size="sm" variant="outline" className="h-10" onClick={() => { setRejecting(false); setErr(null) }}>Cancel</Button>
            {rejecting === 'RETURN'
              ? <Button size="sm" className="h-10 bg-orange-600 hover:bg-orange-700" disabled={decide.isPending} onClick={() => send('RETURN')}>Send revision to admin</Button>
              : <Button size="sm" className="h-10 bg-red-600 hover:bg-red-700" disabled={decide.isPending} onClick={() => send('REJECT')}>Reject Purchase Request</Button>}
          </div>
        )}
        {err && <p className="text-xs text-destructive">{err}</p>}
        {approval.status === 'DIKEMBALIKAN' && (
          <ResubmitPanel reason={approval.note} by={approval.by} canResubmit={!!ppb.can_resubmit} busy={resubmit.isPending}
            rows={(ppb.document_items ?? []).map((it) => ({ id: it.id, label: it.deskripsi_barang ?? '-', code: it.kode_barang, qty: Number(it.kuantitas), unit: it.satuan }))}
            onResubmit={(quantities, n) => resubmit.mutate({ quantities: Object.keys(quantities).length ? quantities : undefined, note: n })} />
        )}

      </CardContent>
    </Card>
  )
}
