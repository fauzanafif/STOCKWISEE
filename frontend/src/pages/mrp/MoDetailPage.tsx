import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Ban, CheckCircle2, ClipboardCheck, FileCheck2, Loader2, Pencil, Play, Plus, RotateCcw, ShoppingCart, Trash2, Undo2 } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { apiErrorMessage } from '@/lib/api'
import { toast } from '@/lib/notify'
import {
  ACTIVITY_LABEL, ENTRY_KIND, MOVEMENT_LABEL, fmtDate, fmtDateTime, fmtQty, newClientKey, useMo, useMoStep, useMrpUnits,
  type EntryKind, type MoDetail, type MoEntry,
} from '@/features/mrp/api'
import { AvailabilityBadge, MoStatusBadge, Qty, Tabs, Warn } from '@/components/mrp/MrpParts'
import { MoFormModal } from '@/pages/mrp/MoListPage'
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

type Tab = 'overview' | 'components' | 'consumption' | 'output' | 'scrap' | 'movements' | 'activity'

/** Record consumption / output / scrap. The unit may be any the item is set up for; the Base UOM equivalent is shown live. */
function EntryModal({ mo, kind, onClose }: { mo: MoDetail; kind: EntryKind; onClose: () => void }) {
  const step = useMoStep(mo.id)
  const [itemId, setItemId] = useState<number | null>(kind === 'OUTPUT' ? mo.item_id : null)
  const [qty, setQty] = useState('')
  const [unit, setUnit] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [key] = useState(newClientKey)
  const units = useMrpUnits(itemId)
  const choices = kind === 'CONSUME'
    ? mo.components.map((c) => ({ id: c.item_id, label: `${c.code} · ${c.description}`, unit: c.base_unit }))
    : [{ id: mo.item_id, label: `${mo.product_code} · ${mo.product_name} (finished product)`, unit: mo.base_unit }, ...mo.components.map((c) => ({ id: c.item_id, label: `${c.code} · ${c.description}`, unit: c.base_unit }))]
  const baseUnit = choices.find((c) => c.id === itemId)?.unit ?? null
  const ratio = units.data?.find((u) => u.code === (unit || baseUnit))?.ratio ?? 1
  const n = Number(qty.replace(',', '.'))
  const comp = mo.components.find((c) => c.item_id === itemId)
  const remaining = kind === 'CONSUME' && comp ? Math.max(0, comp.required - comp.consumed) : kind === 'OUTPUT' ? Math.max(0, mo.planned_qty - mo.output_qty) : null

  const submit = () => {
    setErr(null)
    if (!itemId) return setErr('Select the item.')
    if (!(n > 0)) return setErr('Quantity must be more than 0.')
    if (kind === 'SCRAP' && !reason.trim()) return setErr('Fill in the scrap reason.')
    step.addEntry.mutate({ kind, item_id: itemId, qty: qty.replace(',', '.').trim(), unit: unit || null, entry_date: date, reason: reason.trim() || null, note: note.trim() || null, client_key: key }, {
      onSuccess: () => { toast.success(`${ENTRY_KIND[kind]} recorded.`); onClose() },
      onError: (e) => setErr(apiErrorMessage(e)),
    })
  }

  return (
    <Modal open onClose={onClose} form title={`Record ${ENTRY_KIND[kind].toLowerCase()} · ${mo.number}`}
      footer={<><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" disabled={step.addEntry.isPending} onClick={submit}>{step.addEntry.isPending && <Loader2 className="size-4 animate-spin" />} Record</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {kind !== 'OUTPUT' && (
          <label className="space-y-1 sm:col-span-2"><span className="text-xs text-muted-foreground">Item</span>
            <Select value={itemId ?? ''} onChange={(e) => { setItemId(e.target.value ? Number(e.target.value) : null); setUnit('') }}>
              <option value="">Select…</option>
              {choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </Select></label>
        )}
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Quantity</span><Input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus /></label>
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Unit</span>
          <Select value={unit || baseUnit || ''} onChange={(e) => setUnit(e.target.value === baseUnit ? '' : e.target.value)} disabled={!itemId}>
            {(units.data ?? (baseUnit ? [{ unit_id: 0, code: baseUnit, ratio: 1 }] : [])).map((u) => <option key={u.code} value={u.code}>{u.code}{u.code !== baseUnit ? ` (1 = ${fmtQty(u.ratio)} ${baseUnit})` : ''}</option>)}
          </Select></label>
        <div className="text-xs text-muted-foreground sm:col-span-2">
          {n > 0 && baseUnit && <>Stock effect at validation: <b className="text-foreground tabular-nums">{fmtQty(n * ratio)} {baseUnit}</b>{kind === 'SCRAP' && itemId === mo.item_id ? ' (rejected product: not received into stock)' : ''}. </>}
          {remaining !== null && <>Remaining in plan: {fmtQty(remaining)} {baseUnit ?? mo.base_unit}.</>}
        </div>
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Date</span><Input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Reason {kind === 'SCRAP' ? '' : '(needed beyond the plan)'}</span><Input value={reason} maxLength={255} onChange={(e) => setReason(e.target.value)} /></label>
        <label className="space-y-1 sm:col-span-2"><span className="text-xs text-muted-foreground">Notes</span><Textarea rows={2} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
    </Modal>
  )
}

