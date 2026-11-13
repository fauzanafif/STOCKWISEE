import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Camera, CheckCircle2, Loader2, Truck, X } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { apiErrorMessage } from '@/lib/api'
import { usePurchaseReturn, useReturnPhoto, useReturnStep, type PurchaseReturnDetail } from '@/features/purchaseReturns/api'
import type { TimelineStep } from '@/features/itemRequests/api'
import { ReturnStatusBadge } from '@/pages/PurchaseReturnListPage'
import { RequestTimeline } from '@/components/itemRequests/RequestTimeline'
import { photoToDataUrl } from '@/components/tracking/EvidencePhoto'
import { BackLink } from '@/components/BackLink'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { confirmDialog } from '@/components/ui/confirm'
import { DetailFallback } from '@/components/DetailFallback'
import { openImage } from '@/components/ui/lightbox'
import { DocPage, DocSection, MetaList, TONE_EDGE } from '@/components/doc/DocLayout'
import { cn } from '@/lib/utils'
import { SmartButtons } from '@/components/documents/SmartButtons'
import { Chatter } from '@/components/documents/Chatter'

const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-')
const fmtQty = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 2 })
const fmtRp = (n: number) => `Rp ${n.toLocaleString('id-ID', { maximumFractionDigits: 0 })}`

function steps(r: PurchaseReturnDetail): TimelineStep[] {
  const cancelled = r.status === 'DIBATALKAN'
  return [
    { key: 'DIBUAT', label: 'Return created', state: 'done', at: r.created_at, by: r.created_by_name, note: null },
    { key: 'DIKIRIM', label: 'Sent to vendor', state: r.sent_at ? 'done' : cancelled ? 'cancelled' : 'current', at: r.sent_at, by: r.sent_by_name, note: null },
    {
      key: 'SELESAI', label: r.status === 'SELESAI' ? 'Done' : 'Settled by vendor',
      state: r.resolved_at ? 'done' : cancelled ? 'skipped' : r.sent_at ? 'current' : 'todo', at: r.resolved_at, by: r.resolved_by_name, note: null,
    },
  ]
}

/** The next step of an open return: send it, or settle it. */
function NextStep({ r }: { r: PurchaseReturnDetail }) {
  const step = useReturnStep(r.id)
  const file = useRef<HTMLInputElement>(null)
  const [photo, setPhoto] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [doneNote, setDoneNote] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const onError = (e: unknown) => setErr(apiErrorMessage(e))

  if (r.status === 'DIBUAT') {
    return (
      <Card className={cn("space-y-3 p-4", TONE_EDGE.info)}>
        <div className="text-sm font-semibold">Ship items to vendor</div>
        <input ref={file} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setPhoto(await photoToDataUrl(f, 1600)) }} />
        <div className="flex flex-wrap items-center gap-2">
          {photo ? (
            <span className="relative inline-block overflow-hidden rounded-md border">
              <img src={photo} alt="Shipping proof" className="h-16 w-24 object-cover" />
              <button type="button" onClick={() => setPhoto(null)} className="absolute right-0.5 top-0.5 rounded-full bg-card/90 p-0.5" aria-label="Delete photo"><X className="size-3" /></button>
            </span>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => file.current?.click()}><Camera className="size-4" /> Shipping proof photo</Button>
          )}
          <Input className="min-w-0 flex-1" value={note} maxLength={255} onChange={(e) => setNote(e.target.value)} placeholder="Notes, e.g. via courier / delivery note no. (optional)" />
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
        <Button className="w-full" disabled={step.send.isPending} onClick={() => step.send.mutate({ note: note.trim() || null, photo }, { onError })}>
          {step.send.isPending ? <Loader2 className="size-4 animate-spin" /> : <Truck className="size-4" />} Mark as sent
        </Button>
      </Card>
    )
  }
  if (r.status === 'DIKIRIM') {
    return (
      <Card className={cn("space-y-3 p-4", TONE_EDGE.info)}>
        <div className="text-sm font-semibold">Has the vendor settled this return?</div>
        <Input value={doneNote} maxLength={255} onChange={(e) => setDoneNote(e.target.value)} placeholder="Notes (optional), e.g. replaced with a new item / deducted from the bill" aria-label="Notes" />
        {err && <p className="text-sm text-destructive">{err}</p>}
        <Button className="w-full" disabled={step.resolve.isPending}
          onClick={() => step.resolve.mutate({ ref: null, note: doneNote.trim() || null }, { onError })}>
          {step.resolve.isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Done
        </Button>
      </Card>
    )
  }
  return null
}

