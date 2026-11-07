import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AlertTriangle, Check, CheckCircle2, Info, Loader2, Printer, Search } from 'lucide-react'
import { useOpname, useOpnameMutations, useOpnameUsage, type Opname, type OpnameLine, type UsagePeriod } from '@/features/opname/api'
import { OPNAME_STEPS, OpnameStatusBadge, REVIEW_LABELS, isFromAccurate, typeLabel } from '@/features/opname/status'
import { useAuth } from '@/auth/AuthContext'
import { api, apiErrorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useInfiniteSlice } from '@/components/InfiniteRows'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Textarea } from '@/components/ui/textarea'
import { ItemUsageCount } from '@/components/ItemUsageCount'
import { UsagePeriodFilter, usagePeriodLabel } from '@/components/UsagePeriodFilter'
import { BackLink } from '@/components/BackLink'
import { DetailFallback } from '@/components/DetailFallback'

const PAGE_SIZE = 50

type Filter = 'all' | 'uncounted' | 'counted' | 'diff' | 'recount'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

function fmtDateTime(v: string | null) {
  return v ? new Date(v).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
}

const hasDiff = (l: OpnameLine) => l.match_status === 'INVALID'

/** Moves focus to the next row's quantity field (Enter while counting). */
function focusNextQty(current: HTMLElement) {
  const all = Array.from(document.querySelectorAll<HTMLInputElement>('input[data-qty-input]')).filter((el) => el.offsetParent !== null)
  const i = all.indexOf(current as HTMLInputElement)
  all[i + 1]?.focus()
  all[i + 1]?.select()
}

// ---------------------------------------------------------------- stepper

