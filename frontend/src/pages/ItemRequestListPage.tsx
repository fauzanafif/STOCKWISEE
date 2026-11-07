import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/PageHeader'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ChevronLeft, ChevronRight, Link2, Plus, Search, Send, X } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { apiErrorMessage } from '@/lib/api'
import {
  REQUEST_STATUS, useCreateItemRequest, useItemRequests, useMyRequestProfile, useRequestForms,
  type FormType, type ItemRequest, type ItemRequestStatus,
} from '@/features/itemRequests/api'
import { FormExtraFields } from '@/components/itemRequests/FormExtraFields'
import { RequestLinesEditor, emptyLine, filledLines, linesError, toPayloadLines, type DraftLine } from '@/components/itemRequests/RequestLinesEditor'
import { RequestLinksModal } from '@/components/itemRequests/RequestLinksModal'
import { ColumnMenu, useHiddenColumns, visibleColumns } from '@/components/ColumnVisibility'
import { DataTable, type Column } from '@/components/DataTable'
import { QtyProgress } from '@/components/QtyProgress'
import { useRemembered } from '@/lib/listMemory'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { invalidTo } from '@/lib/notify'

const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-')

/** Needed by a date already past while the request is still running. */
const isLate = (r: ItemRequest) => !!r.needed_date && !['SELESAI', 'DITOLAK', 'DIBATALKAN'].includes(r.status) && new Date(r.needed_date) < new Date(new Date().toDateString())

/** One color per stage, used everywhere a request status shows (list, detail, approval): [pill, dot]. */
const STATUS_TONE: Record<ItemRequestStatus, [string, string]> = {
  MENUNGGU: ['bg-amber-50 text-amber-800 ring-amber-200', 'bg-amber-500'],
  DIPROSES: ['bg-amber-50 text-amber-800 ring-amber-200', 'bg-amber-500'],
  PERLU_PERBAIKAN: ['bg-orange-50 text-orange-800 ring-orange-200', 'bg-orange-500'],
  APPROVAL_MANAGER: ['bg-blue-50 text-blue-800 ring-blue-200', 'bg-blue-500'],
  APPROVAL_DIREKTUR: ['bg-blue-50 text-blue-800 ring-blue-200', 'bg-blue-500'],
  DISIAPKAN: ['bg-violet-50 text-violet-800 ring-violet-200', 'bg-violet-500'],
  SIAP_DISERAHKAN: ['bg-cyan-50 text-cyan-800 ring-cyan-200', 'bg-cyan-500'],
  DIPENUHI_SEBAGIAN: ['bg-teal-50 text-teal-800 ring-teal-200', 'bg-teal-500'],
  MENUNGGU_PENGADAAN: ['bg-indigo-50 text-indigo-800 ring-indigo-200', 'bg-indigo-500'],
  MENUNGGU_BARANG: ['bg-indigo-50 text-indigo-800 ring-indigo-200', 'bg-indigo-500'],
  SELESAI: ['bg-emerald-50 text-emerald-800 ring-emerald-200', 'bg-emerald-500'],
  DITOLAK: ['bg-red-50 text-red-800 ring-red-200', 'bg-red-500'],
  DIBATALKAN: ['bg-slate-100 text-slate-600 ring-slate-200', 'bg-slate-400'],
}

/** label: the server's clearer wording when given (e.g. "NPBG partial & menunggu pengadaan") */
export function RequestStatusBadge({ status, label }: { status: ItemRequest['status']; label?: string | null }) {
  const [pill] = STATUS_TONE[status] ?? STATUS_TONE.DIBATALKAN
  return (
    <span className={cn('inline-flex max-w-[18rem] items-start gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium', pill)}>
      {label || REQUEST_STATUS[status]?.label || status}
    </span>
  )
}