function Photo({ id, slot, label }: { id: number; slot: 'barang' | 'kirim'; label: string }) {
  const p = useReturnPhoto(id, slot, true)
  return (
    <button type="button" onClick={() => p.data && openImage({ src: p.data, alt: label })} className="block w-full cursor-zoom-in overflow-hidden rounded-lg border bg-muted text-left" title="View photo">
      {p.data ? <img src={p.data} alt={label} className="h-36 w-full object-cover" /> : <div className="h-36" />}
      <div className="bg-card px-2 py-1 text-xs text-muted-foreground">{label}</div>
    </button>
  )
}

export function PurchaseReturnDetailPage() {
  const { id } = useParams()
  const { hasPermission } = useAuth()
  const { data: r, isLoading } = usePurchaseReturn(Number(id))
  const step = useReturnStep(Number(id))

  if (isLoading || !r) return <div className="space-y-4"><BackLink to="/purchase-returns" label="Return" /><DetailFallback loading={isLoading} /></div>
  const canManage = hasPermission('purchase_return.manage')
  const total = r.lines.reduce((s, l) => s + l.qty * (l.harga_satuan ?? 0), 0)

  return (
    <DocPage
      chatter={<Chatter type="purchase_return" id={Number(id)} />}
      back={{ to: '/purchase-returns', label: 'Return' }}
      kind="Return"
      number={r.number}
      status={<ReturnStatusBadge status={r.status} />}
      subtitle={[r.vendor ?? '-', fmtDate(r.tgl_retur)].join(' · ')}
      actions={canManage && r.status === 'DIBUAT' ? (
        <Button size="sm" variant="outline" className="text-destructive hover:bg-destructive/5 hover:text-destructive" disabled={step.cancel.isPending}
          onClick={async () => { if ((await confirmDialog({ message: 'Cancel this return?', danger: true }))) step.cancel.mutate() }}>Cancel return</Button>
      ) : undefined}
      aside={<>
        <DocSection title="Information">
          <MetaList items={[
            { label: 'Vendor', value: r.vendor },
            { label: 'Return date', value: fmtDate(r.tgl_retur) },
            { label: 'From Receipt', value: r.ri_id ? <Link to={`/ri/${r.ri_id}`} className=" text-primary hover:underline">{r.no_ri}</Link> : <span className="">{r.no_ri}</span> },
            { label: 'PO No', value: r.no_po ? <span className="">{r.no_po}</span> : null },
            { label: 'Total', value: total > 0 ? <span className="font-semibold tabular-nums">{fmtRp(total)}</span> : null },
          ]} />
        </DocSection>
        <DocSection title="Status">
          <RequestTimeline steps={steps(r)} />
          {(r.sent_note || r.resolution_ref || r.resolution_note) && (
            <div className="mt-3 space-y-0.5 border-t pt-3 text-muted-foreground">
              {r.sent_note && <p>Shipping: {r.sent_note}</p>}
              {r.resolution_ref && <p>Reference: <span className=" text-foreground">{r.resolution_ref}</span></p>}
              {r.resolution_note && <p>{r.resolution_note}</p>}
            </div>
          )}
        </DocSection>
      </>}
    >
      <SmartButtons type="purchase_return" id={Number(id)} />
      {canManage && <NextStep r={r} />}

      <DocSection title="Return reason">
        <p><span className="font-medium">{r.reason}</span>{r.note ? <span className="text-muted-foreground"> — {r.note}</span> : ''}</p>
      </DocSection>

      <DocSection title="Item" count={r.lines.length} flush
        actions={total > 0 ? <span>Total <b className="tabular-nums">{fmtRp(total)}</b></span> : undefined}>
        <ul className="divide-y">
          {r.lines.map((l) => (
            <li key={l.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="break-words font-medium">{l.deskripsi_barang}</div>
                <div className="text-[13px] text-muted-foreground">{l.kode_barang}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="tabular-nums">{fmtQty(l.qty)} <span className="text-muted-foreground">{l.satuan ?? ''}</span></div>
                {!!l.harga_satuan && <div className="text-xs tabular-nums text-muted-foreground">{fmtRp(l.qty * l.harga_satuan)}</div>}
              </div>
            </li>
          ))}
        </ul>
      </DocSection>

      {r.photos.length > 0 && (
        <DocSection title="Photo">
          <div className="grid max-w-lg grid-cols-2 gap-2">
            {r.photos.includes('barang') && <Photo id={r.id} slot="barang" label="Item photo" />}
            {r.photos.includes('kirim') && <Photo id={r.id} slot="kirim" label="Shipping proof" />}
          </div>
        </DocSection>
      )}
    </DocPage>
  )
}
