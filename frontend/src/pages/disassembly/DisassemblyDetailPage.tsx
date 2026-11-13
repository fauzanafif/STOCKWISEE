import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Ban, CheckCircle2, ClipboardCheck, FileCheck2, Loader2, Pencil, Play, Plus, RotateCcw, Trash2, Undo2, X } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { apiErrorMessage } from '@/lib/api'
import { toast } from '@/lib/notify'
import { DSA_ACTIVITY, DSA_KIND, DSA_MOVEMENT, useDsa, useDsaStep, useDsaUnits, type DsaDetail, type DsaEntry, type DsaKind } from '@/features/disassembly/api'
import { fmtDate, fmtDateTime, fmtQty, newClientKey } from '@/features/mrp/api'
import { Qty, Tabs, Warn } from '@/components/mrp/MrpParts'
import { DsaStatusBadge } from '@/components/disassembly/DsaParts'
import { DsaFormModal } from '@/pages/disassembly/DisassemblyListPage'
import { WarehouseGatePanel } from '@/components/WarehouseGatePanel'
import { BackLink } from '@/components/BackLink'
import { DetailFallback } from '@/components/DetailFallback'
import { Activity, DocPage, DocSection, FieldGrid, MetaList } from '@/components/doc/DocLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { confirmDialog } from '@/components/ui/confirm'
import { cn } from '@/lib/utils'

type Tab = 'overview' | 'components' | 'results' | 'variance' | 'movements' | 'accurate' | 'activity'