/** One row of tabs: where each request stands, with how many sit there. */
const FLOW: { key: string; label: string; statuses: ItemRequestStatus[] }[] = [
  { key: '', label: 'All', statuses: [] },
  { key: 'MENUNGGU,DIPROSES,PERLU_PERBAIKAN', label: 'Waiting for verification', statuses: ['MENUNGGU', 'DIPROSES', 'PERLU_PERBAIKAN'] },
  { key: 'APPROVAL_MANAGER,APPROVAL_DIREKTUR', label: 'In approval', statuses: ['APPROVAL_MANAGER', 'APPROVAL_DIREKTUR'] },
  { key: 'DISIAPKAN', label: 'Prepared by warehouse', statuses: ['DISIAPKAN'] },
  { key: 'SIAP_DISERAHKAN', label: 'Ready to collect', statuses: ['SIAP_DISERAHKAN'] },
  { key: 'DIPENUHI_SEBAGIAN,MENUNGGU_PENGADAAN,MENUNGGU_BARANG', label: 'Waiting for items', statuses: ['DIPENUHI_SEBAGIAN', 'MENUNGGU_PENGADAAN', 'MENUNGGU_BARANG'] },
  { key: 'SELESAI', label: 'Done', statuses: ['SELESAI'] },
  { key: 'DITOLAK', label: 'Rejected', statuses: ['DITOLAK'] },
  { key: 'DIBATALKAN', label: 'Cancelled', statuses: ['DIBATALKAN'] },
]

