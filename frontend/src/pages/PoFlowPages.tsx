import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, BadgeCheck, Loader2, Pencil, Plus, Send, Trash2, TriangleAlert, Undo2, X } from 'lucide-react'
import { apiErrorMessage } from '@/lib/api'
import { usePoDraftActions, usePoDraftLines, usePoLineUnits, type PoDraftLine, type PoQuote, type PoStage } from '@/features/poDrafts/api'
import { useVendors } from '@/features/purchasing/api'
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
function FlowSteps({ at, counts }: { at: 'siap' | 'penawaran' | 'draft'; counts?: Partial<Record<PoStage, number>> }) {
  const steps = [
    { key: 'siap', to: '/purchase-orders/siap-po', label: 'Approved Purchase Request Items', n: counts?.SIAP },
    { key: 'penawaran', to: '/purchase-orders/penawaran', label: 'RFQ', n: counts ? (counts.PENAWARAN ?? 0) + (counts.MENUNGGU_DIREKTUR ?? 0) : undefined },
    { key: 'draft', to: '/purchase-orders/draft', label: 'Draft PO', n: counts?.DIPILIH },
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

/** How far a line has moved along the flow. */
const RANK: Record<PoStage, number> = { SIAP: 0, PENAWARAN: 1, MENUNGGU_DIREKTUR: 2, DIPILIH: 3, PO: 4 }
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
  const list = vendors ?? []
  const nameOf = (id: number) => list.find((v) => v.id === id)?.name ?? `#${id}`
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
          <Button disabled={!c.live.length || act.toDraftTable.isPending} onClick={go}>{act.toDraftTable.isPending ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />} Add to Draft PO</Button>
        </div>
      </div>
    </div>
  )
}