/** Record what came out for one component: good, scrap or missing. Any unit the item is set up for; Base UOM shown live. */
function EntryModal({ order, kind, itemId: preset, presetQty, onClose }: { order: DsaDetail; kind: DsaKind; itemId?: number; presetQty?: number; onClose: () => void }) {
  const step = useDsaStep(order.id)
  const [itemId, setItemId] = useState<number | null>(preset ?? null)
  const [qty, setQty] = useState(presetQty ? String(presetQty) : '')
  const [unit, setUnit] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [key] = useState(newClientKey)
  const units = useDsaUnits(itemId)
  const comp = order.components.find((c) => c.item_id === itemId)
  const baseUnit = comp?.base_unit ?? null
  const ratio = units.data?.find((u) => u.code === (unit || baseUnit))?.ratio ?? 1
  const n = Number(qty.replace(',', '.'))
  const needReason = kind !== 'GOOD'

  const submit = () => {
    setErr(null)
    if (!itemId) return setErr('Select the component.')
    if (!(n > 0)) return setErr('Quantity must be more than 0.')
    if (needReason && !reason.trim()) return setErr(kind === 'SCRAP' ? 'Fill in why it is scrapped.' : 'Fill in why it is missing.')
    step.addEntry.mutate({ kind, item_id: itemId, qty: qty.replace(',', '.').trim(), unit: unit || null, entry_date: date, reason: reason.trim() || null, note: note.trim() || null, client_key: key }, {
      onSuccess: () => { toast.success(`${DSA_KIND[kind]} recorded.`); onClose() },
      onError: (e) => setErr(apiErrorMessage(e)),
    })
  }

  return (
    <Modal open onClose={onClose} form title={`Record ${DSA_KIND[kind].toLowerCase()} · ${order.number}`}
      footer={<><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" disabled={step.addEntry.isPending} onClick={submit}>{step.addEntry.isPending && <Loader2 className="size-4 animate-spin" />} Record</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 sm:col-span-2"><span className="text-xs text-muted-foreground">Component</span>
          <Select value={itemId ?? ''} onChange={(e) => { setItemId(e.target.value ? Number(e.target.value) : null); setUnit('') }}>
            <option value="">Select…</option>
            {order.components.map((c) => <option key={c.item_id} value={c.item_id}>{c.code} · {c.description}{c.open > 0 ? ` — ${fmtQty(c.open)} ${c.base_unit} not recorded` : ''}</option>)}
          </Select></label>
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Quantity</span><Input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus /></label>
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Unit</span>
          <Select value={unit || baseUnit || ''} onChange={(e) => setUnit(e.target.value === baseUnit ? '' : e.target.value)} disabled={!itemId}>
            {(units.data ?? (baseUnit ? [{ unit_id: 0, code: baseUnit, ratio: 1 }] : [])).map((u) => <option key={u.code} value={u.code}>{u.code}{u.code !== baseUnit ? ` (1 = ${fmtQty(u.ratio)} ${baseUnit})` : ''}</option>)}
          </Select></label>
        <div className="text-xs text-muted-foreground sm:col-span-2">
          {n > 0 && baseUnit && <>= <b className="text-foreground tabular-nums">{fmtQty(n * ratio)} {baseUnit}</b>{kind === 'GOOD' ? ' enters stock at validation.' : ' — does not enter stock.'} </>}
          {comp && <>Not recorded yet: {fmtQty(comp.open)} {baseUnit}.</>}
        </div>
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Date</span><Input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Reason {needReason ? '' : '(needed beyond the plan)'}</span>
          <Input value={reason} maxLength={255} placeholder={kind === 'SCRAP' ? 'e.g. broken, defective' : kind === 'MISSING' ? 'e.g. not in the box' : ''} onChange={(e) => setReason(e.target.value)} /></label>
        <label className="space-y-1 sm:col-span-2"><span className="text-xs text-muted-foreground">Notes</span><Textarea rows={2} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
    </Modal>
  )
}

/** Finish: how much was really taken apart; every component must then be fully recorded. */
function FinishModal({ order, onClose }: { order: DsaDetail; onClose: () => void }) {
  const step = useDsaStep(order.id)
  const [qty, setQty] = useState(String(order.planned_qty))
  const [err, setErr] = useState<string | null>(null)
  const n = Number(qty.replace(',', '.'))
  const rows = order.components.filter((c) => !c.is_extra).map((c) => {
    const expected = c.qty_per_unit * (n > 0 ? n : 0)
    return { ...c, expected, gap: Math.round((expected - c.accounted) * 1e6) / 1e6 }
  })
  const short = rows.filter((r) => r.gap > 0)
  const over = rows.filter((r) => r.gap < 0)

  return (
    <Modal open onClose={onClose} title={`Mark ${order.number} as finished`}
      footer={<><Button variant="outline" size="sm" onClick={onClose}>Back</Button>
        <Button size="sm" disabled={step.finish.isPending || !(n > 0) || short.length > 0} onClick={() => step.finish.mutate(qty.replace(',', '.').trim(), {
          onSuccess: () => { toast.success('Waiting for validation.'); onClose() }, onError: (e) => setErr(apiErrorMessage(e)),
        })}>{step.finish.isPending && <Loader2 className="size-4 animate-spin" />} Mark as finished</Button></>}>
      <label className="block space-y-1"><span className="text-xs text-muted-foreground">Quantity really taken apart ({order.base_unit}, at most {fmtQty(order.planned_qty, 2)})</span>
        <Input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus /></label>
      <table className="mt-3 w-full text-[13px]">
        <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1">Component</th><th className="py-1 text-right">Expected</th><th className="py-1 text-right">Recorded</th><th className="py-1 text-right">Difference</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.component_id} className="border-t">
              <td className="py-1.5">{r.code}</td>
              <td className="py-1.5 text-right tabular-nums">{fmtQty(r.expected)} {r.base_unit}</td>
              <td className="py-1.5 text-right tabular-nums">{fmtQty(r.accounted)}</td>
              <td className={cn('py-1.5 text-right tabular-nums', r.gap > 0 ? 'font-semibold text-red-700' : r.gap < 0 ? 'text-amber-700' : 'text-emerald-700')}>{r.gap > 0 ? `${fmtQty(r.gap)} not recorded` : r.gap < 0 ? `+${fmtQty(-r.gap)}` : 'OK'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {short.length > 0 && <p className="mt-3 text-sm text-red-700">Record the rest of each component as good, scrap or missing first.</p>}
      {over.length > 0 && <p className="mt-3 text-sm text-amber-700">More was recorded than the BoM gives for this quantity; only a validator can finish it this way.</p>}
      {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
    </Modal>
  )
}

/** Asks for a reason before cancel / reverse. */
function ReasonStep({ title, label, confirmLabel, required, pending, onSubmit, onClose }: {
  title: string; label: string; confirmLabel: string; required?: boolean; pending: boolean; onSubmit: (text: string) => void; onClose: () => void
}) {
  const [text, setText] = useState('')
  return (
    <Modal open onClose={onClose} title={title}
      footer={<><Button variant="outline" size="sm" onClick={onClose}>Back</Button>
        <Button size="sm" variant="destructive" disabled={pending || (required && !text.trim())} onClick={() => onSubmit(text.trim())}>{pending && <Loader2 className="size-4 animate-spin" />} {confirmLabel}</Button></>}>
      <label className="block space-y-1"><span className="text-xs text-muted-foreground">{label}</span><Textarea rows={3} maxLength={255} value={text} onChange={(e) => setText(e.target.value)} autoFocus /></label>
    </Modal>
  )
}

/** Entered in Accurate: one or more Accurate document numbers, confirmed before saving. */
function AccurateModal({ order, onClose }: { order: DsaDetail; onClose: () => void }) {
  const step = useDsaStep(order.id)
  const [refs, setRefs] = useState<string[]>([''])
  const [err, setErr] = useState<string | null>(null)
  const list = refs.map((r) => r.trim()).filter(Boolean)
  const submit = async () => {
    setErr(null)
    if (list.length === 0) return setErr('Fill in at least one Accurate document number.')
    if (!(await confirmDialog({ message: `Mark ${order.number} as entered in Accurate with ${list.join(', ')}? From the next sync Accurate's qty carries this disassembly. This cannot be undone here.`, confirmLabel: 'Mark as entered' }))) return
    step.accurate.mutate(list, { onSuccess: () => { toast.success('Marked as entered in Accurate.'); onClose() }, onError: (e) => setErr(apiErrorMessage(e)) })
  }
  return (
    <Modal open onClose={onClose} title="Mark as entered in Accurate"
      footer={<><Button variant="outline" size="sm" onClick={onClose}>Back</Button><Button size="sm" disabled={step.accurate.isPending || list.length === 0} onClick={submit}>{step.accurate.isPending && <Loader2 className="size-4 animate-spin" />} Mark as entered</Button></>}>
      <p className="mb-2 text-xs text-muted-foreground">Accurate document numbers (e.g. the item adjustment that takes the product out and the one that brings the components in).</p>
      <div className="space-y-2">
        {refs.map((r, i) => (
          <div key={i} className="flex gap-2">
            <Input value={r} maxLength={60} placeholder={`Document ${i + 1}`} onChange={(e) => setRefs((x) => x.map((v, j) => (j === i ? e.target.value : v)))} autoFocus={i === 0} />
            {refs.length > 1 && <Button variant="ghost" size="sm" aria-label="Remove" onClick={() => setRefs((x) => x.filter((_, j) => j !== i))}><X className="size-4" /></Button>}
          </div>
        ))}
      </div>
      {refs.length < 10 && <Button variant="outline" size="sm" className="mt-2" onClick={() => setRefs((x) => [...x, ''])}><Plus className="size-4" /> Add document</Button>}
      {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
    </Modal>
  )
}

function EntryTable({ rows, canVoid, onVoid, empty, showKind }: { rows: DsaEntry[]; canVoid: (e: DsaEntry) => boolean; onVoid: (e: DsaEntry) => void; empty: string; showKind?: boolean }) {
  if (rows.length === 0) return <p className="px-4 py-6 text-center text-muted-foreground">{empty}</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead className="bg-slate-100 text-left text-xs text-slate-600"><tr>
          <th className="px-3 py-2">Component</th>{showKind && <th className="px-3 py-2">Type</th>}<th className="px-3 py-2 text-right">Quantity</th><th className="px-3 py-2">Date</th>
          <th className="px-3 py-2">Recorded by</th><th className="px-3 py-2">Reason / notes</th><th className="px-3 py-2">Status</th><th className="w-10" />
        </tr></thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className={cn('border-t', e.voided_at && 'text-muted-foreground line-through decoration-slate-300')}>
              <td className="px-3 py-2"><div className="font-medium">{e.item_name}</div><div className="text-xs text-muted-foreground">{e.item_code}</div></td>
              {showKind && <td className="px-3 py-2"><Badge variant={e.kind === 'SCRAP' ? 'danger' : 'warning'}>{DSA_KIND[e.kind]}</Badge></td>}
              <td className="px-3 py-2 text-right"><Qty qty={e.qty} unit={e.unit} baseQty={e.base_qty} baseUnit={e.base_unit} />
                {e.unit !== e.base_unit && <div className="text-[11px] text-muted-foreground">ratio {fmtQty(e.unit_ratio)} (frozen)</div>}</td>
              <td className="whitespace-nowrap px-3 py-2">{fmtDate(e.entry_date)}</td>
              <td className="px-3 py-2">{e.recorded_by ?? '-'}</td>
              <td className="px-3 py-2">{e.reason}{e.reason && e.note ? ' · ' : ''}{e.note}</td>
              <td className="px-3 py-2"><div className="flex flex-wrap gap-1">
                {e.voided_at ? <Badge variant="neutral">Voided</Badge> : e.posted_at ? <Badge variant="success">Posted</Badge> : <Badge variant="warning">Not posted</Badge>}
                {e.over_plan && <Badge variant="danger">Beyond plan</Badge>}
              </div></td>
              <td className="px-1">{!e.voided_at && !e.posted_at && canVoid(e) && <Button variant="ghost" size="sm" aria-label="Void entry" onClick={() => onVoid(e)}><Trash2 className="size-4" /></Button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function DisassemblyDetailPage() {
  const { id } = useParams()
  const { hasPermission, user } = useAuth()
  const { data: o, isLoading } = useDsa(Number(id))
  const step = useDsaStep(Number(id))
  const [tab, setTab] = useState<Tab>('overview')
  const [entry, setEntry] = useState<{ kind: DsaKind; itemId?: number; qty?: number } | null>(null)
  const [ask, setAsk] = useState<'cancel' | 'reverse' | 'accurate' | 'finish' | null>(null)
  const [editing, setEditing] = useState(false)
  const onError = (e: unknown) => toast.fromError(e, apiErrorMessage(e))

  const entries = useMemo(() => {
    const all = o?.entries ?? []
    return { good: all.filter((e) => e.kind === 'GOOD'), variance: all.filter((e) => e.kind !== 'GOOD') }
  }, [o?.entries])

  if (isLoading || !o) return <div className="space-y-4"><BackLink to="/disassembly/orders" label="Disassembly Orders" /><DetailFallback loading={isLoading} /></div>

  const can = (p: string) => hasPermission(p)
  const recording = o.status === 'IN_PROGRESS' && can('disassembly.record')
  const canVoid = (e: DsaEntry) => o.status === 'IN_PROGRESS' && (e.recorded_by_id === user?.id || can('disassembly.validate'))
  const voidEntry = async (e: DsaEntry) => {
    if (await confirmDialog({ message: `Void this ${DSA_KIND[e.kind].toLowerCase()} entry? It stays visible as voided.`, danger: true }))
      step.voidEntry.mutate(e.id, { onSuccess: () => toast.success('Entry voided.'), onError })
  }
  const go = (m: { mutate: (v: undefined, opt: { onSuccess: () => void; onError: (e: unknown) => void }) => void }, msg: string) => m.mutate(undefined, { onSuccess: () => toast.success(msg), onError })
  const open = ['DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'TO_CLOSE'].includes(o.status)
  const stock = o.source_stock
  const totals = o.components.reduce((s, c) => ({ good: s.good + c.good, scrap: s.scrap + c.scrap, missing: s.missing + c.missing, open: s.open + c.open }), { good: 0, scrap: 0, missing: 0, open: 0 })
  const goodCount = entries.good.filter((e) => !e.voided_at).length
  const varCount = entries.variance.filter((e) => !e.voided_at).length

  const actions = (
    <>
      {o.status === 'DRAFT' && can('disassembly.create') && (can('disassembly.confirm') || o.responsible_id === user?.id || o.created_by_id === user?.id) &&
        <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil className="size-4" /> Edit</Button>}
      {o.status === 'DRAFT' && can('disassembly.confirm') && (
        <Button size="sm" disabled={step.confirm.isPending} onClick={async () => {
          if (await confirmDialog({ message: `Confirm ${o.number}? The plan is locked; then ask the ${fmtQty(o.planned_qty, 2)} ${o.base_unit} of ${o.product_code} from the warehouse (Item Request → Delivery Order).`, confirmLabel: 'Confirm' }))
            go(step.confirm, 'Confirmed.')
        }}><CheckCircle2 className="size-4" /> Confirm</Button>
      )}
      {o.status === 'CONFIRMED' && can('disassembly.record') && <Button size="sm" disabled={step.start.isPending} onClick={() => go(step.start, 'Disassembly started.')}><Play className="size-4" /> Start disassembly</Button>}
      {o.status === 'IN_PROGRESS' && can('disassembly.record') && <Button size="sm" onClick={() => setAsk('finish')}><ClipboardCheck className="size-4" /> Mark as finished</Button>}
      {o.status === 'TO_CLOSE' && can('disassembly.record') && <Button size="sm" variant="outline" disabled={step.reopen.isPending} onClick={() => step.reopen.mutate(null, { onSuccess: () => toast.success('Reopened.'), onError })}><RotateCcw className="size-4" /> Reopen</Button>}
      {o.status === 'TO_CLOSE' && can('disassembly.validate') && (
        <Button size="sm" disabled={step.validate.isPending} onClick={async () => {
          if (await confirmDialog({ message: `Validate ${o.number}? The ${fmtQty(o.done_qty ?? o.planned_qty, 2)} ${o.base_unit} of ${o.product_code} must have been handed over by the warehouse (Delivery Order) and the ${fmtQty(totals.good)} good component units received with Receipts. The order itself moves no stock.`, confirmLabel: 'Validate' }))
            go(step.validate, 'Validated.')
        }}>{step.validate.isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Validate</Button>
      )}
      {o.status === 'DONE' && o.posts_stock && !o.accurate_recorded && can('disassembly.validate') && <Button size="sm" variant="outline" onClick={() => setAsk('accurate')}><FileCheck2 className="size-4" /> Mark as entered in Accurate</Button>}
      {o.status === 'DONE' && o.posts_stock && !o.accurate_recorded && can('disassembly.cancel') && <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setAsk('reverse')}><Undo2 className="size-4" /> Reverse</Button>}
      {open && can('disassembly.cancel') && <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setAsk('cancel')}><Ban className="size-4" /> Cancel</Button>}
    </>
  )

  return (
    <DocPage back={{ to: '/disassembly/orders', label: 'Disassembly Orders' }} kind="Disassembly Order" number={o.number}
      status={<><DsaStatusBadge status={o.status} />
        {o.status === 'DONE' && o.posts_stock && (o.accurate_recorded ? <Badge variant="success">Entered in Accurate</Badge> : <Badge variant="warning">Not in Accurate</Badge>)}
        {o.reversed && <Badge variant="neutral">Reversed</Badge>}</>}
      subtitle={`${o.product_code} · ${o.product_name}`} actions={actions}
      aside={<>
        <DocSection title="Information">
          <MetaList items={[
            { label: 'BoM', value: <Link to={`/mrp/boms/${o.mrp_bom_id}`} className="text-primary hover:underline">{o.bom_code} rev {o.bom_revision}</Link> },
            { label: 'Planned', value: `${fmtQty(o.planned_qty, 2)} ${o.base_unit}` },
            { label: 'Taken apart', value: o.done_qty !== null ? `${fmtQty(o.done_qty, 2)} ${o.base_unit}` : null, hidden: o.done_qty === null },
            { label: 'Source warehouse', value: o.source_warehouse },
            { label: 'Components go to', value: o.dest_warehouse ?? 'Same as source' },
            { label: 'Responsible', value: o.responsible_name },
            { label: 'Created', value: `${o.created_by_name ?? '-'} · ${fmtDateTime(o.created_at)}` },
            { label: 'Cancel reason', value: o.cancel_reason, hidden: !o.cancel_reason },
          ]} />
        </DocSection>
        <DocSection title="Steps">
          <MetaList items={([['confirmed', 'Confirmed'], ['started', 'Started'], ['finished', 'Finished'], ['done', 'Validated'], ['accurate_recorded', 'Entered in Accurate'], ['cancelled', 'Cancelled'], ['reversed', 'Reversed']] as const)
            .map(([k, label]) => ({ label, value: o.steps[k].at ? `${o.steps[k].by ?? '-'} · ${fmtDateTime(o.steps[k].at)}` : null, hidden: !o.steps[k].at && ['cancelled', 'reversed', 'accurate_recorded'].includes(k) }))} />
        </DocSection>
      </>}>

      {o.bom_changed && open && <Warn>BoM {o.bom_code} rev {o.bom_revision} is no longer active. This order keeps its own copy of the components.</Warn>}
      {o.status === 'DRAFT' && stock.shortage > 0 && <Warn tone="bad">Only {fmtQty(stock.free, 2)} {o.base_unit} of {o.product_code} are free in {o.source_warehouse} (need {fmtQty(o.planned_qty, 2)}). Confirmation will be refused.</Warn>}
      {open && !stock.stock_known && <Warn>Stock of {o.product_code} in {o.source_warehouse} is not known in STOCKWISE yet (no Accurate sync / opening balance).</Warn>}
      {o.status === 'IN_PROGRESS' && totals.open > 0 && <Warn tone="info">{fmtQty(totals.open)} component unit(s) are not recorded yet. Record each as good, scrap or missing before finishing.</Warn>}
      {o.status === 'DONE' && o.posts_stock && !o.accurate_recorded && !o.reversed && <Warn tone="info">Posted in STOCKWISE only. Accurate remains the official stock: enter this disassembly in Accurate, then mark it as entered so the next sync does not count it twice.</Warn>}

      <WarehouseGatePanel gate={o.gate} outLabel="Product out" inLabel="Good components in"
        canRequest={['CONFIRMED', 'IN_PROGRESS'].includes(o.status) && can('disassembly.confirm') && can('item_request.create')}
        canLink={['IN_PROGRESS', 'TO_CLOSE'].includes(o.status) && can('disassembly.record')}
        requesting={step.requestProduct.isPending} linking={step.linkReceipt.isPending}
        onRequest={async () => {
          if (await confirmDialog({ message: `Ask the warehouse for the ${o.product_code} to take apart? An Item Request is made for the responsible person; after approval the warehouse hands it over with a Delivery Order.`, confirmLabel: 'Create Item Request' }))
            step.requestProduct.mutate(undefined, { onSuccess: (d) => toast.success(`Item Request ${d.number} created.`), onError })
        }}
        onLink={(no, done) => step.linkReceipt.mutate(no, { onSuccess: () => { toast.success(`Receipt ${no} linked.`); done() }, onError })}
        onUnlink={(no) => step.unlinkReceipt.mutate(no, { onError })} />

      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { key: 'overview', label: 'Overview' },
        { key: 'components', label: 'Components', count: o.components.length },
        { key: 'results', label: 'Actual Results', count: goodCount },
        { key: 'variance', label: 'Scrap & Variance', count: varCount },
        { key: 'movements', label: 'Inventory Movements', count: o.movements.length },
        { key: 'accurate', label: 'Accurate Reconciliation' },
        { key: 'activity', label: 'Activity History', count: o.activity.length },
      ]} />

      {tab === 'overview' && (
        <DocSection title="Disassembly">
          <FieldGrid items={[
            { label: 'Planned', value: <span className="tabular-nums">{fmtQty(o.planned_qty, 2)} {o.base_unit}</span> },
            { label: 'Taken apart', value: <span className="font-semibold tabular-nums">{o.done_qty !== null ? `${fmtQty(o.done_qty, 2)} ${o.base_unit}` : 'Set when finished'}</span> },
            { label: 'Handed over by the warehouse', value: <span className="tabular-nums">{fmtQty(stock.issued, 2)} {o.base_unit} <span className="text-muted-foreground">(asked {fmtQty(stock.requested, 2)})</span></span> },
            { label: 'Free in source warehouse', value: <span className="tabular-nums">{stock.stock_known ? `${fmtQty(stock.free, 2)} ${o.base_unit}` : '?'}</span> },
            { label: 'Good components', value: <span className="tabular-nums">{fmtQty(totals.good)}</span> },
            { label: 'Scrap / missing', value: <span className="tabular-nums">{fmtQty(totals.scrap)} / {fmtQty(totals.missing)}</span> },
            { label: 'Stock posted', value: o.status === 'DONE' || o.reversed ? fmtDateTime(o.steps.done.at) : 'Not yet (at validation)' },
            { label: 'Notes', value: o.notes, wide: true },
          ]} />
        </DocSection>
      )}

      {tab === 'components' && (
        <DocSection title="Components" flush>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-slate-100 text-left text-xs text-slate-600"><tr>
                <th className="px-3 py-2">Component</th><th className="px-3 py-2 text-right">Per unit</th><th className="px-3 py-2 text-right">Planned</th><th className="px-3 py-2 text-right">Expected</th>
                <th className="px-3 py-2 text-right">Good</th><th className="px-3 py-2 text-right">Received (Receipt)</th><th className="px-3 py-2 text-right">Scrap</th><th className="px-3 py-2 text-right">Missing</th><th className="px-3 py-2 text-right">Not recorded</th>{recording && <th className="w-36" />}
              </tr></thead>
              <tbody>
                {o.components.map((c) => (
                  <tr key={c.component_id} className="border-t">
                    <td className="px-3 py-2"><div className="font-medium">{c.description}</div><div className="text-xs text-muted-foreground">{c.code} · {c.base_unit}{c.is_extra ? ' · outside BoM' : ''}</div></td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtQty(c.qty_per_unit)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtQty(c.planned)}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{fmtQty(c.expected)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{fmtQty(c.good)}</td>
                    <td className={cn('px-3 py-2 text-right tabular-nums', c.received < c.good ? 'text-amber-700' : 'text-muted-foreground')}>{fmtQty(c.received)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtQty(c.scrap)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtQty(c.missing)}</td>
                    <td className={cn('px-3 py-2 text-right tabular-nums', c.open > 0 ? 'font-semibold text-red-700' : c.over > 0 ? 'text-amber-700' : 'text-muted-foreground')}>{c.open > 0 ? fmtQty(c.open) : c.over > 0 ? `+${fmtQty(c.over)}` : '0'}</td>
                    {recording && <td className="px-2 py-2 text-right">{c.open > 0 && <Button size="sm" variant="outline" onClick={() => setEntry({ kind: 'GOOD', itemId: c.item_id, qty: c.open })}>Record as good</Button>}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">All quantities in each component's Base UOM. Expected = per unit × quantity taken apart (the plan until finished).</p>
        </DocSection>
      )}

      {tab === 'results' && (
        <DocSection title="Actual Results" flush actions={recording && <Button size="sm" onClick={() => setEntry({ kind: 'GOOD' })}><Plus className="size-4" /> Record good result</Button>}>
          <EntryTable rows={entries.good} canVoid={canVoid} onVoid={voidEntry} empty="No good results recorded yet." />
        </DocSection>
      )}
      {tab === 'variance' && (
        <DocSection title="Scrap & Variance" flush actions={recording && <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setEntry({ kind: 'SCRAP' })}><Plus className="size-4" /> Scrap</Button>
          <Button size="sm" variant="outline" onClick={() => setEntry({ kind: 'MISSING' })}><Plus className="size-4" /> Missing</Button></div>}>
          <EntryTable rows={entries.variance} canVoid={canVoid} onVoid={voidEntry} empty="No scrap or missing components." showKind />
        </DocSection>
      )}

      {tab === 'movements' && (
        <DocSection title="Inventory Movements" flush>
          {o.movements.length === 0 ? <p className="px-4 py-6 text-center text-muted-foreground">No movements yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-slate-100 text-left text-xs text-slate-600"><tr>
                  <th className="px-3 py-2">Time</th><th className="px-3 py-2">Movement</th><th className="px-3 py-2">Item</th><th className="px-3 py-2">Warehouse</th>
                  <th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Stock before → after</th><th className="px-3 py-2 text-right">Reserved before → after</th><th className="px-3 py-2">By</th>
                </tr></thead>
                <tbody>
                  {o.movements.map((m) => (
                    <tr key={m.id} className="border-t">
                      <td className="whitespace-nowrap px-3 py-2">{fmtDateTime(m.created_at)}</td>
                      <td className="px-3 py-2">{DSA_MOVEMENT[m.type] ?? m.type}</td>
                      <td className="px-3 py-2"><div>{m.item_name}</div><div className="text-xs text-muted-foreground">{m.item_code}</div></td>
                      <td className="px-3 py-2">{m.warehouse}</td>
                      <td className={cn('px-3 py-2 text-right tabular-nums', m.direction > 0 ? 'text-emerald-700' : m.direction < 0 ? 'text-red-700' : 'text-muted-foreground')}>{m.direction > 0 ? '+' : m.direction < 0 ? '−' : ''}{fmtQty(m.qty, 2)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmtQty(m.actual_before, 2)} → {fmtQty(m.actual_after, 2)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtQty(m.reserved_before, 2)} → {fmtQty(m.reserved_after, 2)}</td>
                      <td className="px-3 py-2">{m.user_name ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DocSection>
      )}

      {tab === 'accurate' && (
        <DocSection title="Accurate Reconciliation">
          <FieldGrid items={[
            { label: 'Status', value: o.status !== 'DONE' ? (o.reversed ? 'Reversed — nothing to enter' : 'Not posted yet') : o.accurate_recorded ? <Badge variant="success">Entered in Accurate</Badge> : <Badge variant="warning">Not yet entered in Accurate</Badge> },
            { label: 'Marked by', value: o.steps.accurate_recorded.at ? `${o.steps.accurate_recorded.by ?? '-'} · ${fmtDateTime(o.steps.accurate_recorded.at)}` : '-' },
            { label: 'Accurate documents', value: o.accurate_refs.length ? <div className="flex flex-wrap gap-1">{o.accurate_refs.map((r) => <Badge key={r} variant="neutral">{r}</Badge>)}</div> : '-', wide: true },
            { label: 'Stock effect now', value: o.status === 'DONE' && !o.accurate_recorded ? 'Added on top of the Accurate qty at every sync' : o.accurate_recorded ? 'Carried by the Accurate qty' : 'None', wide: true },
          ]} />
        </DocSection>
      )}

      {tab === 'activity' && (
        <DocSection title="Activity History">
          <Activity items={o.activity.map((a) => ({ id: a.id, label: DSA_ACTIVITY[a.action] ?? a.action, who: a.user_name, at: a.at, note: a.note,
            tone: a.action === 'CANCELLED' || a.action === 'REVERSED' ? 'bad' : a.action === 'VALIDATED' ? 'ok' : a.action === 'ENTRY_VOIDED' ? 'warn' : 'info' }))} />
        </DocSection>
      )}

      {entry && <EntryModal order={o} kind={entry.kind} itemId={entry.itemId} presetQty={entry.qty} onClose={() => setEntry(null)} />}
      {ask === 'finish' && <FinishModal order={o} onClose={() => setAsk(null)} />}
      {ask === 'accurate' && <AccurateModal order={o} onClose={() => setAsk(null)} />}
      {editing && <DsaFormModal open order={o} onClose={() => setEditing(false)} />}
      {ask === 'cancel' && <ReasonStep title={`Cancel ${o.number}`} label={o.status === 'DRAFT' ? 'Reason (optional)' : 'Reason'} confirmLabel="Cancel order" required={o.status !== 'DRAFT'}
        pending={step.cancel.isPending} onClose={() => setAsk(null)}
        onSubmit={(t) => step.cancel.mutate(t || null, { onSuccess: () => { toast.success('Cancelled; reservation released.'); setAsk(null) }, onError })} />}
      {ask === 'reverse' && <ReasonStep title={`Reverse ${o.number}`} label="Reason — every posted movement is reversed (components out again, product back)" confirmLabel="Reverse" required
        pending={step.reverse.isPending} onClose={() => setAsk(null)}
        onSubmit={async (t) => {
          if (await confirmDialog({ message: `Reverse ${o.number}? The recovered components leave stock and the product returns to ${o.source_warehouse}.`, danger: true, confirmLabel: 'Reverse' }))
            step.reverse.mutate(t, { onSuccess: () => { toast.success('Reversed.'); setAsk(null) }, onError })
        }} />}
    </DocPage>
  )
}
