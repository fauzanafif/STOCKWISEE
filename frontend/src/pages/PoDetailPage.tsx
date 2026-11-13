import { DirectorPickTag } from '@/components/DirectorPickTag'
import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { openPoProof, useCompletePo, usePo, usePoAction, useUploadPoProof, useVendors, type PoLine, type PurchaseOrder } from '@/features/purchasing/api'
import { useAuth } from '@/auth/AuthContext'
import { apiErrorMessage } from '@/lib/api'
import { DataTable, type Column } from '@/components/DataTable'
import { PrintDocButton } from '@/components/PrintDocButton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { RequestStatusBadge } from '@/components/ui/request-badge'
import { BackLink } from '@/components/BackLink'
import { InBaseUom } from '@/components/UomEquivalent'
import { Activity, DocPage, DocSection, FieldGrid, SyncNote, TONE_EDGE, type ActivityItem } from '@/components/doc/DocLayout'
import { confirmDialog } from '@/components/ui/confirm'
import { DetailFallback } from '@/components/DetailFallback'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { invalidTo } from '@/lib/notify'
import { QtyProgress } from '@/components/QtyProgress'
import { SmartButtons } from '@/components/documents/SmartButtons'
import { Chatter } from '@/components/documents/Chatter'

const rupiah = (n: number) => 'Rp ' + Number(n).toLocaleString('id-ID')

const lineColumns: Column<PoLine>[] = [
  { key: 'code', header: 'Code', cell: (l) => <span className="text-[13px]">{l.item_code ?? '—'}</span> },
  { key: 'desc', header: 'Description', cell: (l) => <>{l.description}<DirectorPickTag pick={l.director_pick} /></>, className: 'min-w-[16rem]' },
  // one PO number may hold items of several vendors
  { key: 'vendor', header: 'Vendor', cell: (l) => <span className="whitespace-nowrap">{l.vendor_name ?? ''}</span> },
  { key: 'qty', header: 'Qty', cell: (l) => <>{`${l.qty} ${l.unit ?? ''}`}<InBaseUom qty={l.qty} ratio={l.unit_ratio} base={l.base_unit} /></>, className: 'whitespace-nowrap text-right' },
  { key: 'price', header: 'Price', cell: (l) => rupiah(l.unit_price), className: 'whitespace-nowrap text-right tabular-nums' },
  { key: 'total', header: 'Subtotal', cell: (l) => rupiah(l.line_total), className: 'whitespace-nowrap text-right tabular-nums' },
  // ordered / received so far (STOCKWISE count or the Accurate RI lines): a partial delivery reads "10/5"
  {
    key: 'rcv', header: 'Ordered/Received',
    cell: (l) => <QtyProgress total={l.qty} unit={l.unit}
      done={Math.max(Number(l.qty_received ?? 0), (l.received_via ?? []).reduce((n, r) => n + Number(r.kuantitas ?? 0), 0))} />,
  },
  { key: 'ls', header: 'Status', cell: (l) => <RequestStatusBadge status={l.line_status} /> },
  {
    key: 'ppb',
    header: 'From Purchase Request',
    cell: (l) =>
      l.source_ppb ? (
        <Link to={`/ppb/${l.source_ppb.id}`} className="text-[13px] text-primary hover:underline">
          {l.source_ppb.no_ppb ?? '—'}
        </Link>
      ) : (
        '—'
      ),
  },
  {
    key: 'ri',
    header: 'Received via Receipt',
    cell: (l) =>
      l.received_via && l.received_via.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          {l.received_via.map((r) => (
            <Link key={r.id} to={`/ri/${r.id}`} className="text-[13px] text-primary hover:underline">
              {r.no_ri ?? '—'}
            </Link>
          ))}
        </div>
      ) : (
        '—'
      ),
  },
]