/** Draft PO: items in rows, vendors in columns; the price goes at their crossing, saved as it is typed. */
function PriceMatrix({ lines }: { lines: PoDraftLine[] }) {
  const act = usePoDraftActions()
  const c = useChecks(lines)
  const [typed, setTyped] = useState<Record<string, string>>({})
  const vendors = useMemo(() => {
    const by = new Map<number, string>()
    for (const l of lines) {
      for (const v of l.draft_vendors ?? []) by.set(v.id, v.name)
      for (const q of l.quotes) by.set(q.vendor_id, q.vendor_name ?? '')
    }
    return [...by].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [lines])
  const ids = lines.map((l) => l.id)
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
  const submit = async () => {
    const bare = c.live.find((l) => l.quotes.length === 0)
    if (bare) return invalidTo(() => {}, `Set at least one price for ${bare.description}.`)
    if (await confirmDialog({ title: 'Submit to Director?', message: `${c.live.length} items submitted. The Director picks the vendor for each item.`, confirmLabel: 'Submit' }))
      act.submitQuotation.mutate(c.live.map((l) => l.id), { onSuccess: c.clear })
  }
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">Set prices <span className="font-normal text-muted-foreground">({lines.length} items)</span></h2>
        <VendorPicker picked={[]} exclude={vendors.map((v) => v.id)} onChange={(v) => act.addVendors.mutate({ line_ids: ids, vendor_ids: v }, { onError: fail })} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="sticky left-0 z-10 w-10 bg-muted px-3 py-2.5"><Check on={c.allOn} onChange={c.toggleAll} label="Select all to price" /></th>
              <th className={cn(th, 'sticky left-10 z-10 min-w-[16rem] bg-muted')}>Item</th>
              <th className={cn(th, 'whitespace-nowrap text-right')}>Qty</th>
              {vendors.map((v) => (
                <th key={v.id} className={cn(th, 'min-w-[10rem] border-l text-right text-foreground')}>
                  <span className="inline-flex items-center gap-1">{v.name}
                    <button type="button" aria-label={`Remove column ${v.name}`} className="text-muted-foreground hover:text-destructive" onClick={() => act.dropVendor.mutate({ vendor: v.id, line_ids: ids }, { onError: fail })}><X className="size-3" /></button>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {lines.map((l) => {
              const low = l.quotes.length > 1 ? Math.min(...l.quotes.map((q) => q.unit_price)) : null
              return (
                <tr key={l.id} className={c.picked.has(l.id) ? 'bg-primary/5' : undefined}>
                  <td className="sticky left-0 z-10 bg-card px-3 py-2"><Check on={c.picked.has(l.id)} onChange={() => c.toggle(l.id)} label={`Select ${l.description} to price`} /></td>
                  <td className="sticky left-10 z-10 bg-card px-3 py-2"><div className="font-medium">{l.description}</div><div className="text-xs text-muted-foreground">{[l.item_code, l.ppb?.no_ppb].filter(Boolean).join(' · ')}</div></td>
                  <td className={cn(td, 'whitespace-nowrap text-right tabular-nums')}>{fmtQty(l.qty)} <span className="text-xs text-muted-foreground">{l.unit ?? ''}</span><InBaseUom qty={l.qty} ratio={l.unit_ratio} base={l.base_unit} /></td>
                  {vendors.map((v) => {
                    const q = l.quotes.find((x) => x.vendor_id === v.id)
                    const key = `${l.id}:${v.id}`
                    return (
                      <td key={v.id} className="border-l px-2 py-1.5 text-right">
                        <Input className="ml-auto h-8 w-32 text-right tabular-nums" inputMode="decimal" placeholder="Price" aria-label={`Price ${v.name} for ${l.description}`}
                          value={typed[key] ?? (q ? String(q.unit_price) : '')} onChange={(e) => setTyped((t) => ({ ...t, [key]: e.target.value }))} onBlur={() => save(l, v.id, key)} />
                        {q && low === q.unit_price && <div className="mt-0.5 text-[11px] text-emerald-700">Cheapest</div>}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-2 border-t p-2.5">
        <span className="text-sm text-muted-foreground">{c.live.length ? `${c.live.length} items selected` : ''}</span>
        <Button disabled={!c.live.length || act.submitQuotation.isPending} onClick={() => void submit()}><Send className="size-4" /> Submit to Director</Button>
      </div>
    </Card>
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
          onClick={() => act.toQuotation.mutate(c.live.map((l) => l.id), { onSuccess: () => { c.clear(); navigate('/purchase-orders/penawaran') } })}>
          {act.toQuotation.isPending ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />} Move to RFQ
        </Button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ 2. Penawaran Harga

type QTab = 'penawaran' | 'direktur' | 'riwayat'
const Q_TABS: { key: QTab; stage: PoStage; label: string }[] = [
  { key: 'penawaran', stage: 'PENAWARAN', label: 'Quotes (Purchasing)' },
  { key: 'direktur', stage: 'MENUNGGU_DIREKTUR', label: 'Director Pick' },
  { key: 'riwayat', stage: 'DIPILIH', label: 'History' },
]

/**
 * Penawaran Harga: where purchasing talks with the vendors — per item each vendor's price, availability and
 * ETA, as an NPBG-like table — then submits it; the Direktur picks one vendor per item (tagged).
 */
export function PoQuotationPage() {
  const { hasPermission } = useAuth()
  const purchasing = hasPermission('po.create')
  const director = hasPermission('po.approve_director')
  const [params, setParams] = useSearchParams()
  const tab = (Q_TABS.find((t) => t.key === params.get('tab'))?.key ?? (purchasing ? 'penawaran' : 'direktur')) as QTab
  const stage = Q_TABS.find((t) => t.key === tab)!.stage
  const [search, setSearch] = useState('')
  const { data, isLoading } = usePoDraftLines({ search: search.trim() || undefined, done: 1 })
  const [progress, setProgress] = useState<Progress>('todo')
  const all = data?.data ?? []
  const todo = all.filter((l) => l.stage === stage)
  const done = all.filter((l) => RANK[l.stage] > RANK[stage])
  // every item the Director picked: still changeable first, then the ones already in a PO
  const history = all.filter((l) => l.stage === 'DIPILIH' || (l.stage === 'PO' && l.quotes.some((q) => q.chosen)))
  const rows = tab === 'riwayat' ? history : tab === 'direktur' || progress === 'todo' ? todo : progress === 'done' ? done : [...todo, ...done]
  const c = useChecks(todo)
  const act = usePoDraftActions()
  const [quoting, setQuoting] = useState<number | null>(null)
  const [returning, setReturning] = useState<PoDraftLine | null>(null)
  const [changing, setChanging] = useState<number | null>(null)
  const quoted = rows.find((r) => r.id === quoting) ?? null
  const changed = rows.find((r) => r.id === changing && r.stage === 'DIPILIH') ?? null
  const tabs = Q_TABS.filter((t) => purchasing || t.key !== 'penawaran')
  const editable = purchasing && stage === 'PENAWARAN'

  return (
    <div className="space-y-4">
      <PageHeader title="RFQ"
        subtitle={editable ? 'Record the price, availability, and ETA from each vendor for the selected items, then submit to the Director to pick the vendor.'
          : 'Compare vendor quotes for each item. The Director picks one vendor per item; the pick is tagged and moves on to Draft PO.'} />
      {purchasing && <FlowSteps at="penawaran" counts={data?.meta.stages} />}
      <div className="flex flex-col gap-3 border-b md:flex-row md:items-end md:justify-between">
        <div className="-mb-px flex overflow-x-auto" role="tablist">
          {tabs.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => { setParams({ tab: t.key }); c.clear(); setProgress('todo') }}
              className={cn('whitespace-nowrap border-b-2 px-4 pb-2.5 pt-1 text-sm font-medium', tab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
              {t.label}{(t.key === 'riwayat' ? history.length : data?.meta.stages[t.stage] ?? 0) > 0 && <span className="ml-1.5 rounded-full bg-muted px-1.5 text-xs tabular-nums">{t.key === 'riwayat' ? history.length : data?.meta.stages[t.stage]}</span>}
            </button>
          ))}
        </div>
        <Input className="mb-2 md:w-72" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item / Purchase Request no. / vendor" aria-label="Search" />
      </div>
      {tab === 'penawaran' && <ProgressFilter value={progress} onChange={setProgress} todo={todo.length} done={done.length} />}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="whitespace-nowrap border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                {editable && <th className="w-10 px-3 py-2.5"><Check on={c.allOn} onChange={c.toggleAll} label="Select all" /></th>}
                {PPB_HEAD.map((h) => <th key={h} className={cn(th, h === 'Qty' && 'text-right')}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <QuoteRows key={l.id} l={l} checkable={editable} on={c.picked.has(l.id)} onCheck={() => c.toggle(l.id)}
                  editable={purchasing && l.stage === 'PENAWARAN'} picking={director && l.stage === 'MENUNGGU_DIREKTUR'} onQuote={() => setQuoting(l.id)} onReturn={() => setReturning(l)}
                  showLog={tab === 'riwayat'} onChange={director && tab === 'riwayat' && l.stage === 'DIPILIH' ? () => setChanging(l.id) : undefined} />
              ))}
              {rows.length === 0 && <Empty cols={editable ? 10 : 9} loading={isLoading} text={
                tab === 'riwayat' ? 'No Director picks yet.' : tab === 'penawaran' && progress === 'done' ? 'Nothing handled yet.' : stage === 'PENAWARAN' ? 'No items in RFQ yet. Select from Approved Purchase Request Items.'
                  : 'No quotes are waiting for a Director pick.'} />}
            </tbody>
          </table>
        </div>
      </Card>

      {editable && progress !== 'done' && (
        <div className="sticky bottom-2 flex items-center justify-between gap-2 rounded-lg border bg-card p-2.5 shadow-md">
          <span className="text-sm text-muted-foreground">{c.live.length ? `${c.live.length} items selected` : ''}</span>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={!c.live.length || act.backToReady.isPending}
              onClick={async () => { if (await confirmDialog({ message: `Return ${c.live.length} items to Approved Purchase Request Items? Recorded prices stay saved.` })) act.backToReady.mutate(c.live.map((l) => l.id), { onSuccess: c.clear }) }}>
              <Undo2 className="size-4" /> Return to Approved Purchase Request Items
            </Button>
            <Button disabled={!c.live.length || act.submitQuotation.isPending}
              onClick={async () => {
                const bare = c.live.find((l) => l.quotes.length === 0)
                if (bare) return invalidTo(() => {}, `Record at least one vendor price for ${bare.description}.`)
                if (await confirmDialog({ title: 'Submit to Director?', message: `${c.live.length} items submitted. The Director picks the vendor for each item.`, confirmLabel: 'Submit' }))
                  act.submitQuotation.mutate(c.live.map((l) => l.id), { onSuccess: c.clear })
              }}>
              <Send className="size-4" /> Submit to Director
            </Button>
          </div>
        </div>
      )}

      {quoted && <QuoteModal l={quoted} onClose={() => setQuoting(null)} />}
      {returning && <ReturnModal l={returning} onClose={() => setReturning(null)} />}
      {changed && <ChangePickModal l={changed} onClose={() => setChanging(null)} />}
    </div>
  )
}

/** One item: its PPB row, then each vendor's offer under it (cheapest first, the Direktur's pick tagged). */
function QuoteRows({ l, checkable, on, onCheck, editable, picking, onQuote, onReturn, showLog, onChange }: {
  l: PoDraftLine; checkable: boolean; on: boolean; onCheck: () => void; editable: boolean; picking: boolean; onQuote: () => void; onReturn: () => void
  showLog?: boolean; onChange?: () => void
}) {
  const act = usePoDraftActions()
  const low = l.quotes[0]?.unit_price
  const cols = checkable ? 10 : 9
  return (
    <>
      <tr className={cn('border-t-2 border-border', on && 'bg-primary/5')}>
        {checkable && <td className={td}>{l.stage === 'PENAWARAN' && <Check on={on} onChange={onCheck} label={`Select ${l.description}`} />}</td>}
        <PpbCells l={l} />
      </tr>
      <tr className={on ? 'bg-primary/5' : undefined}>
        <td colSpan={cols} className="px-3 pb-3 pt-0">
          <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">Status <StageStatus l={l} /></div>
          {l.return_note && editable && <p className="mb-2 rounded-md bg-orange-50 px-3 py-1.5 text-xs text-orange-800">Returned by Director: {l.return_note}</p>}
          <div className="flex flex-col gap-2 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1 overflow-x-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="whitespace-nowrap bg-muted/30 text-left text-[11px] text-muted-foreground">
                <tr>
                  <th className="px-2.5 py-1.5 font-medium">Vendor</th>
                  <th className="px-2.5 py-1.5 text-right font-medium">Unit price</th>
                  <th className="px-2.5 py-1.5 text-right font-medium">Total ({fmtQty(l.qty)})</th>
                  <th className="px-2.5 py-1.5 font-medium">Availability</th>
                  <th className="px-2.5 py-1.5 font-medium">ETA</th>
                  <th className="px-2.5 py-1.5 font-medium">Price update</th>
                  <th className="px-2.5 py-1.5 font-medium">Notes</th>
                  <th className="w-px px-2.5 py-1.5" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {l.quotes.map((q) => (
                  <tr key={q.id} className={q.chosen ? 'bg-emerald-50' : undefined}>
                    <td className="px-2.5 py-1.5">
                      <span className="font-medium">{q.vendor_name}</span>
                      {q.chosen && <span className="ml-1.5 inline-flex items-center gap-1 rounded bg-emerald-600 px-1.5 py-0.5 text-[11px] font-semibold text-white"><BadgeCheck className="size-3" />Director Pick</span>}
                      {!q.chosen && l.quotes.length > 1 && q.unit_price === low && <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800">Cheapest</span>}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 text-right tabular-nums">{rupiah(q.unit_price)}<VsLast price={q.unit_price} last={l.price_history[0]?.unit_price} /></td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 text-right tabular-nums">{rupiah(q.unit_price * l.qty)}</td>
                    <td className="px-2.5 py-1.5">{q.availability ?? '—'}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5">{fmtDate(q.eta)}</td>
                    <td className="px-2.5 py-1.5"><PriceUpdates q={q} item={l.description} /></td>
                    <td className="px-2.5 py-1.5 text-muted-foreground">{q.note ?? ''}</td>
                    <td className="whitespace-nowrap px-2.5 py-1">
                      {picking && !q.chosen && <Button size="sm" className="h-7 bg-emerald-600 px-2.5 text-xs text-white hover:bg-emerald-700" disabled={act.choose.isPending}
                        onClick={() => act.choose.mutate({ id: l.id, quote_id: q.id })}>Select</Button>}
                      {editable && <button type="button" className="rounded p-1 text-muted-foreground hover:text-destructive" aria-label={`Delete price ${q.vendor_name}`}
                        onClick={async () => { if (await confirmDialog({ message: `Delete the price from ${q.vendor_name}?`, danger: true })) act.removeQuote.mutate({ id: l.id, quoteId: q.id }) }}><Trash2 className="size-3.5" /></button>}
                    </td>
                  </tr>
                ))}
                {l.quotes.length === 0 && <tr><td colSpan={8} className="px-2.5 py-3 text-center text-muted-foreground">No vendor quotes yet.</td></tr>}
              </tbody>
            </table>
          </div>
          <PriceHistory l={l} />
          </div>
          <div className="mt-1.5 flex flex-wrap gap-3 text-xs">
            {editable && <button type="button" onClick={onQuote} className="inline-flex items-center gap-1 font-medium text-primary hover:underline"><Plus className="size-3.5" />{l.quotes.length ? 'Add / change vendor quote' : 'Record vendor quote'}</button>}
            {picking && <button type="button" onClick={onReturn} className="inline-flex items-center gap-1 font-medium text-orange-700 hover:underline"><Undo2 className="size-3.5" />Return to purchasing</button>}
            {onChange && <button type="button" onClick={onChange} className="inline-flex items-center gap-1 font-medium text-primary hover:underline"><Pencil className="size-3.5" />Change pick</button>}
          </div>
          {showLog && <PickLog l={l} />}
        </td>
      </tr>
    </>
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

/** History: change the Director's pick to another vendor that quoted, or send the item back; both need a reason. */
function ChangePickModal({ l, onClose }: { l: PoDraftLine; onClose: () => void }) {
  const act = usePoDraftActions()
  const current = l.quotes.find((q) => q.chosen)?.id ?? null
  const [quoteId, setQuoteId] = useState<number | null>(current)
  const [reason, setReason] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const busy = act.changePick.isPending || act.returnQuotation.isPending
  const reasonOk = () => {
    if (reason.trim().length >= 5) return true
    invalidTo(setErr, 'Write a reason of at least 5 characters.')
    return false
  }
  const save = () => {
    setErr(null)
    if (quoteId === null || quoteId === current) return invalidTo(setErr, 'Select a different vendor.')
    if (reasonOk()) act.changePick.mutate({ id: l.id, quote_id: quoteId, reason: reason.trim() }, { onSuccess: onClose, onError: (e) => setErr(apiErrorMessage(e)) })
  }
  const sendBack = async () => {
    setErr(null)
    if (!reasonOk()) return
    if (await confirmDialog({ title: 'Return to purchasing?', message: 'The current pick is removed and the item goes back to RFQ.', confirmLabel: 'Return' }))
      act.returnQuotation.mutate({ id: l.id, note: reason.trim() }, { onSuccess: onClose, onError: (e) => setErr(apiErrorMessage(e)) })
  }
  return (
    <Modal open onClose={onClose} title="Change Director pick" className="max-w-lg" description={`${l.description} · ${fmtQty(l.qty)} ${l.unit ?? ''}`}
      footer={<>
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button variant="outline" size="sm" className="border-orange-300 text-orange-700 hover:bg-orange-50" disabled={busy} onClick={sendBack}>Return to purchasing</Button>
        <Button size="sm" disabled={busy} onClick={save}>{act.changePick.isPending && <Loader2 className="size-4 animate-spin" />} Save change</Button>
      </>}>
      <div className="space-y-3">
        <div className="divide-y rounded-lg border" role="radiogroup" aria-label="Vendor">
          {l.quotes.map((q) => (
            <label key={q.id} className={cn('flex cursor-pointer items-start gap-2.5 px-3 py-2.5 text-sm', quoteId === q.id && 'bg-primary/5')}>
              <input type="radio" name="pick-vendor" className="mt-0.5 size-4 accent-primary" checked={quoteId === q.id} onChange={() => setQuoteId(q.id)} />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{q.vendor_name}</span>
                {q.id === current && <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800">Current pick</span>}
                <span className="block text-xs text-muted-foreground">{[q.availability, q.eta && `ETA ${fmtDate(q.eta)}`].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="shrink-0 text-right tabular-nums"><span className="block">{rupiah(q.unit_price)}</span><span className="block text-xs text-muted-foreground">{rupiah(q.unit_price * l.qty)}</span></span>
            </label>
          ))}
        </div>
        <div className="space-y-1.5"><Label htmlFor="pick-reason">Reason *</Label>
          <Textarea id="pick-reason" rows={3} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></div>
        {err && <p className="text-sm text-destructive">{err}</p>}
      </div>
    </Modal>
  )
}

function ReturnModal({ l, onClose }: { l: PoDraftLine; onClose: () => void }) {
  const act = usePoDraftActions()
  const [note, setNote] = useState('')
  return (
    <Modal open onClose={onClose} title="Return to purchasing?" className="max-w-md" description={l.description}
      footer={<><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" disabled={act.returnQuotation.isPending} onClick={() => act.returnQuotation.mutate({ id: l.id, note: note.trim() || null }, { onSuccess: onClose })}>Return</Button></>}>
      <div className="space-y-1.5"><Label htmlFor="rt-note">Notes <span className="font-normal text-muted-foreground">(optional)</span></Label>
        <Textarea id="rt-note" rows={3} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="e.g. find another vendor, price too high" autoFocus /></div>
    </Modal>
  )
}

// ------------------------------------------------------------------ 3. Draft PO

type VendorLines = { vendorId: number; name: string; lines: PoDraftLine[] }

const NotPickTag = () => <span className="mt-1 inline-flex items-center gap-1 rounded bg-amber-500 px-1.5 py-0.5 text-[11px] font-semibold text-amber-950"><TriangleAlert className="size-3" />Not Director Pick</span>

/** Draft PO: a matrix of the items the Direktur decided (rows) against every vendor that quoted (columns), prices in the cells. */
export function PoDraftPage() {
  const [search, setSearch] = useState('')
  const { data, isLoading } = usePoDraftLines({ search: search.trim() || undefined, done: 1 })
  const [progress, setProgress] = useState<Progress>('todo')
  // picked from To do, waiting for their prices
  const pricing = useMemo(() => (data?.data ?? []).filter((l) => l.stage === 'PENAWARAN'), [data])
  const todo = useMemo(() => (data?.data ?? []).filter((l) => l.stage === 'DIPILIH' && l.quotes.some((q) => q.chosen)), [data])
  const done = useMemo(() => (data?.data ?? []).filter((l) => l.stage === 'PO'), [data])
  const rows = useMemo(() => (progress === 'todo' ? todo : progress === 'done' ? done : [...todo, ...done]), [progress, todo, done])
  const vendors = useMemo(() => {
    const by = new Map<number, string>()
    for (const l of rows) for (const q of l.quotes) by.set(q.vendor_id, q.vendor_name ?? '')
    return [...by].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [rows])
  const c = useChecks(todo)
  // the vendor used per item: the Direktur's pick unless purchasing picks another cell
  const [vendorOf, setVendorOf] = useState<Record<number, number>>({})
  const quoteOf = (l: PoDraftLine) => l.quotes.find((q) => q.vendor_id === (l.po?.vendor_id ?? vendorOf[l.id])) ?? l.quotes.find((q) => q.chosen) ?? l.quotes[0]
  // one PO = one vendor: the ticked items split per the vendor used
  const groups = useMemo(() => {
    const by = new Map<number, VendorLines>()
    for (const l of c.live) {
      const q = l.quotes.find((x) => x.vendor_id === vendorOf[l.id]) ?? l.quotes.find((x) => x.chosen)!
      const g = by.get(q.vendor_id) ?? { vendorId: q.vendor_id, name: q.vendor_name ?? '', lines: [] }
      g.lines.push(l)
      by.set(q.vendor_id, g)
    }
    return [...by.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [c.live, vendorOf])
  const total = c.live.reduce((t, l) => t + quoteOf(l).unit_price * l.qty, 0)
  const offPick = c.live.filter((l) => !quoteOf(l).chosen).length
  const [queue, setQueue] = useState<VendorLines[]>([])
  const [made, setMade] = useState(0)
  const navigate = useNavigate()

  return (
    <div className="space-y-4">
      <PageHeader title="Draft PO" subtitle="Tick the items to make a PO. The vendor follows the Director pick; if you select another vendor, that item is tagged at approval." />
      <FlowSteps at="draft" counts={data?.meta.stages} />
      {pricing.length > 0 && <PriceMatrix lines={pricing} />}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Input className="sm:w-80" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item / Purchase Request no. / vendor" aria-label="Search" />
        <ProgressFilter value={progress} onChange={setProgress} todo={todo.length} done={done.length} />
      </div>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="sticky left-0 z-10 w-10 bg-muted px-3 py-2.5"><Check on={c.allOn} onChange={c.toggleAll} label="Select all" /></th>
                <th className={cn(th, 'sticky left-10 z-10 min-w-[16rem] bg-muted')}>Item</th>
                <th className={cn(th, 'whitespace-nowrap text-right')}>Qty</th>
                <th className={cn(th, 'whitespace-nowrap')}>Status</th>
                {vendors.map((v) => <th key={v.id} className={cn(th, 'min-w-[9.5rem] border-l text-right text-foreground')}>{v.name}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((l) => {
                const low = Math.min(...l.quotes.map((q) => q.unit_price))
                return (
                  <tr key={l.id}>
                    <td className="sticky left-0 z-10 bg-card px-3 py-2.5">{l.stage === 'DIPILIH' && <Check on={c.picked.has(l.id)} onChange={() => c.toggle(l.id)} label={`Select ${l.description}`} />}</td>
                    <td className="sticky left-10 z-10 bg-card px-3 py-2.5">
                      <div className="font-medium">{l.description}</div>
                      <div className="text-xs text-muted-foreground">{[l.item_code, l.ppb?.no_ppb].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className={cn(td, 'whitespace-nowrap text-right tabular-nums')}>{fmtQty(l.qty)} <span className="text-xs text-muted-foreground">{l.unit ?? ''}</span></td>
                    <td className={td}><StageStatus l={l} /></td>
                    {vendors.map((v) => {
                      const q = l.quotes.find((x) => x.vendor_id === v.id)
                      if (!q) return <td key={v.id} className="border-l px-3 py-2.5 text-right text-muted-foreground">—</td>
                      const used = quoteOf(l).vendor_id === v.id
                      return (
                        <td key={v.id} className={cn('border-l px-3 py-2.5 text-right align-top', q.chosen && 'bg-emerald-50 dark:bg-emerald-950/40', used && !q.chosen && 'bg-amber-100 dark:bg-amber-950/50')}
                          title={[q.availability, q.eta && `ETA ${fmtDate(q.eta)}`, q.note].filter(Boolean).join(' · ') || undefined}>
                          <label className="flex cursor-pointer items-center justify-end gap-2">
                            <input type="radio" disabled={l.stage === 'PO'} className="size-3.5 accent-primary" name={`vendor-${l.id}`} checked={used} aria-label={`Use ${v.name} for ${l.description}`}
                              onChange={() => { setVendorOf((m) => ({ ...m, [l.id]: v.id })); if (!c.picked.has(l.id)) c.toggle(l.id) }} />
                            <span className={cn('whitespace-nowrap tabular-nums', used && 'font-semibold')}>{rupiah(q.unit_price)}</span>
                          </label>
                          {q.chosen
                            ? <span className="mt-1 inline-flex items-center gap-1 rounded bg-emerald-600 px-1.5 py-0.5 text-[11px] font-semibold text-white"><BadgeCheck className="size-3" />Director Pick</span>
                            : used ? <NotPickTag />
                            : l.quotes.length > 1 && q.unit_price === low && <div className="mt-0.5 text-[11px] text-muted-foreground">Cheapest</div>}
                          <div className="mt-0.5"><PriceUpdates q={q} item={l.description} /></div>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr><td colSpan={4 + vendors.length} className="px-3 py-12 text-center text-muted-foreground">
                  {isLoading ? <Loader2 className="mx-auto size-5 animate-spin" /> : progress === 'done' ? 'No PO made yet.' : <>No items with a Director vendor pick yet. Submit first from <Link to="/purchase-orders/penawaran" className="text-primary hover:underline">RFQ</Link>.</>}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="sticky bottom-2 z-20 flex items-center justify-between gap-2 rounded-lg border bg-card p-2.5 shadow-md">
        <span className="text-sm text-muted-foreground">{c.live.length ? <>{c.live.length} items · {groups.length} vendor · <span className="font-medium tabular-nums text-foreground">{rupiah(total)}</span>{offPick > 0 && <span className="ml-2 font-medium text-amber-800 dark:text-amber-300">{offPick} not Director pick</span>}</> : ''}</span>
        <Button disabled={!c.live.length} onClick={() => { setMade(0); setQueue(groups) }}><Send className="size-4" /> {groups.length > 1 ? `Create ${groups.length} Draft PO` : 'Create Draft PO'}</Button>
      </div>
      {queue[0] && (
        <CreatePoModal key={queue[0].vendorId} vendorId={queue[0].vendorId} vendorName={queue[0].name} lines={queue[0].lines} left={queue.length - 1}
          onClose={() => setQueue([])}
          onDone={(po) => {
            if (queue.length > 1) { setMade((n) => n + 1); setQueue(queue.slice(1)); return }
            c.clear(); setQueue([]); navigate(made === 0 ? `/purchase-orders/${po.id}` : '/purchase-orders')
          }} />
      )}
    </div>
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