function Pager({ page, lastPage, total, perPage, onPage, onPerPage }: {
  page: number; lastPage: number; total: number; perPage: number; onPage: (p: number) => void; onPerPage: (n: number) => void
}) {
  const from = total === 0 ? 0 : (page - 1) * perPage + 1
  const to = Math.min(page * perPage, total)
  // 1 … 4 5 [6] 7 8 … 20
  const pages = [...new Set([1, page - 2, page - 1, page, page + 1, page + 2, lastPage])].filter((p) => p >= 1 && p <= lastPage).sort((a, b) => a - b)
  return (
    <div className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3 text-muted-foreground">
        <span>{from}–{to} from {total.toLocaleString('id-ID')}</span>
        <span className="hidden sm:inline">·</span>
        <label className="hidden items-center gap-1.5 sm:flex">
          Rows
          <select className="h-8 rounded-md border bg-card px-1.5 text-sm text-foreground" value={perPage} onChange={(e) => onPerPage(Number(e.target.value))}>
            {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      <div className="flex items-center gap-1">
        <Button type="button" variant="outline" size="sm" className="h-8 px-2" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous"><ChevronLeft className="size-4" /></Button>
        {pages.map((p, i) => (
          <span key={p} className="flex items-center">
            {i > 0 && p - pages[i - 1] > 1 && <span className="px-1 text-muted-foreground">…</span>}
            <button type="button" onClick={() => onPage(p)} aria-current={p === page ? 'page' : undefined}
              className={cn('h-8 min-w-8 rounded-md px-2 text-sm tabular-nums', p === page ? 'bg-primary font-semibold text-primary-foreground' : 'hover:bg-muted')}>{p}</button>
          </span>
        ))}
        <Button type="button" variant="outline" size="sm" className="h-8 px-2" disabled={page >= lastPage} onClick={() => onPage(page + 1)} aria-label="Next"><ChevronRight className="size-4" /></Button>
      </div>
    </div>
  )
}

function NewRequestModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const create = useCreateItemRequest()
  const [formType, setFormType] = useState<FormType>('ATK')
  const forms = useRequestForms()
  const [detail, setDetail] = useState('')
  const form = forms.data?.find((f) => f.type === formType)
  const [divisi, setDivisi] = useState('')
  const [contact, setContact] = useState('')
  // like the form via link: who asks comes from their Data Pekerja (name, HP, divisi)
  const me = useMyRequestProfile(open)
  useEffect(() => {
    if (!me.data) return
    setContact((c) => c || me.data.contact || '')
    if (me.data.divisi) setDivisi((d) => d || me.data.divisi!)
  }, [me.data])
  // without a divisi of their own: the form's divisi as a starting point (only while empty or another form's default)
  useEffect(() => {
    if (me.data?.divisi) return
    const defaults = (forms.data ?? []).map((f) => f.default_divisi).filter(Boolean)
    setDivisi((d) => (!d || defaults.includes(d) ? form?.default_divisi ?? '' : d))
  }, [form, forms.data, me.data])
  const [neededDate, setNeededDate] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()])
  const [err, setErr] = useState<string | null>(null)

  const submit = () => {
    setErr(null)
    const lineErr = linesError(lines)
    if (lineErr) return invalidTo(setErr, lineErr)
    create.mutate({
      form_type: formType, form_detail: form?.detail_label ? detail.trim() || null : null,
      divisi: divisi.trim() || null, contact: contact.trim() || null, needed_date: neededDate || null, lines: toPayloadLines(lines),
    }, {
      onSuccess: (r) => { onClose(); setLines([emptyLine()]); setDetail(''); navigate(`/item-requests/${r.id}`) },
      onError: (e) => setErr(apiErrorMessage(e)),
    })
  }

  return (
    <Modal page form open={open} onClose={onClose} title="Create Item Request" className="max-w-4xl"
      description="Write the item name freely. The warehouse admin matches it with stock, then the system prepares a Delivery Order or purchase (Purchase Request)."
      footer={<>
        <span className="mr-auto hidden text-xs text-muted-foreground sm:inline">{filledLines(lines).length} items · * required</span>
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={submit} disabled={create.isPending}><Send className="size-4" /> {create.isPending ? 'Sending…' : 'Send request'}</Button>
      </>}>
      <div className="space-y-4">
        <section className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-name">Requester name</Label>
            <Input id="new-name" value={me.data?.name ?? ''} readOnly disabled placeholder={me.isLoading ? 'Loading…' : ''} />
          </div>
          <div className="space-y-1.5"><Label htmlFor="new-contact">Phone / WA No.</Label><Input id="new-contact" inputMode="tel" value={contact} maxLength={50} onChange={(e) => setContact(e.target.value)} placeholder="e.g. 0812…" /></div>
          <div className="space-y-1.5">
            <Label htmlFor="new-position">Position</Label>
            <Input id="new-position" value={me.data?.position ?? ''} readOnly disabled />
          </div>
          <div className="hidden lg:block" />
          <div className="space-y-1.5">
            <Label htmlFor="new-form">Form type</Label>
            <Select id="new-form" value={formType} onChange={(e) => setFormType(e.target.value as FormType)}>
              {(forms.data ?? []).map((f) => <option key={f.type} value={f.type}>{f.label}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5"><Label htmlFor="new-divisi">Division</Label><Input id="new-divisi" value={divisi} maxLength={100} onChange={(e) => setDivisi(e.target.value)} placeholder="e.g. Maintenance" /></div>
          <div className="space-y-1.5"><Label htmlFor="new-date">Needed by</Label><Input id="new-date" type="date" value={neededDate} onChange={(e) => setNeededDate(e.target.value)} /></div>
          {form?.detail_label && <FormExtraFields form={form} detail={detail} onDetail={setDetail} idPrefix="new" />}
        </section>
        <RequestLinesEditor lines={lines} onChange={setLines} />
        {err && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>}
      </div>
    </Modal>
  )
}

/**
 * Request Barang: one list. A row of tabs with counts, the filters, a data table with one clear action per
 * row, and numbered pages. A karyawan sees only their own requests; admin gudang all of them.
 */
export function ItemRequestListPage() {
  const navigate = useNavigate()
  const { hasPermission } = useAuth()
  const [search, setSearch] = useRemembered('item-requests', 'search', '')
  const [status, setStatus] = useRemembered('item-requests', 'flow', '')
  const [dateFrom, setDateFrom] = useRemembered('item-requests', 'dateFrom', '')
  const [dateTo, setDateTo] = useRemembered('item-requests', 'dateTo', '')
  const [requester, setRequester] = useRemembered('item-requests', 'requester', '')
  const [formType, setFormType] = useRemembered('item-requests', 'formType', '')
  const [page, setPage] = useRemembered('item-requests', 'page', 1)
  const [perPage, setPerPage] = useRemembered('item-requests', 'perPage', 20)
  const [creating, setCreating] = useState(false)
  const [sharing, setSharing] = useState(false)
  const forms = useRequestForms()
  // typing waits a moment before it asks the server
  const [typed, setTyped] = useState(search)
  useEffect(() => { const t = setTimeout(() => { if (typed !== search) { setSearch(typed); setPage(1) } }, 350); return () => clearTimeout(t) }, [typed])

  const { data, isLoading, isFetching } = useItemRequests({
    search: search || undefined, status: status || undefined, form_type: formType || undefined, requester: requester || undefined,
    date_from: dateFrom || undefined, date_to: dateTo || undefined, page, per_page: perPage,
  })
  const rows = data?.data ?? []
  const counts = data?.meta.status_counts ?? {}
  const countOf = (f: (typeof FLOW)[number]) => (f.statuses.length ? f.statuses : (Object.keys(counts) as ItemRequestStatus[]))
    .reduce((n, s) => n + (counts[s] ?? 0), 0)
  const canProcess = hasPermission('item_request.process')
  const filtered = !!(search || dateFrom || dateTo || requester || formType)
  const reset = () => { setTyped(''); setSearch(''); setDateFrom(''); setDateTo(''); setRequester(''); setFormType(''); setPage(1) }
  const set = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setPage(1) }
  const [hiddenCols, toggleCol] = useHiddenColumns('stockwise:item-request-hidden-columns')

  const columns: Column<ItemRequest>[] = [
    {
      key: 'number',
      header: 'Request No.',
      cell: (r) => (
        <div className="leading-tight">
          <div className="flex items-center gap-1.5 whitespace-nowrap text-[13px] font-semibold text-primary">
            {r.urgency === 'URGENT' && <AlertTriangle className="size-3.5 text-red-600" aria-label="Urgent" />}{r.number}
          </div>
          <div className="text-xs text-muted-foreground">{r.form_label}</div>
        </div>
      ),
    },
    { key: 'tgl', header: 'Date', cell: (r) => <span className="whitespace-nowrap tabular-nums">{fmtDate(r.created_at)}</span> },
    {
      key: 'pemohon',
      header: 'Requester',
      cell: (r) => (
        <div className="leading-tight">
          <div className="whitespace-nowrap font-medium">{r.requester_name ?? '-'}</div>
          <div className="text-xs text-muted-foreground">{r.divisi ?? '-'}</div>
        </div>
      ),
    },
    {
      key: 'item',
      header: 'Item',
      cell: (r) => (
        <div className="max-w-xs leading-tight">
          <div className="truncate">{r.items_preview?.[0] ?? '-'}</div>
          <div className="text-xs text-muted-foreground">
            {r.lines_count} {r.lines_count > 1 ? 'items' : 'item'}{r.lines_count > 1 && r.items_preview?.[1] ? ` · ${r.items_preview[1]}` : ''}
          </div>
        </div>
      ),
    },
    {
      // per item (not per request): asked (approved) / handed over so far, e.g. 10/5
      key: 'diserahkan',
      header: 'Asked / Handed over',
      cell: (r) => {
        const p = r.progress ?? []
        if (p.length === 0) return ''
        return (
          <ul className="min-w-[12rem] space-y-1.5">
            {p.slice(0, 3).map((x, i) => (
              <li key={i} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-xs" title={x.name}>{x.name}</span>
                <QtyProgress total={x.qty} done={x.done} className="min-w-16 shrink-0" />
              </li>
            ))}
            {p.length > 3 && <li className="text-[11px] text-muted-foreground">+{p.length - 3} other items (open detail)</li>}
          </ul>
        )
      },
    },
    {
      key: 'butuh',
      header: 'Needed',
      cell: (r) => {
        const late = isLate(r)
        return <span className={cn('whitespace-nowrap tabular-nums', late && 'font-semibold text-red-600')} title={late ? 'Past the needed date' : undefined}>{r.needed_date ? fmtDate(r.needed_date) : '-'}</span>
      },
    },
    { key: 'status', header: 'Status', cell: (r) => <RequestStatusBadge status={r.status} label={r.status_label} /> },
    {
      key: 'aksi',
      header: <span className="sr-only">Action</span>,
      className: 'text-right',
      cell: (r) => {
        const toVerify = canProcess && ['MENUNGGU', 'DIPROSES', 'PERLU_PERBAIKAN'].includes(r.status)
        return (
          <Button size="sm" variant={toVerify ? 'default' : 'outline'} className="h-8"
            onClick={(e) => { e.stopPropagation(); navigate(`/item-requests/${r.id}`) }}>
            {toVerify ? 'Verify' : 'Detail'}
          </Button>
        )
      },
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader title="Item Request"
        subtitle={canProcess ? 'Match employee requests with the Product Master, then send to approval. Short stock is bought automatically through Draft Purchase Request.' : 'Request items from the warehouse and follow them until you receive them.'}
        actions={<>
          {canProcess && <Button size="sm" variant="outline" onClick={() => setSharing(true)}><Link2 className="size-4" /> Form links</Button>}
          {hasPermission('item_request.create') && <Button size="sm" onClick={() => setCreating(true)}><Plus className="size-4" /> Create Request</Button>}
        </>} />

      <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
        {/* flow: one tab per stage, with how many sit there */}
        <div className="flex overflow-x-auto border-b" role="tablist" aria-label="Request flow">
          {FLOW.map((f) => {
            const on = status === f.key
            return (
              <button key={f.key || 'all'} type="button" role="tab" aria-selected={on} onClick={() => { setStatus(f.key); setPage(1) }}
                className={cn('flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm transition-colors',
                  on ? 'border-primary font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
                {f.label}
                <span className={cn('rounded-full px-1.5 text-xs tabular-nums', on ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>{countOf(f)}</span>
              </button>
            )
          })}
        </div>

        {/* filters */}
        <div className="grid grid-cols-2 gap-2 border-b bg-muted/30 p-3 lg:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))_auto_auto]">
          <div className="relative col-span-2 lg:col-span-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-9 bg-card pl-9" placeholder="Search no., requester, item…" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Search" />
          </div>
          <Input type="date" className="h-9 bg-card" value={dateFrom} onChange={(e) => set(setDateFrom)(e.target.value)} aria-label="From date" title="From date" />
          <Input type="date" className="h-9 bg-card" value={dateTo} onChange={(e) => set(setDateTo)(e.target.value)} aria-label="To date" title="To date" />
          <Select className="h-9 bg-card" value={requester} onChange={(e) => set(setRequester)(e.target.value)} aria-label="Requester">
            <option value="">All requesters</option>
            {(data?.meta.requesters ?? []).map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
          <Select className="h-9 bg-card" value={formType} onChange={(e) => set(setFormType)(e.target.value)} aria-label="Form type">
            <option value="">All forms</option>
            {(forms.data ?? []).map((f) => <option key={f.type} value={f.type}>{f.label}</option>)}
          </Select>
          <Button variant="ghost" size="sm" className={cn('col-span-2 h-9 lg:col-span-1', !filtered && 'hidden lg:inline-flex')} onClick={reset} disabled={!filtered}><X className="size-4" /> Reset</Button>
          {/* the table only shows from md up (phones get a plain list) */}
          <div className="hidden md:block">
            <ColumnMenu columns={columns} hiddenCols={hiddenCols} onToggle={toggleCol} alwaysVisible={['number', 'aksi']} hint="Choose the columns shown in the table." />
          </div>
        </div>

        {/* phone: the same list, one block per request */}
        <div className="divide-y md:hidden">
          {isLoading && rows.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>}
          {!isLoading && rows.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No requests.</p>}
          {rows.map((r) => (
            <button key={r.id} type="button" onClick={() => navigate(`/item-requests/${r.id}`)} className="block w-full px-4 py-3 text-left active:bg-muted/50">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium">{r.requester_name ?? '-'}{r.divisi && <span className="font-normal text-muted-foreground"> · {r.divisi}</span>}</div>
                  <div className="truncate text-sm">{r.items_preview?.[0] ?? '-'}{r.lines_count > 1 ? <span className="text-muted-foreground"> +{r.lines_count - 1}</span> : null}</div>
                  <div className="text-xs text-muted-foreground">{r.number} · {fmtDate(r.created_at)}</div>
                </div>
                <RequestStatusBadge status={r.status} label={r.status_label} />
              </div>
            </button>
          ))}
        </div>

        <div className={cn('hidden md:block', isFetching && !isLoading && 'opacity-70 transition-opacity')}>
          <DataTable columns={visibleColumns(columns, hiddenCols, ['number', 'aksi'])} rows={rows} rowKey={(r) => r.id} isLoading={isLoading} containerClassName="rounded-none border-0 shadow-none"
            onRowClick={(r) => navigate(`/item-requests/${r.id}`)}
            emptyText={filtered || status ? 'No requests for this filter.' : 'No item requests yet.'} />
        </div>

        {data && data.meta.total > 0 && (
          <Pager page={data.meta.page} lastPage={data.meta.last_page} total={data.meta.total} perPage={perPage}
            onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1) }} />
        )}
      </div>

      <NewRequestModal open={creating} onClose={() => setCreating(false)} />
      {canProcess && <RequestLinksModal open={sharing} onClose={() => setSharing(false)} />}
    </div>
  )
}
