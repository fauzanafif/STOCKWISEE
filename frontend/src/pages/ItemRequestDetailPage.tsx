import { useEffect, useMemo, useRef, useState } from 'react'
import { ProxyPickup } from '@/components/itemRequests/ProxyPickup'
import { Link, useLocation, useParams } from 'react-router-dom'
import { AlertTriangle, Ban, CheckCircle2, ChevronLeft, ChevronRight, Loader2, Copy, Lock, MessageSquare, PackageCheck, Plus, Search, Undo2 } from 'lucide-react'
import { toast, invalidTo } from '@/lib/notify'
import { useAuth } from '@/auth/AuthContext'
import { apiErrorMessage } from '@/lib/api'
import {
  STAGE_INFO, trackUrl, useCancelItemRequest, useRequestProxy, useShareBase, useMatchLine, useCloseRemaining, useFulfill, useFulfillmentFile, useHandoverFile, useItemRequest,
  useProcessItemRequest, useSetUrgency,
  type Fulfillment, type ItemRequestDetail, type ItemRequestLine, type LineStatus, type StockRecommendation,
} from '@/features/itemRequests/api'
import { ApprovalActions, HandoverQty, type HandoverDraft } from '@/components/itemRequests/ApprovalActions'
import { StepsBar } from '@/components/itemRequests/RequestTimeline'
import { useUnits, type ItemLookupResult } from '@/features/inventory/api'
import { UomEquivalent } from '@/components/UomEquivalent'
import { VerifySerials } from '@/components/itemRequests/VerifySerials'
import { askedText } from '@/lib/askedText'
import { RequestStatusBadge } from '@/pages/ItemRequestListPage'
import { BackLink } from '@/components/BackLink'
import { ItemPicker } from '@/components/ItemPicker'
import { ItemFormModal } from '@/components/ItemFormModal'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { cn, copyText } from '@/lib/utils'
import { BYPASS_TEXT, isAutoApproval } from '@/lib/approval'
import { confirmDialog } from '@/components/ui/confirm'
import { openImage } from '@/components/ui/lightbox'
import { DetailFallback } from '@/components/DetailFallback'
import { LineImagesCell, RequestImages } from '@/components/itemRequests/RequestImages'
import { QtyProgress } from '@/components/QtyProgress'
import { SmartButtons } from '@/components/documents/SmartButtons'
import { Chatter } from '@/components/documents/Chatter'

