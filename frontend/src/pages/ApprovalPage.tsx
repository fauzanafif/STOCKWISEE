import { useEffect, useMemo, useState } from 'react'
import { PpbReference } from '@/components/PpbReference'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckCheck, CheckCircle2, ChevronDown, ClipboardCheck, ExternalLink, FileText, Inbox, Loader2, PackageCheck, Search, ShoppingCart, Undo2, XCircle } from 'lucide-react'
import { apiErrorMessage } from '@/lib/api'
import { useAuth } from '@/auth/AuthContext'
import { useApprovals, usePurchasingApprovals, type ApprovalRow } from '@/features/itemRequests/api'
import { useDecidePpb, usePpb } from '@/features/ppb/api'
import { usePo, usePoAction } from '@/features/purchasing/api'
import { useDecideNpbg, useNpbg } from '@/features/npbg/api'
import { ApprovalActions, type HandoverDraft } from '@/components/itemRequests/ApprovalActions'
import { isAutoApproval, stepText } from '@/lib/approval'
import { RequestStatusBadge } from '@/pages/ItemRequestListPage'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { askedQty } from '@/lib/askedText'
import { DirectorPickTag } from '@/components/DirectorPickTag'
import { toast } from '@/lib/notify'
import { LineImagesCell, RequestImages } from '@/components/itemRequests/RequestImages'

const fmtQty = (n: number | string | null | undefined) => (n == null ? '' : Number(n).toLocaleString('id-ID', { maximumFractionDigits: 2 }))
const rupiah = (n: number) => 'Rp ' + Number(n).toLocaleString('id-ID')
const fmtDate = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '')

/** How long a task has waited — the inbox sorts and colours by it (SAP Fiori "My Inbox" style). */
function age(v: string | null | undefined): { text: string; late: boolean } {
  if (!v) return { text: '', late: false }
  const days = Math.floor((Date.now() - new Date(v).getTime()) / 86_400_000)
  return { text: days <= 0 ? 'today' : `${days} days`, late: days >= 3 }
}

type Kind = 'REQUEST' | 'GUDANG' | 'NPBG' | 'PPB' | 'PO'

/** One thing waiting for this user, whatever document it is. */
interface Task {
  key: string
  kind: Kind
  id: number
  number: string
  title: string
  subtitle: string
  stage: string
  date: string | null
  urgent: boolean
  amount?: number
  preview: string
  request?: ApprovalRow
}

/** Each module: what the user decides there, in a few words (the cards and the group headings). */
const KIND: Record<Kind, { label: string; what: string; icon: typeof FileText; tone: string; edge: string }> = {
  REQUEST: { label: 'Item Request', what: 'Approve the items and quantities asked', icon: ClipboardCheck, tone: 'bg-blue-50 text-blue-700', edge: 'border-blue-300' },
  GUDANG: { label: 'Warehouse Handover', what: 'Prepare the goods and hand them over', icon: PackageCheck, tone: 'bg-violet-50 text-violet-700', edge: 'border-violet-300' },
  NPBG: { label: 'Delivery Order', what: 'Approve a Delivery Order already submitted', icon: PackageCheck, tone: 'bg-teal-50 text-teal-700', edge: 'border-teal-300' },
  PPB: { label: 'Purchase Request', what: 'Approve what is going to be bought', icon: FileText, tone: 'bg-amber-50 text-amber-700', edge: 'border-amber-300' },
  PO: { label: 'Purchase Order', what: 'Approve the vendor, prices and total', icon: ShoppingCart, tone: 'bg-emerald-50 text-emerald-700', edge: 'border-emerald-300' },
}
const ORDER: Kind[] = ['REQUEST', 'GUDANG', 'NPBG', 'PPB', 'PO']

/**
 * Approval — ONE inbox for everything waiting for this user: Request Barang (Manajer / Direktur),
 * Gudang (siapkan barang / serah terima), PPB STOCKWISE (Manajer → Direktur) and PO STOCKWISE (Direktur).
 * List on the left, the document and its actions on the right (on a phone: one after the other).
 */