export function PoDetailPage() {
  const { id } = useParams()
  const poId = Number(id)
  const { hasPermission } = useAuth()
  const { data: po, isLoading } = usePo(poId)
  const action = usePoAction(poId)
  const [err, setErr] = useState<string | null>(null)

  if (isLoading || !po) return <div className="space-y-4"><BackLink to="/purchase-orders" label="Purchase Order List" /><DetailFallback loading={isLoading} /></div>

  const run = (name: string, body?: unknown) =>
    action.mutate({ action: name, body }, { onError: (e) => setErr(apiErrorMessage(e)) })

  const isFromAccurate = po.accurate_po_id != null
  // STOCKWISE PO: Direktur approval (the internal approve button is the Direktur's)
  const stockwise = !isFromAccurate && (po.approval_status != null || po.can_complete)

  const lines = po.items ?? []
  // one vendor for every line: it is in the header, no column for it
  const oneVendor = new Set(lines.map((l) => l.vendor_name ?? '')).size <= 1
  const vendors = (po.vendors?.length ?? 0) > 1 ? po.vendors!.map((v) => v.name).join(' · ') : po.vendor?.name ?? po.vendor_name ?? '—'
  const activity: ActivityItem[] = (po.approval_log ?? []).map((l) => ({
    id: l.id, label: LOG_TEXT[l.action] ?? l.action, who: l.user_name, at: l.created_at, note: l.note,
    tone: l.action === 'REJECT' ? 'warn' : l.action === 'DIAJUKAN' ? 'wait' : 'ok',
  }))

  return (
    <DocPage
      chatter={<Chatter type="purchase_order" id={poId} />}
      back={{ to: '/purchase-orders', label: 'Purchase Order List' }}
      kind="Purchase Order"
      number={po.number}
      status={<>
        <RequestStatusBadge status={po.status} />
        {isFromAccurate ? <Badge variant="default">Accurate</Badge> : <Badge variant="neutral">STOCKWISE</Badge>}
      </>}
      subtitle={vendors}
      actions={<>
        {!isFromAccurate && po.status === 'DRAFT' && !stockwise && hasPermission('po.approve') && (
          <Button size="sm" disabled={action.isPending} onClick={() => run('approve')}>Approve</Button>
        )}
        {!isFromAccurate && po.status === 'APPROVED' && hasPermission('po.send') && (
          <Button size="sm" disabled={action.isPending} onClick={() => run('send')}>Send to Vendor</Button>
        )}
        <PrintDocButton url={`/api/purchase-orders/${po.id}/print`} docType="po" />
        {!isFromAccurate && !['RECEIVED', 'CLOSED', 'CANCELLED', 'PARTIAL_RECEIVED'].includes(po.status) && hasPermission('po.cancel') && (
          <Button size="sm" variant="outline" className="text-destructive hover:bg-destructive/5 hover:text-destructive" disabled={action.isPending}
            onClick={async () => { if (await confirmDialog({ title: `Cancel ${po.number}?`, message: 'A cancelled PO cannot be processed again.', confirmLabel: 'Cancel PO', danger: true })) run('cancel', { reason: 'Cancelled from the UI' }) }}>
            Cancel
          </Button>
        )}
      </>}
    >
      <SmartButtons type="purchase_order" id={poId} />
      {err && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>}
      {stockwise && <DirectorApproval po={po} onError={setErr} />}
      {!isFromAccurate && (po.can_upload_proof || po.proof) && <PurchaseProof po={po} onError={setErr} />}

      <DocSection title="Information">
        <FieldGrid cols={3} items={[
          { label: 'Date', value: po.date ? new Date(po.date).toLocaleDateString('en-GB', { dateStyle: 'medium' }) : '—' },
          { label: 'Estimated arrival', value: po.expected_date ? new Date(po.expected_date).toLocaleDateString('en-GB', { dateStyle: 'medium' }) : '—' },
          { label: 'Total', value: <span className="font-semibold tabular-nums">{rupiah(po.total)}</span> },
          { label: 'Created', value: new Date(po.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) },
          { label: 'Approved', value: po.approved_at ? new Date(po.approved_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—' },
          { label: 'From Purchase Request', value: po.from_ppb_approval, hidden: !po.from_ppb_approval },
        ]} />
      </DocSection>

      <DocSection title="Item" count={lines.length} flush
        actions={<span className="text-sm">Total <b className="tabular-nums">{rupiah(po.total)}</b></span>}>
        <DataTable columns={oneVendor ? lineColumns.filter((c) => c.key !== 'vendor') : lineColumns} rows={lines} rowKey={(l) => l.id} containerClassName="max-h-none rounded-none border-0" />
      </DocSection>

      {(po.notes || activity.length > 0) && (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {po.notes && <DocSection title="Notes"><p className="whitespace-pre-wrap">{po.notes}</p></DocSection>}
          {activity.length > 0 && <DocSection title="Activity"><Activity items={activity} /></DocSection>}
        </div>
      )}
      {isFromAccurate
        ? <SyncNote at={po.accurate_synced_at} />
        : <SyncNote manual />}
    </DocPage>
  )
}

const PO_APPROVAL: Record<string, { label: string; cls: string }> = {
  MENUNGGU_DIREKTUR: { label: 'Waiting for Director approval', cls: TONE_EDGE.wait },
  DIKEMBALIKAN: { label: 'Revision needed from Director; correct and resubmit', cls: TONE_EDGE.warn },
  DISETUJUI: { label: 'Approved by Director', cls: TONE_EDGE.ok },
}
const LOG_TEXT: Record<string, string> = { DIAJUKAN: 'Submitted to Director', APPROVE: 'Approved by Director', REJECT: 'Returned by Director', DIBELI: 'Purchased' }

/** Approved PO: upload the proof of purchase (nota / invoice, photo or PDF) → status "Sudah dibeli". */
function PurchaseProof({ po, onError }: { po: PurchaseOrder; onError: (m: string | null) => void }) {
  const upload = useUploadPoProof(po.id)
  const input = useRef<HTMLInputElement>(null)
  const [opening, setOpening] = useState(false)
  const pick = (file?: File) => {
    if (!file) return
    if (file.size > 15 * 1024 * 1024) return onError('Ukuran file maksimal 15 MB.')
    onError(null)
    upload.mutate(file, { onError: (e) => onError(apiErrorMessage(e)), onSettled: () => { if (input.current) input.current.value = '' } })
  }
  const view = () => {
    setOpening(true)
    openPoProof(po.id).catch((e) => onError(apiErrorMessage(e))).finally(() => setOpening(false))
  }

  return (
    <Card className={po.proof ? TONE_EDGE.ok : TONE_EDGE.info}>
      <CardContent className="flex flex-col gap-3 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="font-medium">{po.proof ? 'Purchased' : 'Upload purchase proof'}</div>
          <div className="break-words text-xs text-muted-foreground">
            {po.proof
              ? `Proof: ${po.proof.file_name ?? 'file'}${po.proof.at ? ` · ${new Date(po.proof.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}` : ''} — items received through Receipt.`
              : 'The PO is approved. Upload the purchase receipt / invoice (photo or PDF); the status becomes "Purchased" automatically.'}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {po.proof && <Button size="sm" variant="outline" disabled={opening} onClick={view}>{opening ? 'Opening…' : 'View proof'}</Button>}
          {po.can_upload_proof && <>
            <input ref={input} type="file" className="hidden" accept="image/png,image/jpeg,image/webp,application/pdf"
              onChange={(e) => pick(e.target.files?.[0])} />
            <Button size="sm" variant={po.proof ? 'outline' : 'default'} disabled={upload.isPending} onClick={() => input.current?.click()}>
              {upload.isPending ? 'Uploading…' : po.proof ? 'Change proof' : 'Upload purchase proof'}
            </Button>
          </>}
        </div>
      </CardContent>
    </Card>
  )
}

/** STOCKWISE PO: purchasing completes it (vendor / price) → the Direktur approves or sends it back. */
function DirectorApproval({ po, onError }: { po: PurchaseOrder; onError: (m: string | null) => void }) {
  const action = usePoAction(po.id)
  const [completing, setCompleting] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState('')
  const waitingEntry = po.status === 'MENUNGGU_PO'
  const meta = po.approval_status ? PO_APPROVAL[po.approval_status] : null
  const run = (name: string, body?: unknown) => action.mutate({ action: name, body }, { onSuccess: () => { setRejecting(false); setNote('') }, onError: (e) => onError(apiErrorMessage(e)) })

  return (
    <Card className={meta?.cls ?? (waitingEntry ? TONE_EDGE.info : undefined)}>
      <CardContent className="space-y-3 p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-medium">{waitingEntry ? 'Waiting for PO — its items are in Draft PO' : meta?.label ?? 'PO STOCKWISE'}</div>
            <div className="text-xs text-muted-foreground">
              {po.from_ppb_approval ? `From Purchase Request ${po.from_ppb_approval} already approved. ` : ''}STOCKWISE POs are approved by the Director before being sent to the vendor.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {po.can_complete && (waitingEntry
              ? <Button size="sm" asChild><Link to="/purchase-orders/draft">Open RFQ</Link></Button>
              : <Button size="sm" variant="outline" onClick={() => setCompleting(true)}>Correct & resubmit</Button>)}
            {po.can_approve && !rejecting && <>
              <Button size="sm" variant="outline" className="border-orange-300 text-orange-700 hover:bg-orange-50" disabled={action.isPending} onClick={() => setRejecting(true)}>Revise</Button>
              <Button size="sm" disabled={action.isPending} onClick={() => run('approve')}>Approve (Director)</Button>
            </>}
          </div>
        </div>
        {rejecting && (
          <div className="flex flex-wrap gap-2">
            <Input className="min-w-0 flex-1" autoFocus placeholder="Why revise? What needs changing? (required)" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
            <Button size="sm" variant="outline" className="h-10" onClick={() => setRejecting(false)}>Cancel</Button>
            <Button size="sm" className="h-10 bg-orange-600 hover:bg-orange-700" disabled={action.isPending}
              onClick={() => (note.trim() ? run('reject', { note: note.trim() }) : invalidTo(onError, 'A note is required: write why it is revised.'))}>Send revision to purchasing</Button>
          </div>
        )}
      </CardContent>
      {completing && <CompletePoModal po={po} onClose={() => setCompleting(false)} />}
    </Card>
  )
}

/** Purchasing fixes a STOCKWISE PO the Direktur sent back: its vendor (one PO = one vendor), qty and prices. */
function CompletePoModal({ po, onClose }: { po: PurchaseOrder; onClose: () => void }) {
  const complete = useCompletePo(po.id)
  const { data: vendors } = useVendors({ limit: 2000, is_active: '1' })
  const [vendorId, setVendorId] = useState<number | ''>(po.vendor?.id ?? '')
  const [expected, setExpected] = useState(po.expected_date ?? '')
  const [lines, setLines] = useState(() => (po.items ?? []).map((l) => ({
    id: l.id, code: l.item_code, description: l.description, unit: l.unit, qty: String(Number(l.qty)), price: String(Number(l.unit_price) || ''),
  })))
  const [err, setErr] = useState<string | null>(null)
  const num = (v: string) => Number(v.trim().replace(',', '.'))
  const total = lines.reduce((t, l) => t + (num(l.qty) || 0) * (num(l.price) || 0), 0)
  const set = (i: number, patch: Partial<(typeof lines)[number]>) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const submit = () => {
    setErr(null)
    if (!vendorId) return invalidTo(setErr, 'Select this PO vendor.')
    if (lines.some((l) => !(num(l.qty) > 0) || !(num(l.price) >= 0) || l.price.trim() === '')) return invalidTo(setErr, 'Fill in qty (> 0) and price for each item.')
    complete.mutate({
      vendor_id: Number(vendorId), expected_date: expected || null,
      lines: lines.map((l) => ({ id: l.id, qty: num(l.qty), unit_price: num(l.price) })),
    }, { onSuccess: onClose, onError: (e) => setErr(apiErrorMessage(e)) })
  }
  return (
    <Modal open onClose={onClose} title={`Complete ${po.number}`} className="max-w-5xl"
      description="Vendor and price of each item, then the PO goes back to the Director. One PO per vendor."
      footer={<>
        <span className="mr-auto text-sm font-medium">Total {rupiah(total)}</span>
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" disabled={complete.isPending} onClick={submit}>Submit to Director</Button>
      </>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="cp-vendor">Vendor *</Label>
            <Select id="cp-vendor" value={vendorId} onChange={(e) => setVendorId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Select vendor…</option>
              {(vendors ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </Select>
          </div>
          <div className="space-y-1"><Label htmlFor="cp-exp">Estimated arrival</Label><Input id="cp-exp" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></div>
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="whitespace-nowrap border-b bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-10 px-3 py-2.5 text-center font-medium">No</th>
                <th className="min-w-[14rem] px-3 py-2.5 font-medium">Item</th>
                <th className="px-3 py-2.5 text-right font-medium">Qty</th>
                <th className="px-3 py-2.5 text-right font-medium">Price (Rp)</th>
                <th className="px-3 py-2.5 text-right font-medium">Subtotal</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {lines.map((l, i) => (
                <tr key={l.id} className="align-top even:bg-muted/20">
                  <td className="px-3 py-2.5 text-center tabular-nums text-muted-foreground">{i + 1}</td>
                  <td className="px-3 py-2.5"><div className="font-medium">{l.description}</div><div className="text-[13px] text-muted-foreground">{[l.code, l.unit].filter(Boolean).join(' · ')}</div></td>
                  <td className="px-3 py-2"><Input className="ml-auto h-9 w-24 text-right tabular-nums" inputMode="decimal" value={l.qty} aria-label={`Qty ${l.description}`} onChange={(e) => set(i, { qty: e.target.value })} /></td>
                  <td className="px-3 py-2"><Input className="ml-auto h-9 w-32 text-right tabular-nums" inputMode="decimal" value={l.price} placeholder="price" aria-label={`Price ${l.description}`} onChange={(e) => set(i, { price: e.target.value })} /></td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{rupiah((num(l.qty) || 0) * (num(l.price) || 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
      </div>
    </Modal>
  )
}
