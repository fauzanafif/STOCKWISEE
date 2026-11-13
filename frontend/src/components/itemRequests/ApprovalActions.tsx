import { useRef, useState, useCallback } from 'react'
import { QrScanner } from '@/components/itemRequests/QrScanner'
import { Link } from 'react-router-dom'
import { Camera, CheckCircle2, HandHelping, Loader2, PackageCheck, RefreshCw, Undo2, XCircle, ScanLine } from 'lucide-react'
import { apiErrorMessage } from '@/lib/api'
import { STAGE_INFO, isBypass, useDecideRequest, useHandover, type Fulfillment, type ItemRequestStatus, type RequestProxy } from '@/features/itemRequests/api'
import { photoToDataUrl } from '@/components/tracking/EvidencePhoto'
import { SignaturePad } from '@/components/itemRequests/SignaturePad'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { Textarea } from '@/components/ui/textarea'
import { invalidTo } from '@/lib/notify'
import { LineImagesCell } from '@/components/itemRequests/RequestImages'
import { SerialPicker } from '@/components/npbg/SerialPicker'
import { useNpbgSerials } from '@/features/npbg/api'

interface Target {
  id: number
  number: string
  status: ItemRequestStatus
  requester_name: string | null
  can_approve: boolean
  can_handover: boolean
  proxy?: RequestProxy | null
  can_fulfill?: boolean
  approve_as?: 'MANAGER' | 'DIREKTUR' | 'GUDANG' | null
  /** the NPBG waiting for its serah terima (detail and Approval page): its quantities are fixed in the dialog */
  fulfillments?: Pick<Fulfillment, 'id' | 'seq' | 'status' | 'no_npbg' | 'lines'>[]
}

const fmtQty = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 2 })
const parse = (v: string) => Number(v.trim().replace(',', '.'))

type OpenFulfillment = Pick<Fulfillment, 'id' | 'seq' | 'no_npbg' | 'lines'>

/** Gudang's table before the serah terima: typed quantity per fulfillment line, and whether the rest is closed. */
export interface HandoverDraft {
  qty: Record<number, string>
  drop: Record<number, boolean>
  /** why less than the approved NPBG is handed over (required then) */
  reason?: Record<number, string>
}

/** The fixed quantities of a draft, or what is wrong with it. */
function readDraft(f: OpenFulfillment, d?: HandoverDraft): { handed: Record<number, number>; drop: number[]; reasons: Record<number, string> } | { error: string } {
  const handed: Record<number, number> = {}
  const drop: number[] = []
  const reasons: Record<number, string> = {}
  for (const l of f.lines) {
    const raw = d?.qty[l.id]
    const v = raw === undefined ? l.qty : parse(raw)
    if (!Number.isFinite(v) || v < 0 || v > l.qty) return { error: `Quantity of ${l.deskripsi ?? ''}: 0 to ${fmtQty(l.qty)}.` }
    handed[l.id] = v
    if (v < l.qty) {
      // the NPBG was made from stock that is there: handing over less needs a reason
      const why = (d?.reason?.[l.id] ?? '').trim()
      if (!why) return { error: `Fill in why the quantity of ${l.deskripsi ?? ''} is reduced.` }
      reasons[l.id] = why
      if (d?.drop[l.id]) drop.push(l.id)
    }
  }
  if (Object.values(handed).every((v) => v <= 0)) return { error: 'Fill in the quantity handed over.' }
  return { handed, drop, reasons }
}

/**
 * What the serah terima hands over: the whole prepared NPBG (Gudang never hands over part of it).
 * value / onChange are kept for the callers; there is nothing to change any more.
 */
