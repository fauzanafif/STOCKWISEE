import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, BadgeCheck, Loader2, Lock, Pencil, Plus, Send, Trash2, TriangleAlert, Undo2, X } from 'lucide-react'
import { apiErrorMessage } from '@/lib/api'
import { usePoDraftActions, usePoDraftLines, usePoLineUnits, type PoDraftLine, type PoQuote, type PoStage } from '@/features/poDrafts/api'
import { useSaveVendor, useVendors } from '@/features/purchasing/api'
import { useAuth } from '@/auth/AuthContext'
import { PageHeader } from '@/components/PageHeader'
import { InBaseUom } from '@/components/UomEquivalent'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RequestStatusBadge } from '@/components/ui/request-badge'
import { Card } from '@/components/ui/card'
import { confirmDialog } from '@/components/ui/confirm'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { invalidTo, toast } from '@/lib/notify'
import { cn } from '@/lib/utils'

const rupiah = (n: number) => 'Rp ' + Number(n).toLocaleString('id-ID', { maximumFractionDigits: 2 })
const fmtQty = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 2 })
const fmtDate = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—')
/** "1.200.000" / "1200000" / "1200,5" / "1200.5" → a number */
const num = (v: string) => {
  const t = v.trim().replace(/\s/g, '')
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'))
  return Number(t.replace(',', '.'))
}
/** An offer against the last purchase price: ▲ dearer (red) / ▼ cheaper (green), in %. */
function VsLast({ price, last }: { price: number; last?: number }) {
  if (!last) return null
  const d = ((price - last) / last) * 100
  if (Math.abs(d) < 0.05) return <span className="ml-1 text-[11px] text-muted-foreground">= last price</span>
  return <span className={cn('ml-1 text-[11px] font-medium', d > 0 ? 'text-red-600' : 'text-emerald-700')}>{d > 0 ? '▲' : '▼'} {Math.abs(d).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%</span>
}

/** The last 3 purchase prices of the item (newest first), beside the offers now. */
function PriceHistory({ l }: { l: PoDraftLine }) {
  return (
    <div className="min-w-[13rem] rounded-md border bg-muted/20">
      <div className="border-b px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground">Previous 3 prices</div>
      {l.price_history.length === 0 ? <p className="px-2.5 py-2 text-xs text-muted-foreground">{l.item_id ? 'Never purchased.' : 'New item (outside the master).'}</p> : (
        <ul className="divide-y text-xs">
          {l.price_history.map((h, i) => (
            <li key={`${h.po}-${i}`} className="flex items-baseline justify-between gap-2 px-2.5 py-1.5">
              <span className="min-w-0"><span className="block truncate">{h.vendor ?? '—'}</span><span className="block text-[11px] text-muted-foreground">{fmtDate(h.date)} · {h.po}</span></span>
              <span className="shrink-0 tabular-nums font-medium">{rupiah(h.unit_price)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The date of purchasing's last price update; opens the last 3 updates of this vendor. */
function PriceUpdates({ q, item }: { q: PoQuote; item: string }) {
  const [open, setOpen] = useState(false)
  const last = q.updates[0]?.at ?? q.updated_at
  if (!last) return null
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="whitespace-nowrap text-[11px] text-muted-foreground underline-offset-2 hover:text-primary hover:underline" aria-label={`Price history ${q.vendor_name} for ${item}`}>
        Update {fmtDate(last)}
      </button>
      {open && (
        <Modal open onClose={() => setOpen(false)} title="Last 3 price updates" className="max-w-md" description={`${item} · ${q.vendor_name ?? ''}`}
          footer={<Button variant="outline" size="sm" onClick={() => setOpen(false)}>Close</Button>}>
          <ul className="divide-y rounded-lg border text-left text-sm">
            {q.updates.map((u, i) => (
              <li key={`${u.at}-${i}`} className="flex items-baseline justify-between gap-3 px-3 py-2">
                <span className="min-w-0"><span className="block">{fmtDate(u.at)}</span><span className="block truncate text-xs text-muted-foreground">{u.by ?? '—'}</span></span>
                <span className="shrink-0 font-medium tabular-nums">{rupiah(u.unit_price)}</span>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </>
  )
}

const th = 'px-3 py-2.5 font-medium'
const td = 'px-3 py-2.5'

/** The steps of the flow, on top of each page: where the items are now. */
function FlowSteps({ at, counts }: { at: 'siap' | 'rfq'; counts?: Partial<Record<PoStage, number>> }) {
  const steps = [
    { key: 'siap', to: '/purchase-orders/siap-po', label: 'Approved Purchase Request Items', n: counts?.SIAP },
    { key: 'rfq', to: '/purchase-orders/draft', label: 'RFQ', n: counts ? (counts.PENAWARAN ?? 0) + (counts.MENUNGGU_DIREKTUR ?? 0) + (counts.DIPILIH ?? 0) : undefined },
  ] as const
  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-sm">
      {steps.map((s, i) => (
        <li key={s.key} className="flex items-center gap-1.5">
          {i > 0 && <ArrowRight className="size-3.5 text-muted-foreground" />}
          <Link to={s.to} className={cn('rounded-full px-3 py-1 text-[13px]', at === s.key ? 'bg-primary font-medium text-primary-foreground' : 'bg-card text-muted-foreground ring-1 ring-border hover:text-foreground')}>
            {i + 1}. {s.label}{s.n ? <span className="ml-1 tabular-nums">({s.n})</span> : null}
          </Link>
        </li>
      ))}
    </ol>
  )
}

type Progress = 'todo' | 'done' | 'all'

/** What was already handled stays on the page: Not yet shows the work, Done shows the rest with its status. */
function ProgressFilter({ value, onChange, todo, done }: { value: Progress; onChange: (v: Progress) => void; todo: number; done: number }) {
  const opts: [Progress, string, number][] = [['todo', 'Not yet', todo], ['done', 'Done', done], ['all', 'All', todo + done]]
  return (
    <div className="flex gap-2" role="tablist" aria-label="Filter by progress">
      {opts.map(([k, label, n]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} onClick={() => onChange(k)}
          className={cn('flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors max-md:py-2', value === k ? 'border-primary bg-primary/10 text-primary' : 'bg-card text-muted-foreground hover:bg-muted hover:text-foreground')}>
          {label}<span className="tabular-nums opacity-70">{n}</span>
        </button>
      ))}
    </div>
  )
}

/** Where a line stands now, in words. */
function StageStatus({ l }: { l: PoDraftLine }) {
  const chosen = l.quotes.find((q) => q.chosen)
  if (l.stage === 'PO') return <span className="inline-flex flex-wrap items-center gap-1.5 whitespace-nowrap"><Link to={`/purchase-orders/${l.po?.id}`} className="text-[13px] text-primary hover:underline">{l.po?.number}</Link>{l.po?.status && <RequestStatusBadge status={l.po.status} />}</span>
  if (l.stage === 'DIPILIH') return <Badge variant="success">Director picked{chosen ? `: ${chosen.vendor_name}` : ''}</Badge>
  if (l.stage === 'MENUNGGU_DIREKTUR') return <Badge variant="warning">Waiting for Director pick</Badge>
  if (l.stage === 'PENAWARAN') return <Badge>In RFQ</Badge>
  return <Badge variant="neutral">Not quoted yet</Badge>
}

function useChecks(rows: PoDraftLine[]) {
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const live = rows.filter((r) => picked.has(r.id))
  const allOn = rows.length > 0 && rows.every((r) => picked.has(r.id))
  return {
    picked, live, allOn,
    toggle: (id: number) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n }),
    toggleAll: () => setPicked(allOn ? new Set() : new Set(rows.map((r) => r.id))),
    clear: () => setPicked(new Set()),
  }
}

const Check = ({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) =>
  <input type="checkbox" className="size-4 accent-primary" checked={on} onChange={onChange} aria-label={label} />

const Empty = ({ cols, loading, text }: { cols: number; loading: boolean; text: string }) => (
  <tr><td colSpan={cols} className="px-3 py-12 text-center text-muted-foreground">{loading ? <Loader2 className="mx-auto size-5 animate-spin" /> : text}</td></tr>
)

/** The PPB columns of a line, as in the NPBG table. */
function PpbCells({ l }: { l: PoDraftLine }) {
  return (
    <>
      <td className={cn(td, 'whitespace-nowrap')}>{l.ppb ? <Link to={`/ppb/${l.ppb.id}`} className="text-[13px] text-primary hover:underline">{l.ppb.no_ppb}</Link> : '—'}</td>
      <td className={cn(td, 'whitespace-nowrap text-xs')}>{fmtDate(l.ppb?.tgl_ppb)}</td>
      <td className={cn(td, 'whitespace-nowrap text-[13px]')}>{l.item_code ?? <span className="text-muted-foreground">new</span>}</td>
      <td className={cn(td, 'min-w-[14rem] font-medium')}>{l.description}</td>
      <td className={cn(td, 'whitespace-nowrap text-right tabular-nums')}>{fmtQty(l.qty)}<InBaseUom qty={l.qty} ratio={l.unit_ratio} base={l.base_unit} /></td>
      <td className={cn(td, 'text-xs')}>{l.unit ?? '—'}</td>
      <td className={cn(td, 'text-xs')}>{l.ppb?.divisi ?? '—'}</td>
      <td className={cn(td, 'text-xs')}>{l.ppb?.peminta ?? '—'}</td>
      <td className={cn(td, 'whitespace-nowrap text-xs')}>{fmtDate(l.ppb?.tgl_diperlukan)}</td>
    </>
  )
}
const PPB_HEAD = ['Purchase Request No', 'Purchase Request Date', 'Code', 'Item', 'Qty', 'Unit', 'Division', 'Requester', 'Needed']

// ------------------------------------------------------------------ Dashboard To do

/** Vendors picked for the table: any of them, added one by one. */
function VendorPicker({ picked, onChange, exclude = [], label = 'Add vendor' }: { picked: number[]; onChange: (ids: number[]) => void; exclude?: number[]; label?: string }) {
  const { data: vendors } = useVendors({ limit: 2000, is_active: '1' })
  const saveVendor = useSaveVendor()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const list = vendors ?? []
  const nameOf = (id: number) => list.find((v) => v.id === id)?.name ?? `#${id}`
  const create = () => {
    if (!newName.trim()) return
    saveVendor.mutate({ name: newName.trim() }, { onSuccess: (v) => { onChange([...picked, v.id]); setNewName(''); setCreating(false) } })
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {picked.map((id) => (
        <span key={id} className="inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-xs">{nameOf(id)}
          <button type="button" aria-label={`Remove ${nameOf(id)}`} className="text-muted-foreground hover:text-destructive" onClick={() => onChange(picked.filter((x) => x !== id))}><X className="size-3" /></button>
        </span>
      ))}
      <Select className="h-8 w-56" aria-label={label} value="" onChange={(e) => { if (e.target.value) onChange([...picked, Number(e.target.value)]) }}>
        <option value="">{label}…</option>
        {list.filter((v) => !picked.includes(v.id) && !exclude.includes(v.id)).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
      </Select>
      {creating ? (
        <div className="flex items-center gap-1">
          <Input className="h-8 w-44" placeholder="Vendor name" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} autoFocus />
          <Button size="sm" className="h-8" disabled={saveVendor.isPending} onClick={create}>{saveVendor.isPending ? <Loader2 className="size-3 animate-spin" /> : 'Save'}</Button>
          <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => { setCreating(false); setNewName('') }}><X className="size-4" /></button>
        </div>
      ) : (
        <button type="button" className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => setCreating(true)}>
          <Plus className="size-3" /> New vendor
        </button>
      )}
    </div>
  )
}

/** Purchase Order's To do: the items ready to process. Pick items and any vendors; they become the Draft PO table. */
export function PoTodoList() {
  const { data, isLoading } = usePoDraftLines({})
  const rows = (data?.data ?? []).filter((l) => l.stage === 'SIAP')
  const c = useChecks(rows)
  const [vendors, setVendors] = useState<number[]>([])
  const act = usePoDraftActions()
  const navigate = useNavigate()
  const go = () => {
    if (!vendors.length) return invalidTo(() => {}, 'Pick at least one vendor.')
    act.toDraftTable.mutate({ line_ids: c.live.map((l) => l.id), vendor_ids: vendors }, { onSuccess: () => { c.clear(); setVendors([]); navigate('/purchase-orders/draft') } })
  }
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="whitespace-nowrap border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <tr><th className="w-10 px-3 py-2.5"><Check on={c.allOn} onChange={c.toggleAll} label="Select all" /></th>{PPB_HEAD.map((h) => <th key={h} className={cn(th, h === 'Qty' && 'text-right')}>{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((l) => <tr key={l.id} className={c.picked.has(l.id) ? 'bg-primary/5' : undefined}><td className={td}><Check on={c.picked.has(l.id)} onChange={() => c.toggle(l.id)} label={`Select ${l.description}`} /></td><PpbCells l={l} /></tr>)}
            {rows.length === 0 && <Empty cols={10} loading={isLoading} text="No items are ready for a PO." />}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-2.5">
        <VendorPicker picked={vendors} onChange={setVendors} />
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{c.live.length ? `${c.live.length} items · ${vendors.length} vendors` : ''}</span>
          <Button disabled={!c.live.length || act.toDraftTable.isPending} onClick={go}>{act.toDraftTable.isPending ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />} Add to RFQ</Button>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ 1. PPB Siap PO

/** PPB Siap PO: every item of a PPB the Direktur approved; purchasing picks which go into the Penawaran Harga. */
export function PoReadyPage() {
  const [search, setSearch] = useState('')
  const { data, isLoading } = usePoDraftLines({ search: search.trim() || undefined, done: 1 })
  const [progress, setProgress] = useState<Progress>('todo')
  const all = data?.data ?? []
  const todo = all.filter((l) => l.stage === 'SIAP')
  const done = all.filter((l) => l.stage !== 'SIAP')
  const rows = progress === 'todo' ? todo : progress === 'done' ? done : [...todo, ...done]
  const c = useChecks(todo)
  const act = usePoDraftActions()
  const navigate = useNavigate()
  return (
    <div className="space-y-4">
      <PageHeader title="Approved Purchase Request Items" subtitle="Items from approved Purchase Requests. Tick the items that need prices, then move them to RFQ." />
      <FlowSteps at="siap" counts={data?.meta.stages} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Input className="sm:w-80" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item / Purchase Request no. / requester / division" aria-label="Search" />
        <ProgressFilter value={progress} onChange={setProgress} todo={todo.length} done={done.length} />
      </div>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="whitespace-nowrap border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-10 px-3 py-2.5"><Check on={c.allOn} onChange={c.toggleAll} label="Select all" /></th>
                {PPB_HEAD.map((h) => <th key={h} className={cn(th, h === 'Qty' && 'text-right')}>{h}</th>)}
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((l) => (
                <tr key={l.id} className={c.picked.has(l.id) ? 'bg-primary/5' : undefined}>
                  <td className={td}>{l.stage === 'SIAP' && <Check on={c.picked.has(l.id)} onChange={() => c.toggle(l.id)} label={`Select ${l.description}`} />}</td>
                  <PpbCells l={l} />
                  <td className={td}><StageStatus l={l} /></td>
                </tr>
              ))}
              {rows.length === 0 && <Empty cols={11} loading={isLoading} text={progress === 'done' ? 'Nothing handled yet.' : 'No items yet. Items arrive here after the Purchase Request is approved.'} />}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="sticky bottom-2 flex items-center justify-between gap-2 rounded-lg border bg-card p-2.5 shadow-md">
        <span className="text-sm text-muted-foreground">{c.live.length ? `${c.live.length} items selected` : ''}</span>
        <Button disabled={!c.live.length || act.toQuotation.isPending}
          onClick={() => act.toQuotation.mutate(c.live.map((l) => l.id), { onSuccess: () => { c.clear(); navigate('/purchase-orders/draft') } })}>
          {act.toQuotation.isPending ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />} Move to RFQ
        </Button>
      </div>
    </div>
  )
}

function QuoteModal({ l, onClose }: { l: PoDraftLine; onClose: () => void }) {
  const act = usePoDraftActions()
  const { data: vendors } = useVendors({ limit: 2000, is_active: '1' })
  const [vendorId, setVendorId] = useState<number | ''>('')
  const [price, setPrice] = useState('')
  const [availability, setAvailability] = useState('')
  const [eta, setEta] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const fill = (q?: PoQuote) => { setPrice(q ? String(q.unit_price) : ''); setAvailability(q?.availability ?? ''); setEta(q?.eta ?? ''); setNote(q?.note ?? '') }
  const save = () => {
    setErr(null)
    if (!vendorId) return invalidTo(setErr, 'Select a vendor.')
    if (price.trim() === '' || !(num(price) >= 0)) return invalidTo(setErr, 'Fill in the unit price.')
    act.quote.mutate({ id: l.id, vendor_id: Number(vendorId), unit_price: num(price), availability: availability.trim() || null, eta: eta || null, note: note.trim() || null }, {
      onSuccess: () => { setVendorId(''); fill() },
      onError: (e) => setErr(apiErrorMessage(e)),
    })
  }
  return (
    <Modal page open onClose={onClose} title={`Vendor quote · ${l.description}`} description={`${l.description} · ${fmtQty(l.qty)} ${l.unit ?? ''}`}
      footer={<Button variant="outline" size="sm" onClick={onClose}>Done</Button>}>
      <div className="space-y-3">
        <PriceHistory l={l} />
        {l.quotes.length > 0 && (
          <ul className="divide-y rounded-lg border text-sm">
            {l.quotes.map((q) => (
              <li key={q.id} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
                <button type="button" className="font-medium text-primary hover:underline" onClick={() => { setVendorId(q.vendor_id); fill(q) }}>{q.vendor_name}</button>
                <span className="text-xs text-muted-foreground">{[q.availability, q.eta && `ETA ${fmtDate(q.eta)}`].filter(Boolean).join(' · ')}</span>
                <span className="tabular-nums">{rupiah(q.unit_price)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2"><Label htmlFor="q-vendor">Vendor *</Label>
            <Select id="q-vendor" value={vendorId} onChange={(e) => { const v = e.target.value ? Number(e.target.value) : ''; setVendorId(v); fill(l.quotes.find((q) => q.vendor_id === v)) }}>
              <option value="">Select vendor…</option>
              {(vendors ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </Select>
          </div>
          <div className="space-y-1"><Label htmlFor="q-price">Unit price (Rp) *</Label>
            <Input id="q-price" className="text-right tabular-nums" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" /></div>
          <div className="space-y-1"><Label htmlFor="q-avail">Availability</Label>
            <Input id="q-avail" list="q-avail-list" value={availability} maxLength={100} onChange={(e) => setAvailability(e.target.value)} placeholder="e.g. Ready / Indent 1 week" />
            <datalist id="q-avail-list"><option value="Ready" /><option value="Ready sebagian" /><option value="Inden" /><option value="Kosong" /></datalist></div>
          <div className="space-y-1"><Label htmlFor="q-eta">Estimated arrival (ETA)</Label>
            <Input id="q-eta" type="date" value={eta} onChange={(e) => setEta(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="q-note">Notes</Label>
            <Input id="q-note" value={note} maxLength={255} onChange={(e) => setNote(e.target.value)} placeholder="e.g. 1 yr warranty, shipping included" /></div>
          <div className="flex justify-end sm:col-span-2">
            <Button size="sm" disabled={act.quote.isPending} onClick={save}>{act.quote.isPending && <Loader2 className="size-4 animate-spin" />} Save quote</Button>
          </div>
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
      </div>
    </Modal>
  )
}

/** Who picked, changed or returned this item, newest first. Picks made before this log existed show from the quote itself. */
function PickLog({ l }: { l: PoDraftLine }) {
  const chosen = l.quotes.find((q) => q.chosen)
  const fmtWhen = (v: string | null | undefined) => (v ? new Date(v).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')
  const price = (n: number | null) => (n === null ? '' : ` (${rupiah(n)})`)
  return (
    <ul className="mt-2 space-y-1 rounded-md bg-muted/30 px-2.5 py-2 text-xs">
      {l.pick_log.map((g) => (
        <li key={g.id}>
          <span className="font-medium">{g.by ?? '—'}</span> <span className="text-muted-foreground">· {fmtWhen(g.at)} ·</span>{' '}
          {g.action === 'PICK' ? `Picked ${g.to_vendor}${price(g.to_price)}`
            : g.action === 'CHANGE' ? `Changed ${g.from_vendor ?? '—'}${price(g.from_price)} to ${g.to_vendor}${price(g.to_price)}`
              : `Returned to purchasing${g.from_vendor ? ` (was ${g.from_vendor})` : ''}`}
          {g.reason && <span className="text-muted-foreground"> · {g.reason}</span>}
        </li>
      ))}
      {l.pick_log.length === 0 && chosen && <li><span className="font-medium">{chosen.chosen_by ?? '—'}</span> <span className="text-muted-foreground">· {fmtWhen(chosen.chosen_at)} ·</span> Picked {chosen.vendor_name}{price(chosen.unit_price)}</li>}
    </ul>
  )
}

// ------------------------------------------------------------------ 2. RFQ price matrix

type VendorLines = { vendorId: number; name: string; lines: PoDraftLine[] }
type Ask = { kind: 'change'; line: PoDraftLine; quote: PoQuote } | { kind: 'return'; line: PoDraftLine }

const STAGE_ORDER: Partial<Record<PoStage, number>> = { PENAWARAN: 0, MENUNGGU_DIREKTUR: 1, DIPILIH: 2, PO: 3 }

const NotPickTag = () => <span className="mt-1 inline-flex items-center gap-1 rounded bg-amber-500 px-1.5 py-0.5 text-[11px] font-semibold text-amber-950"><TriangleAlert className="size-3" />Not Director Pick</span>
const PickTag = () => <span className="mt-1 inline-flex items-center gap-1 rounded bg-emerald-600 px-1.5 py-0.5 text-[11px] font-semibold text-white"><BadgeCheck className="size-3" />Director Pick<Lock className="size-3" /></span>

/** A Director pick is locked: changing it or sending the item back needs a written reason, kept in the pick log. */
function ReasonModal({ ask, onClose }: { ask: Ask; onClose: () => void }) {
  const act = usePoDraftActions()
  const [reason, setReason] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const change = ask.kind === 'change'
  const busy = act.changePick.isPending || act.returnQuotation.isPending
  const from = ask.line.quotes.find((q) => q.chosen)
  const save = () => {
    setErr(null)
    if (reason.trim().length < 5) return invalidTo(setErr, 'Write a reason of at least 5 characters.')
    const opts = { onSuccess: onClose, onError: (e: unknown) => setErr(apiErrorMessage(e)) }
    if (ask.kind === 'change') act.changePick.mutate({ id: ask.line.id, quote_id: ask.quote.id, reason: reason.trim() }, opts)
    else act.returnQuotation.mutate({ id: ask.line.id, note: reason.trim() }, opts)
  }
  return (
    <Modal open onClose={onClose} title={change ? 'Change Director pick?' : 'Return to purchasing?'} className="max-w-md"
      description={ask.line.description}
      footer={<>
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" disabled={busy} onClick={save}>{busy && <Loader2 className="size-4 animate-spin" />} {change ? 'Change pick' : 'Return'}</Button>
      </>}>
      <div className="space-y-3">
        {from && (
          <div className="flex items-center justify-between gap-2 rounded-md border bg-emerald-50 px-3 py-2 text-sm dark:bg-emerald-950/40">
            <span className="font-medium">{from.vendor_name}</span><span className="tabular-nums">{rupiah(from.unit_price)}</span>
          </div>
        )}
        {ask.kind === 'change' && (
          <div className="flex items-center justify-between gap-2 rounded-md border bg-primary/5 px-3 py-2 text-sm">
            <span className="inline-flex items-center gap-1.5 font-medium"><ArrowRight className="size-3.5" />{ask.quote.vendor_name}</span><span className="tabular-nums">{rupiah(ask.quote.unit_price)}</span>
          </div>
        )}
        <div className="space-y-1.5"><Label htmlFor="ask-reason">Reason *</Label>
          <Textarea id="ask-reason" rows={3} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} autoFocus /></div>
        {err && <p className="text-sm text-destructive">{err}</p>}
      </div>
    </Modal>
  )
}

/** RFQ: one price matrix for every role. Purchasing types prices, the Director clicks a price to pick it (green, locked), purchasing then makes the PO. */
export function PoDraftPage() {
  const { hasPermission } = useAuth()
  const purchasing = hasPermission('po.create')
  const director = hasPermission('po.approve_director')
  const [search, setSearch] = useState('')
  const { data, isLoading } = usePoDraftLines({ search: search.trim() || undefined, done: 1 })
  const [progress, setProgress] = useState<Progress>('todo')
  const allLines = data?.data ?? []
  const active = useMemo(() => allLines.filter((l) => l.stage === 'PENAWARAN' || l.stage === 'MENUNGGU_DIREKTUR' || l.stage === 'DIPILIH'), [allLines])
  const done = useMemo(() => allLines.filter((l) => l.stage === 'PO'), [allLines])
  const rows = useMemo(() => {
    const list = progress === 'todo' ? active : progress === 'done' ? done : [...active, ...done]
    return [...list].sort((a, b) => (STAGE_ORDER[a.stage] ?? 9) - (STAGE_ORDER[b.stage] ?? 9))
  }, [progress, active, done])
  const pricingIds = useMemo(() => active.filter((l) => l.stage === 'PENAWARAN').map((l) => l.id), [active])
  const vendors = useMemo(() => {
    const by = new Map<number, string>()
    for (const l of rows) {
      for (const v of l.draft_vendors ?? []) by.set(v.id, v.name)
      for (const q of l.quotes) by.set(q.vendor_id, q.vendor_name ?? '')
    }
    return [...by].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [rows])
  const checkable = (l: PoDraftLine) => purchasing && (l.stage === 'PENAWARAN' || (l.stage === 'DIPILIH' && l.quotes.some((q) => q.chosen)))
  const c = useChecks(rows.filter(checkable))
  const priced = c.live.filter((l) => l.stage === 'PENAWARAN')
  const ordering = c.live.filter((l) => l.stage === 'DIPILIH')
  const [vendorOf, setVendorOf] = useState<Record<number, number>>({})
  const usedQuote = (l: PoDraftLine) => l.quotes.find((q) => q.vendor_id === (l.po?.vendor_id ?? vendorOf[l.id])) ?? l.quotes.find((q) => q.chosen)
  const groups = useMemo(() => {
    const by = new Map<number, VendorLines>()
    for (const l of ordering) {
      const q = l.quotes.find((x) => x.vendor_id === vendorOf[l.id]) ?? l.quotes.find((x) => x.chosen)!
      const g = by.get(q.vendor_id) ?? { vendorId: q.vendor_id, name: q.vendor_name ?? '', lines: [] }
      g.lines.push(l)
      by.set(q.vendor_id, g)
    }
    return [...by.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [ordering, vendorOf])
  const total = ordering.reduce((t, l) => t + (usedQuote(l)?.unit_price ?? 0) * l.qty, 0)
  const offPick = ordering.filter((l) => !usedQuote(l)?.chosen).length
  const [typed, setTyped] = useState<Record<string, string>>({})
  const [queue, setQueue] = useState<VendorLines[]>([])
  const [made, setMade] = useState(0)
  const [addingItem, setAddingItem] = useState(false)
  const [editingItem, setEditingItem] = useState<PoDraftLine | null>(null)
  const [quoting, setQuoting] = useState<number | null>(null)
  const [ask, setAsk] = useState<Ask | null>(null)
  const [logOpen, setLogOpen] = useState<Set<number>>(new Set())
  const navigate = useNavigate()
  const act = usePoDraftActions()
  const quoted = allLines.find((r) => r.id === quoting && r.stage === 'PENAWARAN') ?? null
  const fail = (e: unknown) => toast.fromError(e, apiErrorMessage(e))

  const save = (l: PoDraftLine, vendor: number, key: string) => {
    const text = typed[key]
    if (text === undefined) return
    const q = l.quotes.find((x) => x.vendor_id === vendor)
    const forget = () => setTyped((t) => { const n = { ...t }; delete n[key]; return n })
    if (text.trim() === '') {
      if (q) act.clearPrice.mutate({ id: l.id, quoteId: q.id }, { onSuccess: forget, onError: fail })
      else forget()
      return
    }
    const price = num(text)
    if (!(price >= 0)) { toast.invalid('The price must be a number.'); forget(); return }
    if (q && q.unit_price === price) { forget(); return }
    act.setPrice.mutate({ id: l.id, vendor_id: vendor, unit_price: price }, { onSuccess: forget, onError: fail })
  }
  const removeItem = async (l: PoDraftLine) => {
    if (await confirmDialog({ message: `Remove "${l.description}" from RFQ?`, danger: true }))
      act.removeItem.mutate(l.id)
  }
  const submit = async () => {
    const bare = priced.find((l) => l.quotes.length === 0)
    if (bare) return invalidTo(() => {}, `Set at least one price for ${bare.description}.`)
    if (await confirmDialog({ title: 'Submit to Director?', message: `${priced.length} items submitted. The Director picks the vendor for each item.`, confirmLabel: 'Submit' }))
      act.submitQuotation.mutate(priced.map((l) => l.id), { onSuccess: c.clear })
  }
  const backToReady = async () => {
    if (await confirmDialog({ message: `Return ${priced.length} items to Approved Purchase Request Items?` }))
      act.backToReady.mutate(priced.map((l) => l.id), { onSuccess: c.clear })
  }
  const toggleLog = (id: number) => setLogOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const cell = (l: PoDraftLine, v: { id: number; name: string }, low: number | null) => {
    const q = l.quotes.find((x) => x.vendor_id === v.id)
    const key = `${l.id}:${v.id}`
    const tip = q ? [q.availability, q.eta && `ETA ${fmtDate(q.eta)}`, q.note].filter(Boolean).join(' · ') || undefined : undefined
    if (l.stage === 'PENAWARAN' && purchasing) {
      return (
        <td key={v.id} className="border-l px-2 py-1.5 text-right align-top" title={tip}>
          <Input className="ml-auto h-8 w-32 text-right tabular-nums" inputMode="decimal" placeholder="Price" aria-label={`Price ${v.name} for ${l.description}`}
            value={typed[key] ?? (q ? String(q.unit_price) : '')} onChange={(e) => setTyped((t) => ({ ...t, [key]: e.target.value }))} onBlur={() => save(l, v.id, key)} />
          {q && low === q.unit_price && <div className="mt-0.5 text-[11px] text-emerald-700">Cheapest</div>}
          {q && <div className="mt-0.5"><PriceUpdates q={q} item={l.description} /></div>}
        </td>
      )
    }
    if (!q) return <td key={v.id} className="border-l px-3 py-2.5 text-right align-top text-muted-foreground">—</td>
    const used = (l.stage === 'DIPILIH' || l.stage === 'PO') && usedQuote(l)?.id === q.id
    const action =
      l.stage === 'MENUNGGU_DIREKTUR' && director ? { label: `Pick ${v.name} for ${l.description}`, hover: 'hover:bg-emerald-100 dark:hover:bg-emerald-900/40', run: () => act.choose.mutate({ id: l.id, quote_id: q.id }) }
        : l.stage === 'DIPILIH' && director && !q.chosen ? { label: `Change pick to ${v.name} for ${l.description}`, hover: 'hover:bg-emerald-100 dark:hover:bg-emerald-900/40', run: () => setAsk({ kind: 'change', line: l, quote: q }) }
          : l.stage === 'DIPILIH' && purchasing ? { label: `Use ${v.name} for ${l.description}`, hover: 'hover:bg-amber-50 dark:hover:bg-amber-950/40', run: () => { setVendorOf((m) => ({ ...m, [l.id]: v.id })); if (!c.picked.has(l.id)) c.toggle(l.id) } }
            : null
    const body = (
      <>
        <div className={cn('whitespace-nowrap tabular-nums', (q.chosen || used) && 'font-semibold')}>{rupiah(q.unit_price)}</div>
        {l.stage !== 'PO' && <div><VsLast price={q.unit_price} last={l.price_history[0]?.unit_price} /></div>}
        {q.chosen ? <PickTag /> : used ? <NotPickTag /> : low === q.unit_price && <div className="mt-0.5 text-[11px] text-emerald-700">Cheapest</div>}
      </>
    )
    return (
      <td key={v.id} title={tip} className={cn('border-l p-0 text-right align-top', q.chosen ? 'bg-emerald-50 dark:bg-emerald-950/40' : used && 'bg-amber-100 dark:bg-amber-950/50')}>
        {action
          ? <button type="button" aria-label={action.label} disabled={act.choose.isPending} onClick={action.run}
            className={cn('block w-full cursor-pointer px-3 pb-1 pt-2.5 text-right transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500 disabled:opacity-60', action.hover)}>{body}</button>
          : <div className="px-3 pb-1 pt-2.5">{body}</div>}
        <div className="px-3 pb-2"><PriceUpdates q={q} item={l.description} /></div>
      </td>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PageHeader title="RFQ" subtitle="Set vendor prices, the Director picks the vendor, then create the PO." />
        {purchasing && <Button size="sm" onClick={() => setAddingItem(true)}><Plus className="size-4" /> Add Item</Button>}
      </div>
      <FlowSteps at="rfq" counts={data?.meta.stages} />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">Price Matrix <span className="font-normal text-muted-foreground">({rows.length} items)</span></h2>
            <Input className="h-8 sm:w-72" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item / Purchase Request no. / vendor" aria-label="Search" />
            <ProgressFilter value={progress} onChange={setProgress} todo={active.length} done={done.length} />
          </div>
          {purchasing && pricingIds.length > 0 && (
            <VendorPicker picked={[]} exclude={vendors.map((v) => v.id)} onChange={(v) => act.addVendors.mutate({ line_ids: pricingIds, vendor_ids: v }, { onError: fail })} />
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="sticky left-0 z-10 w-10 bg-muted px-3 py-2.5">{purchasing && <Check on={c.allOn} onChange={c.toggleAll} label="Select all" />}</th>
                <th className={cn(th, 'sticky left-10 z-10 min-w-[16rem] bg-muted')}>Item</th>
                <th className={cn(th, 'whitespace-nowrap text-right')}>Qty</th>
                <th className={cn(th, 'whitespace-nowrap')}>Status</th>
                {vendors.map((v) => (
                  <th key={v.id} className={cn(th, 'min-w-[10rem] border-l text-right text-foreground')}>
                    <span className="inline-flex items-center gap-1">{v.name}
                      {purchasing && pricingIds.length > 0 && (
                        <button type="button" aria-label={`Remove column ${v.name}`} className="text-muted-foreground hover:text-destructive" onClick={() => act.dropVendor.mutate({ vendor: v.id, line_ids: pricingIds }, { onError: fail })}><X className="size-3" /></button>
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((l) => {
                const low = l.quotes.length > 1 ? Math.min(...l.quotes.map((q) => q.unit_price)) : null
                const editable = purchasing && l.stage === 'PENAWARAN'
                const hasLog = l.pick_log.length > 0 || l.quotes.some((q) => q.chosen)
                return (
                  <tr key={l.id} className={c.picked.has(l.id) ? 'bg-primary/5' : undefined}>
                    <td className="sticky left-0 z-10 bg-card px-3 py-2.5 align-top">{checkable(l) && <Check on={c.picked.has(l.id)} onChange={() => c.toggle(l.id)} label={`Select ${l.description}`} />}</td>
                    <td className="sticky left-10 z-10 bg-card px-3 py-2.5 align-top">
                      <div className="font-medium">{l.description}</div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                        <span>{[l.item_code, l.ppb?.no_ppb].filter(Boolean).join(' · ') || (l.item_id ? '' : 'manual')}</span>
                        {editable && <button type="button" onClick={() => setQuoting(l.id)} className="text-primary hover:underline">Quotes</button>}
                        {editable && !l.ppb && <button type="button" onClick={() => setEditingItem(l)} className="hover:text-primary" aria-label={`Edit ${l.description}`}><Pencil className="size-3" /></button>}
                        {editable && !l.ppb && <button type="button" onClick={() => void removeItem(l)} className="hover:text-destructive" aria-label={`Remove ${l.description}`}><Trash2 className="size-3" /></button>}
                        {director && (l.stage === 'MENUNGGU_DIREKTUR' || l.stage === 'DIPILIH') && (
                          <button type="button" onClick={() => setAsk({ kind: 'return', line: l })} className="inline-flex items-center gap-0.5 text-orange-700 hover:underline"><Undo2 className="size-3" />Return</button>
                        )}
                        {hasLog && <button type="button" onClick={() => toggleLog(l.id)} className="hover:text-primary hover:underline" aria-expanded={logOpen.has(l.id)}>Log</button>}
                      </div>
                      {l.return_note && l.stage === 'PENAWARAN' && <p className="mt-1 rounded bg-orange-50 px-2 py-1 text-xs text-orange-800">Returned by Director: {l.return_note}</p>}
                      {logOpen.has(l.id) && <PickLog l={l} />}
                    </td>
                    <td className={cn(td, 'whitespace-nowrap text-right align-top tabular-nums')}>{fmtQty(l.qty)} <span className="text-xs text-muted-foreground">{l.unit ?? ''}</span><InBaseUom qty={l.qty} ratio={l.unit_ratio} base={l.base_unit} /></td>
                    <td className={cn(td, 'align-top')}><StageStatus l={l} /></td>
                    {vendors.map((v) => cell(l, v, low))}
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr><td colSpan={4 + vendors.length} className="px-3 py-12 text-center text-muted-foreground">
                  {isLoading ? <Loader2 className="mx-auto size-5 animate-spin" />
                    : progress === 'done' ? 'No PO made yet.'
                      : <>No items yet. Move items from <Link to="/purchase-orders/siap-po" className="text-primary hover:underline">Approved Purchase Request Items</Link>, or add a manual item.</>}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {c.live.length > 0 && (
        <div className="sticky bottom-2 z-20 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-2.5 shadow-md">
          <span className="text-sm text-muted-foreground">
            {priced.length > 0 && <>{priced.length} items to submit</>}
            {priced.length > 0 && ordering.length > 0 && ' · '}
            {ordering.length > 0 && <>{ordering.length} items for PO · {groups.length} vendor · <span className="font-medium tabular-nums text-foreground">{rupiah(total)}</span>{offPick > 0 && <span className="ml-2 font-medium text-amber-800 dark:text-amber-300">{offPick} not Director pick</span>}</>}
          </span>
          <div className="flex flex-wrap gap-2">
            {priced.length > 0 && <>
              <Button variant="outline" disabled={act.backToReady.isPending} onClick={() => void backToReady()}><Undo2 className="size-4" /> Return to Approved Items</Button>
              <Button disabled={act.submitQuotation.isPending} onClick={() => void submit()}><Send className="size-4" /> Submit to Director</Button>
            </>}
            {ordering.length > 0 && <Button onClick={() => { setMade(0); setQueue(groups) }}><Send className="size-4" /> {groups.length > 1 ? `Create ${groups.length} Draft PO` : 'Create Draft PO'}</Button>}
          </div>
        </div>
      )}

      {queue[0] && (
        <CreatePoModal key={queue[0].vendorId} vendorId={queue[0].vendorId} vendorName={queue[0].name} lines={queue[0].lines} left={queue.length - 1}
          onClose={() => setQueue([])}
          onDone={(po) => {
            if (queue.length > 1) { setMade((n) => n + 1); setQueue(queue.slice(1)); return }
            c.clear(); setQueue([]); navigate(made === 0 ? `/purchase-orders/${po.id}` : '/purchase-orders')
          }} />
      )}
      {addingItem && <AddItemModal onClose={() => setAddingItem(false)} />}
      {editingItem && <EditItemModal item={editingItem} onClose={() => setEditingItem(null)} />}
      {quoted && <QuoteModal l={quoted} onClose={() => setQuoting(null)} />}
      {ask && <ReasonModal ask={ask} onClose={() => setAsk(null)} />}
    </div>
  )
}

/** Add Item: only items of an approved Purchase Request can enter the RFQ; tick them and they join the matrix. */
function AddItemModal({ onClose }: { onClose: () => void }) {
  const act = usePoDraftActions()
  const { data, isLoading } = usePoDraftLines({})
  const rows = (data?.data ?? []).filter((l) => l.stage === 'SIAP')
  const c = useChecks(rows)
  const add = () => act.toQuotation.mutate(c.live.map((l) => l.id), { onSuccess: onClose })
  return (
    <Modal page open onClose={onClose} title="Add Item to RFQ" description="Only items of an approved Purchase Request can be added. Tick the items that need prices."
      footer={<>
        <span className="mr-auto text-sm text-muted-foreground">{c.live.length ? `${c.live.length} items selected` : ''}</span>
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" disabled={!c.live.length || act.toQuotation.isPending} onClick={add}>{act.toQuotation.isPending ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />} Add to RFQ</Button>
      </>}>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="whitespace-nowrap border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <tr><th className="w-10 px-3 py-2.5"><Check on={c.allOn} onChange={c.toggleAll} label="Select all" /></th>{PPB_HEAD.map((h) => <th key={h} className={cn(th, h === 'Qty' && 'text-right')}>{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((l) => <tr key={l.id} className={c.picked.has(l.id) ? 'bg-primary/5' : undefined}><td className={td}><Check on={c.picked.has(l.id)} onChange={() => c.toggle(l.id)} label={`Select ${l.description}`} /></td><PpbCells l={l} /></tr>)}
            {rows.length === 0 && <Empty cols={10} loading={isLoading} text="No approved Purchase Request items are waiting." />}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}


function EditItemModal({ item, onClose }: { item: PoDraftLine; onClose: () => void }) {
  const act = usePoDraftActions()
  const [description, setDescription] = useState(item.description)
  const [qty, setQty] = useState(String(item.qty))
  const [err, setErr] = useState<string | null>(null)
  const save = () => {
    setErr(null)
    if (!description.trim()) return invalidTo(setErr, 'Fill in the item description.')
    if (!qty.trim() || !(num(qty) > 0)) return invalidTo(setErr, 'Qty must be greater than 0.')
    act.updateItem.mutate({ id: item.id, description: description.trim(), qty: num(qty) }, {
      onSuccess: () => onClose(),
      onError: (e) => setErr(apiErrorMessage(e)),
    })
  }
  return (
    <Modal open onClose={onClose} title="Edit Item" className="max-w-md"
      footer={<><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" disabled={act.updateItem.isPending} onClick={save}>{act.updateItem.isPending && <Loader2 className="size-4 animate-spin" />} Save</Button></>}>
      <div className="space-y-3">
        <div className="space-y-1"><Label>Description *</Label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div className="space-y-1"><Label>Qty *</Label>
          <Input className="w-40 text-right tabular-nums" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
        {err && <p className="text-sm text-destructive">{err}</p>}
      </div>
    </Modal>
  )
}

/** The picked items of the Direktur's vendor → one PO, submitted to the Direktur (prices from the pick, editable). */
function CreatePoModal({ vendorId, vendorName, lines, left, onClose, onDone }: { vendorId: number; vendorName: string; lines: PoDraftLine[]; left: number; onClose: () => void; onDone: (po: { id: number }) => void }) {
  const act = usePoDraftActions()
  const quote = (l: PoDraftLine) => l.quotes.find((q) => q.vendor_id === vendorId)
  const [expected, setExpected] = useState(() => lines.map((l) => quote(l)?.eta).filter(Boolean).sort().at(-1) ?? '')
  const [notes, setNotes] = useState('')
  const [qty, setQty] = useState<Record<number, string>>({})
  const [price, setPrice] = useState<Record<number, string>>({})
  const [unit, setUnit] = useState<Record<number, number>>({})
  const unitLists = usePoLineUnits(lines)
  const [err, setErr] = useState<string | null>(null)
  const qtyOf = (l: PoDraftLine) => qty[l.id] ?? String(l.qty)
  const priceOf = (l: PoDraftLine) => price[l.id] ?? String(quote(l)?.unit_price ?? '')
  // another unit keeps the same goods and the same total: 12 PCS at 100 = 1,2 PCK at 1.000
  const changeUnit = (l: PoDraftLine, options: { unit_id: number; ratio: number }[], next: number) => {
    const from = options.find((o) => o.unit_id === (unit[l.id] ?? l.unit_id))?.ratio
    const to = options.find((o) => o.unit_id === next)?.ratio
    if (from && to) {
      setQty((q) => ({ ...q, [l.id]: String(Math.round(((num(qtyOf(l)) || 0) * from / to) * 10000) / 10000) }))
      setPrice((p) => ({ ...p, [l.id]: String(Math.round(((num(priceOf(l)) || 0) * to / from) * 100) / 100) }))
    }
    setUnit((u) => ({ ...u, [l.id]: next }))
  }
  const total = lines.reduce((t, l) => t + (num(qtyOf(l)) || 0) * (num(priceOf(l)) || 0), 0)
  const submit = () => {
    setErr(null)
    const bad = lines.find((l) => !(num(qtyOf(l)) > 0) || priceOf(l).trim() === '' || !(num(priceOf(l)) >= 0))
    if (bad) return invalidTo(setErr, `Fill in qty (> 0) and price of ${bad.description}.`)
    act.submit.mutate({
      line_ids: lines.map((l) => l.id), vendor_id: vendorId, expected_date: expected || null, notes: notes.trim() || null,
      lines: lines.map((l) => ({ id: l.id, qty: num(qtyOf(l)), unit_price: num(priceOf(l)), ...(unit[l.id] ? { unit_id: unit[l.id] } : {}) })),
    }, { onSuccess: onDone, onError: (e) => setErr(apiErrorMessage(e)) })
  }
  return (
    <Modal page open onClose={onClose} title={`Draft PO · ${vendorName}`}
      description={`${lines.length} items become one PO, then go to the Director.${left > 0 ? ` There is still ${left} more vendors after this.` : ''}`}
      footer={<>
        <span className="mr-auto text-sm font-medium">Total {rupiah(total)}</span>
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" disabled={act.submit.isPending} onClick={submit}>{act.submit.isPending && <Loader2 className="size-4 animate-spin" />} Create Draft PO & submit</Button>
      </>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="cp-exp">Estimated arrival</Label><Input id="cp-exp" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="cp-notes">Remarks</Label><Input id="cp-notes" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} placeholder="empty = From Draft PO · Purchase Request no." /></div>
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="whitespace-nowrap border-b bg-muted text-left text-xs text-muted-foreground">
              <tr><th className={cn(th, 'min-w-[14rem]')}>Item</th><th className={cn(th, 'text-right')}>Qty</th><th className={cn(th, 'text-right')}>Price (Rp)</th><th className={cn(th, 'text-right')}>Subtotal</th></tr>
            </thead>
            <tbody className="divide-y">
              {lines.map((l, i) => {
                const list = unitLists[i]?.data
                const options = list?.units ?? []
                const current = unit[l.id] ?? l.unit_id
                const chosen = options.find((o) => o.unit_id === current)
                return (
                <tr key={l.id} className={cn('align-top', !quote(l)?.chosen && 'bg-amber-100 dark:bg-amber-950/50')}>
                  <td className={td}><div className="font-medium">{l.description}</div><div className="text-xs text-muted-foreground">{[l.item_code, l.ppb?.no_ppb].filter(Boolean).join(' · ')}</div>{!quote(l)?.chosen && <NotPickTag />}</td>
                  <td className="px-3 py-2"><div className="flex items-center justify-end gap-1">
                    <Input className="h-9 w-20 text-right tabular-nums" inputMode="decimal" value={qtyOf(l)} aria-label={`Qty ${l.description}`} onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))} />
                    {options.length > 1 ? (
                      <Select className="h-9 w-24" value={current ?? ''} aria-label={`Unit ${l.description}`} onChange={(e) => changeUnit(l, options, Number(e.target.value))}>
                        {!chosen && <option value={current ?? ''}>{l.unit ?? '—'}</option>}
                        {options.map((o) => <option key={o.unit_id} value={o.unit_id}>{o.code}</option>)}
                      </Select>
                    ) : <span className="w-10 text-xs text-muted-foreground">{l.unit ?? ''}</span>}</div>
                    {chosen && chosen.ratio !== 1 && (num(qtyOf(l)) || 0) > 0 && <div className="mt-1 whitespace-nowrap text-right text-[11px] tabular-nums text-muted-foreground">= {fmtQty(Math.round(num(qtyOf(l)) * chosen.ratio * 100) / 100)} {list?.base} in stock</div>}
                    {list && !chosen && l.unit !== list.base && <div className="mt-1 whitespace-nowrap text-right text-[11px] text-amber-700">No ratio to {list.base}: set it in UOM before receiving</div>}
                  </td>
                  <td className="px-3 py-2"><Input className="ml-auto h-9 w-32 text-right tabular-nums" inputMode="decimal" value={priceOf(l)} aria-label={`Price ${l.description}`} onChange={(e) => setPrice((p) => ({ ...p, [l.id]: e.target.value }))} /></td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{rupiah((num(qtyOf(l)) || 0) * (num(priceOf(l)) || 0))}</td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
      </div>
    </Modal>
  )
}