/** Asks for a short text (reason / Accurate document numbers) before a step. */
function TextStep({ title, label, confirmLabel, danger, required, onSubmit, onClose, pending }: {
  title: string; label: string; confirmLabel: string; danger?: boolean; required?: boolean; pending: boolean; onSubmit: (text: string) => void; onClose: () => void
}) {
  const [text, setText] = useState('')
  return (
    <Modal open onClose={onClose} title={title}
      footer={<><Button variant="outline" size="sm" onClick={onClose}>Back</Button>
        <Button size="sm" variant={danger ? 'destructive' : 'default'} disabled={pending || (required && !text.trim())} onClick={() => onSubmit(text.trim())}>{pending && <Loader2 className="size-4 animate-spin" />} {confirmLabel}</Button></>}>
      <label className="block space-y-1"><span className="text-xs text-muted-foreground">{label}</span><Textarea rows={3} maxLength={255} value={text} onChange={(e) => setText(e.target.value)} autoFocus /></label>
    </Modal>
  )
}

function EntryTable({ rows, canVoid, onVoid, empty }: { rows: MoEntry[]; canVoid: (e: MoEntry) => boolean; onVoid: (e: MoEntry) => void; empty: string }) {
  if (rows.length === 0) return <p className="px-4 py-6 text-center text-muted-foreground">{empty}</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead className="bg-slate-100 text-left text-xs text-slate-600"><tr>
          <th className="px-3 py-2">Item</th><th className="px-3 py-2 text-right">Quantity</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Recorded by</th><th className="px-3 py-2">Reason / notes</th><th className="px-3 py-2">Status</th><th className="w-10" />
        </tr></thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className={cn('border-t', e.voided_at && 'text-muted-foreground line-through decoration-slate-300')}>
              <td className="px-3 py-2"><div className="font-medium">{e.item_name}</div><div className="text-xs text-muted-foreground">{e.item_code}</div></td>
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

export function MoDetailPage() {
  const { id } = useParams()
  const { hasPermission, user } = useAuth()
  const { data: mo, isLoading } = useMo(Number(id))
  const step = useMoStep(Number(id))
  const [tab, setTab] = useState<Tab>('overview')
  const [entry, setEntry] = useState<EntryKind | null>(null)
  const [ask, setAsk] = useState<'cancel' | 'reverse' | 'accurate' | null>(null)
  const [editing, setEditing] = useState(false)
  const onError = (e: unknown) => toast.fromError(e, apiErrorMessage(e))

  const entries = useMemo(() => {
    const all = mo?.entries ?? []
    return {
      consume: all.filter((e) => e.kind === 'CONSUME'),
      output: all.filter((e) => e.kind === 'OUTPUT'),
      scrap: all.filter((e) => e.kind === 'SCRAP'),
    }
  }, [mo?.entries])

  if (isLoading || !mo) return <div className="space-y-4"><BackLink to="/mrp/orders" label="Manufacturing Orders" /><DetailFallback loading={isLoading} /></div>

  const can = (p: string) => hasPermission(p)
  const recording = mo.status === 'IN_PROGRESS' && can('mrp.record')
  const shortage = mo.components.filter((c) => c.shortage > 0)
  const unknown = mo.components.filter((c) => c.status === 'UNKNOWN')
  const extra = mo.entries.some((e) => e.over_plan && !e.voided_at)
  const canVoid = (e: MoEntry) => mo.status === 'IN_PROGRESS' && (e.recorded_by_id === user?.id || can('mrp.validate'))
  const voidEntry = async (e: MoEntry) => {
    if (await confirmDialog({ message: `Void this ${ENTRY_KIND[e.kind].toLowerCase()} entry? It stays visible as voided.`, danger: true }))
      step.voidEntry.mutate(e.id, { onSuccess: () => toast.success('Entry voided.'), onError })
  }
  const go = (m: { mutate: (v: undefined, o: { onSuccess: () => void; onError: (e: unknown) => void }) => void }, msg: string) => m.mutate(undefined, { onSuccess: () => toast.success(msg), onError })

  const actions = (
    <>
      {mo.status === 'DRAFT' && can('mrp.create') && (can('mrp.confirm') || mo.responsible_id === user?.id) &&
        <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil className="size-4" /> Edit</Button>}
      {mo.status === 'DRAFT' && can('mrp.confirm') && (
        <Button size="sm" disabled={step.confirm.isPending} onClick={async () => {
          const msg = shortage.length ? `${shortage.length} component(s) are short. Confirm anyway? The rest can be bought through a Purchase Request.` : 'Confirm this MO? The plan is locked; then ask the components from the warehouse (Item Request → Delivery Order).'
          if (await confirmDialog({ message: msg, confirmLabel: 'Confirm' })) go(step.confirm, 'Confirmed: components reserved.')
        }}><CheckCircle2 className="size-4" /> Confirm</Button>
      )}
      {mo.status === 'CONFIRMED' && can('mrp.record') && <Button size="sm" disabled={step.start.isPending} onClick={() => go(step.start, 'Production started.')}><Play className="size-4" /> Start production</Button>}
      {mo.status === 'IN_PROGRESS' && can('mrp.record') && (
        <Button size="sm" disabled={step.finish.isPending} onClick={async () => {
          if (await confirmDialog({ message: 'Mark production as finished? It then waits for validation; nothing is posted to stock yet.', confirmLabel: 'Mark as finished' })) go(step.finish, 'Waiting for validation.')
        }}><ClipboardCheck className="size-4" /> Mark as finished</Button>
      )}
      {mo.status === 'TO_CLOSE' && can('mrp.record') && <Button size="sm" variant="outline" disabled={step.reopen.isPending} onClick={() => step.reopen.mutate(null, { onSuccess: () => toast.success('Reopened.'), onError })}><RotateCcw className="size-4" /> Reopen</Button>}
      {mo.status === 'TO_CLOSE' && can('mrp.validate') && (
        <Button size="sm" disabled={step.validate.isPending} onClick={async () => {
          if (await confirmDialog({ message: mo.posts_stock ? `Validate ${mo.number}?` : `Validate ${mo.number}? The components used must have been handed over by the warehouse (Delivery Order) and the ${fmtQty(mo.output_qty)} ${mo.base_unit} of ${mo.product_code} received with a Receipt. The MO itself moves no stock.`, confirmLabel: 'Validate' }))
            go(step.validate, 'Validated.')
        }}>{step.validate.isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Validate</Button>
      )}
      {mo.status === 'DONE' && mo.posts_stock && !mo.accurate_recorded && can('mrp.validate') && <Button size="sm" variant="outline" onClick={() => setAsk('accurate')}><FileCheck2 className="size-4" /> Mark as entered in Accurate</Button>}
      {mo.status === 'DONE' && mo.posts_stock && !mo.accurate_recorded && can('mrp.cancel') && <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setAsk('reverse')}><Undo2 className="size-4" /> Reverse</Button>}
      {['DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'TO_CLOSE'].includes(mo.status) && can('mrp.cancel') &&
        <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setAsk('cancel')}><Ban className="size-4" /> Cancel</Button>}
    </>
  )

  const progress = mo.planned_qty > 0 ? Math.min(100, (mo.output_qty / mo.planned_qty) * 100) : 0

  return (
    <DocPage back={{ to: '/mrp/orders', label: 'Manufacturing Orders' }} kind="Manufacturing Order" number={mo.number}
      status={<><MoStatusBadge status={mo.status} />{mo.priority === 'URGENT' && <Badge variant="danger">Urgent</Badge>}
        {mo.status === 'DONE' && mo.posts_stock && (mo.accurate_recorded ? <Badge variant="success">Entered in Accurate</Badge> : <Badge variant="warning">Not in Accurate</Badge>)}
        {mo.reversed && <Badge variant="neutral">Reversed</Badge>}</>}
      subtitle={`${mo.product_code} · ${mo.product_name}`} actions={actions}
      aside={<>
        <DocSection title="Information">
          <MetaList items={[
            { label: 'BoM', value: <Link to={`/mrp/boms/${mo.mrp_bom_id}`} className="text-primary hover:underline">{mo.bom_code} rev {mo.bom_revision}</Link> },
            { label: 'Planned', value: `${fmtQty(mo.planned_qty, 2)} ${mo.base_unit}` },
            { label: 'Planned dates', value: `${fmtDate(mo.planned_start)} – ${fmtDate(mo.planned_finish)}` },
            { label: 'Responsible', value: mo.responsible_name },
            { label: 'Created', value: `${mo.created_by_name ?? '-'} · ${fmtDateTime(mo.created_at)}` },
            { label: 'Accurate documents', value: mo.accurate_refs, hidden: !mo.accurate_refs },
            { label: 'Cancel reason', value: mo.cancel_reason, hidden: !mo.cancel_reason },
          ]} />
        </DocSection>
        <DocSection title="Steps">
          <MetaList items={([['confirmed', 'Confirmed'], ['started', 'Started'], ['finished', 'Finished'], ['done', 'Validated'], ['accurate_recorded', 'Entered in Accurate'], ['cancelled', 'Cancelled'], ['reversed', 'Reversed']] as const)
            .map(([k, label]) => ({ label, value: mo.steps[k].at ? `${mo.steps[k].by ?? '-'} · ${fmtDateTime(mo.steps[k].at)}` : null, hidden: !mo.steps[k].at && ['cancelled', 'reversed', 'accurate_recorded'].includes(k) }))} />
        </DocSection>
      </>}>

      {mo.bom_changed && ['DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'TO_CLOSE'].includes(mo.status) && <Warn>BoM {mo.bom_code} rev {mo.bom_revision} is no longer active. This MO keeps its own copy of the components.</Warn>}
      {shortage.length > 0 && (
        <Warn tone="bad">
          {shortage.length} component(s) are short: {shortage.map((c) => `${c.code} ${fmtQty(c.shortage)} ${c.base_unit}`).join(', ')}.
          {can('ppb.create') && ['DRAFT', 'CONFIRMED', 'IN_PROGRESS'].includes(mo.status) && (
            <Button size="sm" variant="outline" className="ml-2 mt-1" disabled={step.shortage.isPending}
              onClick={() => step.shortage.mutate(undefined, { onSuccess: (d) => toast.success(`Draft Purchase Request ${d.number} created (${d.lines} items).`), onError })}>
              <ShoppingCart className="size-4" /> Request shortage via Purchase Request
            </Button>
          )}
        </Warn>
      )}
      {unknown.length > 0 && <Warn>Stock of {unknown.map((c) => c.code).join(', ')} is not known in STOCKWISE yet (no Accurate sync / opening balance).</Warn>}
      {extra && <Warn>Some entries are beyond the plan or outside the BoM; they were allowed with a reason.</Warn>}
      {mo.status === 'DONE' && mo.posts_stock && !mo.accurate_recorded && !mo.reversed && <Warn tone="info">Posted in STOCKWISE only. Accurate remains the official stock: enter this production in Accurate, then mark it as entered so the next sync does not count it twice.</Warn>}

      <WarehouseGatePanel gate={mo.gate} outLabel="Components out" inLabel="Finished goods in"
        canRequest={['CONFIRMED', 'IN_PROGRESS'].includes(mo.status) && can('mrp.confirm') && can('item_request.create')}
        canLink={['IN_PROGRESS', 'TO_CLOSE'].includes(mo.status) && can('mrp.record')}
        requesting={step.requestComponents.isPending} linking={step.linkReceipt.isPending}
        onRequest={async () => {
          if (await confirmDialog({ message: 'Ask the warehouse for the components not asked yet? An Item Request is made for the responsible person; it goes through verification and approval, then the warehouse hands the Delivery Order over.', confirmLabel: 'Create Item Request' }))
            step.requestComponents.mutate(undefined, { onSuccess: (d) => toast.success(`Item Request ${d.number} created.`), onError })
        }}
        onLink={(no, done) => step.linkReceipt.mutate(no, { onSuccess: () => { toast.success(`Receipt ${no} linked.`); done() }, onError })}
        onUnlink={(no) => step.unlinkReceipt.mutate(no, { onError })} />

      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { key: 'overview', label: 'Overview' },
        { key: 'components', label: 'Components & availability', count: mo.components.length },
        { key: 'consumption', label: 'Consumption', count: entries.consume.filter((e) => !e.voided_at).length },
        { key: 'output', label: 'Finished output', count: entries.output.filter((e) => !e.voided_at).length },
        { key: 'scrap', label: 'Scrap', count: entries.scrap.filter((e) => !e.voided_at).length },
        { key: 'movements', label: 'Inventory movements', count: mo.movements.length },
        { key: 'activity', label: 'Activity', count: mo.activity.length },
      ]} />

      {tab === 'overview' && (
        <DocSection title="Production">
          <FieldGrid items={[
            { label: 'Planned', value: <span className="tabular-nums">{fmtQty(mo.planned_qty, 2)} {mo.base_unit}</span> },
            { label: 'Good output', value: <span className="font-semibold tabular-nums">{fmtQty(mo.output_qty, 2)} {mo.base_unit}</span> },
            { label: 'Rejected product', value: <span className="tabular-nums">{fmtQty(mo.scrap_product_qty, 2)} {mo.base_unit}</span> },
            { label: 'Component lines', value: mo.components.length },
            { label: 'Entries', value: mo.entries.filter((e) => !e.voided_at).length },
            { label: 'Stock posted', value: mo.status === 'DONE' || mo.reversed ? fmtDateTime(mo.steps.done.at) : 'Not yet (at validation)' },
            { label: 'Notes', value: mo.notes, wide: true },
          ]} />
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>Output vs plan</span><span className="tabular-nums">{progress.toFixed(0)}%</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${progress}%` }} /></div>
          </div>
        </DocSection>
      )}

      {tab === 'components' && (
        <DocSection title="Components & availability" flush>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-slate-100 text-left text-xs text-slate-600"><tr>
                <th className="px-3 py-2">Component</th><th className="px-3 py-2 text-right">Per unit</th><th className="px-3 py-2 text-right">Required</th>
                <th className="px-3 py-2 text-right">On hand</th><th className="px-3 py-2 text-right">Asked (Item Request)</th><th className="px-3 py-2 text-right">Handed over (DO)</th>
                <th className="px-3 py-2 text-right">Shortage</th><th className="px-3 py-2 text-right">Consumed</th><th className="px-3 py-2 text-right">Scrap</th><th className="px-3 py-2">Availability</th>
              </tr></thead>
              <tbody>
                {mo.components.map((c) => (
                  <tr key={c.component_id} className="border-t">
                    <td className="px-3 py-2"><div className="font-medium">{c.description}</div><div className="text-xs text-muted-foreground">{c.code} · {c.base_unit}{c.is_extra ? ' · outside BoM' : ''}</div></td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtQty(c.qty_per_unit)}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{fmtQty(c.required)}</td>
                    <td className="px-3 py-2 text-right tabular-nums" title={c.accurate_qty !== null ? `Accurate qty ${fmtQty(c.accurate_qty)}${c.accurate_synced_at ? ` · sync ${fmtDateTime(c.accurate_synced_at)}` : ''}` : undefined}>{c.stock_known ? fmtQty(c.on_hand) : '?'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtQty(c.requested)}</td>
                    <td className={cn('px-3 py-2 text-right tabular-nums', c.issued >= c.required ? 'text-emerald-700' : '')}>{fmtQty(c.issued)}</td>
                    <td className={cn('px-3 py-2 text-right tabular-nums', c.shortage > 0 && 'font-semibold text-red-700')}>{fmtQty(c.shortage)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtQty(c.consumed)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtQty(c.scrapped)}</td>
                    <td className="px-3 py-2"><AvailabilityBadge status={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">All quantities in each component's Base UOM. On hand follows the STOCKWISE stock, which is aligned to Accurate at every sync.</p>
        </DocSection>
      )}

      {tab === 'consumption' && (
        <DocSection title="Consumption" flush actions={recording && <Button size="sm" onClick={() => setEntry('CONSUME')}><Plus className="size-4" /> Record consumption</Button>}>
          <EntryTable rows={entries.consume} canVoid={canVoid} onVoid={voidEntry} empty="No consumption recorded yet." />
        </DocSection>
      )}
      {tab === 'output' && (
        <DocSection title="Finished output" flush actions={recording && <Button size="sm" onClick={() => setEntry('OUTPUT')}><Plus className="size-4" /> Record output</Button>}>
          <EntryTable rows={entries.output} canVoid={canVoid} onVoid={voidEntry} empty="No finished output recorded yet." />
        </DocSection>
      )}
      {tab === 'scrap' && (
        <DocSection title="Scrap" flush actions={recording && <Button size="sm" onClick={() => setEntry('SCRAP')}><Plus className="size-4" /> Record scrap</Button>}>
          <EntryTable rows={entries.scrap} canVoid={canVoid} onVoid={voidEntry} empty="No scrap recorded." />
        </DocSection>
      )}

      {tab === 'movements' && (
        <DocSection title="Inventory movements" flush>
          {mo.movements.length === 0 ? <p className="px-4 py-6 text-center text-muted-foreground">No movements yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-slate-100 text-left text-xs text-slate-600"><tr>
                  <th className="px-3 py-2">Time</th><th className="px-3 py-2">Movement</th><th className="px-3 py-2">Item</th><th className="px-3 py-2">Warehouse</th>
                  <th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Stock before → after</th><th className="px-3 py-2 text-right">Reserved before → after</th><th className="px-3 py-2">By</th>
                </tr></thead>
                <tbody>
                  {mo.movements.map((m) => (
                    <tr key={m.id} className="border-t">
                      <td className="whitespace-nowrap px-3 py-2">{fmtDateTime(m.created_at)}</td>
                      <td className="px-3 py-2">{MOVEMENT_LABEL[m.type] ?? m.type}</td>
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

      {tab === 'activity' && (
        <DocSection title="Activity">
          <Activity items={mo.activity.map((a) => ({ id: a.id, label: ACTIVITY_LABEL[a.action] ?? a.action, who: a.user_name, at: a.at, note: a.note,
            tone: a.action === 'CANCELLED' || a.action === 'REVERSED' ? 'bad' : a.action === 'VALIDATED' ? 'ok' : a.action === 'ENTRY_VOIDED' ? 'warn' : 'info' }))} />
        </DocSection>
      )}

      {entry && <EntryModal mo={mo} kind={entry} onClose={() => setEntry(null)} />}
      {editing && <MoFormModal open mo={mo} onClose={() => setEditing(false)} />}
      {ask === 'cancel' && <TextStep title={`Cancel ${mo.number}`} label={mo.status === 'DRAFT' ? 'Reason (optional)' : 'Reason'} confirmLabel="Cancel MO" danger required={mo.status !== 'DRAFT'}
        pending={step.cancel.isPending} onClose={() => setAsk(null)}
        onSubmit={(t) => step.cancel.mutate(t || null, { onSuccess: () => { toast.success('MO cancelled; reservations released.'); setAsk(null) }, onError })} />}
      {ask === 'reverse' && <TextStep title={`Reverse ${mo.number}`} label="Reason — every posted movement is reversed (components back to stock, finished goods out)" confirmLabel="Reverse" danger required
        pending={step.reverse.isPending} onClose={() => setAsk(null)}
        onSubmit={(t) => step.reverse.mutate(t, { onSuccess: () => { toast.success('Reversed.'); setAsk(null) }, onError })} />}
      {ask === 'accurate' && <TextStep title="Mark as entered in Accurate" label="Accurate document numbers (e.g. Delivery Order and Receipt / item adjustment)" confirmLabel="Mark as entered" required
        pending={step.accurate.isPending} onClose={() => setAsk(null)}
        onSubmit={(t) => step.accurate.mutate(t, { onSuccess: () => { toast.success('Marked as entered in Accurate.'); setAsk(null) }, onError })} />}
    </DocPage>
  )
}