export function HandoverQty({ f, stock, images }: {
  f: OpenFulfillment; value?: HandoverDraft; onChange?: (d: HandoverDraft) => void
  /** request line id → the item's stock (Master Produk; it drops when the serah terima is done) */
  stock?: Record<number, number | null | undefined>
  /** the requester's images per item: Gudang sees what was asked */
  images?: { requestId: number; byLine: Record<number, string[]> }
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="whitespace-nowrap bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Item</th>
            {stock && <th className="px-3 py-2 text-right font-medium" title="Product Master stock, reduced when handover finishes">Stock</th>}
            <th className="px-4 py-2 text-right font-medium">Handed Over</th>
            {images && <th className="px-4 py-2 text-right font-medium">Image</th>}
          </tr>
        </thead>
        <tbody className="divide-y">
          {f.lines.map((l) => {
            // Gudang hands over the whole NPBG it prepared — never part of it (no quantity to change)
            return (
              <tr key={l.id} className="align-top">
                <td className="px-4 py-2.5"><div className="font-medium">{l.deskripsi}</div></td>
                {stock && (
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums" title="Product Master stock, reduced when handover finishes">
                    {stock[l.line_id] != null ? <span className={(stock[l.line_id] ?? 0) > 0 ? 'text-emerald-700' : 'text-muted-foreground'}>{fmtQty(Number(stock[l.line_id]))} {l.satuan ?? ''}</span> : <span className="text-muted-foreground">?</span>}
                  </td>
                )}
                <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums"><b>{fmtQty(l.qty)}</b> <span className="text-xs text-muted-foreground">{l.satuan ?? ''}</span></td>
                {/* the requester's images of this item, rightmost */}
                {images && <td className="px-4 py-2.5"><LineImagesCell requestId={images.requestId} lineId={l.line_id} slots={images.byLine[l.line_id]} /></td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * The one thing the current user does: Approve (one tap; the approver does not change quantities),
 * Revisi (back to admin gudang to revise it, with a required note) or Tolak (with a reason);
 * for Gudang: prepare the goods from stock, or the serah terima of the prepared NPBG.
 */
export function ApprovalActions({ req, onDone, onPrepare, handover }: {
  req: Target
  onDone?: () => void
  /** detail page: jump to its "Siapkan barang" panel instead of opening the request */
  onPrepare?: () => void
  /** Gudang: what is handed over, fixed in the table first (HandoverQty) */
  handover?: HandoverDraft
}) {
  const decide = useDecideRequest(req.id)
  const [mode, setMode] = useState<'REJECT' | 'RETURN' | null>(null)
  const [reason, setReason] = useState('')
  // a note with the approval: admin gudang, the requester and the next approver all see it
  const [approveNote, setApproveNote] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [handing, setHanding] = useState(false)
  const info = STAGE_INFO[req.status]

  if (!info || (!req.can_approve && !req.can_handover && !req.can_fulfill)) return null

  const send = (action: 'APPROVE' | 'REJECT' | 'RETURN') => {
    setErr(null)
    if (action !== 'APPROVE' && !reason.trim()) return invalidTo(setErr, action === 'REJECT' ? 'The rejection reason is required.' : 'A note is required: write why it is revised.')
    decide.mutate({ action, note: action === 'APPROVE' ? (approveNote.trim() || null) : reason.trim() }, {
      onSuccess: () => { setMode(null); setReason(''); setApproveNote(''); onDone?.() },
      onError: (e) => setErr(apiErrorMessage(e)),
    })
  }

  const openF = req.fulfillments?.find((f) => f.status !== 'DISERAHKAN') ?? null
  const draft = openF ? readDraft(openF, handover) : null
  const draftError = draft && 'error' in draft ? draft.error : null
  const fixed = draft && !('error' in draft) ? draft : null

  if (req.can_handover) {
    return (
      <>
        <div className="flex flex-col gap-1 sm:items-end">
          <Button className="w-full sm:w-auto" disabled={!!draftError} onClick={() => setHanding(true)}><HandHelping className="size-4" /> Handover</Button>
          {draftError && <span className="text-xs text-destructive">{draftError}</span>}
        </div>
        {/* mounted only while open: every serah terima starts empty */}
        {handing && <HandoverDialog open onClose={() => setHanding(false)} req={req} onDone={onDone}
          fulfillment={openF} handed={fixed?.handed} drop={fixed?.drop} reasons={fixed?.reasons} />}
      </>
    )
  }

  // Gudang: goods in stock but no NPBG yet, give them from the stock first
  if (req.can_fulfill && req.status === 'DISIAPKAN') {
    return onPrepare
      ? <Button className="w-full sm:w-auto" onClick={onPrepare}><PackageCheck className="size-4" /> Prepare items</Button>
      : <Button asChild className="w-full sm:w-auto"><Link to={`/item-requests/${req.id}#siapkan`}><PackageCheck className="size-4" /> Prepare items</Link></Button>
  }

  if (req.can_fulfill) {
    return onPrepare
      ? <Button className="w-full sm:w-auto" onClick={onPrepare}><PackageCheck className="size-4" /> Prepare items</Button>
      : <Button asChild className="w-full sm:w-auto"><Link to={`/item-requests/${req.id}#siapkan`}><PackageCheck className="size-4" /> Prepare items</Link></Button>
  }

  if (mode) {
    const reject = mode === 'REJECT'
    return (
      <div className={reject ? 'w-full space-y-2 rounded-lg border border-red-200 bg-red-50/60 p-3' : 'w-full space-y-2 rounded-lg border border-orange-200 bg-orange-50/60 p-3'}>
        <Label htmlFor={`rj-${req.id}`} className={reject ? 'text-red-800' : 'text-orange-800'}>{reject ? 'Rejection reason *' : 'Why revise? *'}</Label>
        <Textarea id={`rj-${req.id}`} autoFocus rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder={reject ? 'e.g. Use old stock first' : 'e.g. Recheck the items / quantity'} />
        {err && <p className="text-sm text-destructive">{err}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => { setMode(null); setErr(null) }} disabled={decide.isPending}>Cancel</Button>
          <Button size="sm" className={reject ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-orange-600 text-white hover:bg-orange-700'} onClick={() => send(mode)} disabled={decide.isPending}>
            {decide.isPending ? <Loader2 className="size-4 animate-spin" /> : reject ? <XCircle className="size-4" /> : <Undo2 className="size-4" />}
            {reject ? 'Reject request' : 'Send revision to admin'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full space-y-1.5 sm:w-auto">
      <Textarea rows={2} maxLength={500} value={approveNote} onChange={(e) => setApproveNote(e.target.value)} className="min-h-0 text-sm"
        placeholder="Notes for the warehouse admin & requester (optional)" aria-label="Approval notes" />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="flex-1 border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800 sm:flex-none" onClick={() => setMode('REJECT')} disabled={decide.isPending}>
          <XCircle className="size-4" /> Reject
        </Button>
        <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => setMode('RETURN')} disabled={decide.isPending}>
          <Undo2 className="size-4" /> Revise
        </Button>
        <Button className="flex-[2] sm:flex-none" onClick={() => send('APPROVE')} disabled={decide.isPending}>
          {decide.isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} {isBypass(req) ? 'Approve as Director' : info.approve}
        </Button>
      </div>
      {isBypass(req) && <p className="text-xs text-muted-foreground">The Manager is approved automatically.</p>}
      {err && <p className="text-sm text-destructive">{err}</p>}
    </div>
  )
}

/** The serials of one item in stock, to pick those handed over. */
function LineSerials({ code, need, picked, onChange, requestId }: { code: string; need: number; picked: string[]; onChange: (v: string[]) => void; requestId: number }) {
  // the serials this request holds (picked while verifying) are listed too
  const sn = useNpbgSerials(code, requestId)
  // its own serials (already on this NPBG) stay selectable
  const list = [...picked.filter((p) => !(sn.data?.data ?? []).some((s) => s.serial === p)).map((serial) => ({ serial, source: 'ACCURATE' as const, expired: null })), ...(sn.data?.data ?? [])]
  return <SerialPicker serials={list} loading={sn.isLoading} need={need} picked={picked} onChange={onChange} />
}

/**
 * Siapkan & serah terima, one step on the gudang's phone: 1 how much is really handed over (less than
 * prepared goes back to stock), 2 photo of the goods being handed over, 3 who receives it, 4 the receiver signs.
 */
export function HandoverDialog({ open, onClose, req, onDone, fulfillment, handed: fixed, drop, reasons }: {
  open: boolean; onClose: () => void; req: Target; onDone?: () => void; fulfillment?: OpenFulfillment | null
  /** fixed in the table before (default: everything prepared) */
  handed?: Record<number, number>
  drop?: number[]
  reasons?: Record<number, string>
}) {
  const handover = useHandover(req.id, fulfillment?.id)
  const file = useRef<HTMLInputElement>(null)
  const [photo, setPhoto] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  // the requester receives it unless another name is typed
  const [receiver, setReceiver] = useState(req.requester_name ?? '')
  const [editingReceiver, setEditingReceiver] = useState(!req.requester_name)
  const [signature, setSignature] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  // the requester named a representative: they pick up with the requester's one-time code (scanned)
  const [byProxy, setByProxy] = useState(!!req.proxy)
  const [code, setCode] = useState('')
  const [scanning, setScanning] = useState(false)
  const scanned = useCallback((text: string) => { setCode(text); setScanning(false) }, [])
  const digits = (code.startsWith('STOCKWISE-WAKIL:') ? code.slice(16) : code).replace(/\D/g, '')

  const pick = async (f: File | undefined) => {
    if (!f) return
    setErr(null)
    setReading(true)
    try { setPhoto(await photoToDataUrl(f, 1600)) } catch (e) { setErr((e as Error).message) } finally { setReading(false) }
  }

  const qtyOf: Record<number, number> = Object.fromEntries((fulfillment?.lines ?? []).map((l) => [l.id, fixed?.[l.id] ?? l.qty]))
  // items with serial numbers: the serials of the units handed over, one per unit
  const snLines = (fulfillment?.lines ?? []).filter((l) => l.manage_sn && l.kode_barang && (qtyOf[l.id] ?? 0) > 0)
  const [serials, setSerials] = useState<Record<number, string[]>>(() => Object.fromEntries(snLines.map((l) => [l.id, l.serials ?? []])))
  const snDone = snLines.every((l) => (serials[l.id] ?? []).length === qtyOf[l.id])
  const ready = !!photo && !!signature && snDone && (byProxy ? digits.length === 6 : receiver.trim() !== '')
  const submit = () => {
    setErr(null)
    const short = snLines.find((l) => (serials[l.id] ?? []).length !== qtyOf[l.id])
    if (short) return invalidTo(setErr, `Select ${qtyOf[short.id]} serial number(s) for ${short.deskripsi ?? short.kode_barang}.`)
    if (!photo) return invalidTo(setErr, 'Take the handover proof photo first.')
    if (byProxy && digits.length !== 6) return invalidTo(setErr, 'Scan the representative QR or type the code (6 digits).')
    if (!byProxy && !receiver.trim()) return invalidTo(setErr, 'Fill in the recipient name.')
    if (!signature) return invalidTo(setErr, 'Ask the recipient to sign.')
    handover.mutate({ photo, signature, received_by: byProxy ? (req.proxy?.name ?? 'Wakil') : receiver.trim(), proxy_code: byProxy ? digits : undefined,
      handed: fulfillment ? qtyOf : undefined, drop: drop?.length ? drop : undefined, reasons: reasons && Object.keys(reasons).length ? reasons : undefined,
      serials: snLines.length ? Object.fromEntries(snLines.map((l) => [l.id, serials[l.id] ?? []])) : undefined }, {
      onSuccess: () => { onClose(); onDone?.() },
      onError: (e) => setErr(apiErrorMessage(e)),
    })
  }

  let n = 0
  return (
    <Modal open={open} onClose={onClose} title="Handover" description={fulfillment ? `${req.number} · Delivery Order ${fulfillment.no_npbg ?? ''}${fulfillment.seq > 1 ? ` (#${fulfillment.seq})` : ''} · ${fulfillment.lines.filter((l) => (qtyOf[l.id] ?? 0) > 0).length} items as in the table` : req.number} className="max-w-lg"
      footer={
        <Button className="w-full" size="lg" onClick={submit} disabled={handover.isPending || !ready}>
          {handover.isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
          {handover.isPending ? 'Saving…' : 'Done'}
        </Button>
      }>
      <div className="space-y-5">
        {req.proxy && (
          // the requester named a representative: who comes, and their code checked here
          <section className="space-y-2">
            <StepTitle n={++n} done={!byProxy || digits.length === 6}>Who is collecting?</StepTitle>
            <div className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/40 p-1" role="radiogroup" aria-label="Collector">
              {([[false, `${req.requester_name ?? 'Requester'} yourself`], [true, `Representative: ${req.proxy.name}`]] as const).map(([v, label]) => (
                <button key={String(v)} type="button" role="radio" aria-checked={byProxy === v} onClick={() => { setByProxy(v); setErr(null) }}
                  className={byProxy === v ? 'truncate rounded-md bg-card px-2 py-1.5 text-sm font-medium ring-1 ring-border' : 'truncate rounded-md px-2 py-1.5 text-sm text-muted-foreground'}>{label}</button>
              ))}
            </div>
            {byProxy && (digits.length === 6 && !scanning ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
                <span className="flex items-center gap-2 text-emerald-800"><ScanLine className="size-4" /> Code <b className=" tracking-widest">{digits}</b></span>
                <button type="button" className="text-xs text-primary hover:underline" onClick={() => { setCode(''); setScanning(true) }}>Scan again</button>
              </div>
            ) : (
              <div className="space-y-2">
                {scanning ? <QrScanner onResult={scanned} /> : (
                  <Button type="button" variant="outline" className="w-full" onClick={() => setScanning(true)}><ScanLine className="size-4" /> Scan representative QR</Button>
                )}
                <Input inputMode="numeric" maxLength={6} value={digits} onChange={(e) => setCode(e.target.value)} placeholder="or type the 6-digit code" aria-label="Representative code" className="text-center tracking-[0.3em]" />
              </div>
            ))}
          </section>
        )}
        {snLines.length > 0 && (
          <section className="space-y-2">
            <StepTitle n={++n} done={snDone}>Serial numbers</StepTitle>
            {snLines.map((l) => (
              <div key={l.id} className="space-y-1">
                <div className="text-sm font-medium">{l.deskripsi} <span className="font-normal text-muted-foreground">· {l.kode_barang} · {qtyOf[l.id]} {l.satuan ?? ''}</span></div>
                <LineSerials code={l.kode_barang!} requestId={req.id} need={qtyOf[l.id]} picked={serials[l.id] ?? []} onChange={(v) => setSerials((s) => ({ ...s, [l.id]: v }))} />
              </div>
            ))}
          </section>
        )}
        <section className="space-y-2">
          <StepTitle n={++n} done={!!photo}>Proof photo</StepTitle>
          <input ref={file} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
          {photo ? (
            <div className="relative overflow-hidden rounded-lg border">
              <img src={photo} alt="Handover proof" className="max-h-64 w-full bg-muted object-contain" />
              <Button type="button" size="sm" variant="outline" className="absolute right-2 top-2 bg-card/90" onClick={() => file.current?.click()}><RefreshCw className="size-4" /> Change</Button>
            </div>
          ) : (
            <button type="button" onClick={() => file.current?.click()} disabled={reading}
              className="flex w-full flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-8 text-sm text-muted-foreground transition-colors hover:border-primary hover:bg-primary/5 hover:text-primary">
              {reading ? <Loader2 className="size-7 animate-spin" /> : <Camera className="size-7" />}
              <span className="font-medium">{reading ? 'Processing…' : 'Take photo'}</span>
            </button>
          )}
        </section>

        <section className="space-y-2">
          <StepTitle n={++n} done={!!signature}>Recipient signature</StepTitle>
          {open && <SignaturePad onChange={setSignature} />}
          {byProxy ? (
            <p className="text-center text-xs text-muted-foreground">Recipient: <span className="font-medium text-foreground">{req.proxy?.name}</span> (representative {req.requester_name})</p>
          ) : editingReceiver ? (
            <Input value={receiver} maxLength={150} autoFocus={!req.requester_name} onChange={(e) => setReceiver(e.target.value)} placeholder="Recipient name" aria-label="Recipient name" />
          ) : (
            <p className="text-center text-xs text-muted-foreground">
              Recipient: <span className="font-medium text-foreground">{receiver}</span>{' '}
              <button type="button" className="text-primary hover:underline" onClick={() => setEditingReceiver(true)}>change</button>
            </p>
          )}
        </section>

        {err && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>}
      </div>
    </Modal>
  )
}

function StepTitle({ n, done, children }: { n: number; done: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold">
      <span className={done ? 'flex size-6 items-center justify-center rounded-full bg-emerald-600 text-xs text-white' : 'flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs text-primary'}>
        {done ? <CheckCircle2 className="size-4" /> : n}
      </span>
      {children}
    </div>
  )
}