function Stepper({ o }: { o: Opname }) {
  const recount = o.status === 'RECOUNT_REQUIRED'
  const current = recount ? 1 : OPNAME_STEPS.findIndex((s) => s.status === o.status)

  return (
    <ol className="grid grid-cols-4 gap-1 sm:gap-2">
      {OPNAME_STEPS.map((s, i) => {
        const done = i < current || o.status === 'COMPLETED'
        const active = i === current && o.status !== 'COMPLETED'
        return (
          <li key={s.status} className="flex flex-col items-center gap-1 text-center">
            <div className="flex w-full items-center">
              <div className={cn('h-0.5 flex-1', i === 0 ? 'invisible' : done || active ? 'bg-primary' : 'bg-border')} />
              <span
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold',
                  done && 'border-primary bg-primary text-primary-foreground',
                  active && (recount ? 'border-red-500 text-red-600' : 'border-primary text-primary'),
                  !done && !active && 'border-border text-muted-foreground',
                )}
              >
                {done ? <Check className="size-4" /> : i + 1}
              </span>
              <div className={cn('h-0.5 flex-1', i === OPNAME_STEPS.length - 1 ? 'invisible' : done ? 'bg-primary' : 'bg-border')} />
            </div>
            <span className={cn('text-[11px] sm:text-xs', active ? 'font-semibold' : 'text-muted-foreground')}>
              {active && recount ? 'Recount' : s.label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

// ---------------------------------------------------------------- row editing

interface RowProps {
  /** period of the NPBG / PPB counts, for their links */
  period?: UsagePeriod
  line: OpnameLine
  /** Accurate mirror: before/after/difference of the adjustment, no note/review columns */
  accurate: boolean
  showSystemQty: boolean
  editable: boolean
  reviewable: boolean
  decision: string
  onDecision: (d: string) => void
  onSave: (physical: number, note?: string) => Promise<unknown>
}

/** Local input state + save-on-leave with a visible per-row save status. */
function useLineEditor(line: OpnameLine, onSave: RowProps['onSave']) {
  const [physical, setPhysical] = useState(line.physical_qty?.toString() ?? '')
  const [note, setNote] = useState(line.note ?? '')
  const [state, setState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (physical === '') return
    const qty = Number(physical)
    if (Number.isNaN(qty) || qty < 0) {
      setState('error')
      setError('The quantity must be a number ≥ 0')
      return
    }
    if (qty === line.physical_qty && (note || null) === (line.note || null)) return
    setState('saving')
    setError(null)
    try {
      await onSave(qty, note.trim() || undefined)
      setState('saved')
    } catch (e) {
      setState('error')
      setError(apiErrorMessage(e))
    }
  }

  return { physical, setPhysical, note, setNote, state, error, save }
}

function SaveIndicator({ state, error, counted }: { state: SaveState; error: string | null; counted: boolean }) {
  if (state === 'saving') return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Saving</span>
  if (state === 'error') return <span className="text-xs text-destructive">{error ?? 'Failed to save'}</span>
  if (state === 'saved' || counted) return <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="size-3" /> Saved</span>
  return <span className="text-xs text-muted-foreground">Not filled</span>
}

function MatchCell({ line, accurate }: { line: OpnameLine; accurate?: boolean }) {
  if (accurate) {
    const d = Number(line.difference ?? 0)
    if (Math.abs(d) < 0.001) return <span className="text-muted-foreground">0</span>
    return <span className={cn('font-semibold tabular-nums', d > 0 ? 'text-emerald-600' : 'text-red-600')}>{line.diff_label}</span>
  }
  if (!line.match_status) return <span className="text-muted-foreground">—</span>
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {line.match_status === 'VALID' ? <Badge variant="success">Matches</Badge> : <Badge variant="danger">Difference</Badge>}
      {line.match_status === 'INVALID' && <span className="text-xs font-medium text-amber-700">{line.diff_label}</span>}
    </div>
  )
}

function ReviewCell({ line, reviewable, decision, onDecision }: Pick<RowProps, 'line' | 'reviewable' | 'decision' | 'onDecision'>) {
  if (reviewable) {
    return (
      <select
        className="h-9 w-full rounded-md border border-input bg-card px-2 text-base sm:text-sm"
        value={decision}
        onChange={(e) => onDecision(e.target.value)}
      >
        <option value="APPROVED">Approve</option>
        <option value="RECOUNT">Recount</option>
        <option value="REJECTED">Reject</option>
      </select>
    )
  }
  const r = REVIEW_LABELS[line.review_status] ?? { label: line.review_status, variant: 'neutral' as const }
  return <Badge variant={r.variant}>{r.label}</Badge>
}

function LineRow(p: RowProps) {
  const { line } = p
  const ed = useLineEditor(line, p.onSave)

  return (
    <tr className={cn('border-t align-top', p.reviewable && p.decision !== 'APPROVED' && 'bg-amber-50/60 dark:bg-amber-500/5')}>
      <td className="px-3 py-2">
        <div className="text-[13px] text-muted-foreground">{line.item_code}</div>
        <div>{line.description}</div>
      </td>
      <td className="px-3 py-2 text-right"><ItemUsageCount kind="npbg" code={line.item_code} count={line.npbg_count} period={p.period} /></td>
      <td className="px-3 py-2 text-right"><ItemUsageCount kind="ppb" code={line.item_code} count={line.ppb_count} period={p.period} /></td>
      {p.showSystemQty && <td className="px-3 py-2 text-right tabular-nums">{line.system_qty}</td>}
      <td className="px-3 py-2">
        {p.editable ? (
          <div className="space-y-1">
            <Input
              data-qty-input
              type="number"
              inputMode="decimal"
              min={0}
              className="h-9 w-28"
              value={ed.physical}
              onChange={(e) => ed.setPhysical(e.target.value)}
              onBlur={ed.save}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), focusNextQty(e.currentTarget))}
            />
            <SaveIndicator state={ed.state} error={ed.error} counted={line.count_status === 'COUNTED'} />
          </div>
        ) : (
          <span className="tabular-nums">{line.physical_qty ?? '—'}</span>
        )}
      </td>
      {p.showSystemQty && <td className="px-3 py-2"><MatchCell line={line} accurate={p.accurate} /></td>}
      {!p.accurate && <td className="px-3 py-2">
        {p.editable ? (
          <Input
            className="h-9"
            placeholder="Reason if the quantity differs"
            value={ed.note}
            onChange={(e) => ed.setNote(e.target.value)}
            onBlur={ed.save}
          />
        ) : (
          <span className={cn(!line.note && 'text-muted-foreground')}>{line.note ?? '—'}</span>
        )}
      </td>}
      {!p.accurate && <td className="px-3 py-2"><ReviewCell {...p} /></td>}
    </tr>
  )
}

function LineCard(p: RowProps) {
  const { line } = p
  const ed = useLineEditor(line, p.onSave)

  return (
    <div className={cn('space-y-2 rounded-lg border bg-card p-3', p.reviewable && p.decision !== 'APPROVED' && 'border-amber-300')}>
      <div>
        <div className="text-[13px] text-muted-foreground">{line.item_code}</div>
        <div className="text-sm font-medium">{line.description}</div>
        <div className="mt-0.5 flex gap-4 text-xs">
          <span><span className="text-muted-foreground">Delivery Order:</span> <ItemUsageCount kind="npbg" code={line.item_code} count={line.npbg_count} period={p.period} /></span>
          <span><span className="text-muted-foreground">Purchase Request:</span> <ItemUsageCount kind="ppb" code={line.item_code} count={line.ppb_count} period={p.period} /></span>
        </div>
      </div>
      {p.showSystemQty && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span><span className="text-muted-foreground">{p.accurate ? 'Before' : 'System'}:</span> <b className="tabular-nums">{line.system_qty}</b></span>
          {!p.editable && <span><span className="text-muted-foreground">{p.accurate ? 'After' : 'Physical'}:</span> <b className="tabular-nums">{line.physical_qty ?? '—'}</b></span>}
          <MatchCell line={line} accurate={p.accurate} />
        </div>
      )}
      {p.editable ? (
        <div className="grid grid-cols-[7rem_1fr] gap-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Physical quantity</label>
            <Input
              data-qty-input
              type="number"
              inputMode="decimal"
              min={0}
              value={ed.physical}
              onChange={(e) => ed.setPhysical(e.target.value)}
              onBlur={ed.save}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), focusNextQty(e.currentTarget))}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Notes</label>
            <Input placeholder="Reason if different" value={ed.note} onChange={(e) => ed.setNote(e.target.value)} onBlur={ed.save} />
          </div>
          <div className="col-span-2"><SaveIndicator state={ed.state} error={ed.error} counted={line.count_status === 'COUNTED'} /></div>
        </div>
      ) : (
        <>
          {!p.showSystemQty && <div className="text-sm"><span className="text-muted-foreground">Physical:</span> <b>{line.physical_qty ?? '—'}</b></div>}
          {line.note && <div className="text-sm"><span className="text-muted-foreground">Notes:</span> {line.note}</div>}
        </>
      )}
      {!p.accurate && (p.reviewable || line.review_status !== 'PENDING') && (
        <div className="flex items-center gap-2 text-sm">
          <span className="shrink-0 text-muted-foreground">Review:</span>
          <div className="flex-1"><ReviewCell {...p} /></div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- page

export function OpnameDetailPage() {
  const { id } = useParams()
  const opnameId = Number(id)
  const { hasPermission } = useAuth()
  const { data: o, isLoading } = useOpname(opnameId)
  const m = useOpnameMutations(opnameId)
  const [err, setErr] = useState<string | null>(null)
  const [decisions, setDecisions] = useState<Record<number, string>>({})
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [printing, setPrinting] = useState(false)
  const [confirmSubmit, setConfirmSubmit] = useState(false)
  const [confirmReview, setConfirmReview] = useState(false)
  const [reviewNote, setReviewNote] = useState('')
  // NPBG / PPB columns: all time unless a period is picked
  const [period, setPeriod] = useState<UsagePeriod>({})
  const usage = useOpnameUsage(opnameId, period)

  // Blind count: only a reviewer sees system_qty / the match verdict (the API omits them otherwise).
  const canSeeSystemQty = hasPermission('opname.review')

  const allItems = useMemo(() => o?.items ?? [], [o])
  const stats = useMemo(() => {
    const counted = allItems.filter((l) => l.count_status === 'COUNTED').length
    return {
      total: allItems.length,
      counted,
      uncounted: allItems.length - counted,
      diff: allItems.filter(hasDiff).length,
      recount: allItems.filter((l) => l.review_status === 'RECOUNT').length,
    }
  }, [allItems])

  // A FULL opname can hold thousands of lines -> filter/page on the client.
  const filteredItems = useMemo(() => {
    const s = search.trim().toLowerCase()
    return allItems.filter((l) => {
      if (filter === 'uncounted' && l.count_status === 'COUNTED') return false
      if (filter === 'counted' && l.count_status !== 'COUNTED') return false
      if (filter === 'diff' && !hasDiff(l)) return false
      if (filter === 'recount' && l.review_status !== 'RECOUNT') return false
      if (!s) return true
      return (l.item_code ?? '').toLowerCase().includes(s) || (l.description ?? '').toLowerCase().includes(s)
    })
  }, [allItems, search, filter])
  // shown in growing chunks while scrolling (all lines are already loaded)
  const { rows: pageItems, footer: itemsFooter } = useInfiniteSlice(filteredItems, PAGE_SIZE, `${search}|${filter}`)

  async function printOpname() {
    setPrinting(true)
    setErr(null)
    try {
      const res = await api.get(`/api/stock-opnames/${opnameId}/print`, { responseType: 'blob' })
      window.open(URL.createObjectURL(res.data as Blob), '_blank')
    } catch (e) {
      setErr(apiErrorMessage(e))
    } finally {
      setPrinting(false)
    }
  }

  if (isLoading || !o) return <div className="space-y-4"><BackLink to="/stock-opnames" label="Physical Inventory List" /><DetailFallback loading={isLoading} /></div>

  const fromAccurate = isFromAccurate(o)
  const onErr = (e: unknown) => setErr(apiErrorMessage(e))
  const canStart = !fromAccurate && (o.status === 'SCHEDULED' || o.status === 'RECOUNT_REQUIRED') && hasPermission('opname.count')
  const editable = !fromAccurate && o.status === 'IN_PROGRESS' && hasPermission('opname.count')
  const canSubmit = !fromAccurate && o.status === 'IN_PROGRESS' && hasPermission('opname.submit')
  const reviewable = !fromAccurate && o.status === 'PENDING_REVIEW' && hasPermission('opname.approve')
  const pct = stats.total ? Math.round((stats.counted / stats.total) * 100) : 0

  const decisionOf = (l: OpnameLine) => decisions[l.id] ?? 'APPROVED'
  const reviewSummary = {
    approvedDiff: allItems.filter((l) => decisionOf(l) === 'APPROVED' && hasDiff(l)).length,
    recount: allItems.filter((l) => decisionOf(l) === 'RECOUNT').length,
    rejected: allItems.filter((l) => decisionOf(l) === 'REJECTED').length,
  }
  const setAll = (d: string, only?: (l: OpnameLine) => boolean) =>
    setDecisions(Object.fromEntries(allItems.map((l) => [l.id, only && !only(l) ? decisionOf(l) : d])))

  const showFilter = (f: Filter) => {
    setFilter(f)
  }

  // --- "what to do next" callout
  let next: { tone: 'info' | 'warn' | 'done'; text: React.ReactNode; action?: React.ReactNode } | null = null
  if (fromAccurate) {
    next = {
      tone: 'info',
      text: (
        <>
          This stock opname comes from <b>Accurate</b> (read-only). Changes are made in Accurate.
          {o.accurate_synced_at && <> Last sync: {fmtDateTime(o.accurate_synced_at)}.</>}
        </>
      ),
    }
  } else if (o.status === 'SCHEDULED') {
    next = canStart
      ? { tone: 'info', text: <>Opname scheduled. Click <b>Start Counting</b> when staff are ready to count in the warehouse.</>, action: <Button onClick={() => m.start.mutate(undefined, { onError: onErr })} disabled={m.start.isPending}>Start Counting</Button> }
      : { tone: 'info', text: 'Waiting for warehouse staff to start counting.' }
  } else if (o.status === 'RECOUNT_REQUIRED') {
    next = {
      tone: 'warn',
      text: <>The warehouse admin requests <b>{stats.recount} items</b> recalculated. {canStart ? <>Click <b>Start Recount</b>, then correct the quantity.</> : 'Waiting for staff to recount.'}</>,
      action: canStart ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => showFilter('recount')}>View the items</Button>
          <Button onClick={() => m.start.mutate(undefined, { onError: onErr })} disabled={m.start.isPending}>Start Recount</Button>
        </div>
      ) : <Button variant="outline" onClick={() => showFilter('recount')}>View the items</Button>,
    }
  } else if (o.status === 'IN_PROGRESS') {
    next = stats.uncounted > 0
      ? {
          tone: 'info',
          text: <>Fill <b>physical quantity</b> each item; saves automatically when moving columns (press <b>Enter</b> to go to the next item). Still <b>{stats.uncounted} items</b> not filled.</>,
          action: <Button variant="outline" onClick={() => showFilter('uncounted')}>Show unfilled</Button>,
        }
      : {
          tone: 'done',
          text: canSubmit
            ? <>All items filled. Make sure items with a different quantity have a <b>notes</b>, then send for review.</>
            : 'All items filled. Waiting to be sent for review.',
          action: canSubmit ? <Button onClick={() => setConfirmSubmit(true)}>Send for Review</Button> : undefined,
        }
  } else if (o.status === 'PENDING_REVIEW') {
    next = reviewable
      ? {
          tone: 'warn',
          text: <>Check the count results. All items automatically <b>Approved</b>; change to <b>Recount</b> or <b>Reject</b> if needed. {stats.diff > 0 && <><b>{stats.diff} items</b> difference; if approved, stock is adjusted to the physical quantity.</>}</>,
          action: (
            <div className="flex flex-wrap gap-2">
              {stats.diff > 0 && <Button variant="outline" onClick={() => showFilter('diff')}>View differences</Button>}
              <Button onClick={() => setConfirmReview(true)}>Finish Review</Button>
            </div>
          ),
        }
      : { tone: 'info', text: 'Count result already sent, waiting for warehouse admin review.' }
  } else if (o.status === 'COMPLETED') {
    next = { tone: 'done', text: 'Stock opname finished. Approved differences have adjusted the stock.' }
  }

  const periodOn = !!(period.from || period.to)
  const rowProps = (l: OpnameLine): RowProps => ({
    line: periodOn && l.item_code
      ? { ...l, npbg_count: usage.data?.[l.item_code]?.npbg, ppb_count: usage.data?.[l.item_code]?.ppb }
      : l,
    period,
    accurate: fromAccurate,
    showSystemQty: canSeeSystemQty,
    editable,
    reviewable,
    decision: decisionOf(l),
    onDecision: (d) => setDecisions((s) => ({ ...s, [l.id]: d })),
    onSave: (physical_qty, note) => m.count.mutateAsync({ lineId: l.id, physical_qty, note }),
  })

  const filterChips: Array<{ key: Filter; label: string; count: number; show: boolean }> = [
    { key: 'all', label: 'All', count: stats.total, show: true },
    { key: 'uncounted', label: 'Not filled', count: stats.uncounted, show: !fromAccurate },
    { key: 'counted', label: 'Filled', count: stats.counted, show: !fromAccurate },
    { key: 'diff', label: 'Difference', count: stats.diff, show: canSeeSystemQty },
    { key: 'recount', label: 'Recount', count: stats.recount, show: stats.recount > 0 },
  ]

  return (
    <div className="space-y-4">
      <BackLink to="/stock-opnames" label="Physical Inventory List" />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-all text-xl font-semibold tracking-tight">{o.number}</h1>
          <p className="text-sm text-muted-foreground">
            Warehouse {o.warehouse?.code ?? '—'} · {fromAccurate ? 'From Accurate' : typeLabel(o.type)} · {stats.total} items
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <OpnameStatusBadge opname={o} />
          <Button size="sm" variant="outline" disabled={printing} onClick={printOpname}>
            <Printer className="size-4" /> {printing ? 'Preparing…' : o.status === 'SCHEDULED' ? 'Print Count Sheet' : 'Print'}
          </Button>
        </div>
      </div>

      {!fromAccurate && (
        <Card><CardContent className="p-4"><Stepper o={o} /></CardContent></Card>
      )}

      {next && (
        <div
          className={cn(
            'flex flex-col gap-3 rounded-lg border p-4 text-sm sm:flex-row sm:items-center sm:justify-between',
            next.tone === 'warn' && 'border-amber-300 bg-amber-50 dark:bg-amber-500/10',
            next.tone === 'done' && 'border-emerald-300 bg-emerald-50 dark:bg-emerald-500/10',
            next.tone === 'info' && 'bg-primary/5',
          )}
        >
          <div className="flex items-start gap-2">
            {next.tone === 'warn' ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
              : next.tone === 'done' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              : <Info className="mt-0.5 size-4 shrink-0 text-primary" />}
            <div>{next.text}</div>
          </div>
          {next.action && <div className="shrink-0">{next.action}</div>}
        </div>
      )}

      {err && <p className="whitespace-pre-line rounded-md bg-destructive/10 p-3 text-sm text-destructive">{err}</p>}

      {!fromAccurate && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Count progress</span>
              <span className="tabular-nums text-muted-foreground">{stats.counted}/{stats.total} items · {pct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className={cn('h-full rounded-full transition-all', pct === 100 ? 'bg-emerald-500' : 'bg-primary')} style={{ width: `${pct}%` }} />
            </div>
            <div className="grid grid-cols-2 gap-3 border-t pt-3 text-sm sm:grid-cols-4">
              <div>
                <div className="text-xs text-muted-foreground">Scheduled</div>
                <div>{fmtDateTime(o.created_at)}</div>
                {o.scheduled_by && <div className="text-xs text-muted-foreground">by {o.scheduled_by}</div>}
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Start counting</div>
                <div>{fmtDateTime(o.started_at)}</div>
                {o.counter && <div className="text-xs text-muted-foreground">by {o.counter}</div>}
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Sent for review</div>
                <div>{fmtDateTime(o.submitted_at)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">In review</div>
                <div>{fmtDateTime(o.reviewed_at)}</div>
                {o.reviewer && <div className="text-xs text-muted-foreground">by {o.reviewer}</div>}
              </div>
            </div>
            {o.review_note && <div className="rounded-md bg-muted/50 p-2 text-sm"><span className="text-muted-foreground">Review notes:</span> {o.review_note}</div>}
          </CardContent>
        </Card>
      )}

      {/* filters */}
      <div className="space-y-2">
        <UsagePeriodFilter value={period} onChange={setPeriod} />
        <div className="inline-flex flex-wrap gap-0.5 rounded-lg border bg-card p-0.5">
          {filterChips.filter((c) => c.show).map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => showFilter(c.key)}
              className={cn(
                'rounded-md px-3 py-1 text-sm transition-colors',
                filter === c.key ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {c.label} <span className="tabular-nums opacity-75">({c.count})</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search item code / name…" value={search} onChange={(e) => { setSearch(e.target.value) }} />
          </div>
          {reviewable && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setAll('APPROVED')}>Approve all</Button>
              {stats.diff > 0 && <Button size="sm" variant="outline" onClick={() => setAll('RECOUNT', hasDiff)}>Recount all differences</Button>}
            </div>
          )}
        </div>
      </div>

      {/* desktop / tablet: table */}
      {/* the table scrolls inside itself; more lines appear at its bottom */}
      <div className="hidden max-h-[70vh] overflow-auto rounded-lg border bg-card md:block">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-left">
            <tr>
              <th className="px-3 py-2 font-medium text-muted-foreground">Item</th>
 <th className="w-16 px-3 py-2 text-right font-medium text-muted-foreground" title={`Delivery Order rows (items out) for this item ${usagePeriodLabel(period)}`}>Delivery Order</th>
 <th className="w-16 px-3 py-2 text-right font-medium text-muted-foreground" title={`Purchase Request rows (purchase requests) for this item ${usagePeriodLabel(period)}`}>Purchase Request</th>
              {canSeeSystemQty && <th className="w-28 whitespace-nowrap px-3 py-2 text-right font-medium text-muted-foreground">{fromAccurate ? 'Qty before' : 'System stock'}</th>}
              <th className="w-36 whitespace-nowrap px-3 py-2 font-medium text-muted-foreground">{fromAccurate ? 'Qty after' : 'Physical quantity'}</th>
              {canSeeSystemQty && <th className="w-40 px-3 py-2 font-medium text-muted-foreground">{fromAccurate ? 'Difference' : 'Result'}</th>}
              {!fromAccurate && <th className="w-56 px-3 py-2 font-medium text-muted-foreground">Notes</th>}
              {!fromAccurate && <th className="w-40 px-3 py-2 font-medium text-muted-foreground">Review</th>}
            </tr>
          </thead>
          <tbody>
            {pageItems.length === 0 && (
              <tr><td colSpan={(canSeeSystemQty ? 6 : 4) + (fromAccurate ? 0 : 2)} className="px-3 py-8 text-center text-muted-foreground">No items for this filter.</td></tr>
            )}
            {pageItems.map((l) => <LineRow key={l.id} {...rowProps(l)} />)}
          </tbody>
        </table>
        <div className="border-t">{itemsFooter}</div>
      </div>

      {/* phone: cards (scroll inside their own box too) */}
      <div className="max-h-[75vh] space-y-2 overflow-y-auto md:hidden">
        {pageItems.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No items for this filter.</p>}
        {pageItems.map((l) => <LineCard key={l.id} {...rowProps(l)} />)}
        {itemsFooter}
      </div>

      {/* sticky action bar while counting / reviewing, so the main button is always reachable */}
      {(canSubmit || reviewable) && (
        <div className="sticky bottom-0 z-20 -mx-3 flex items-center justify-between gap-2 border-t bg-card/95 px-3 py-2 backdrop-blur sm:-mx-6 sm:px-6">
          <span className="text-sm text-muted-foreground">
            {canSubmit ? <><b className="text-foreground">{stats.counted}/{stats.total}</b> filled</> : <><b className="text-foreground">{reviewSummary.recount + reviewSummary.rejected}</b> tagged</>}
          </span>
          {canSubmit ? (
            <Button onClick={() => setConfirmSubmit(true)} disabled={m.submit.isPending}>Send for Review</Button>
          ) : (
            <Button onClick={() => setConfirmReview(true)} disabled={m.review.isPending}>Finish Review</Button>
          )}
        </div>
      )}

      {confirmSubmit && (
        <Modal
          open
          onClose={() => setConfirmSubmit(false)}
          title="Send the count result for review?"
          description="Once sent, quantities cannot change unless the admin asks for a recount."
          footer={
            <>
              <Button variant="outline" size="sm" onClick={() => setConfirmSubmit(false)}>Check again</Button>
              <Button
                size="sm"
                disabled={stats.uncounted > 0 || m.submit.isPending}
                onClick={() => m.submit.mutate(undefined, { onSuccess: () => setConfirmSubmit(false), onError: (e) => { setConfirmSubmit(false); onErr(e) } })}
              >
                {m.submit.isPending ? 'Sending…' : 'Yes, send'}
              </Button>
            </>
          }
        >
          <div className="space-y-2 text-sm">
            <p>Filled: <b>{stats.counted}</b> from <b>{stats.total}</b> items.</p>
            {stats.uncounted > 0 && (
              <p className="rounded-md bg-destructive/10 p-2 text-destructive">
                Still {stats.uncounted} items not filled. Fill all of them before sending.
              </p>
            )}
          </div>
        </Modal>
      )}

      {confirmReview && (
        <Modal
          open
          onClose={() => setConfirmReview(false)}
          title="Finish the review?"
          footer={
            <>
              <Button variant="outline" size="sm" onClick={() => setConfirmReview(false)}>Cancel</Button>
              <Button
                size="sm"
                disabled={m.review.isPending}
                onClick={() =>
                  m.review.mutate(
                    { decisions: allItems.map((l) => ({ id: l.id, decision: decisionOf(l) })), note: reviewNote.trim() || undefined },
                    { onSuccess: () => setConfirmReview(false), onError: (e) => { setConfirmReview(false); onErr(e) } },
                  )
                }
              >
                {m.review.isPending ? 'Saving…' : 'Yes, finish'}
              </Button>
            </>
          }
        >
          <div className="space-y-3 text-sm">
            <ul className="space-y-1">
              <li>• <b>{reviewSummary.approvedDiff}</b> items with approved differences → <b>stock adjusted</b> to the physical quantity.</li>
              <li>• <b>{reviewSummary.recount}</b> items requested <b>recount</b>{reviewSummary.recount > 0 && ' → opname returns to the counter'}.</li>
              <li>• <b>{reviewSummary.rejected}</b> items rejected → stock unchanged.</li>
            </ul>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Review notes (optional)</label>
              <Textarea rows={2} maxLength={255} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