export function ApprovalPage() {
  const [params, setParams] = useSearchParams()
  const { hasPermission } = useAuth()
  const tab = params.get('tab') === 'done' ? 'done' : 'todo'
  const [kind, setKind] = useState<Kind | ''>('')
  const [search, setSearch] = useState('')
  const requests = useApprovals(tab)
  const buying = usePurchasingApprovals(tab === 'todo' && ['ppb.approve_manager', 'ppb.approve_director', 'po.approve_director', 'npbg.approve_manager', 'npbg.approve_director'].some((p) => hasPermission(p)))

  // a Direktur without the Manager right sees the Manager step too and may approve it straight away
  const bypassNpbg = hasPermission('npbg.approve_director') && !hasPermission('npbg.approve_manager')
  const bypassPpb = hasPermission('ppb.approve_director') && !hasPermission('ppb.approve_manager')
  const tasks = useMemo<Task[]>(() => {
    const out: Task[] = []
    for (const r of requests.data?.data ?? []) {
      const gudang = r.status === 'DISIAPKAN' || r.status === 'SIAP_DISERAHKAN'
      const lines = gudang ? r.lines.filter((l) => l.remaining > 0) : r.lines.filter((l) => l.decision === 'NPBG')
      out.push({
        key: `REQUEST-${r.id}`, kind: tab === 'todo' && gudang ? 'GUDANG' : 'REQUEST', id: r.id, number: r.number,
        title: r.requester_name ?? '-', subtitle: [r.form_label, r.divisi].filter(Boolean).join(' · '),
        stage: tab === 'todo' && r.status === 'APPROVAL_MANAGER' && r.approve_as === 'DIREKTUR' ? 'Director Approval (skips Manager)' : r.status_label,
        date: r.processed_at ?? r.created_at, urgent: r.urgency === 'URGENT',
        preview: lines.map((l) => `${l.deskripsi_barang} ${fmtQty(gudang ? l.remaining : l.approved_qty ?? l.qty)}${l.satuan ? ` ${l.satuan}` : ''}`).join(', '),
        request: r,
      })
    }
    for (const n of buying.data?.npbg ?? []) {
      out.push({ key: `NPBG-${n.id}`, kind: 'NPBG', id: n.id, number: n.no_npbg, title: n.peminta ?? n.pelanggan ?? 'Delivery Order', subtitle: [n.pelanggan, n.divisi].filter(Boolean).join(' · '),
        stage: n.step === 'DIREKTUR' ? 'Director Approval' : bypassNpbg ? 'Director Approval (skips Manager)' : 'Manager Approval', date: n.tgl_npbg, urgent: false, preview: n.items.join(', ') })
    }
    for (const d of buying.data?.ppb ?? []) {
      out.push({ key: `PPB-${d.id}`, kind: 'PPB', id: d.id, number: d.no_ppb, title: d.peminta ?? 'PPB', subtitle: [`${d.lines} items`, d.divisi].filter(Boolean).join(' · '),
        stage: d.step === 'DIREKTUR' ? 'Director Approval' : bypassPpb ? 'Director Approval (skips Manager)' : 'Manager Approval', date: d.tgl_ppb, urgent: false, preview: d.items.join(', ') })
    }
    for (const p of buying.data?.po ?? []) {
      out.push({ key: `PO-${p.id}`, kind: 'PO', id: p.id, number: p.number, title: p.vendor ?? 'PO', subtitle: `${p.items_count} items${p.off_pick ? ` · ${p.off_pick} not Director pick` : ''}${p.from_ppb ? ` · from Purchase Request ${p.from_ppb}` : ''}`,
        stage: 'Director Approval', date: p.date, urgent: false, amount: p.total, preview: `${rupiah(p.total)}${p.off_pick ? ` · ${p.off_pick} not Director pick` : ''}` })
    }
    // urgent first, then the oldest
    return out.sort((a, b) => Number(b.urgent) - Number(a.urgent) || (tab === 'done' ? -1 : 1) * String(a.date ?? '').localeCompare(String(b.date ?? '')))
  }, [requests.data, buying.data, tab, bypassNpbg, bypassPpb])

  const counts = useMemo(() => tasks.reduce((m, t) => ({ ...m, [t.kind]: (m[t.kind] ?? 0) + 1 }), {} as Partial<Record<Kind, number>>), [tasks])
  const shown = tasks.filter((t) => (!kind || t.kind === kind)
    && (!search.trim() || `${t.number} ${t.title} ${t.subtitle} ${t.preview}`.toLowerCase().includes(search.trim().toLowerCase())))

  // the open task: ?sel=KIND-id (or ?focus=<request id> from a notification)
  const focus = params.get('focus')
  const selKey = params.get('sel') ?? (focus ? `REQUEST-${focus}` : null)
  const selected = tasks.find((t) => t.key === selKey) ?? null
  const select = (key: string | null) => setParams((p) => { const n = new URLSearchParams(p); n.delete('focus'); if (key) n.set('sel', key); else n.delete('sel'); return n }, { replace: true })
  // desktop: keep something open
  // the first task as the list shows it (grouped per module)
  const firstShown = ORDER.flatMap((k) => shown.filter((t) => t.kind === k))[0]
  useEffect(() => {
    if (!selected && firstShown && window.matchMedia('(min-width: 1024px)').matches) select(firstShown.key)
  }, [selected, firstShown?.key]) // eslint-disable-line react-hooks/exhaustive-deps

  const loading = (requests.isLoading && !requests.data) || (buying.isLoading && !buying.data && buying.fetchStatus !== 'idle')

  return (
    <div className="space-y-4">
      <PageHeader title="Approval" icon={<ClipboardCheck className="size-5" />} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex w-fit rounded-lg border bg-muted/50 p-0.5" role="tablist">
          {([['todo', 'Action needed'], ['done', 'History']] as const).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k}
              onClick={() => { setParams(k === 'todo' ? {} : { tab: k }, { replace: true }); setKind('') }}
              className={cn('rounded-md px-3 py-1.5 text-sm font-medium transition-colors', tab === k ? 'bg-card text-foreground ring-1 ring-border' : 'text-muted-foreground hover:text-foreground')}>
              {label}{k === 'todo' && tab === 'todo' && tasks.length > 0 ? ` (${tasks.length})` : ''}
            </button>
          ))}
        </div>
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search number, name, item…" aria-label="Search" />
        </div>
      </div>

      {/* one card per module: what is decided there and how many wait — click to show only that module */}
      {tasks.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5" role="group" aria-label="Modules">
          {ORDER.filter((k) => counts[k]).map((k) => {
            const K = KIND[k]
            const on = kind === k
            return (
              <button key={k} type="button" onClick={() => setKind(on ? '' : k)} aria-pressed={on}
                className={cn('flex items-start gap-2.5 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/40', on && cn('ring-2 ring-primary/30', K.edge))}>
                <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-md', K.tone)}><K.icon className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{K.label}</span>
                    <span className="text-lg font-semibold tabular-nums">{counts[k]}</span>
                  </span>
                  <span className="block text-xs leading-snug text-muted-foreground">{K.what}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:items-start">
        {/* the inbox */}
        <Card className={cn('overflow-hidden', selected && 'hidden lg:block')}>
          {loading && (
            <ul className="divide-y" aria-busy="true" aria-label="Loading">
              {[0, 1, 2, 3].map((i) => (
                <li key={i} className="flex gap-3 px-4 py-3">
                  <span className="size-8 shrink-0 animate-pulse rounded-md bg-muted" />
                  <span className="flex-1 space-y-2 pt-0.5"><span className="block h-3.5 w-2/3 animate-pulse rounded bg-muted" /><span className="block h-3 w-1/3 animate-pulse rounded bg-muted" /><span className="block h-3 w-5/6 animate-pulse rounded bg-muted" /></span>
                </li>
              ))}
            </ul>
          )}
          {!loading && shown.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><CheckCheck className="size-6" /></span>
              <p className="font-medium">{tab === 'todo' ? 'All clear, nothing is waiting for you' : 'No history yet'}</p>
            </div>
          )}
          <div className="max-h-[calc(100vh-300px)] overflow-y-auto">
            {ORDER.filter((k) => shown.some((t) => t.kind === k)).map((k) => {
              const K = KIND[k]
              const rows = shown.filter((t) => t.kind === k)
              return (
                <section key={k} aria-label={K.label}>
                  {/* the module heading: sticky while its tasks scroll */}
                  <div className="sticky top-0 z-[1] flex items-center gap-2 border-b bg-muted/60 px-4 py-1.5 text-xs font-semibold text-foreground/80 backdrop-blur">
                    <K.icon className="size-3.5" /> {K.label} <span className="font-normal text-muted-foreground">· {rows.length}</span>
                  </div>
                  <ul className="divide-y">
                    {rows.map((t) => {
                      const a = age(t.date)
                      return (
                        <li key={t.key}>
                          <button type="button" onClick={() => select(t.key)}
                            className={cn('w-full px-4 py-2.5 text-left transition-colors hover:bg-muted/50', selected?.key === t.key && 'bg-primary/5 shadow-[inset_3px_0_0_hsl(var(--primary))]')}>
                            <span className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-sm font-medium">{t.number}</span>
                              {tab === 'todo' && a.text && <span className={cn('shrink-0 text-xs', a.late ? 'font-semibold text-red-600' : 'text-muted-foreground')}>{a.text}</span>}
                            </span>
                            <span className="block truncate text-[13px] text-muted-foreground">{t.title}{t.subtitle ? ` · ${t.subtitle}` : ''}</span>
                            <span className="mt-1 flex flex-wrap items-center gap-1.5">
                              <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground/80">{t.stage}</span>
                              {t.urgent && <span className="rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">Urgent</span>}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )
            })}
          </div>
        </Card>

        {/* the open document */}
        <div className={cn(!selected && 'hidden lg:block')}>
          {selected ? (
            <TaskDetail key={selected.key} task={selected} history={tab === 'done'} onBack={() => select(null)} onDone={() => select(null)} />
          ) : (
            <Card className="flex flex-col items-center gap-2 border-dashed py-24 text-center text-muted-foreground">
              <Inbox className="size-10 text-muted-foreground/50" />
              <p>Select a task on the left.</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

/** Header of a document (SAP object header): what, who, the stage, and the actions. */
function DetailHeader({ task, onBack, link, actions }: { task: Task; onBack: () => void; link: string; actions?: React.ReactNode }) {
  const K = KIND[task.kind]
  return (
    <div className="space-y-4 border-b p-4">
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground lg:hidden"><ArrowLeft className="size-4" /> Back</button>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {/* one line: module · number · who · what · stage */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', K.tone)} title={K.what}>{K.label}</span>
            <h2 className="text-lg font-semibold tracking-tight">{task.number}</h2>
            <span className="text-sm text-muted-foreground">· {task.title}{task.subtitle ? ` · ${task.subtitle}` : ''}</span>
            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800">{task.stage}</span>
            {task.urgent && <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-700">Urgent</span>}
          </div>
        </div>
        <Link to={link} className="inline-flex shrink-0 items-center gap-1 text-sm text-primary hover:underline">Open document <ExternalLink className="size-3.5" /></Link>
      </div>
      {actions}
    </div>
  )
}

/** The "Field: value" grid of an object page. */
function Facts({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className={cn('grid grid-cols-2 gap-x-4 gap-y-2 p-4 text-sm', items.length > 4 ? 'sm:grid-cols-3 lg:grid-cols-5' : 'sm:grid-cols-4')}>
      {items.map(([k, v]) => <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-medium">{v ?? ''}</dd></div>)}
    </dl>
  )
}

/** numericFrom: the first column of numbers (right-aligned); default the last two */
function LinesTable({ head, rows, numericFrom, rowClass }: { head: string[]; rows: React.ReactNode[][]; numericFrom?: number; rowClass?: (i: number) => string | false | undefined }) {
  const from = numericFrom ?? head.length - 2
  return (
    <div className="overflow-x-auto border-t">
      <table className="w-full text-sm">
        <thead className="whitespace-nowrap bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>{head.map((h, i) => <th key={h} className={cn('px-4 py-2 font-medium', i > 0 && i >= from && 'text-right')}>{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r, i) => <tr key={i} className={cn('align-top transition-colors', rowClass?.(i))}>{r.map((c, j) => <td key={j} className={cn('px-4 py-2.5', j > 0 && j >= from && 'whitespace-nowrap text-right tabular-nums')}>{c}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  )
}

function TaskDetail({ task, history, onBack, onDone }: { task: Task; history: boolean; onBack: () => void; onDone: () => void }) {
  if (task.kind === 'PPB') return <PpbDetail task={task} onBack={onBack} onDone={onDone} />
  if (task.kind === 'NPBG') return <NpbgDetail task={task} onBack={onBack} onDone={onDone} />
  if (task.kind === 'PO') return <PoDetail task={task} onBack={onBack} onDone={onDone} />
  const r = task.request!
  const gudang = task.kind === 'GUDANG'
  const lines = gudang ? r.lines.filter((l) => l.remaining > 0) : r.lines.filter((l) => l.decision === 'NPBG' || history)
  return <RequestDetail task={task} r={r} gudang={gudang} lines={lines} history={history} onBack={onBack} onDone={onDone} />
}

function RequestDetail({ task, r, gudang, lines, history, onBack, onDone }: {
  task: Task; r: ApprovalRow; gudang: boolean; lines: ApprovalRow['lines']; history: boolean; onBack: () => void; onDone: () => void
}) {
  // the inbox refreshes itself (stock included): when it last did
  const live = useApprovals(history ? 'done' : 'todo')
  // Gudang: what is handed over, fixed in the table before the serah terima
  const [draft] = useState<HandoverDraft>({ qty: {}, drop: {} })
  const openF = gudang && !history ? r.fulfillments?.find((f) => f.status !== 'DISERAHKAN') ?? null : null
  const waiting = openF ? lines.filter((l) => !openF.lines.some((fl) => fl.line_id === l.id)) : lines
  // Manager / Direktur do not change quantities: "Revisi" sends it to admin gudang to revise them
  const approvedOf = (l: ApprovalRow['lines'][number]) => Number(l.approved_qty ?? l.qty)
  // what the requester asked, in their own words: picking one lights up its verified items on the right
  const askedOf = (l: ApprovalRow['lines'][number]) => (l.deskripsi_peminta ?? l.deskripsi_barang ?? '').trim()
  const keyOf = (l: ApprovalRow['lines'][number]) => askedOf(l).toLowerCase()
  const asked = Object.values(r.lines.reduce<Record<string, { key: string; name: string; qty: number; unit: string | null; n: number; askedQty: number; askedUnit: string }>>((m, l) => {
    const k = keyOf(l)
    const a = askedQty(l)
    m[k] ??= { key: k, name: askedOf(l), qty: 0, unit: l.satuan, n: 0, askedQty: 0, askedUnit: a.unit }
    m[k].qty += Number(l.qty)
    m[k].askedQty += a.qty
    m[k].n += 1
    return m
  }, {})).map((g) => ({ ...g, name: `${g.name} ${fmtQty(g.askedQty)}${g.askedUnit ? ` ${g.askedUnit}` : ''}` }))
  return (
    <Card className="overflow-hidden">
      <DetailHeader task={task} onBack={onBack} link={`/item-requests/${r.id}`}
        actions={!history && (
          // empty:hidden: no action for this user at this stage → no empty grey box under the header
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 p-3 empty:hidden">
            <ApprovalActions req={r} onDone={onDone} handover={openF ? draft : undefined} />
          </div>
        )} />
      <Facts items={[['Requester', r.requester_name], ['Division', r.divisi], ['Source', r.source_label ?? '-'], ['Verifying admin', r.verified_step?.user_name ?? '-'], ['Needed', fmtDate(r.needed_date)], ['Status', <RequestStatusBadge status={r.status} label={r.status_label} />]]} />
      {(r.note || r.verify_note) && (
        <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t px-4 py-3 text-sm">
          {r.note && <><dt className="text-muted-foreground">Purpose</dt><dd className="whitespace-pre-wrap">{r.note}</dd></>}
          {r.verify_note && <><dt className="text-muted-foreground">Admin note</dt><dd className="whitespace-pre-wrap">{r.verify_note}</dd></>}
        </dl>
      )}
      {r.proxy && (
        <p className="border-t bg-emerald-50/60 px-4 py-3 text-sm">
          <span className="text-emerald-700">Picked up by representative: </span><b>{r.proxy.name}</b>
          <span className="text-muted-foreground"> · scan its QR at handover (valid until {new Date(r.proxy.expires_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })})</span>
        </p>
      )}
      {/* the requester's images: Manager, Direktur and Gudang see what is asked */}
      {(r.images?.length ?? 0) > 0 && (
        <div className="space-y-1.5 border-t px-4 py-3">
          <div className="text-xs text-muted-foreground">Image from requester</div>
          <RequestImages requestId={r.id} slots={r.images} />
        </div>
      )}
      {openF && (
        // Gudang: only what is handed over (default: the approved NPBG quantity, can be lowered)
        <div className="border-t">
          <div className="px-4 pb-1 pt-3 text-xs text-muted-foreground">Delivery Order <span className="">{openF.no_npbg}</span>{openF.seq > 1 ? ` (#${openF.seq})` : ''}</div>
          {/* the same view as the other approvals, without the bought (PPB) split: all of it leaves the stock */}
          <GudangPicks r={r} lines={r.lines.filter((l) => openF.lines.some((fl) => fl.line_id === l.id))} asked={asked} keyOf={keyOf} forGudang
            approvedOf={(l) => openF.lines.filter((fl) => fl.line_id === l.id).reduce((n, fl) => n + Number(fl.qty), 0)} />
        </div>
      )}
      {gudang && !history && (
        <p className="border-t px-4 py-2 text-right text-xs text-muted-foreground">
          Real-time stock{live.dataUpdatedAt ? `, updated ${new Date(live.dataUpdatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}
        </p>
      )}
      {gudang ? (!openF && waiting.length > 0 && (
        <GudangPicks r={r} lines={waiting} asked={asked} keyOf={keyOf} approvedOf={(l) => Number(l.remaining)} forGudang />
      )) : (
        <GudangPicks r={r} lines={lines} asked={asked} keyOf={keyOf} approvedOf={approvedOf} />
      )}
      {r.last_step && (
        <p className="border-t px-4 py-3 text-xs text-muted-foreground">Last step: {stepText(r.last_step.action, r.last_step.note, r.last_step.stage)}{isAutoApproval(r.last_step.note) ? '' : ` · ${r.last_step.user_name ?? 'System'}`}{r.last_step.note && !isAutoApproval(r.last_step.note) ? ` · ${r.last_step.note}` : ''}</p>
      )}
    </Card>
  )
}

/**
 * What admin gudang picked, per item the requester asked — Manager and Direktur alike: one row per asked
 * item ("sabun · 10 PCS · 1 barang dipilih · 10/10 ✓"); a click drops it down to its picked Master Produk
 * items in columns (qty, stock, from stock = NPBG, bought = PPB). The final split is made after the Direktur.
 */
function GudangPicks({ r, lines, asked, keyOf, approvedOf, forGudang }: {
  r: ApprovalRow; lines: ApprovalRow['lines']; asked: { key: string; name: string; qty: number; unit: string | null }[]
  keyOf: (l: ApprovalRow['lines'][number]) => string; approvedOf: (l: ApprovalRow['lines'][number]) => number
  /** Gudang: only what is handed over (no from-stock / bought split — buying is not its task) */
  forGudang?: boolean
}) {
  const round = (n: number) => Math.round(n * 100) / 100
  const split = (l: ApprovalRow['lines'][number]) => {
    const need = approvedOf(l)
    const npbg = l.item_id ? Math.min(need, Math.max(0, l.available ?? 0)) : 0
    return { need, npbg, ppb: round(need - npbg) }
  }
  const groups = asked.map((a) => ({ ...a, lines: lines.filter((l) => keyOf(l) === a.key) })).filter((g) => g.lines.length > 0)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const allOpen = groups.length > 0 && groups.every((g) => open[g.key])
  const all = lines.map(split)
  const fromStock = round(all.reduce((n, x) => n + x.npbg, 0))
  const bought = round(all.reduce((n, x) => n + x.ppb, 0))
  const handed = round(all.reduce((n, x) => n + x.need, 0))

  return (
    <div className="space-y-4 border-t px-4 py-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-[15px] font-semibold">{forGudang ? 'Items handed over' : 'Items'} <span className="font-normal text-muted-foreground">· {lines.length}</span></h3>
        <span className="text-xs text-muted-foreground">
          {forGudang ? <>Handed over <b className="text-emerald-700">{fmtQty(handed)}</b></> : <>
            From stock <b className="text-emerald-700">{fmtQty(fromStock)}</b>
            {bought > 0 && <> · To buy <b className="text-indigo-700">{fmtQty(bought)}</b></>}
          </>}
        </span>
        <button type="button" className="ml-auto text-xs font-medium text-primary hover:underline" onClick={() => setOpen(allOpen ? {} : Object.fromEntries(groups.map((g) => [g.key, true])))}>
          {allOpen ? 'Close all' : 'Open all'}
        </button>
      </div>

      <div className="divide-y overflow-hidden rounded-lg border bg-card">
        {groups.map((g) => {
          const total = round(g.lines.reduce((n, l) => n + approvedOf(l), 0))
          const ok = Math.abs(total - g.qty) < 0.005
          const isOpen = !!open[g.key]
          return (
            <div key={g.key}>
              {/* the asked item: click to drop down its picks */}
              <button type="button" onClick={() => setOpen((o) => ({ ...o, [g.key]: !o[g.key] }))} aria-expanded={isOpen}
                className={cn('flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40', isOpen && 'bg-blue-50/70')}>
                <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', !isOpen && '-rotate-90')} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{g.name}</span>
                  <span className="block text-xs text-muted-foreground">{g.lines.length} items{forGudang ? ' handed over' : ' picked by warehouse'}</span>
                  {/* given less than asked on purpose: admin gudang's reason */}
                  {g.lines.find((l) => l.short_reason)?.short_reason && <span className="block text-xs text-amber-700">Reason: {g.lines.find((l) => l.short_reason)!.short_reason}</span>}
                </span>
                <span className="shrink-0 text-right text-sm tabular-nums">
                  <span className="font-semibold">{fmtQty(g.qty)}</span> <span className="text-xs text-muted-foreground">{g.unit ?? ''}</span>
                  <span className={cn('block text-xs font-medium', ok ? 'text-emerald-700' : 'text-amber-700')}>{fmtQty(total)} / {fmtQty(g.qty)}{forGudang ? ' handed over' : ok ? ' ✓' : ' given less'}</span>
                </span>
              </button>

              {isOpen && (
                // phone: one small card per pick (no table wider than the screen)
                <ul className="divide-y border-t bg-muted/10 sm:hidden">
                  {g.lines.map((l) => {
                    const x = split(l)
                    return (
                      <li key={l.id} className="space-y-2 px-4 py-3 text-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0"><div className="break-words font-medium leading-snug">{l.item_description ?? l.deskripsi_barang}</div>
                            <div className="text-xs text-muted-foreground"><span className="">{l.kode_barang ?? '-'}</span>{l.note ? ` · ${l.note}` : ''}</div></div>
                          <LineImagesCell requestId={r.id} lineId={l.id} slots={l.images} />
                        </div>
                        <dl className={cn('grid gap-1 text-center text-xs', forGudang ? 'grid-cols-2' : 'grid-cols-4')}>
                          {([['Stock', l.available == null ? '?' : fmtQty(l.available), l.available == null ? '' : (l.available ?? 0) >= x.need ? 'text-emerald-700' : 'text-red-600'],
                            ...(forGudang ? [['Handed Over', <b>{fmtQty(x.need)}</b>, '']] : [['Requested', <b>{fmtQty(x.need)}</b>, ''], ['Handed Over', fmtQty(x.npbg), 'font-semibold text-emerald-700'], ['Purchased', fmtQty(x.ppb), 'font-semibold text-indigo-700']])] as [string, React.ReactNode, string][]).map(([k, val, tone]) => (
                            <div key={k} className="rounded-md bg-card px-1 py-1.5 ring-1 ring-inset ring-border"><dt className="text-[11px] text-muted-foreground">{k}</dt><dd className={cn('mt-0.5 tabular-nums', tone)}>{val}</dd></div>
                          ))}
                        </dl>
                      </li>
                    )
                  })}
                </ul>
              )}
              {isOpen && (
                <div className="hidden overflow-x-auto border-t bg-muted/10 sm:block">
                  <table className={cn('w-full text-sm', forGudang ? 'min-w-[420px]' : 'min-w-[520px]')}>
                    <thead className="whitespace-nowrap text-left text-xs text-muted-foreground">
                      <tr className="border-b">
                        <th className="py-2 pl-11 pr-3 font-medium">Selected items</th>
                        <th className="px-3 py-2 text-right font-medium">Stock</th>
                        <th className="px-3 py-2 text-right font-medium">{forGudang ? 'Handed Over' : 'Requested'}</th>
                        {!forGudang && <>
                          <th className="px-3 py-2 text-right font-medium" title="Issued from stock and handed over (estimate)">Handed Over</th>
                          <th className="px-3 py-2 text-right font-medium" title="Purchased through Purchase Request until Receipt (estimate)">Purchased</th>
                        </>}
                        <th className="px-4 py-2 text-right font-medium">Image</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {g.lines.map((l) => {
                        const x = split(l)
                        return (
                          <tr key={l.id} className="align-top">
                            <td className="py-2.5 pl-11 pr-3"><div className="font-medium leading-snug">{l.item_description ?? l.deskripsi_barang}</div>
                              <div className="text-xs text-muted-foreground"><span className="">{l.kode_barang ?? '-'}</span>{l.note ? ` · ${l.note}` : ''}</div></td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right"><StockCell onHand={l.on_hand} free={l.available} tone={l.available == null ? 'text-muted-foreground' : (l.available ?? 0) >= x.need ? 'text-emerald-700' : 'text-red-600'} /></td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums"><b>{fmtQty(x.need)}</b> <span className="text-xs text-muted-foreground">{l.satuan ?? ''}</span></td>
                            {!forGudang && <>
                              <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-emerald-700">{fmtQty(x.npbg)}</td>
                              <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-indigo-700">{fmtQty(x.ppb)}</td>
                            </>}
                            <td className="px-4 py-2"><div className="flex justify-end"><LineImagesCell requestId={r.id} lineId={l.id} slots={l.images} /></div></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Approve / Revisi (back to the admin who made it, with a required note) / Tolak — the same bar for PPB,
 * NPBG and PO. Every change goes through Revisi: the approver does not edit the document.
 */
function DecisionBar({ approveLabel, rejectLabel, busy, onApprove, onReject, onReturn, returnTo = 'admin', withNote }: {
  approveLabel: string; rejectLabel?: string; busy: boolean; onApprove: (note?: string) => void; onReject?: (note: string) => void; hint?: string
  /** Revisi: send it back for a revision (a note is required) */
  onReturn?: (note: string) => void
  /** who revises it (PO: purchasing) */
  returnTo?: string
  /** a note goes with the approval (everyone sees it) */
  withNote?: boolean
}) {
  const [rejecting, setRejecting] = useState<false | 'reject' | 'return'>(false)
  const [note, setNote] = useState('')
  const [approveNote, setApproveNote] = useState('')
  if (rejecting) {
    const back = rejecting === 'return'
    // an empty note is a validation (😆), not a greyed-out button
    const submit = () => {
      if (!note.trim()) return toast.invalid(back ? 'A note is required: write why it is revised.' : 'The rejection reason is required.')
      if (back) onReturn?.(note.trim())
      else onReject?.(note.trim())
    }
    return (
      <div className={back ? 'space-y-2 rounded-lg border border-orange-200 bg-orange-50/60 p-3' : 'space-y-2 rounded-lg border border-red-200 bg-red-50/60 p-3'}>
        <Input autoFocus value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} aria-label="Notes"
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          placeholder={back ? 'Why revise? What needs changing? (required)' : 'Rejection reason (required)'} />
        {back && <p className="text-xs text-orange-900/80">Returned to {returnTo} to be revised, then resubmitted to approval.</p>}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button>
          {back ? (
            <Button size="sm" disabled={busy} onClick={submit}><Undo2 className="size-4" /> Send revision to {returnTo}</Button>
          ) : (
            <Button size="sm" className="bg-red-600 text-white hover:bg-red-700" disabled={busy} onClick={submit}><XCircle className="size-4" /> {rejectLabel}</Button>
          )}
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-2 rounded-lg bg-muted/40 p-3">
      {withNote && (
        <Input value={approveNote} maxLength={1000} onChange={(e) => setApproveNote(e.target.value)} aria-label="Approval notes"
          className="bg-card" placeholder="Notes (optional), visible to everyone" />
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex gap-2">
        {onReturn && <Button size="sm" variant="outline" className="border-orange-300 text-orange-700 hover:bg-orange-50" disabled={busy} onClick={() => setRejecting('return')}><Undo2 className="size-4" /> Revise</Button>}
        {onReject && <Button size="sm" variant="outline" className="border-red-300 text-red-700 hover:bg-red-50" disabled={busy} onClick={() => setRejecting('reject')}><XCircle className="size-4" /> {rejectLabel}</Button>}
        <Button size="sm" disabled={busy} onClick={() => onApprove(withNote ? approveNote.trim() || undefined : undefined)}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} {approveLabel}
        </Button>
      </div>
      </div>
    </div>
  )
}

/** Stock of Master Produk; what prepared NPBG hold for other requests is said under it (it leaves with their serah terima). */
function StockCell({ onHand, free, tone }: { onHand?: number | null; free?: number | null; tone?: string }) {
  const stock = onHand ?? free
  if (stock == null) return <span className="text-muted-foreground">?</span>
  const held = free != null && onHand != null ? Math.round((onHand - free) * 100) / 100 : 0
  return (
    <span className="inline-flex flex-col items-end">
      <span className={tone ?? (stock > 0 ? 'text-emerald-700' : 'text-muted-foreground')}>{fmtQty(stock)}</span>
      {held > 0 && <span className="text-[11px] text-muted-foreground">on order {fmtQty(held)}</span>}
    </span>
  )
}

// Manager / Direktur do not change anything (PPB, NPBG): what is not right goes back to admin with "Revisi"
const QTY_HINT = 'Something not right? Click Revise, the admin will correct it.'

function PpbDetail({ task, onBack, onDone }: { task: Task; onBack: () => void; onDone: () => void }) {
  const { data: ppb, isLoading } = usePpb(task.id)
  const decide = useDecidePpb(task.id)
  const [err, setErr] = useState<string | null>(null)
  if (isLoading || !ppb) return <Card className="flex justify-center py-24"><Loader2 className="size-6 animate-spin text-muted-foreground" /></Card>
  const items = ppb.document_items ?? []
  const run = (action: 'APPROVE' | 'REJECT' | 'RETURN', note?: string) =>
    decide.mutate({ action, note: note ?? null }, { onSuccess: onDone, onError: (e) => setErr(apiErrorMessage(e)) })
  return (
    <Card className="overflow-hidden">
      <DetailHeader task={task} onBack={onBack} link={`/ppb/${ppb.id}`}
        actions={ppb.can_decide && <>
          <DecisionBar approveLabel={task.stage.includes('Director') ? 'Approve (Director)' : 'Approve (Manager)'} rejectLabel="Reject" busy={decide.isPending}
            hint={`${task.stage.includes('Director') ? 'Once approved, the Purchase Request goes to the PO table for vendor & price.' : 'After Manager approval, the Purchase Request waits for the Director.'} ${QTY_HINT}`}
            withNote
            onApprove={(n) => run('APPROVE', n)} onReject={(n) => run('REJECT', n)} onReturn={(n) => run('RETURN', n)} />
          {err && <p className="text-sm text-destructive">{err}</p>}
        </>} />
      <Facts items={[['Purchase Request Date', fmtDate(ppb.tgl_ppb)], ['Needed', fmtDate(ppb.tgl_diperlukan)], ['Division', ppb.divisi], ['Item', `${items.length} rows`]]} />
      <LinesTable head={['Item', 'Reference', 'Requester', 'Qty']} numericFrom={3}
        rows={items.map((it) => [
          <div><div className="font-medium">{it.deskripsi_barang}</div><div className="text-[13px] text-muted-foreground">{it.kode_barang ?? ''}</div>{it.catatan_baris && <div className="text-xs text-muted-foreground">{it.catatan_baris}</div>}</div>,
          <PpbReference r={it.reference} />,
          it.peminta ?? '',
          `${fmtQty(it.kuantitas)} ${it.satuan ?? ''}`,
        ])} />
      {(ppb.approval_log?.length ?? 0) > 0 && (
        <ol className="space-y-1 border-t px-4 py-3 text-xs text-muted-foreground">
          {ppb.approval_log!.map((l) => <li key={l.id}>{fmtDate(l.created_at)} · <span className="font-medium text-foreground">{stepText(l.action, l.note)}</span>{isAutoApproval(l.note) ? '' : ` · ${l.user_name ?? 'System'}${l.note ? `, ${l.note}` : ''}`}</li>)}
        </ol>
      )}
    </Card>
  )
}

function NpbgDetail({ task, onBack, onDone }: { task: Task; onBack: () => void; onDone: () => void }) {
  const { data: n, isLoading } = useNpbg(task.id)
  const decide = useDecideNpbg(task.id)
  const [err, setErr] = useState<string | null>(null)
  if (isLoading || !n) return <Card className="flex justify-center py-24"><Loader2 className="size-6 animate-spin text-muted-foreground" /></Card>
  const run = (action: 'APPROVE' | 'REJECT' | 'RETURN', note?: string) =>
    decide.mutate({ action, note: note ?? null }, { onSuccess: onDone, onError: (e) => setErr(apiErrorMessage(e)) })
  return (
    <Card className="overflow-hidden">
      <DetailHeader task={task} onBack={onBack} link={`/npbg/${n.id}`}
        actions={n.can_decide && <>
          <DecisionBar approveLabel={task.stage.includes('Director') ? 'Approve (Director)' : 'Approve (Manager)'} rejectLabel="Reject" busy={decide.isPending}
            hint={`${task.stage.includes('Director') ? 'Once approved, items leave stock right away.' : 'After Manager approval, the Delivery Order waits for the Director.'} ${QTY_HINT}`}
            withNote
            onApprove={(note) => run('APPROVE', note)} onReject={(note) => run('REJECT', note)} onReturn={(note) => run('RETURN', note)} />
          {err && <p className="text-sm text-destructive">{err}</p>}
        </>} />
      <Facts items={[['Date', fmtDate(n.tgl_npbg)], ['Customer', n.pelanggan], ['Requester', n.peminta], ['Type', n.tipe_npbg]]} />
      <LinesTable head={['Item', 'Remarks', 'Qty']}
        rows={[[
          <div><div className="font-medium">{n.deskripsi_barang}</div><div className="text-[13px] text-muted-foreground">{n.kode_barang ?? ''}</div></div>,
          n.deskripsi ?? n.keterangan ?? '',
          `${fmtQty(n.kuantitas)} ${n.satuan ?? ''}`,
        ]]} />
    </Card>
  )
}

function PoDetail({ task, onBack, onDone }: { task: Task; onBack: () => void; onDone: () => void }) {
  const { data: po, isLoading } = usePo(task.id)
  const action = usePoAction(task.id)
  const [err, setErr] = useState<string | null>(null)
  if (isLoading || !po) return <Card className="flex justify-center py-24"><Loader2 className="size-6 animate-spin text-muted-foreground" /></Card>
  const run = (name: string, body?: unknown) => action.mutate({ action: name, body }, { onSuccess: onDone, onError: (e) => setErr(apiErrorMessage(e)) })
  return (
    <Card className="overflow-hidden">
      <DetailHeader task={task} onBack={onBack} link={`/purchase-orders/${po.id}`}
        actions={po.can_approve && <>
          <DecisionBar approveLabel="Approve (Director)" busy={action.isPending} returnTo="purchasing"
            hint="Once approved, purchasing sends the PO to the vendor. Something not right? Click Revise; purchasing corrects it."
            onApprove={() => run('approve')} onReturn={(n) => run('reject', { note: n })} />
          {err && <p className="text-sm text-destructive">{err}</p>}
        </>} />
      <Facts items={[['Vendor', (po.vendors?.length ?? 0) > 1 ? po.vendors!.map((v) => v.name).join(' · ') : po.vendor?.name ?? po.vendor_name], ['Date', fmtDate(po.date)], ['Estimated arrival', fmtDate(po.expected_date)], ['Total', <span className="tabular-nums">{rupiah(po.total)}</span>]]} />
      <LinesTable head={['Item', 'Qty', 'Price', 'Subtotal']}
        rowClass={(i) => (po.items?.[i]?.director_pick?.status === 'BUKAN' ? 'bg-amber-100 dark:bg-amber-950/50' : undefined)}
        rows={(po.items ?? []).map((l) => [
          <div><div className="font-medium">{l.description}</div><div className="text-[13px] text-muted-foreground">{[l.item_code, (po.vendors?.length ?? 0) > 1 ? l.vendor_name : null].filter(Boolean).join(' · ')}</div><DirectorPickTag pick={l.director_pick} /></div>,
          `${fmtQty(l.qty)} ${l.unit ?? ''}`, rupiah(l.unit_price), rupiah(l.line_total),
        ])} />
      {po.notes && <p className="border-t px-4 py-3 text-xs text-muted-foreground">{po.notes}</p>}
    </Card>
  )
}
