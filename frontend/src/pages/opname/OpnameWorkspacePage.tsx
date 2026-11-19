import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, ChevronRight, History, Info, Loader2, Lock, Printer, ScanLine, Search, Trash2 } from 'lucide-react'
import {
  useFlowActions, useLineCounts, useOpnameAdjustments, useOpnameEvents,
  type FlowAction, type FlowLine, type FlowOpname,
} from '@/features/opname/workflow'
import { FLOW, FLOW_STEPS, FlowBadge } from '@/features/opname/status'
import { api, apiErrorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useInfiniteSlice } from '@/components/InfiniteRows'
import { ExportBar } from '@/components/export/ExportBar'
import { ItemPicker } from '@/components/ItemPicker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { OpnameOrderForm } from './OpnameOrderForm'

const PAGE = 50

export const fmtQty = (v: number | null | undefined) => (v == null ? '—' : Number(v).toLocaleString('id-ID', { maximumFractionDigits: 2 }))
export const fmtDateTime = (v: string | null | undefined) => (v ? new Date(v).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—')
const fmtDate = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')

/** variance, coloured: more found = green, less = red, equal = grey */
export function VarianceValue({ value, pct, kind }: { value: number | null | undefined; pct?: number | null; kind?: string | null }) {
  if (value == null) return <span className="text-muted-foreground">—</span>
  if (kind === 'MATCH' || Math.abs(value) < 0.005) return <span className="inline-flex items-center gap-1 text-muted-foreground"><CheckCircle2 className="size-3.5 text-emerald-500" />0</span>
  const plus = value > 0
  return (
    <span className={cn('inline-flex items-baseline gap-1 font-semibold tabular-nums', plus ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
      {plus ? '+' : '−'}{fmtQty(Math.abs(value))}
      {pct != null && <span className="text-xs font-normal opacity-80">({plus ? '+' : '−'}{Math.abs(pct).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%)</span>}
    </span>
  )
}

// ---------------------------------------------------------------- status bar (Odoo-style chevrons)

function StatusBar({ status }: { status: string }) {
  const cancelled = status === 'CANCELLED'
  const at = status === 'RECOUNT' ? 'REVIEW' : status
  const current = FLOW_STEPS.findIndex((s) => s.status === at)
  return (
    <ol aria-label="Workflow" className="flex flex-wrap items-stretch overflow-hidden rounded-md border bg-card text-xs sm:text-[13px]">
      {FLOW_STEPS.map((s, i) => {
        const active = !cancelled && i === current
        const done = !cancelled && i < current
        return (
          <li key={s.status} aria-current={active ? 'step' : undefined}
            className={cn('relative flex items-center gap-1 px-2.5 py-1.5 sm:px-3', i > 0 && 'border-l',
              active ? 'bg-primary font-semibold text-primary-foreground' : done ? 'text-foreground' : 'text-muted-foreground')}>
            {done && <CheckCircle2 className="size-3.5 text-emerald-500" />}
            {active && status === 'RECOUNT' ? 'Recount' : s.label}
          </li>
        )
      })}
      {cancelled && <li className="border-l bg-slate-200 px-3 py-1.5 font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-100">Cancelled</li>}
    </ol>
  )
}

// ---------------------------------------------------------------- small pieces

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-2 py-1 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children ?? '—'}</dd>
    </div>
  )
}

function Callout({ tone, children, action }: { tone: 'info' | 'warn' | 'done' | 'lock'; children: ReactNode; action?: ReactNode }) {
  const Icon = tone === 'warn' ? AlertTriangle : tone === 'done' ? CheckCircle2 : tone === 'lock' ? Lock : Info
  return (
    <div className={cn('flex flex-col gap-3 rounded-lg border p-3 text-sm sm:flex-row sm:items-center sm:justify-between',
      tone === 'warn' && 'border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10',
      tone === 'done' && 'border-emerald-300 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-500/10',
      tone === 'lock' && 'bg-muted/60',
      tone === 'info' && 'bg-primary/5')}>
      <div className="flex items-start gap-2">
        <Icon className={cn('mt-0.5 size-4 shrink-0', tone === 'warn' ? 'text-amber-600' : tone === 'done' ? 'text-emerald-600' : 'text-primary')} />
        <div>{children}</div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

/** A required / optional text asked before a step (reason, note), with the step's own wording. */
function AskModal({ title, description, label, required, confirm, danger, busy, onClose, onConfirm, children }: {
  title: string; description?: ReactNode; label: string; required?: boolean; confirm: string; danger?: boolean; busy?: boolean
  onClose: () => void; onConfirm: (text: string) => void; children?: ReactNode
}) {
  const [text, setText] = useState('')
  const ok = !required || text.trim().length >= 3
  return (
    <Modal open onClose={onClose} title={title} description={description}
      footer={<>
        <Button size="sm" variant="outline" onClick={onClose}>Back</Button>
        <Button size="sm" variant={danger ? 'destructive' : 'default'} disabled={!ok || busy} onClick={() => onConfirm(text.trim())}>
          {busy && <Loader2 className="size-4 animate-spin" />}{confirm}
        </Button>
      </>}>
      <div className="space-y-3 text-sm">
        {children}
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">{label}{required && ' *'}</span>
          <Textarea rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        </label>
      </div>
    </Modal>
  )
}

function CountHistory({ opnameId, line, onClose }: { opnameId: number; line: FlowLine; onClose: () => void }) {
  const { data, isLoading } = useLineCounts(opnameId, line.id)
  return (
    <Modal open onClose={onClose} title={`Count history — ${line.item_code ?? ''}`} description={line.description ?? undefined}>
      {isLoading ? <p className="py-4 text-sm text-muted-foreground">Loading…</p> : !data?.length ? <p className="py-4 text-sm text-muted-foreground">Not counted yet.</p> : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1">Round</th><th>Qty</th><th>By</th><th>When</th><th>Note</th></tr></thead>
          <tbody>
            {data.map((c) => (
              <tr key={c.id} className="border-t align-top">
                <td className="py-1.5">{c.round === 1 ? 'Count' : `Recount ${c.round - 1}`}{c.source === 'SCAN' && <Badge variant="neutral" className="ml-1">scan</Badge>}</td>
                <td className="tabular-nums font-medium">{fmtQty(c.counted_qty)}</td>
                <td>{c.counted_by ?? '—'}</td>
                <td className="whitespace-nowrap">{fmtDateTime(c.counted_at)}</td>
                <td>{c.note ?? ''}{c.recount_reason && <div className="text-xs text-amber-700">Recount: {c.recount_reason}</div>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  )
}

// ---------------------------------------------------------------- lines

type Filter = 'all' | 'uncounted' | 'counted' | 'variance' | 'recount' | 'excluded'
type Decision = { decision: 'ACCEPT' | 'EXCLUDE'; note: string }

interface LineProps {
  line: FlowLine
  o: FlowOpname
  counting: boolean
  reviewing: boolean
  draft: boolean
  selected: boolean
  onSelect: (on: boolean) => void
  decision: Decision
  onDecision: (d: Decision) => void
  onCount: (qty: number, note: string | null) => Promise<unknown>
  onHistory: () => void
  onRemove: () => void
  inputRef: (el: HTMLInputElement | null) => void
}

function LineRow(p: LineProps) {
  const { line, o } = p
  const see = o.can_see_system
  // in a recount the line is counted again from scratch (blind), the earlier count stays in its history
  const recountLine = o.flow_status === 'RECOUNT' && line.review_status === 'RECOUNT'
  const editable = p.counting && (o.flow_status !== 'RECOUNT' || recountLine)
  const [qty, setQty] = useState(recountLine && line.count_status !== 'COUNTED' ? '' : (line.physical_qty?.toString() ?? ''))
  const [note, setNote] = useState(line.note ?? '')
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    if (qty.trim() === '') return
    const n = Number(qty.replace(',', '.'))
    if (Number.isNaN(n) || n < 0) { setState('error'); setErr('A number ≥ 0'); return }
    if (n === line.physical_qty && (note || null) === (line.note || null) && line.count_status === 'COUNTED') return
    setState('saving'); setErr(null)
    try { await p.onCount(n, note.trim() || null); setState('saved') } catch (e) { setState('error'); setErr(apiErrorMessage(e)) }
  }

  const tint = see && line.variance_kind === 'MINUS' ? 'bg-red-50/60 dark:bg-red-500/5' : see && line.variance_kind === 'PLUS' ? 'bg-emerald-50/60 dark:bg-emerald-500/5' : ''
  return (
    <tr className={cn('border-t align-top', tint, line.review_status === 'REJECTED' && 'opacity-60', recountLine && 'bg-amber-50 dark:bg-amber-500/10')}>
      {p.reviewing && (
        <td className="px-2 py-2"><input type="checkbox" aria-label={`Select ${line.item_code}`} className="size-4" checked={p.selected} onChange={(e) => p.onSelect(e.target.checked)} /></td>
      )}
      <td className="px-3 py-2">
        <div className="text-[13px] text-muted-foreground">{line.item_code}</div>
        <div className="leading-snug">{line.description}</div>
        {line.recount_reason && line.review_status === 'RECOUNT' && <div className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">Recount: {line.recount_reason}</div>}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">{line.uom ?? '—'}</td>
      <td className="px-3 py-2 whitespace-nowrap">{line.location ?? '—'}</td>
      {see && <td className="px-3 py-2 text-right tabular-nums">{fmtQty(line.system_qty)}</td>}
      <td className="px-3 py-2">
        {editable ? (
          <div className="space-y-1">
            <Input ref={p.inputRef} data-qty-input aria-label={`Counted quantity of ${line.item_code}`} type="number" inputMode="decimal" min={0} className="h-9 w-28"
              value={qty} onChange={(e) => setQty(e.target.value)} onBlur={save}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void save(); focusNext(e.currentTarget) } }} />
            <span className={cn('block text-xs', state === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
              {state === 'saving' ? 'Saving…' : state === 'error' ? err : (state === 'saved' || (line.count_status === 'COUNTED' && !(recountLine && qty === ''))) ? '✓ Saved' : 'Not counted'}
            </span>
          </div>
        ) : <span className="font-medium tabular-nums">{fmtQty(line.physical_qty)}</span>}
      </td>
      {see && <td className="px-3 py-2 text-right"><VarianceValue value={line.variance} pct={line.variance_pct} kind={line.variance_kind} /></td>}
      <td className="px-3 py-2 text-xs">
        {line.counted_by ? <>{line.counted_by}<div className="text-muted-foreground">{fmtDateTime(line.counted_at)}</div></> : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-3 py-2">
        {p.reviewing ? (
          <div className="space-y-1">
            <Select aria-label={`Decision for ${line.item_code}`} className="h-8 text-sm" value={p.decision.decision} onChange={(e) => p.onDecision({ ...p.decision, decision: e.target.value as Decision['decision'] })}>
              <option value="ACCEPT">Accept count</option>
              <option value="EXCLUDE">Exclude (no adjustment)</option>
            </Select>
            <Input aria-label={`Variance reason for ${line.item_code}`} className="h-8 text-sm" placeholder={line.variance_kind && line.variance_kind !== 'MATCH' ? 'Reason of the variance *' : 'Reason (optional)'}
              value={p.decision.note} onChange={(e) => p.onDecision({ ...p.decision, note: e.target.value })} />
            {line.note && <div className="text-xs text-muted-foreground">Counter: {line.note}</div>}
          </div>
        ) : editable ? (
          <Input aria-label={`Note for ${line.item_code}`} className="h-9" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} onBlur={save} />
        ) : (
          <div className="text-sm">
            {line.review_status === 'REJECTED' && <Badge variant="neutral" className="mb-0.5">Excluded</Badge>}
            {line.adjustment && <Badge variant="success" className="mb-0.5">Adjusted {line.adjustment.difference > 0 ? '+' : '−'}{fmtQty(Math.abs(line.adjustment.difference))}</Badge>}
            <div>{line.review_note ?? line.note ?? <span className="text-muted-foreground">—</span>}</div>
          </div>
        )}
      </td>
      <td className="px-2 py-2 text-right whitespace-nowrap">
        {(line.counts_count ?? 0) > 0 && (
          <button type="button" onClick={p.onHistory} aria-label={`Count history of ${line.item_code}`} title="Count history" className="inline-flex size-8 items-center justify-center rounded hover:bg-muted">
            <History className="size-4" /><span className="sr-only">{line.counts_count}</span>
          </button>
        )}
        {p.draft && (
          <button type="button" onClick={p.onRemove} aria-label={`Remove ${line.item_code}`} className="inline-flex size-8 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-destructive"><Trash2 className="size-4" /></button>
        )}
      </td>
    </tr>
  )
}

function focusNext(current: HTMLElement) {
  const all = Array.from(document.querySelectorAll<HTMLInputElement>('input[data-qty-input]'))
  const next = all[all.indexOf(current as HTMLInputElement) + 1]
  next?.focus()
  next?.select()
}

// ---------------------------------------------------------------- page

type Ask = 'recount' | 'approval' | 'approve' | 'reject' | 'close' | 'cancel' | 'correction' | 'finish' | 'confirm' | 'start' | null

export function OpnameWorkspacePage({ o }: { o: FlowOpname }) {
  const navigate = useNavigate()
  const a = useFlowActions(o.id)
  const can = (x: FlowAction) => o.actions.includes(x)
  const status = o.flow_status
  const see = o.can_see_system
  const [tab, setTab] = useState<'items' | 'adjustments' | 'history'>('items')
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [scan, setScan] = useState('')
  const [scanPlusOne, setScanPlusOne] = useState(false)
  const [scanMsg, setScanMsg] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [decisions, setDecisions] = useState<Record<number, Decision>>({})
  const [ask, setAsk] = useState<Ask>(null)
  const [editing, setEditing] = useState(false)
  const [history, setHistory] = useState<FlowLine | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [printing, setPrinting] = useState(false)
  const inputs = useRef(new Map<number, HTMLInputElement>())

  const counting = can('count')
  const reviewing = can('review')
  const draft = can('edit')
  const decisionOf = (l: FlowLine): Decision => decisions[l.id] ?? { decision: l.review_status === 'REJECTED' ? 'EXCLUDE' : 'ACCEPT', note: l.review_note ?? '' }
  const hasVar = (l: FlowLine) => l.variance_kind === 'PLUS' || l.variance_kind === 'MINUS'

  const lines = useMemo(() => {
    const s = search.trim().toLowerCase()
    return o.lines.filter((l) => {
      if (filter === 'uncounted' && l.count_status === 'COUNTED') return false
      if (filter === 'counted' && l.count_status !== 'COUNTED') return false
      if (filter === 'variance' && !hasVar(l)) return false
      if (filter === 'recount' && l.review_status !== 'RECOUNT') return false
      if (filter === 'excluded' && l.review_status !== 'REJECTED') return false
      return !s || (l.item_code ?? '').toLowerCase().includes(s) || (l.description ?? '').toLowerCase().includes(s) || (l.location ?? '').toLowerCase().includes(s)
    })
  }, [o.lines, filter, search])
  const { rows, footer } = useInfiniteSlice(lines, PAGE, `${filter}|${search}`)
  const sm = o.summary
  const pct = sm.lines ? Math.round((sm.counted / sm.lines) * 100) : 0

  const run = <T,>(p: Promise<T>, after?: (v: T) => void) => { setErr(null); p.then((v) => { setAsk(null); after?.(v) }).catch((e) => { setAsk(null); setErr(apiErrorMessage(e)) }) }
  const changedDecisions = () => o.lines.filter((l) => decisions[l.id]).map((l) => ({ id: l.id, decision: decisions[l.id].decision, note: decisions[l.id].note.trim() || null }))
  const saveDecisions = async () => { const d = changedDecisions(); if (d.length) await a.reviewDecisions.mutateAsync({ decisions: d }); setDecisions({}) }

  /** barcode / keyboard-wedge scanner: the code + Enter finds the line (and with "+1 per scan" counts one more) */
  async function onScan() {
    const code = scan.trim().toLowerCase()
    if (!code) return
    const line = o.lines.find((l) => (l.item_code ?? '').toLowerCase() === code)
    setScan('')
    if (!line) { setScanMsg(`"${code}" is not on this stock opname.`); return }
    if (status === 'RECOUNT' && line.review_status !== 'RECOUNT') { setScanMsg(`${line.item_code} is not asked to be recounted.`); return }
    if (scanPlusOne) {
      const next = (line.count_status === 'COUNTED' && !(status === 'RECOUNT' && line.count_round !== o.count_round) ? (line.physical_qty ?? 0) : 0) + 1
      try { await a.count.mutateAsync({ lineId: line.id, physical_qty: next, note: line.note, source: 'SCAN' }); setScanMsg(`${line.item_code}: ${fmtQty(next)}`) } catch (e) { setScanMsg(apiErrorMessage(e)) }
      return
    }
    setFilter('all'); setSearch(line.item_code ?? '')
    setScanMsg(`${line.item_code} — enter its quantity.`)
    setTimeout(() => { const el = inputs.current.get(line.id); el?.focus(); el?.select() }, 50)
  }

  async function print() {
    setPrinting(true)
    try { const res = await api.get(`/api/stock-opnames/${o.id}/print`, { responseType: 'blob' }); window.open(URL.createObjectURL(res.data as Blob), '_blank') } catch (e) { setErr(apiErrorMessage(e)) } finally { setPrinting(false) }
  }

  // ---- the main buttons of this status (Odoo: on the left of the status bar)
  const buttons: ReactNode[] = []
  const primary = (k: string, label: string, on: () => void, busy?: boolean) => buttons.push(<Button key={k} size="sm" onClick={on} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />}{label}</Button>)
  const secondary = (k: string, label: string, on: () => void, danger?: boolean) => buttons.push(<Button key={k} size="sm" variant="outline" className={cn(danger && 'text-destructive')} onClick={on}>{label}</Button>)
  if (can('confirm')) primary('confirm', 'Confirm', () => setAsk('confirm'))
  if (can('edit')) secondary('edit', 'Edit', () => setEditing(true))
  if (can('start_counting')) primary('start', 'Start Counting', () => setAsk('start'))
  if (can('finish_counting')) primary('finish', status === 'RECOUNT' ? 'Finish Recount' : 'Finish Counting', () => setAsk('finish'))
  if (can('request_approval')) primary('approval', 'Send for Approval', () => setAsk('approval'))
  if (reviewing) secondary('save', Object.keys(decisions).length ? `Save Review (${Object.keys(decisions).length})` : 'Save Review', () => run(saveDecisions()))
  if (can('recount')) secondary('recount', selected.size ? `Recount (${selected.size})` : 'Recount…', () => (selected.size ? setAsk('recount') : setErr('Tick the items to recount first (tip: filter “Variance”).')))
  if (can('approve')) primary('approve', 'Approve & Post', () => setAsk('approve'))
  if (can('reject')) secondary('reject', 'Reject', () => setAsk('reject'), true)
  if (can('close')) primary('close', 'Mark as Done', () => setAsk('close'))
  if (can('correction')) secondary('correction', 'Create Correction', () => setAsk('correction'))
  if (can('cancel')) secondary('cancel', 'Cancel', () => setAsk('cancel'), true)

  // ---- what happens next
  let next: { tone: 'info' | 'warn' | 'done' | 'lock'; text: ReactNode } | null = null
  if (status === 'DRAFT') next = { tone: 'info', text: <>Draft order: check the items, the counting team and the person in charge, then <b>Confirm</b> to fix the item list.</> }
  else if (status === 'CONFIRMED') next = { tone: 'info', text: <>Order confirmed. <b>Start Counting</b> when the team is in the warehouse — the book quantities are frozen at that moment.</> }
  else if (status === 'COUNTING') next = { tone: 'info', text: <>Count every item and type the quantity found{see ? '' : ' (the system quantity is hidden — blind count)'}. Scan a barcode or press <b>Enter</b> to go to the next item. <b>{sm.uncounted}</b> left.</> }
  else if (status === 'RECOUNT') next = { tone: 'warn', text: <><b>{sm.recount_open}</b> of {sm.recount} items must be counted again (round {o.count_round}). The earlier counts stay in each item’s history.</> }
  else if (status === 'REVIEW') next = see
    ? { tone: 'warn', text: <><b>{sm.variance_lines ?? 0}</b> items differ (+{fmtQty(sm.plus_qty)} / {fmtQty(sm.minus_qty)}). Accept or exclude each, give the reason of every variance, ask a <b>recount</b> where needed, then <b>Send for Approval</b>.</> }
    : { tone: 'info', text: 'Counting finished — the warehouse admin is reviewing the variances.' }
  else if (status === 'WAITING_APPROVAL') next = { tone: 'warn', text: <>Waiting for the supervisor. <b>Approve &amp; Post</b> writes the accepted variances to the Stock Ledger in one transaction.{o.review_note && <> Reviewer: “{o.review_note}”.</>}</> }
  else if (status === 'POSTED') next = { tone: 'done', text: <>Posted {fmtDateTime(o.posted_at)} by {o.poster ?? '—'} — {sm.adjusted ?? 0} stock adjustments. The document is locked; mark it as done to close it.</> }
  else if (status === 'DONE') next = { tone: 'lock', text: <>Closed and locked. A mistake is fixed with <b>Create Correction</b> (a new, audited stock opname of the same items).</> }
  else if (status === 'CANCELLED') next = { tone: 'lock', text: <>Cancelled {fmtDateTime(o.cancelled_at)}: {o.cancel_reason}. Stock was not changed.</> }

  const chips: Array<[Filter, string, number, boolean]> = [
    ['all', 'All', sm.lines, true],
    ['uncounted', 'Not counted', sm.uncounted, !['DRAFT', 'CONFIRMED'].includes(status)],
    ['counted', 'Counted', sm.counted, !['DRAFT', 'CONFIRMED'].includes(status)],
    ['variance', 'Variance', sm.variance_lines ?? 0, see],
    ['recount', 'Recount', sm.recount, sm.recount > 0],
    ['excluded', 'Excluded', sm.excluded ?? 0, (sm.excluded ?? 0) > 0],
  ]
  const approvedLines = o.lines.filter((l) => l.review_status === 'APPROVED' && hasVar(l))

  return (
    <div className="space-y-4">
      {/* breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        <Link to="/stock-opnames/dashboard" className="hover:text-foreground">Stock Opname</Link><ChevronRight className="size-3.5" />
        <Link to="/stock-opnames" className="hover:text-foreground">Documents</Link><ChevronRight className="size-3.5" />
        <span className="font-medium text-foreground">{o.number}</span>
      </nav>

      {/* control panel: the buttons of this status | the status bar */}
      <div className="flex flex-col gap-2 rounded-lg border bg-card p-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {buttons}
          <Button size="sm" variant="ghost" onClick={print} disabled={printing}><Printer className="size-4" />{['DRAFT', 'CONFIRMED'].includes(status) ? 'Count Sheet' : 'Print'}</Button>
        </div>
        <StatusBar status={status} />
      </div>

      {next && <Callout tone={next.tone}>{next.text}</Callout>}
      {err && <p role="alert" className="whitespace-pre-line rounded-md bg-destructive/10 p-3 text-sm text-destructive">{err}</p>}

      {/* the sheet */}
      <section className="rounded-lg border bg-card p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Stock Opname</div>
            <h1 className="text-2xl font-semibold tracking-tight">{o.number}</h1>
          </div>
          <FlowBadge status={status} />
        </div>
        <dl className="grid gap-x-8 md:grid-cols-2">
          <div>
            <Field label="Date">{fmtDate(o.scheduled_date)}</Field>
            <Field label="Warehouse">{o.warehouse ? `${o.warehouse.code} — ${o.warehouse.name}` : '—'}</Field>
            <Field label="Location">{o.location?.code ?? 'All locations'}</Field>
            <Field label="Category">{o.category?.path ?? o.category?.name ?? 'All categories'}</Field>
            <Field label="Items">{o.scope === 'ALL' ? 'All items' : o.scope === 'OPENING' ? 'Opening balance' : 'Selected items'} · {sm.lines} lines</Field>
          </div>
          <div>
            <Field label="Method">{o.count_method === 'CYCLE' ? 'Cycle Count' : 'Full Count'}</Field>
            <Field label="Person in charge">{o.responsible?.name ?? '—'}</Field>
            <Field label="Counting team">{o.team.length ? o.team.map((t) => t.name).join(', ') : 'Anyone with counting access'}</Field>
            <Field label="Notes">{o.notes ?? '—'}</Field>
            {o.correction_of && <Field label="Correction of"><Link className="text-primary hover:underline" to={`/stock-opnames/${o.correction_of.id}`}>{o.correction_of.number}</Link></Field>}
            {o.corrections.length > 0 && <Field label="Corrections">{o.corrections.map((c) => <Link key={c.id} className="mr-2 text-primary hover:underline" to={`/stock-opnames/${c.id}`}>{c.number}</Link>)}</Field>}
          </div>
        </dl>

        {status !== 'DRAFT' && (
          <div className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="flex justify-between text-xs text-muted-foreground"><span>Counted</span><span className="tabular-nums">{sm.counted}/{sm.lines} · {pct}%</span></div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted"><div className={cn('h-full rounded-full', pct === 100 ? 'bg-emerald-500' : 'bg-primary')} style={{ width: `${pct}%` }} /></div>
            </div>
            {see && <div className="text-sm"><div className="text-xs text-muted-foreground">Accuracy</div><b className="text-lg tabular-nums">{sm.accuracy != null ? `${sm.accuracy}%` : '—'}</b></div>}
            {see && <div className="text-sm"><div className="text-xs text-muted-foreground">Items with variance</div><b className="text-lg tabular-nums">{sm.variance_lines ?? 0}</b> <span className="text-xs"><span className="text-emerald-600">+{fmtQty(sm.plus_qty)}</span> / <span className="text-red-600">{fmtQty(sm.minus_qty)}</span></span></div>}
            <div className="text-sm"><div className="text-xs text-muted-foreground">Book qty frozen</div>{fmtDateTime(o.snapshot_at)}</div>
          </div>
        )}
      </section>

      {/* notebook */}
      <div role="tablist" aria-label="Sections" className="flex gap-1 border-b">
        {([['items', `Items (${sm.lines})`], ...(see ? [['adjustments', `Stock Adjustments${sm.adjusted ? ` (${sm.adjusted})` : ''}`]] : []), ['history', 'History & Approval']] as Array<[typeof tab, string]>).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cn('-mb-px border-b-2 px-3 py-2 text-sm', tab === k ? 'border-primary font-medium text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>{label}</button>
        ))}
      </div>

      {tab === 'items' && (
        <div className="space-y-3">
          {draft && (
            <div className="max-w-xl"><span className="text-xs text-muted-foreground">Add an item</span>
              <ItemPicker onPick={(it) => run(a.addLines.mutateAsync({ item_ids: [it.id] }))} /></div>
          )}
          {counting && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-2">
              <ScanLine className="size-4 text-muted-foreground" />
              <Input aria-label="Scan barcode or type item code" className="h-9 w-full sm:w-72" placeholder="Scan barcode / type item code + Enter" value={scan}
                onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void onScan() } }} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={scanPlusOne} onChange={(e) => setScanPlusOne(e.target.checked)} />+1 per scan</label>
              {scanMsg && <span role="status" className="text-sm text-muted-foreground">{scanMsg}</span>}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex flex-wrap gap-0.5 rounded-lg border bg-card p-0.5">
              {chips.filter((c) => c[3]).map(([k, label, n]) => (
                <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k}
                  className={cn('rounded-md px-3 py-1 text-sm', filter === k ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted')}>
                  {label} <span className="tabular-nums opacity-75">({n})</span>
                </button>
              ))}
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="h-9 pl-9" placeholder="Search code / name / location…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            {reviewing && <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(o.lines.filter(hasVar).map((l) => l.id)))}>Select all variances</Button>}
            <div className="ml-auto"><ExportBar dataset="stock-opname-lines" filters={{ opname_id: o.id, source: 'internal' }} filenameBase={`stock-opname-${o.number}`} viewPermission="report.opname" /></div>
          </div>

          <div className="max-h-[70vh] overflow-auto rounded-lg border bg-card">
            <table className="w-full min-w-[56rem] text-sm">
              <thead className="sticky top-0 z-10 bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  {reviewing && <th className="w-8 px-2 py-2" />}
                  <th className="px-3 py-2 font-medium">Item</th>
                  <th className="px-3 py-2 font-medium">UOM</th>
                  <th className="px-3 py-2 font-medium">Location</th>
                  {see && <th className="px-3 py-2 text-right font-medium">System qty</th>}
                  <th className="px-3 py-2 font-medium">Counted qty</th>
                  {see && <th className="px-3 py-2 text-right font-medium">Variance</th>}
                  <th className="px-3 py-2 font-medium">Counted by</th>
                  <th className="px-3 py-2 font-medium">{reviewing ? 'Decision & reason' : 'Note'}</th>
                  <th className="w-16 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={10} className="px-3 py-10 text-center text-muted-foreground">No items for this filter.</td></tr>}
                {rows.map((l) => (
                  <LineRow key={`${l.id}-${l.count_round}-${l.review_status}`} line={l} o={o} counting={counting} reviewing={reviewing} draft={draft}
                    selected={selected.has(l.id)} onSelect={(on) => setSelected((s) => { const n = new Set(s); if (on) n.add(l.id); else n.delete(l.id); return n })}
                    decision={decisionOf(l)} onDecision={(d) => setDecisions((m) => ({ ...m, [l.id]: d }))}
                    onCount={(qty, note) => a.count.mutateAsync({ lineId: l.id, physical_qty: qty, note })}
                    onHistory={() => setHistory(l)} onRemove={() => run(a.removeLine.mutateAsync(l.id))}
                    inputRef={(el) => { if (el) inputs.current.set(l.id, el); else inputs.current.delete(l.id) }} />
                ))}
              </tbody>
            </table>
            <div className="border-t">{footer}</div>
          </div>
        </div>
      )}

      {tab === 'adjustments' && see && <AdjustmentsTab o={o} />}
      {tab === 'history' && <HistoryTab o={o} />}

      {/* ---- the confirmations / questions of each step */}
      {ask === 'confirm' && <AskModal title="Confirm this order?" description={`${sm.lines} items will be fixed for counting. Items can no longer be added or removed.`} label="Note (optional)" confirm="Confirm" busy={a.confirm.isPending} onClose={() => setAsk(null)} onConfirm={() => run(a.confirm.mutateAsync())} />}
      {ask === 'start' && <AskModal title="Start counting now?" description="The book quantity of every item is frozen now; the variance is measured against it." label="Note (optional)" confirm="Start Counting" busy={a.startCounting.isPending} onClose={() => setAsk(null)} onConfirm={() => run(a.startCounting.mutateAsync())} />}
      {ask === 'finish' && (
        <AskModal title={status === 'RECOUNT' ? 'Finish the recount?' : 'Finish counting?'} label="Note (optional)" confirm="Yes, send for review" busy={a.finishCounting.isPending} onClose={() => setAsk(null)} onConfirm={() => run(a.finishCounting.mutateAsync())}>
          <p>Counted <b>{sm.counted}</b> of <b>{sm.lines}</b> items.{(status === 'RECOUNT' ? sm.recount_open : sm.uncounted) > 0 && <span className="text-destructive"> {status === 'RECOUNT' ? sm.recount_open : sm.uncounted} still to count.</span>}</p>
          <p className="text-muted-foreground">Quantities cannot change afterwards unless a recount is requested.</p>
        </AskModal>
      )}
      {ask === 'recount' && (
        <AskModal title={`Recount ${selected.size} items?`} description="They go back to the counting team. The first count stays in each item’s history." label="Reason for the recount" required confirm="Request Recount" busy={a.recount.isPending}
          onClose={() => setAsk(null)} onConfirm={(reason) => run(saveDecisions().then(() => a.recount.mutateAsync({ line_ids: [...selected], reason })), () => setSelected(new Set()))} />
      )}
      {ask === 'approval' && (
        <AskModal title="Send to the supervisor?" label="Note for the supervisor (optional)" confirm="Send for Approval" busy={a.requestApproval.isPending}
          onClose={() => setAsk(null)} onConfirm={(note) => run(saveDecisions().then(() => a.requestApproval.mutateAsync({ note: note || undefined })))}>
          <p>Items not excluded are <b>accepted</b>: stock will be adjusted to the count once approved. Every accepted variance needs a reason.</p>
        </AskModal>
      )}
      {ask === 'approve' && (
        <AskModal title="Approve and post to the Stock Ledger?" label="Approval note (optional)" confirm="Approve & Post" busy={a.approve.isPending}
          onClose={() => setAsk(null)} onConfirm={(note) => run(a.approve.mutateAsync({ note: note || undefined }))}>
          <ul className="space-y-1">
            <li>• <b>{approvedLines.length}</b> stock adjustments will be posted (+{fmtQty(approvedLines.filter((l) => (l.variance ?? 0) > 0).reduce((n, l) => n + (l.variance ?? 0), 0))} / −{fmtQty(Math.abs(approvedLines.filter((l) => (l.variance ?? 0) < 0).reduce((n, l) => n + (l.variance ?? 0), 0)))}).</li>
            <li>• <b>{sm.excluded ?? 0}</b> excluded items keep their stock.</li>
            <li>• All in one transaction: if one line fails, nothing is posted. Afterwards the document is locked.</li>
          </ul>
        </AskModal>
      )}
      {ask === 'reject' && <AskModal title="Send back to review?" label="Why (the reviewer sees it)" required confirm="Reject" danger busy={a.reject.isPending} onClose={() => setAsk(null)} onConfirm={(note) => run(a.reject.mutateAsync({ note }))} />}
      {ask === 'close' && <AskModal title="Mark as done?" description="The document is closed and locked." label="Note (optional)" confirm="Mark as Done" busy={a.close.isPending} onClose={() => setAsk(null)} onConfirm={(note) => run(a.close.mutateAsync({ note: note || undefined }))} />}
      {ask === 'cancel' && <AskModal title="Cancel this stock opname?" description="Stock is not changed. The document and its counts are kept." label="Reason" required confirm="Cancel Stock Opname" danger busy={a.cancel.isPending} onClose={() => setAsk(null)} onConfirm={(reason) => run(a.cancel.mutateAsync({ reason }))} />}
      {ask === 'correction' && (
        <AskModal title="Create a correction?" description="A posted document is never edited. A new draft stock opname of the same items is created and goes through the whole workflow." label="What is being corrected (optional)" confirm="Create Correction" busy={a.correction.isPending}
          onClose={() => setAsk(null)} onConfirm={(note) => run(a.correction.mutateAsync({ note: note || undefined }), (n) => navigate(`/stock-opnames/${n.id}`))} />
      )}
      {editing && <OpnameOrderForm existing={o} onClose={() => setEditing(false)} />}
      {history && <CountHistory opnameId={o.id} line={history} onClose={() => setHistory(null)} />}
    </div>
  )
}

// ---------------------------------------------------------------- tabs

function AdjustmentsTab({ o }: { o: FlowOpname }) {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useOpnameAdjustments({ opname_id: o.id, page })
  return (
    <div className="space-y-2">
      <div className="flex justify-end"><ExportBar dataset="stock-opname-adjustments" filters={{ opname_id: o.id }} filenameBase={`adjustments-${o.number}`} viewPermission="report.opname" /></div>
      <div className="overflow-auto rounded-lg border bg-card">
        <table className="w-full min-w-[48rem] text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr><th className="px-3 py-2">Item</th><th className="px-3 py-2 text-right">Before</th><th className="px-3 py-2 text-right">After</th><th className="px-3 py-2 text-right">Adjustment</th><th className="px-3 py-2">Reason</th><th className="px-3 py-2">Approved</th><th className="px-3 py-2">Ledger</th></tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">Loading…</td></tr>}
            {!isLoading && !data?.data.length && <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">{['POSTED', 'DONE'].includes(o.flow_status) ? 'No variance was posted.' : 'Nothing is posted before approval.'}</td></tr>}
            {data?.data.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2"><div className="text-[13px] text-muted-foreground">{r.item_code}</div>{r.description}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtQty(r.qty_before)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtQty(r.qty_after)}</td>
                <td className="px-3 py-2 text-right"><VarianceValue value={r.difference} /></td>
                <td className="px-3 py-2">{r.reason}</td>
                <td className="px-3 py-2 text-xs">{r.approved_by}<div className="text-muted-foreground">{fmtDateTime(r.approved_at)}</div></td>
                <td className="px-3 py-2 text-xs text-muted-foreground">#{r.movement_id ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && data.meta.last_page > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span>Page {page} / {data.meta.last_page}</span>
          <Button size="sm" variant="outline" disabled={page >= data.meta.last_page} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
      {o.posting_batch && <p className="text-xs text-muted-foreground">Posting batch {o.posting_batch}</p>}
    </div>
  )
}

export const EVENT_LABELS: Record<string, string> = {
  CREATED: 'Created', UPDATED: 'Edited', LINES_ADDED: 'Items added', LINE_REMOVED: 'Item removed', CONFIRMED: 'Confirmed',
  COUNT_STARTED: 'Counting started (book qty frozen)', COUNT_FINISHED: 'Counting finished', RECOUNT_REQUESTED: 'Recount requested',
  RECOUNT_FINISHED: 'Recount finished', REVIEW_SAVED: 'Review saved', APPROVAL_REQUESTED: 'Sent for approval', APPROVED: 'Approved',
  REJECTED: 'Rejected by supervisor', POSTED: 'Posted to Stock Ledger', CLOSED: 'Done', CANCELLED: 'Cancelled',
  CORRECTION_CREATED: 'Correction created',
}

function HistoryTab({ o }: { o: FlowOpname }) {
  const { data, isLoading } = useOpnameEvents(o.id)
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <ol className="space-y-0 rounded-lg border bg-card p-4">
        {isLoading && <li className="text-sm text-muted-foreground">Loading…</li>}
        {data?.map((e) => (
          <li key={e.id} className="relative border-l pb-4 pl-4 last:pb-0">
            <span className={cn('absolute -left-[5px] top-1 size-2.5 rounded-full', ['REJECTED', 'CANCELLED'].includes(e.event) ? 'bg-red-500' : ['POSTED', 'APPROVED', 'CLOSED'].includes(e.event) ? 'bg-emerald-500' : 'bg-primary')} />
            <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <b>{EVENT_LABELS[e.event] ?? e.event}</b>
              {e.from_status && e.to_status && e.from_status !== e.to_status && <span className="text-xs text-muted-foreground">{FLOW[e.from_status]?.label ?? e.from_status} → {FLOW[e.to_status]?.label ?? e.to_status}</span>}
            </div>
            <div className="text-xs text-muted-foreground">{e.user ?? 'System'} · {fmtDateTime(e.at)}</div>
            {e.note && <div className="mt-1 rounded bg-muted/60 px-2 py-1 text-sm">{e.note}</div>}
            {e.meta && typeof e.meta.adjusted_lines === 'number' && <div className="mt-1 text-xs text-muted-foreground">{String(e.meta.adjusted_lines)} adjustments</div>}
          </li>
        ))}
      </ol>
      <dl className="space-y-1 rounded-lg border bg-card p-4 text-sm">
        <div className="mb-2 font-medium">Approval</div>
        <Field label="Created">{o.created_by} · {fmtDateTime(o.created_at)}</Field>
        <Field label="Counting">{o.counter ?? '—'} · {fmtDateTime(o.started_at)}</Field>
        <Field label="Reviewed">{o.reviewer ?? '—'} · {fmtDateTime(o.reviewed_at)}</Field>
        <Field label="Approved">{o.approver ?? '—'} · {fmtDateTime(o.approved_at)}</Field>
        {o.approval_note && <Field label="Supervisor note">{o.approval_note}</Field>}
        <Field label="Posted">{o.poster ?? '—'} · {fmtDateTime(o.posted_at)}</Field>
        <Field label="Closed">{fmtDateTime(o.closed_at)}</Field>
      </dl>
    </div>
  )
}