const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-')
const fmtDateTime = (v: string | null) => (v ? new Date(v).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-')
const fmtQty = (n: number | string | null) => (n == null ? '?' : Number(n).toLocaleString('id-ID', { maximumFractionDigits: 2 }))
/** "1,5" or "1.5" → 1.5; NaN when not a number */
const num = (v: string) => Number(v.trim().replace(',', '.'))
/** older notes saved with a long dash: shown with a comma instead */
const clean = (t: string | null | undefined) => (t ? t.replace(/\s*—\s*/g, ', ') : t)

interface Choice {
  /** the unit asked, when the warehouse corrects it */
  unit?: string
  /** the Master Produk items picked for this requested item (one or more, in the order picked) */
  items: StockRecommendation[]
  /** how many of each picked item (its id → qty as typed) */
  qtys: Record<number, string>
  /** given less than asked (e.g. 9 of 10, 1 kept in stock): why — required then */
  reason?: string
  /** items with serial numbers: the serials picked per item (its id → serials), held for this request */
  serials?: Record<number, string[]>
  /** how many serials each of those items needs (its id → count) */
  snNeed?: Record<number, number | null>
}

/** "1,5" / "1.5" → 1.5; 0 when empty or not a number (a qty field) */
const qtyOf = (v: string | undefined) => { const n = num(v ?? ''); return Number.isFinite(n) && n > 0 ? n : 0 }
const round2 = (n: number) => Math.round(n * 100) / 100
/** how many of the item's own unit one unit asked makes (1 DUS = 5 RIM); 1 when it is the same unit */
const ratioOf = (item: StockRecommendation) => (item.unit_ratio && item.unit_ratio > 0 ? item.unit_ratio : 1)
/** what a master item can give from stock now, in the unit asked (unknown stock counts as none) */
const inStock = (item: StockRecommendation) => (item.stock_known ? Math.max(0, item.available ?? 0) / ratioOf(item) : 0)

/**
 * How many of each picked item: from stock first (in the order picked), the rest on the first item —
 * that part is bought (Draft PPB) after the approval. Verifying is only "which item, how many".
 */
function distribute(items: StockRecommendation[], needed: number): Record<number, string> {
  const qtys: Record<number, string> = {}
  if (items.length === 0) return qtys
  if (items.length === 1) return { [items[0].id]: String(needed) }
  let left = needed
  for (const it of items) {
    const take = round2(Math.min(left, Math.floor(inStock(it))))
    qtys[it.id] = String(take)
    left = round2(left - take)
  }
  qtys[items[0].id] = String(round2(qtyOf(qtys[items[0].id]) + left))
  return qtys
}

/** The total picked, and what the stock gives now (NPBG) vs what is bought (Draft PPB). */
function split(choice: Choice) {
  let total = 0, stock = 0
  for (const it of choice.items) {
    const q = qtyOf(choice.qtys[it.id])
    total += q
    stock += Math.min(q, inStock(it))
  }
  return { total: round2(total), stock: round2(stock), buy: round2(total - stock) }
}

/** Stock of a master item in its own unit, as a short colored text; $qty is in the unit asked. */
function stockText(item: StockRecommendation, qty: number) {
  if (!item.stock_known) return <span className="text-muted-foreground">stock ?</span>
  const a = item.available ?? 0
  const need = qty * ratioOf(item)
  return <span className={a >= need ? 'text-emerald-700' : a > 0 ? 'text-amber-700' : 'text-red-600'}>stock {fmtQty(a)} {item.unit ?? ''}</span>
}

/** The master item already saved on a line, as a pick option. */
const savedItem = (l: ItemRequestLine): StockRecommendation | null => (l.item_id ? {
  id: l.item_id, code: l.kode_barang ?? '', description: l.item_description ?? l.deskripsi_barang, unit: l.satuan,
  available: l.available ?? null, stock_known: l.available != null, score: 0,
  unit_ratio: l.asked_ratio ?? null, unit_problem: l.asked_unit_problem ?? null,
} : null)

/** One requested item to verify: which Master Produk item(s) and how many — stock decides NPBG / PPB later. */
function OpenLine({ line, requestId, choice, onChange, onPatch, onPick, saving }: {
  line: ItemRequestLine; requestId: number; choice: Choice; onChange: (c: Choice) => void
  /** change from the latest choice (several updates in one render never overwrite each other) */
  onPatch: (f: (c: Choice) => Choice) => void
  /** save the pick at once (the Item table below follows) */
  onPick: (itemId: number) => void
  saving: boolean
}) {
  const { hasPermission } = useAuth()
  const saved = savedItem(line)
  const [extra, setExtra] = useState<StockRecommendation | null>(saved && !line.recommendations.some((r) => r.id === saved.id) ? saved : null)
  const [searching, setSearching] = useState(false)
  const [adding, setAdding] = useState(false)
  const options = extra && !line.recommendations.some((r) => r.id === extra.id) ? [...line.recommendations, extra] : line.recommendations
  const needed = Number(line.qty)
  // the requester's unit; picking an item does not lose it
  const askedUnit = choice.unit ?? line.requested_unit ?? line.satuan ?? ''
  const { data: units } = useUnits()
  const unitCodes = [...new Set([...(units ?? []).map((u) => u.code), ...(askedUnit ? [askedUnit] : [])])].sort()

  const toggleItem = (item: StockRecommendation) => {
    const on = choice.items.some((i) => i.id === item.id)
    const items = on ? choice.items.filter((i) => i.id !== item.id) : [...choice.items, item]
    if (!on && item.id !== line.item_id && choice.items.length === 0) onPick(item.id)
    onChange({ ...choice, items, qtys: distribute(items, needed) })
  }
  const fromLookup = (it: ItemLookupResult) => {
    const r: StockRecommendation = { id: it.id, code: it.code, description: it.description, unit: it.unit, available: it.available, stock_known: it.stock_known, score: 0 }
    setExtra(r)
    setSearching(false)
    if (!choice.items.some((i) => i.id === r.id)) toggleItem(r)
  }
  // more than the stock is fine (the rest is bought after the approval) — but never more than asked in all:
  // while typing, an item takes at most what the others leave of the request
  const [capped, setCapped] = useState<{ id: number; max: number } | null>(null)
  const maxFor = (itemId: number) => round2(Math.max(0, needed - choice.items.filter((i) => i.id !== itemId).reduce((n, i) => n + qtyOf(choice.qtys[i.id]), 0)))
  const setQty = (itemId: number, v: string) => {
    const typed = v.replace(/[^\d.,]/g, '')
    const max = maxFor(itemId)
    if (qtyOf(typed) > max) {
      setCapped({ id: itemId, max })
      onChange({ ...choice, qtys: { ...choice.qtys, [itemId]: String(max) } })
      return
    }
    setCapped(null)
    onChange({ ...choice, qtys: { ...choice.qtys, [itemId]: typed } })
  }

  const sum = split(choice)
  const diff = round2(sum.total - needed)

  return (
    <Card className="space-y-4 rounded-lg p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="min-w-0 break-words text-base font-semibold">{line.deskripsi_peminta ?? line.deskripsi_barang}</div>
          <RequestImages requestId={requestId} lineId={line.id} slots={line.images} size="size-12" className="shrink-0 gap-1" />
        </div>
        <div className="flex shrink-0 items-center gap-1.5 font-semibold tabular-nums">{fmtQty(line.qty)}
          <Select className="h-8 w-24 font-normal" aria-label={`Requested unit ${line.deskripsi_peminta ?? line.deskripsi_barang}`} value={askedUnit} onChange={(e) => onChange({ ...choice, unit: e.target.value })}>
            {!askedUnit && <option value="">Unit…</option>}
            {unitCodes.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </div>
      </div>
      {line.note && <p className="-mt-3 text-sm text-muted-foreground">{line.note}</p>}

      {/* which warehouse item */}
      <div className="-mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>Items in Product Master</span>
        {saving ? <span className="flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> Saving…</span>
          : choice.items.length > 0 ? <span className="flex items-center gap-1 text-emerald-700"><CheckCircle2 className="size-3" /> {choice.items.length} items selected</span>
          : <span>Select an item to fulfil the request</span>}
      </div>
      <div className="divide-y rounded-lg border">
        {/* every recommendation, best match first: 5 rows in view, the rest by scrolling */}
        <div className="max-h-[14.5rem] divide-y overflow-y-auto overscroll-contain">
          {options.length === 0 && <p className="px-3 py-3 text-sm text-muted-foreground">No recommendations; search another item or add it to the Product Master.</p>}
          {options.map((r, i) => {
            const isSelected = choice.items.some((item) => item.id === r.id)
            const q = qtyOf(choice.qtys[r.id])
            const fromStock = Math.min(q, inStock(r))
            return (
              <div key={r.id} className={cn('flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 text-sm', isSelected ? 'bg-primary/5' : 'hover:bg-muted/50')}>
                <label className="flex min-w-0 flex-1 basis-60 cursor-pointer items-center gap-3">
                  <input type="checkbox" className="size-4 shrink-0 accent-primary" checked={isSelected} onChange={() => toggleItem(r)} />
                  <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1 break-words">{r.description}<span className="ml-1.5 text-[13px] text-muted-foreground">{r.code}</span></span>
                  <span className="shrink-0 text-right text-xs">
                    {stockText(r, isSelected ? q : needed)}
                    {askedUnit && r.unit && askedUnit !== r.unit && r.unit_ratio && <span className="block text-[11px] text-muted-foreground">1 {askedUnit} = {fmtQty(r.unit_ratio)} {r.unit}</span>}
                    {!isSelected && r.unit_ratio == null && r.unit_problem && <span className="block text-[11px] text-red-600">no {askedUnit} ratio</span>}
                  </span>
                </label>
                {isSelected && (
                  // phone: its own row under the name; wider: on the right
                  <div className="ml-14 flex items-center gap-2 sm:ml-0">
                    <Input className={cn('h-8 w-20 text-right tabular-nums', capped?.id === r.id && 'border-red-400 focus-visible:border-red-500 focus-visible:ring-red-200')} inputMode="decimal"
                      aria-label={`Quantity ${r.description}`} aria-invalid={capped?.id === r.id} title={`Maximum ${fmtQty(maxFor(r.id))}`}
                      value={choice.qtys[r.id] ?? ''} onChange={(e) => setQty(r.id, e.target.value)} onBlur={() => setCapped(null)} />
                    <span className="w-10 text-xs font-medium text-muted-foreground">{askedUnit}</span>
                    <span className="w-40 text-xs leading-tight text-muted-foreground">
                      {capped?.id === r.id ? <span className="font-medium text-red-600">Max {fmtQty(capped.max)}: total may not exceed {fmtQty(needed)} {askedUnit}</span>
                        : r.unit_problem && r.unit_ratio == null ? <span className="font-medium text-red-600">{r.unit_problem}</span>
                        : q <= 0 ? 'fill in the quantity' : <>
                        {askedUnit && r.unit && askedUnit !== r.unit && (r.unit_ratio
                          ? <span className="block font-medium tabular-nums text-primary">= {fmtQty(round2(q * r.unit_ratio))} {r.unit}</span>
                          : <UomEquivalent qty={q} unit={askedUnit} itemId={r.id} />)}
                        {fromStock > 0 && <span className="text-emerald-700">{fmtQty(round2(fromStock))} from stock</span>}
                        {fromStock > 0 && q > fromStock && ' · '}
                        {q > fromStock && <span className="text-amber-700">{fmtQty(round2(q - fromStock))} purchased</span>}
                      </>}
                    </span>
                  </div>
                )}
                {isSelected && r.code && q > 0 && (
                  <div className="basis-full sm:pl-8">
                    <VerifySerials code={r.code} itemId={r.id} itemUnit={r.unit} qty={q} unit={askedUnit} requestId={requestId}
                      picked={choice.serials?.[r.id] ?? []}
                      onChange={(v) => onPatch((c) => ({ ...c, serials: { ...c.serials, [r.id]: v } }))}
                      onNeed={(n) => onPatch((c) => ((c.snNeed?.[r.id] ?? null) === n ? c : { ...c, snNeed: { ...c.snNeed, [r.id]: n } }))} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
        {options.length > 5 && <p className="bg-muted/30 px-3 py-1 text-center text-xs text-muted-foreground">{options.length} recommendations, scroll to see more</p>}
        {searching ? (
          <div className="p-2"><ItemPicker onPick={fromLookup} /></div>
        ) : (
          <div className="flex flex-wrap px-3 py-2">
            <button type="button" onClick={() => setSearching(true)} className="flex items-center gap-2 px-3 py-2.5 text-sm text-primary">
              <Search className="size-4" /> Search another item
            </button>
            {hasPermission('item.create') && (
              <button type="button" onClick={() => setAdding(true)} className="flex items-center gap-2 px-3 py-2.5 text-sm text-primary">
                <Plus className="size-4" /> Not there? Add to Product Master
              </button>
            )}
          </div>
        )}
      </div>
      {/* not in the master yet: added there first (Barang / Jasa, stock 0), then picked here */}
      <ItemFormModal open={adding} onClose={() => setAdding(false)} initial={{ description: (line.deskripsi_peminta ?? line.deskripsi_barang).toUpperCase() }}
        onCreated={(it) => {
          const r: StockRecommendation = { id: it.id, code: it.code, description: it.description, unit: it.unit?.code ?? null, available: 0, stock_known: true, score: 0 }
          setExtra(r)
          if (!choice.items.some((i) => i.id === r.id)) toggleItem(r)
        }} />

      {choice.items.length === 0 ? (
        <p className="text-sm text-amber-700">Select an item from the Product Master. Not there? Add it first.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
          <span>
            <span className="text-muted-foreground">Total </span>
            <span className={cn('font-semibold tabular-nums', diff === 0 ? 'text-emerald-700' : 'text-red-600')}>{fmtQty(sum.total)}</span>
            <span className="text-muted-foreground"> / {fmtQty(needed)} {askedUnit}</span>
            {diff !== 0 && <span className={cn('ml-1.5 text-xs font-medium', diff > 0 ? 'text-red-600' : 'text-amber-700')}>{diff > 0 ? `more ${fmtQty(diff)}` : `given less ${fmtQty(-diff)}`}</span>}
          </span>
          {sum.stock > 0 && <span className="text-xs text-emerald-700">From stock {fmtQty(sum.stock)} → Delivery Order</span>}
          {sum.buy > 0 && <span className="text-xs text-amber-700">Purchased {fmtQty(sum.buy)} → Draft Purchase Request</span>}
          {choice.items.length > 1 && (
            <button type="button" className="ml-auto text-xs font-medium text-primary hover:underline" onClick={() => onChange({ ...choice, qtys: distribute(choice.items, needed) })}>
              Redistribute automatically
            </button>
          )}
          {diff < 0 && sum.total > 0 && (
            // given less than asked on purpose (e.g. 1 kept in stock): why — the approvers and the requester read it
            <div className="basis-full space-y-1">
              <Label htmlFor={`reason-${line.id}`} className="text-xs text-amber-800">Reason for giving less than requested *</Label>
              <Input id={`reason-${line.id}`} maxLength={255} value={choice.reason ?? ''} onChange={(e) => onChange({ ...choice, reason: e.target.value })}
                placeholder="e.g. 1 left kept as warehouse reserve" className={cn('h-9 bg-card', !(choice.reason ?? '').trim() && 'border-amber-400')} />
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

/** One color per line status: [text, background]. */
const LINE_TONE: Partial<Record<LineStatus, string>> = {
  MENUNGGU: 'bg-amber-50 text-amber-800', PERLU_PERBAIKAN: 'bg-orange-50 text-orange-800',
  APPROVAL_MANAGER: 'bg-blue-50 text-blue-800', APPROVAL_DIREKTUR: 'bg-blue-50 text-blue-800',
  DISIAPKAN: 'bg-violet-50 text-violet-800', SIAP_DISERAHKAN: 'bg-cyan-50 text-cyan-800',
  DIPENUHI_SEBAGIAN: 'bg-teal-50 text-teal-800', MENUNGGU_PENGADAAN: 'bg-indigo-50 text-indigo-800', MENUNGGU_BARANG: 'bg-indigo-50 text-indigo-800',
  SELESAI: 'bg-emerald-50 text-emerald-800', DITUTUP: 'bg-slate-100 text-slate-700', DITOLAK: 'bg-red-50 text-red-800', DIBATALKAN: 'bg-slate-100 text-slate-600',
}

/** What a decided line became: its status, and its Draft PPB / PPB document, or why it was rejected / closed. */
function DecisionCell({ line }: { line: ItemRequestLine }) {
  const badge = <span className={cn('inline-block rounded px-1.5 py-0.5 text-xs font-medium', LINE_TONE[line.line_status] ?? 'bg-muted')}>{line.line_status_label}</span>
  if (line.decision === null) return badge
  if (line.decision === 'TOLAK') return <div className="space-y-0.5 leading-tight">{badge}<div className="text-xs text-muted-foreground">{line.reject_reason}</div></div>
  return (
    <div className="space-y-0.5 leading-tight">
      {badge}
      {line.closed_reason && <div className="text-xs text-muted-foreground">Closed: {clean(line.closed_reason)}</div>}
    </div>
  )
}

/** Before the system decides (until the approval): what the stock now would give — an estimate. */
const BEFORE_ALLOCATION = ['MENUNGGU', 'DIPROSES', 'PERLU_PERBAIKAN', 'APPROVAL_MANAGER', 'APPROVAL_DIREKTUR']
function estimate(l: ItemRequestLine, status: string): { npbg: number; ppb: number } | null {
  if (!BEFORE_ALLOCATION.includes(status) || l.decision === 'TOLAK') return null
  const need = Number(l.approved_qty ?? l.qty)
  // still to verify: the qty is in the unit asked (1 DUS), the stock in the item's own unit (RIM)
  const ratio = l.decision === null && l.asked_ratio ? l.asked_ratio : 1
  const fromStock = l.item_id ? Math.min(need, Math.max(0, l.available ?? 0) / ratio) : 0
  return { npbg: Math.round(fromStock * 100) / 100, ppb: Math.round((need - fromStock) * 100) / 100 }
}

/** NPBG column: only the quantity given from stock (its NPBG and state in the tooltip). */
function NpbgCell({ line, status }: { line: ItemRequestLine; status: string }) {
  const est = estimate(line, status)
  if (est) return <span className="text-muted-foreground" title="Estimated from current stock, set by the system after approval">{fmtQty(est.npbg)}</span>
  if (!line.npbg) return <span className="text-muted-foreground">0</span>
  const tip = line.npbg.docs.map((d) => `${d.no} · ${d.handed ? 'diserahkan' : 'siap diserahkan'}`).join(' | ')
  return <span className="font-semibold text-emerald-700" title={tip}>{fmtQty(line.npbg.qty)}</span>
}

/** PPB column: only the quantity to be bought (its Draft / PPB / PO and stage in the tooltip). */
function PpbCell({ line, status }: { line: ItemRequestLine; status: string }) {
  const est = estimate(line, status)
  if (est) return <span className="text-muted-foreground" title="Estimated from current stock, set by the system after approval">{fmtQty(est.ppb)}</span>
  const p = line.ppb
  if (!p) return <span className="text-muted-foreground">0</span>
  const tip = [p.po_number ?? p.no_ppb ?? `Draft ${p.draft_number}`, p.stage].join(' · ')
  return <span className={cn('font-semibold', p.stage.startsWith('Received') ? 'text-emerald-700' : 'text-indigo-700')} title={tip}>{fmtQty(p.qty)}</span>
}

/** The warehouse item (or the requester's words), with what was asked when it differs. */
/** An item's name (and what the requester typed), its images beside it: this item, these photos. */
function LineName({ line, requestId }: { line: ItemRequestLine; requestId: number }) {
  const matched = !!line.item_description
  // For Item Request (not PPB/PO), always show the original requester's description
  // For PPB/PO, show the matched item description from Master Produk
  // "HVS A4 1 DUS": what was asked, in the unit asked (from the verification to the approval)
  const displayName = askedText(line)
  return (
    <div className="min-w-0">
      <div className="break-words font-medium">{displayName}</div>
      <div className="break-words text-xs text-muted-foreground">
        {[line.kode_barang, matched && line.item_description && line.item_description !== displayName ? `cocok: ${line.item_description}` : null, line.note].filter(Boolean).join(' · ')}
      </div>
      {line.requested_qty != null && line.unit_ratio != null && <div className="mt-0.5 text-xs tabular-nums text-primary">Requested {fmtQty(line.requested_qty)} {line.requested_unit} = {fmtQty(line.qty)} {line.satuan}</div>}
      {line.decision === null && line.asked_unit_problem && <div className="mt-0.5 text-xs text-red-600">{line.asked_unit_problem}</div>}
      {line.uom_unmapped && <div className="mt-0.5 text-xs text-amber-700">Requested in "{line.requested_unit}", not in the UOM master: counted as written</div>}
      {line.short_reason && <div className="mt-0.5 text-xs text-amber-700">Given less: {line.short_reason}</div>}
      {(line.serials?.length ?? 0) > 0 && <div className="mt-0.5 break-words text-xs text-violet-700">SN: <span className="font-mono">{line.serials!.join(', ')}</span></div>}
      {/* phone (cards): the images under the name */}
      {(line.images?.length ?? 0) > 0 && <RequestImages requestId={requestId} lineId={line.id} slots={line.images} size="size-11" className="mt-1.5 gap-1 sm:hidden" />}
    </div>
  )
}

/** a unit beside a quantity: small and muted */
function Unit({ u }: { u: string | null | undefined }) {
  return u ? <span className="text-[11px] font-normal text-muted-foreground">{u}</span> : null
}

/**
 * The items: asked → approved → handed over → left, the stock now, the status (a table; cards on a phone).
 * Manager / Direktur do not change quantities here: they send the request back to admin gudang.
 */
function ItemsTable({ req, selectedLineId, onSelectLine }: { req: ItemRequestDetail; selectedLineId: number | null; onSelectLine: (id: number) => void }) {
  const decided = req.lines.some((l) => l.approved_qty != null)
  // during the Manager / Direktur approval nothing is handed over yet: no Diserahkan / Sisa columns
  const handing = decided && !['APPROVAL_MANAGER', 'APPROVAL_DIREKTUR'].includes(req.status)
  const left = (l: ItemRequestLine) => l.remaining
  const approvedCell = (l: ItemRequestLine) => (l.approved_qty != null ? <>{fmtQty(l.approved_qty)} <Unit u={l.satuan} /></> : '')
  // a line still to verify holds what was asked (1 DUS); once verified, the item's own unit (5 RIM)
  const pending = (l: ItemRequestLine) => l.decision === null && !!l.asked_unit
  const requestedCell = (l: ItemRequestLine) => pending(l) ? <>
    {fmtQty(l.qty)} <Unit u={l.asked_unit} />
    {l.item_id && l.asked_ratio && l.asked_unit !== l.satuan && <span className="block text-[11px] font-normal text-primary">= {fmtQty(Math.round(Number(l.qty) * l.asked_ratio * 100) / 100)} {l.satuan}</span>}
  </> : <>{fmtQty(l.qty)} <Unit u={l.satuan} /></>
  // the stock of Master Produk (it drops with the serah terima); what is held for prepared NPBG under it
  const stockOf = (l: ItemRequestLine) => {
    const stock = l.on_hand ?? l.available
    if (stock == null) return ''
    const held = l.on_hand != null && l.available != null ? Math.round((l.on_hand - l.available) * 100) / 100 : 0
    return <>{fmtQty(stock)} <Unit u={l.satuan} />{held > 0 && <span className="block text-[11px] font-normal text-muted-foreground">on order {fmtQty(held)}</span>}</>
  }
  const stockTone = (l: ItemRequestLine) => {
    const need = pending(l) ? Number(l.qty) * (l.asked_ratio ?? 1) : l.remaining > 0 ? l.remaining : Number(l.approved_qty ?? l.qty)
    return l.available == null ? 'text-muted-foreground' : l.decision !== 'TOLAK' && l.available < need ? 'font-semibold text-red-600' : 'text-emerald-700'
  }

  return (
    <>
      {/* phone: one card per item */}
      <ul className="divide-y sm:hidden">
        {req.lines.map((l) => (
          <li key={l.id} className={cn('space-y-2 p-4 text-sm', l.decision === null && 'cursor-pointer active:bg-muted/50', selectedLineId === l.id && 'bg-blue-50 shadow-[inset_3px_0_0_theme(colors.blue.500)]')}
            onClick={() => l.decision === null && onSelectLine(l.id)}>
            <div className="flex items-start justify-between gap-3"><LineName line={l} requestId={req.id} /><DecisionCell line={l} /></div>
            <dl className="grid gap-1 text-center text-xs" style={{ gridTemplateColumns: `repeat(${1 + (decided ? 1 : 0) + (handing ? 2 : 0) + 1}, minmax(0, 1fr))` }}>
              {([['Requested', requestedCell(l)], ...(decided ? [['Approved', approvedCell(l)]] : []),
                ...(handing ? [['Requested/Handed Over', l.approved_qty != null && l.decision !== 'TOLAK' ? <QtyProgress total={Number(l.approved_qty)} done={l.fulfilled_qty} className="mx-auto w-fit" /> : ''], ['Balance', l.approved_qty != null ? <span>{fmtQty(left(l))}</span> : '']] : []),
                ['Stock', <span className={stockTone(l)}>{stockOf(l)}</span>]] as [string, React.ReactNode][]).map(([k, v]) => (
                <div key={k} className="rounded bg-muted/40 px-1 py-1.5">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums [&_input]:mx-auto [&_input]:h-7 [&_input]:w-14">{v}</dd>
                </div>
              ))}
            </dl>
            <dl className="grid grid-cols-2 gap-1 text-center text-xs">
              <div className="rounded bg-emerald-50/60 px-1 py-1.5"><dt className="text-muted-foreground">Delivery Order</dt><dd className="mt-0.5 tabular-nums">{l.decision === 'TOLAK' ? 0 : <NpbgCell line={l} status={req.status} />}</dd></div>
              <div className="rounded bg-indigo-50/60 px-1 py-1.5"><dt className="text-muted-foreground">Purchase Request</dt><dd className="mt-0.5 tabular-nums">{l.decision === 'TOLAK' ? 0 : <PpbCell line={l} status={req.status} />}</dd></div>
            </dl>
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <thead className="whitespace-nowrap border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="w-10 px-4 py-2.5 font-medium">#</th>
              <th className="min-w-[14rem] px-3 py-2.5 font-medium">Item</th>
              <th className="px-3 py-2.5 text-right font-medium">Requested</th>
              {decided && <>
                <th className="px-3 py-2.5 text-right font-medium">Approved</th>
                {handing && <>
                  <th className="px-3 py-2.5 font-medium" title="Per item: approved / handed over quantity, e.g. 10/5 = 5 of 10 handed over">Requested/Handed Over</th>
                  <th className="px-3 py-2.5 text-right font-medium">Balance</th>
                </>}
              </>}
              <th className="px-3 py-2.5 text-right font-medium">Stock</th>
              <th className="px-3 py-2.5 text-right font-medium" title="Issued from stock">Delivery Order</th>
              <th className="px-3 py-2.5 text-right font-medium" title="No stock, purchased until Receipt">Purchase Request</th>
              <th className="min-w-[9rem] px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 text-right font-medium">Image</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {req.lines.map((l, i) => (
              <tr key={l.id} className={cn('align-top', l.decision === null && 'cursor-pointer hover:bg-muted/50', selectedLineId === l.id && 'bg-blue-50 hover:bg-blue-50 [&>td:first-child]:shadow-[inset_3px_0_0_theme(colors.blue.500)]')}
                onClick={() => l.decision === null && onSelectLine(l.id)}>
                <td className="px-4 py-3 tabular-nums text-muted-foreground">{i + 1}</td>
                <td className="px-3 py-3"><LineName line={l} requestId={req.id} /></td>
                <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{requestedCell(l)}</td>
                {decided && <>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{approvedCell(l)}</td>
                  {handing && <>
                    {/* per item: approved (asked) / handed over so far, e.g. 10/5 */}
                    <td className="px-3 py-3">{l.approved_qty != null && l.decision !== 'TOLAK' ? <QtyProgress total={Number(l.approved_qty)} done={l.fulfilled_qty} unit={l.satuan} /> : ''}</td>
                    <td className={cn('whitespace-nowrap px-3 py-3 text-right tabular-nums', left(l) > 0 && 'font-semibold')}>{l.approved_qty != null ? <>{fmtQty(left(l))} <Unit u={l.satuan} /></> : ''}</td>
                  </>}
                </>}
                <td className={cn('whitespace-nowrap px-3 py-3 text-right tabular-nums', stockTone(l))}>{stockOf(l)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{l.decision === 'TOLAK' ? 0 : <NpbgCell line={l} status={req.status} />}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{l.decision === 'TOLAK' ? 0 : <PpbCell line={l} status={req.status} />}</td>
                <td className="px-4 py-3"><DecisionCell line={l} /></td>
                {/* the requester's images of this item, rightmost: from the request to its end */}
                <td className="px-4 py-3"><LineImagesCell requestId={req.id} lineId={l.id} slots={l.images} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

/**
 * Gudang: how much of each item it gives now, from the real stock (≤ what is left, ≤ the stock).
 * That becomes one NPBG; what cannot be given may go to a Draft PPB. Or the rest is closed.
 */
function FulfillPanel({ req, panelRef }: { req: ItemRequestDetail; panelRef: React.RefObject<HTMLDivElement | null> }) {
  const fulfill = useFulfill(req.id)
  const close = useCloseRemaining(req.id)
  const plan = req.plan ?? []
  const [qty, setQty] = useState<Record<number, string>>({})
  const [toPpb, setToPpb] = useState<Record<number, boolean>>({})
  const [closing, setClosing] = useState(false)
  const [reason, setReason] = useState('')
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    setQty((q) => Object.fromEntries(plan.map((p) => [p.line_id, q[p.line_id] ?? String(p.suggested)])))
    setToPpb((t) => Object.fromEntries(plan.map((p) => [p.line_id, t[p.line_id] ?? !p.in_procurement])))
  }, [req.plan]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!req.can_fulfill && !req.can_close) return null
  const rows = plan.map((p) => {
    const v = num(qty[p.line_id] ?? '0')
    const left = Number.isFinite(v) ? Math.max(0, p.remaining - v) : p.remaining
    return { p, v, left }
  })
  const giving = rows.filter((r) => r.v > 0).length
  const shortage = rows.filter((r) => r.left > 0 && !r.p.in_procurement && toPpb[r.p.line_id]).length

  const submit = () => {
    setErr(null)
    for (const { p, v } of rows) {
      if (!Number.isFinite(v) || v < 0) return invalidTo(setErr, `Quantity ${p.deskripsi} is not valid.`)
      if (v > p.remaining) return invalidTo(setErr, `${p.deskripsi}: at most the remaining need (${fmtQty(p.remaining)}).`)
      if (v > 0 && p.available != null && v > p.available) return invalidTo(setErr, `${p.deskripsi}: stock is only ${fmtQty(p.available)}.`)
    }
    if (giving === 0 && shortage === 0) return invalidTo(setErr, 'Fill in the quantity handed over, or pass the shortage on to Draft Purchase Request.')
    fulfill.mutate(rows.map(({ p, v }) => ({ line_id: p.line_id, qty: v, shortage_to_ppb: !!toPpb[p.line_id] && !p.in_procurement })), {
      onError: (e) => setErr(apiErrorMessage(e)),
    })
  }
  const doClose = () => {
    setErr(null)
    if (!reason.trim()) return invalidTo(setErr, 'Write the reason for closing the remaining need.')
    close.mutate({ reason: reason.trim() }, { onSuccess: () => { setClosing(false); setReason('') }, onError: (e) => setErr(apiErrorMessage(e)) })
  }

  return (
    <div ref={panelRef} id="siapkan" className="scroll-mt-4">
      <Panel title="Prepare items from stock" className="border-primary/30">
        {req.can_fulfill && plan.length > 0 && (
          <ul className="divide-y">
            {rows.map(({ p, left }) => (
              <li key={p.line_id} className="grid gap-3 p-4 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                <div className="min-w-0">
                  <div className="break-words font-medium">{p.deskripsi}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.kode_barang && <span className="">{p.kode_barang} · </span>}
                    remaining need <b className="text-foreground">{fmtQty(p.remaining)} {p.satuan ?? ''}</b> · stock available{' '}
                    <b className={(p.available ?? 0) < p.remaining ? 'text-red-600' : 'text-emerald-700'}>{p.available != null ? fmtQty(p.available) : ''}</b>
                  </div>
                  {!p.item_id && <div className="mt-1 text-xs text-amber-700">Not matched to a warehouse item yet, cannot be issued from stock.</div>}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:justify-end">
                  {/* what the stock has now, never less: Gudang does not hand over part of it */}
                  <span className="text-xs text-muted-foreground">Handed Over <b className="text-sm tabular-nums text-foreground">{fmtQty(num(qty[p.line_id] ?? '0') || 0)}</b> {p.satuan ?? ''}</span>
                  {left > 0 && (p.in_procurement ? (
                    <span className="text-xs text-indigo-700">{fmtQty(left)} being purchased</span>
                  ) : (
                    <label className="flex cursor-pointer items-center gap-2 text-xs">
                      <input type="checkbox" className="size-4 accent-primary" checked={!!toPpb[p.line_id]} onChange={(e) => setToPpb((t) => ({ ...t, [p.line_id]: e.target.checked }))} />
                      short {fmtQty(left)} to Draft PPB
                    </label>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-3 border-t p-4">
          {closing && (
            <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
              <Label htmlFor="close-reason">Reason for closing the remaining need *</Label>
              <Input id="close-reason" autoFocus maxLength={255} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. No longer needed / replaced by another item" />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => { setClosing(false); setErr(null) }}>Cancel</Button>
                <Button size="sm" onClick={doClose} disabled={close.isPending}><Lock className="size-4" /> Close the rest</Button>
              </div>
            </div>
          )}
          {err && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm text-muted-foreground">
              {req.can_fulfill ? `${giving} items handed over${shortage ? ` · ${shortage} shortage to Draft Purchase Request` : ''} · stock is reduced right away` : 'There is still a remaining need.'}
            </span>
            <div className="flex flex-wrap gap-2">
              {req.can_close && !closing && <Button variant="outline" onClick={() => setClosing(true)}><Lock className="size-4" /> Close the rest</Button>}
              {req.can_fulfill && plan.length > 0 && (
                <Button onClick={submit} disabled={fulfill.isPending}><PackageCheck className="size-4" /> {fulfill.isPending ? 'Saving…' : 'Create Delivery Order & prepare'}</Button>
              )}
            </div>
          </div>
        </div>
      </Panel>
    </div>
  )
}

/** Every giving of goods: NPBG #1, #2 …, how much, and its serah terima proof. */
function Fulfillments({ req, draft, onDraft }: { req: ItemRequestDetail; draft: HandoverDraft; onDraft: (d: HandoverDraft) => void }) {
  const list = req.fulfillments ?? []
  if (list.length === 0) return null
  return (
    <Panel title={`Delivery Order & handover (${list.length})`}>
      <ul className="divide-y">
        {list.map((f) => req.can_handover && f.status !== 'DISERAHKAN' ? (
          // Gudang fixes here how much is handed over; the serah terima then only takes the photo and signature
          <li key={f.id} className="space-y-2 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 text-sm">
              <span><span className="font-semibold">#{f.seq}</span> <span className="">{f.no_npbg}</span></span>
              <span className="rounded bg-violet-50 px-1.5 py-0.5 text-xs font-medium text-violet-800">Set the quantity, then hand over</span>
            </div>
            <HandoverQty f={f} value={draft} onChange={onDraft} stock={Object.fromEntries(req.lines.map((l) => [l.id, l.on_hand ?? l.available]))}
              images={{ requestId: req.id, byLine: Object.fromEntries(req.lines.map((l) => [l.id, l.images ?? []])) }} />
          </li>
        ) : <FulfillmentRow key={f.id} reqId={req.id} f={f} />)}
      </ul>
    </Panel>
  )
}

const FULFIL_TONE: Record<Fulfillment['status'], [string, string]> = {
  DISIAPKAN: ['bg-violet-50 text-violet-800', 'Ready for handover'],
  SIAP: ['bg-cyan-50 text-cyan-800', 'Ready for handover'],
  DISERAHKAN: ['bg-emerald-50 text-emerald-800', 'Handed over'],
}

function FulfillmentRow({ reqId, f }: { reqId: number; f: Fulfillment }) {
  const photo = useFulfillmentFile(reqId, f.id, 'handover', f.photo)
  const sign = useFulfillmentFile(reqId, f.id, 'signature', f.signature)
  const npbgId = f.lines.find((l) => l.npbg_id)?.npbg_id
  return (
    <li className="space-y-2 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold">#{f.seq}</span>
          {npbgId ? <Link to={`/npbg/${npbgId}`} className=" text-primary hover:underline">{f.no_npbg}</Link> : <span className="">{f.no_npbg}</span>}
          {f.seq > 1 && <span className="text-xs text-muted-foreground">Next Delivery Order</span>}
        </div>
        <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', FULFIL_TONE[f.status][0])}>{FULFIL_TONE[f.status][1]}</span>
      </div>
      <ul className="space-y-1">
        {f.lines.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-3">
            <span className="min-w-0 break-words">{l.deskripsi}</span>
            <span className="shrink-0 tabular-nums">
              {l.handed_qty != null && l.handed_qty !== l.qty ? <><s className="text-muted-foreground">{fmtQty(l.qty)}</s> {fmtQty(l.handed_qty)}</> : fmtQty(l.handed_qty ?? l.qty)} {l.satuan ?? ''}
            </span>
          </li>
        ))}
      </ul>
      <div className="text-xs text-muted-foreground">
        Prepared {fmtDateTime(f.prepared_at)}{f.prepared_by ? ` · ${f.prepared_by}` : ''}
        {f.handed_at && <> · handed over {fmtDateTime(f.handed_at)}{f.handed_by ? ` · ${f.handed_by}` : ''} · received {f.received_by ?? '-'}</>}
      </div>
      {f.note && <div className="text-xs">{f.note}</div>}
      {f.status === 'DISERAHKAN' && (f.photo || f.signature) && (
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button type="button" onClick={() => openImage([{ src: photo.data, alt: `Handover photo #${f.seq}` }, ...(sign.data ? [{ src: sign.data, alt: `Tanda tangan ${f.received_by ?? ''}` }] : [])])}
            className="block cursor-zoom-in overflow-hidden rounded-md border bg-muted" title="View photo">
            {photo.data ? <img src={photo.data} alt={`Handover photo #${f.seq}`} className="h-28 w-full object-cover" /> : <div className="h-28" />}
          </button>
          <div className="flex cursor-zoom-in flex-col rounded-md border bg-white p-1" onClick={() => sign.data && openImage({ src: sign.data, alt: `Tanda tangan ${f.received_by ?? ''}` })}>
            <div className="flex flex-1 items-center justify-center">{sign.data && <img src={sign.data} alt={`Signature #${f.seq}`} className="max-h-24 w-full object-contain" />}</div>
            <div className="border-t pt-0.5 text-center text-xs text-slate-600">{f.received_by ?? '-'}</div>
          </div>
        </div>
      )}
    </li>
  )
}

/** The proof of the serah terima: photo and signature. */
function HandoverProof({ req }: { req: ItemRequestDetail }) {
  // the old flow's single serah terima (newer ones are listed per NPBG)
  const h = (req.fulfillments ?? []).length === 0 ? req.handover : null
  const photo = useHandoverFile(req.id, 'handover', !!h?.photo)
  const sign = useHandoverFile(req.id, 'signature', !!h?.signature)
  if (!h) return null
  return (
    <Panel title="Handover proof" aside={<span className="text-xs text-muted-foreground">{fmtDateTime(h.at)}</span>}>
      <div className="grid grid-cols-2 gap-3 p-4">
        <button type="button" onClick={() => openImage([{ src: photo.data, alt: 'Handover photo' }, ...(sign.data ? [{ src: sign.data, alt: 'Recipient signature' }] : [])])}
          className="block cursor-zoom-in overflow-hidden rounded-md border bg-muted" title="View photo">
          {photo.data ? <img src={photo.data} alt="Handover photo" className="h-44 w-full object-cover" /> : <div className="h-44" />}
        </button>
        <div className="flex cursor-zoom-in flex-col rounded-md border bg-white p-2" onClick={() => sign.data && openImage({ src: sign.data, alt: 'Recipient signature' })}>
          <div className="flex flex-1 items-center justify-center">{sign.data && <img src={sign.data} alt="Recipient signature" className="max-h-36 w-full object-contain" />}</div>
          <div className="border-t pt-1 text-center text-xs text-slate-600">{h.received_by ?? '-'}</div>
        </div>
      </div>
      <dl className="divide-y border-t px-4 text-sm">
        <Row label="Received by">{h.received_by ?? '-'}</Row>
        <Row label="Handed over by">{h.by ?? '-'}</Row>
      </dl>
    </Panel>
  )
}

/** A titled card (Classroom-like: rounded, a plain title). */
function Panel({ title, aside, children, className }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <Card className={cn('overflow-hidden rounded-lg', className)}>
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3 sm:px-5">
        <h2 className="text-[15px] font-medium">{title}</h2>
        {aside}
      </div>
      {children}
    </Card>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium">{children}</dd>
    </div>
  )
}

const LOG_TEXT: Record<string, string> = {
  'ADMIN.VALIDASI': 'Verified by warehouse admin',
  'MANAGER.APPROVE': 'Approved by Manager', 'MANAGER.REJECT': 'Rejected by Manager', 'MANAGER.RETURN': 'Returned by Manager for correction',
  'DIREKTUR.APPROVE': 'Approved by Director', 'DIREKTUR.REJECT': 'Rejected by Director', 'DIREKTUR.RETURN': 'Returned by Director for correction',
  'GUDANG.APPROVE': 'Prepared by warehouse', 'GUDANG.REJECT': 'Rejected by warehouse',
  'GUDANG.FULFILL': 'Delivery Order created from stock', 'GUDANG.CONFIRM': 'Quantity handed over is set by the warehouse', 'GUDANG.SHORTAGE': 'Shortage to Draft Purchase Request', 'GUDANG.CLOSE': 'Remaining need closed',
  'SERAH_TERIMA.HANDOVER': 'Items handed over',
}

/** Everything that happened to the request, oldest first. */
function Activity({ req }: { req: ItemRequestDetail }) {
  const items = [
    { at: req.created_at, text: 'Request created', by: req.requester_name, note: null as string | null, bad: false },
    ...(req.approval_log.length === 0 && req.processed_at ? [{ at: req.processed_at, text: 'Processed by warehouse admin', by: req.processed_by_name, note: null, bad: false }] : []),
    ...[...req.approval_log].reverse().map((a) => ({ at: a.at ?? '', text: isAutoApproval(a.note) ? BYPASS_TEXT : LOG_TEXT[`${a.stage}.${a.action}`] ?? a.action,
      by: isAutoApproval(a.note) ? `bypass ${a.user_name ?? 'Director'}` : a.user_name, note: isAutoApproval(a.note) ? null : clean(a.note) ?? null, bad: a.action === 'REJECT' || a.action === 'RETURN' })),
    ...(req.status === 'DIBATALKAN' ? [{ at: '', text: 'Request cancelled', by: null, note: null, bad: true }] : []),
  ]
  return (
    <ol className="space-y-3 p-4">
      {items.map((a, i) => (
        <li key={i} className="flex gap-3 text-sm">
          <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', a.bad ? 'bg-red-500' : i === items.length - 1 ? 'bg-primary' : 'bg-muted-foreground/40')} />
          <div className="min-w-0">
            <div className={cn('font-medium', a.bad && 'text-red-700')}>{a.text}</div>
            <div className="text-xs text-muted-foreground">{[a.at ? fmtDateTime(a.at) : null, a.by].filter(Boolean).join(' · ')}</div>
            {a.note && <div className="mt-0.5 text-xs">{a.note}</div>}
          </div>
        </li>
      ))}
    </ol>
  )
}

export function ItemRequestDetailPage() {
  const { id } = useParams()
  const { user, hasPermission } = useAuth()
  const { data: req, isLoading } = useItemRequest(Number(id))
  const cancel = useCancelItemRequest(Number(id))
  const proxy = useRequestProxy(Number(id))
  const proc = useProcessItemRequest(Number(id))
  const urgency = useSetUrgency(Number(id))
  const match = useMatchLine(Number(id))
  const share = useShareBase()
  const location = useLocation()
  const prepareRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLDivElement>(null)

  // only while admin gudang still validates (or fixes what was sent back); afterwards the request is in approval
  const canProcess = !!req && hasPermission('item_request.process') && ['MENUNGGU', 'DIPROSES', 'PERLU_PERBAIKAN'].includes(req.status)
  const open = useMemo(() => (canProcess && req ? req.lines.filter((l) => l.decision === null) : []), [req, canProcess])
  const [choices, setChoices] = useState<Record<number, Choice>>({})
  // the item being verified: picked in the table "Barang yang diminta" (the first one to verify by default)
  const [selectedLineId, setSelectedLineId] = useState<number | null>(null)
  useEffect(() => {
    setSelectedLineId((id) => (id !== null && open.some((l) => l.id === id) ? id : open[0]?.id ?? null))
  }, [open])
  const [pelanggan, setPelanggan] = useState('')
  const [verifyNote, setVerifyNote] = useState('')
  const [tipe, setTipe] = useState<'Penjualan' | 'Non Penjualan'>('Non Penjualan')
  const [err, setErr] = useState<string | null>(null)

  // default per line: the best recommendation, the quantity asked
  useEffect(() => {
    // the item already saved on the line; nothing picked for the admin (no blue row before a click)
    setChoices((prev) => Object.fromEntries(open.map((l) => {
      if (prev[l.id]) return [l.id, prev[l.id]]
      const items = savedItem(l) ? [savedItem(l)!] : []
      return [l.id, { items, qtys: distribute(items, Number(l.qty)), serials: l.item_id && l.serials?.length ? { [l.item_id]: l.serials } : {} }]
    })))
  }, [open])
  useEffect(() => { if (req) setPelanggan((p) => p || req.divisi || req.requester_name || '') }, [req])
  // opened from the Approval page's "Siapkan barang"
  const wantsPrepare = location.hash === '#siapkan' && (!!req?.can_fulfill || !!req?.can_handover)
  useEffect(() => {
    if (wantsPrepare) (req?.can_handover ? confirmRef : prepareRef).current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [wantsPrepare]) // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraft] = useState<HandoverDraft>({ qty: {}, drop: {} })
  useEffect(() => { setDraft({ qty: {}, drop: {} }) }, [req?.status])

  if (isLoading || !req) return <div className="space-y-4"><BackLink to="/item-requests" label="Item Request" /><DetailFallback loading={isLoading} /></div>

  const canCancel = req.status === 'MENUNGGU' && (req.requester_id === user?.id || hasPermission('item_request.process'))
  const info = STAGE_INFO[req.status]
  const myTurn = !!info && (req.can_approve || req.can_handover || !!req.can_fulfill)
  const sentBack = req.status === 'PERLU_PERBAIKAN' ? req.approval_log.find((a) => a.action === 'RETURN') : undefined

  const submit = () => {
    setErr(null)
    const unmatched = open.find((l) => choices[l.id]?.items.length === 0)
    if (unmatched) return invalidTo(setErr, `"${unmatched.deskripsi_peminta ?? unmatched.deskripsi_barang}" is not selected from the Product Master yet; if it is not there, add it first.`)
    if (!pelanggan.trim()) return invalidTo(setErr, 'Fill in the Customer for the Delivery Order.')
    
    // the picked items together: exactly what was asked (the stock decides NPBG / Draft PPB after the approval)
    const empty = open.find((l) => choices[l.id]?.items.some((it) => qtyOf(choices[l.id].qtys[it.id]) <= 0))
    if (empty) return invalidTo(setErr, `Fill in the quantity of each item for "${empty.deskripsi_peminta ?? empty.deskripsi_barang}", or untick it.`)
    const over = open.find((l) => split(choices[l.id]).total > Number(l.qty) || split(choices[l.id]).total <= 0)
    if (over) return invalidTo(setErr, `Quantity of "${over.deskripsi_peminta ?? over.deskripsi_barang}" 1–${fmtQty(over.qty)} ${over.satuan ?? ''} (requested). Short stock is fine: the rest is bought through Draft Purchase Request.`)
    const noReason = open.find((l) => split(choices[l.id]).total < Number(l.qty) && !(choices[l.id].reason ?? '').trim())
    if (noReason) { setSelectedLineId(noReason.id); return invalidTo(setErr, `"${noReason.deskripsi_peminta ?? noReason.deskripsi_barang}" is given less than requested: fill in the reason.`) }

    // items with serial numbers: one serial per unit given from stock, picked here
    const snShort = open.find((l) => choices[l.id].items.some((it) => { const n = choices[l.id].snNeed?.[it.id]; return n != null && (choices[l.id].serials?.[it.id] ?? []).length !== n }))
    if (snShort) {
      setSelectedLineId(snShort.id)
      const it = choices[snShort.id].items.find((i) => { const n = choices[snShort.id].snNeed?.[i.id]; return n != null && (choices[snShort.id].serials?.[i.id] ?? []).length !== n })!
      return invalidTo(setErr, `Select ${choices[snShort.id].snNeed?.[it.id]} serial number(s) for ${it.description}.`)
    }

    proc.mutate({
      lines: Object.fromEntries(open.map((l) => [l.id, {
        items: choices[l.id].items.map((it) => ({ item_id: it.id, qty: qtyOf(choices[l.id].qtys[it.id]),
          ...(choices[l.id].serials?.[it.id]?.length ? { serials: choices[l.id].serials![it.id] } : {}) })),
        reason: split(choices[l.id]).total < Number(l.qty) ? (choices[l.id].reason ?? '').trim() : null,
        ...(choices[l.id].unit ? { unit: choices[l.id].unit } : {}),
      }])),
      note: verifyNote.trim() || null,
      npbg: { pelanggan: pelanggan.trim(), tipe_npbg: tipe },
    }, { onError: (e) => setErr(apiErrorMessage(e)) })
  }

  const copyLink = async () => {
    const url = trackUrl(req.track_token, share.base)
    if (await copyText(url)) toast.success('Status link copied. Send it to the requester to follow the status.')
    else toast.error(`Cannot copy automatically. Copy by hand: ${url}`, { duration: 15000 })
  }

  const overdue = !!req.needed_date && !['SELESAI', 'DITOLAK', 'DIBATALKAN'].includes(req.status) && new Date(req.needed_date) < new Date(new Date().toDateString())

  const matched = open.filter((l) => (choices[l.id]?.items.length ?? 0) > 0).length
  const selectedIdx = open.findIndex((l) => l.id === selectedLineId)
  const selected = selectedIdx >= 0 ? open[selectedIdx] : null
  // a click in the table: that item in the verification card (scrolled into view)
  const toLine = (lineId: number) => {
    setSelectedLineId(lineId)
    requestAnimationFrame(() => document.getElementById('verifikasi')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
  }
  // the round icon: green when done, red when rejected, grey when cancelled
  const title = [...new Set(req.lines.map((l) => l.deskripsi_peminta ?? l.deskripsi_barang))]

  return (
    <div className="pb-8">
      <BackLink to="/item-requests" label="Item Request" />
      <SmartButtons type="item_request" id={Number(id)} className="mt-3" />

      {/*
        Classroom's assignment page: the left column is the request (title, what is asked, its progress,
        the activity); the right card is "your part" — what this user does now. On a phone the card comes
        right after the title, so the action is never far.
      */}
      <div className="mt-3 grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <header className="flex gap-3 border-b-2 border-primary/70 pb-4 sm:gap-4">
          <div className="min-w-0 flex-1 space-y-1">
            <h1 className="break-words text-xl font-semibold leading-tight tracking-tight sm:text-2xl">
              {title.slice(0, 3).join(', ')}{title.length > 3 && <span className="text-muted-foreground"> +{title.length - 3} others</span>}
            </h1>
            <div className="text-sm text-muted-foreground">
              {[req.requester_name, req.divisi].filter(Boolean).join(' · ')} · {fmtDateTime(req.created_at)}
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className=" text-sm font-semibold">{req.number}</span>
              <RequestStatusBadge status={req.status} label={req.status_label} />
              {req.urgency === 'URGENT' && <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 ring-1 ring-inset ring-red-200"><AlertTriangle className="size-3.5" />Urgent</span>}
              <span className="text-xs text-muted-foreground">{req.form_label}{req.form_detail_label && req.form_detail ? ` · ${req.form_detail_label}: ${req.form_detail}` : ''}</span>
            </div>
          </div>
          {/* like Classroom's "Tenggat" */}
          <div className="hidden shrink-0 text-right sm:block">
            <div className="text-xs text-muted-foreground">Needed</div>
            <div className={cn('text-sm font-medium', overdue && 'text-red-600')}>{req.needed_date ? fmtDate(req.needed_date) : 'No date'}</div>
            {overdue && <div className="text-xs font-medium text-red-600">Late</div>}
          </div>
        </header>

        {/* ---- your part, then the Chatter (right); on a phone the Chatter drops under the request */}
        <aside className="contents lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:block lg:space-y-4">
          <div className="space-y-4">
            <Card className="overflow-hidden rounded-lg shadow-md">
              <div className="space-y-3 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-lg font-normal">Your Action</h2>
                  {req.needed_date && <span className={cn('text-xs sm:hidden', overdue ? 'font-medium text-red-600' : 'text-muted-foreground')}>{overdue ? 'Late · ' : 'Needed '}{fmtDate(req.needed_date)}</span>}
                </div>

                {open.length > 0 ? (
                  // admin gudang: verify, then send to approval
                  <div className="space-y-3">
                    <div>
                      <div className="flex justify-between text-sm"><span>Items matched</span><span className="tabular-nums font-medium">{matched} / {open.length}</span></div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(matched / open.length) * 100}%` }} /></div>
                    </div>
                    <div className="space-y-1"><Label htmlFor="pr-pelanggan" className="text-xs">Delivery Order Customer</Label><Input id="pr-pelanggan" value={pelanggan} maxLength={200} onChange={(e) => setPelanggan(e.target.value)} /></div>
                    <div className="space-y-1"><Label htmlFor="pr-tipe" className="text-xs">Delivery Order Type</Label>
                      <Select id="pr-tipe" value={tipe} onChange={(e) => setTipe(e.target.value as typeof tipe)}><option>Non Penjualan</option><option>Penjualan</option></Select>
                    </div>
                    <div className="space-y-1"><Label htmlFor="pr-note" className="text-xs">Admin notes (optional)</Label>
                      <Textarea id="pr-note" rows={2} maxLength={1000} value={verifyNote} onChange={(e) => setVerifyNote(e.target.value)} placeholder="Read by Manager, Director & requester" />
                    </div>
                    {err && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>}
                    <Button className="w-full" onClick={submit} disabled={proc.isPending}>
                      <CheckCircle2 className="size-4" /> {proc.isPending ? 'Sending…' : 'Send to approval'}
                    </Button>
                  </div>
                ) : myTurn ? (
                  <div className="space-y-3">
                    <div>
                      <div className="text-sm font-medium">{req.can_handover ? 'Prepare & hand over items' : req.can_fulfill ? 'Prepare items from stock' : req.approve_as === 'DIREKTUR' && req.status === 'APPROVAL_MANAGER' ? 'Waiting for Manager — you can approve directly as Director' : `Waiting for your approval (${info.who})`}</div>
                    </div>
                    <div className="[&_button]:w-full [&>div]:flex-col [&>div]:items-stretch">
                      <ApprovalActions req={req} handover={draft} onPrepare={() => prepareRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-3 rounded-lg bg-muted/50 p-3 text-sm">
                    <CheckCircle2 className={cn('mt-0.5 size-4 shrink-0', req.status === 'SELESAI' ? 'text-emerald-600' : 'text-muted-foreground')} />
                    <div>
                      <div className="font-medium">{req.status === 'SELESAI' ? 'Done — items received' : 'Nothing for you to do'}</div>
                      <p className="text-xs text-muted-foreground">{info ? `Now: ${info.who ? `${info.who} — ` : ''}${req.status_label}` : req.status_label}</p>
                    </div>
                  </div>
                )}
              </div>

              {(req.can_proxy || req.proxy?.code) && (
                <div className="border-t p-4">
                  <ProxyPickup number={req.number} proxy={req.proxy} busy={proxy.create.isPending || proxy.cancel.isPending}
                    onCreate={(name) => proxy.create.mutateAsync(name)} onCancel={() => proxy.cancel.mutateAsync()} searchPeople={proxy.people} />
                </div>
              )}
              {(req.track_token || canProcess || canCancel) && (
                <div className="flex flex-wrap gap-1 border-t bg-muted/20 px-2 py-2">
                  {req.track_token && <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={copyLink}><Copy className="size-3.5" /> Copy status link</Button>}
                  {canProcess && (
                    <Button size="sm" variant="ghost" className={cn('h-8 text-xs', req.urgency !== 'URGENT' && 'text-red-700 hover:text-red-800')} disabled={urgency.isPending}
                      onClick={() => urgency.mutate(req.urgency === 'URGENT' ? null : 'URGENT')}>
                      <AlertTriangle className="size-3.5" /> {req.urgency === 'URGENT' ? 'Remove urgent' : 'Mark urgent'}
                    </Button>
                  )}
                  {canCancel && (
                    <Button size="sm" variant="ghost" className="h-8 text-xs text-destructive hover:text-destructive" disabled={cancel.isPending}
                      onClick={async () => { if ((await confirmDialog('Cancel this request?'))) cancel.mutate() }}>
                      <Ban className="size-3.5" /> Cancel
                    </Button>
                  )}
                </div>
              )}
            </Card>

            <Card className="hidden overflow-hidden rounded-lg lg:block">
              <InfoList req={req} />
            </Card>
          </div>
          <Chatter type="item_request" id={Number(id)} className="order-last lg:sticky lg:top-20 lg:order-none" />
        </aside>

        {/* ---- the request (left) */}
        <main className="min-w-0 space-y-5 lg:col-start-1 lg:row-start-2">
          {sentBack && (
            <div className="flex gap-3 rounded-lg border border-orange-300 bg-orange-50 p-4 text-sm">
              <Undo2 className="mt-0.5 size-4 shrink-0 text-orange-700" />
              <div>
                <div className="font-semibold text-orange-900">Returned for correction{sentBack.user_name ? ` by ${sentBack.user_name}` : ''}</div>
                <p className="text-orange-900/80">{clean(sentBack.note)}</p>
              </div>
            </div>
          )}

          {req.note && (
            <div className="whitespace-pre-wrap rounded-lg bg-muted/40 px-4 py-3 text-sm"><span className="mb-0.5 block text-xs text-muted-foreground">Requester notes</span>{req.note}</div>
          )}
          {req.verify_note && (
            <div className="whitespace-pre-wrap rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950"><span className="mb-0.5 block text-xs text-blue-700">Warehouse admin notes</span>{req.verify_note}</div>
          )}

          <Card className="rounded-lg px-4 py-4 sm:px-5"><StepsBar steps={req.timeline} /></Card>

          {/* what was asked → approved → given (NPBG) / bought (PPB); while verifying, a click picks the item below */}
          <Panel title={`Requested items (${req.lines.length})`}
            >
            <ItemsTable req={req} selectedLineId={open.length > 0 ? selectedLineId : null} onSelectLine={toLine} />
            {(req.images?.length ?? 0) > 0 && (
              <div className="space-y-2 border-t px-4 py-3 sm:px-5">
                <div className="text-xs text-muted-foreground">Images from requester ({req.images!.length})</div>
                <RequestImages requestId={req.id} slots={req.images} size="size-24" />
              </div>
            )}
          </Panel>

          {/* admin gudang: ONE verification card — the item picked in the table, its recommendations and picks */}
          {open.length > 0 && (
            <section id="verifikasi" className="scroll-mt-20 space-y-2">
              <div className="flex items-center justify-between gap-2 px-1">
                <h2 className="text-[15px] font-medium">Item verification{selected ? <span className="font-normal text-muted-foreground"> · {selectedIdx + 1} from {open.length}</span> : null}</h2>
                <div className="flex items-center gap-1">
                  <span className="mr-1 text-xs text-muted-foreground">{matched} from {open.length} matched</span>
                  <Button type="button" variant="outline" size="sm" className="h-8 px-2" aria-label="Previous item" disabled={selectedIdx <= 0} onClick={() => setSelectedLineId(open[selectedIdx - 1].id)}><ChevronLeft className="size-4" /></Button>
                  <Button type="button" variant="outline" size="sm" className="h-8 px-2" aria-label="Next item" disabled={selectedIdx < 0 || selectedIdx >= open.length - 1} onClick={() => setSelectedLineId(open[selectedIdx + 1].id)}><ChevronRight className="size-4" /></Button>
                </div>
              </div>
              {selected && choices[selected.id] ? (
                <OpenLine key={selected.id} line={selected} requestId={req.id} choice={choices[selected.id]}
                  onChange={(c) => setChoices((x) => ({ ...x, [selected.id]: c }))}
                  onPatch={(f) => setChoices((x) => (x[selected.id] ? { ...x, [selected.id]: f(x[selected.id]) } : x))}
                  saving={match.isPending && match.variables?.lineId === selected.id}
                  onPick={(itemId) => match.mutate({ lineId: selected.id, itemId }, { onError: (e) => setErr(apiErrorMessage(e)) })} />
              ) : (
                <Card className="rounded-lg p-8 text-center text-sm text-muted-foreground">Select an item in the table to verify.</Card>
              )}
            </section>
          )}

          <FulfillPanel req={req} panelRef={prepareRef} />
          <div id="konfirmasi" ref={confirmRef} className="scroll-mt-20"><Fulfillments req={req} draft={draft} onDraft={setDraft} /></div>
          <HandoverProof req={req} />

          {/* like Classroom's class comments: what happened, in order */}
          <Panel title="Activity" aside={<MessageSquare className="size-4 text-muted-foreground" />}><Activity req={req} /></Panel>

          <Card className="overflow-hidden rounded-lg lg:hidden"><InfoList req={req} /></Card>
        </main>
      </div>
    </div>
  )
}

/** The remaining details of the request (contact, how it came in, who verified). */
function InfoList({ req }: { req: ItemRequestDetail }) {
  return (
    <>
      <div className="border-b px-4 py-3 text-[15px] font-medium">Information</div>
      <dl className="divide-y px-4 text-sm">
        <Row label="Requester">{req.requester_name ?? '-'}</Row>
        {req.requester_contact && <Row label="Contact">{req.requester_contact}</Row>}
        <Row label="Division">{req.divisi || '-'}</Row>
        <Row label="Sent via">{req.source === 'LINK' ? 'Form links' : 'Application'}</Row>
        {req.requester_location && <Row label="Network"><span className={req.requester_location === 'Outside Office' ? 'text-amber-700' : ''}>{req.requester_location}</span></Row>}
        <Row label="Verified">{req.processed_at ? `${fmtDateTime(req.processed_at)}${req.processed_by_name ? ` · ${req.processed_by_name}` : ''}` : 'Not yet'}</Row>
      </dl>
    </>
  )
}
