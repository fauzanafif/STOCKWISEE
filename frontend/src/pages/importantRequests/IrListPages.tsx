import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronRight, MessageSquare, Plus, Search, SlidersHorizontal, X } from 'lucide-react'
import { IR_SCOPES, IR_STATUS, useIrList, useIrSummary, type IrRow, type IrScope } from '@/features/importantRequests/api'
import { IrPriorityBadge } from '@/components/importantRequests/IrParts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useRemembered } from '@/lib/listMemory'
import { cn } from '@/lib/utils'

const CLOSED = ['SELESAI', 'DIBATALKAN', 'DRAFT']
const fmtDue = (v: string) => new Date(v).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Due-date groups of Classroom's to-do: Terlambat / Hari ini / Minggu ini / Minggu depan / Nanti / Tanpa tenggat. */
function dueGroup(r: IrRow): string {
  if (CLOSED.includes(r.status)) return 'Done & others'
  if (!r.deadline) return 'Tanpa tenggat'
  if (r.overdue) return 'Terlambat'
  const today = new Date(new Date().toDateString()).getTime()
  const days = Math.floor((new Date(new Date(r.deadline).toDateString()).getTime() - today) / 86400000)
  if (days <= 0) return 'Today'
  if (days < 7) return 'Minggu ini'
  if (days < 14) return 'Minggu depan'
  return 'Nanti'
}
const GROUP_ORDER = ['Terlambat', 'Today', 'Minggu ini', 'Minggu depan', 'Nanti', 'Tanpa tenggat', 'Done & others']

/** One request as a Classroom to-do row: icon, title, who, the due date and its state on the right. */
export function IrItem({ r, scope }: { r: IrRow; scope?: IrScope }) {
  const mine = scope === 'tasks' && r.my_status
  const state = mine ? r.my_status_label : r.status_label
  const stateTone = (mine ? r.my_status : r.status) === 'SELESAI' ? 'text-emerald-700' : r.overdue && !CLOSED.includes(r.status) ? 'text-red-600'
    : (mine ? r.my_status : r.status) === 'ON_REVIEW' || state === 'On Review' ? 'text-blue-700'
    : (mine ? r.my_status : r.status)?.startsWith('DISERAHKAN') ? 'text-emerald-700' : (mine ? r.my_status : r.status) === 'REVISI' ? 'text-orange-700' : 'text-muted-foreground'
  return (
    <Link to={`/important-requests/${r.id}`} className="group flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/40 sm:gap-4 sm:px-5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium group-hover:text-primary">{r.title}</span>
          {r.priority === 'URGENT' || r.priority === 'HIGH' ? <IrPriorityBadge priority={r.priority} /> : null}
          {r.unread_comments > 0 && <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground"><MessageSquare className="size-3" />{r.unread_comments}</span>}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {scope === 'tasks' ? `From ${r.creator ?? '-'}` : `For ${r.assignee_names.join(', ') || '-'}`}
          {r.assignees_total > 1 && scope !== 'tasks' && ` · ${r.assignees_done}/${r.assignees_total} done`} · <span className="">{r.number}</span>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className={cn('text-xs', r.overdue && !CLOSED.includes(r.status) ? 'font-medium text-red-600' : 'text-muted-foreground')}>{r.deadline ? fmtDue(r.deadline) : 'No deadline'}</div>
        <div className={cn('text-xs font-medium', stateTone)}>{state}</div>
      </div>
      <ChevronRight className="hidden size-4 shrink-0 text-muted-foreground sm:block" />
    </Link>
  )
}

/** Permintaan Saya / Tugas Saya / Perlu Persetujuan / Selesai — Classroom's to-do: grouped by due date. */
export function IrListPage({ scope }: { scope: Exclude<IrScope, 'all'> }) {
  const navigate = useNavigate()
  const meta = IR_SCOPES[scope]
  const [typed, setTyped] = useState('')
  const [search, setSearch] = useRemembered(`ir-${scope}`, 'search', '')
  const [status, setStatus] = useRemembered(`ir-${scope}`, 'status', '')
  const [priority, setPriority] = useRemembered(`ir-${scope}`, 'priority', '')
  const [overdue, setOverdue] = useRemembered(`ir-${scope}`, 'overdue', false)
  const [chosenSort, setSort] = useRemembered(`ir-${scope}`, 'sort', 'deadline')
  // Tugas Saya: one list, the nearest deadline on top
  const tasks = scope === 'tasks'
  const sort = tasks ? 'deadline' : chosenSort
  const [page, setPage] = useRemembered(`ir-${scope}`, 'page', 1)
  const [showFilters, setShowFilters] = useState(!!(status || priority || overdue))
  const [folded, setFolded] = useState<Record<string, boolean>>({})
  useEffect(() => { setTyped(search) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(() => { if (typed !== search) { setSearch(typed); setPage(1) } }, 300); return () => clearTimeout(t) }, [typed])
  const { data, isLoading, isError } = useIrList({ scope, part: tasks ? 'open' : undefined, status: status || undefined, priority: priority || undefined, overdue, search: search || undefined, sort, page })
  const summary = useIrSummary()

  const reset = () => { setTyped(''); setSearch(''); setStatus(''); setPriority(''); setOverdue(false); setPage(1) }
  const extra = [status, priority, overdue].filter(Boolean).length
  const filtered = !!search || extra > 0
  const rows = data?.data ?? []
  // sorted by due date: Classroom's groups; otherwise one plain list
  const groups: [string, IrRow[]][] = sort === 'deadline' && !tasks
    ? GROUP_ORDER.map((g) => [g, rows.filter((r) => dueGroup(r) === g)] as [string, IrRow[]]).filter(([, l]) => l.length > 0)
    : rows.length ? [['', rows]] : []

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold">{meta.label}</h1>
        </div>
        {summary.data?.can_create && scope !== 'done' && <Button size="sm" onClick={() => navigate('/important-requests/baru')}><Plus className="size-4" /> Create request</Button>}
      </div>


      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-9 pl-9" placeholder="Search number / title" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Search" />
        </div>
        {!tasks && (
          <Select className="h-9 w-auto" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="deadline">By deadline</option>
            <option value="recent">Recently changed</option>
            <option value="priority">Priority</option>
          </Select>
        )}
        <Button variant="outline" size="sm" className={cn('h-9', extra > 0 && 'border-primary text-primary')} onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
          <SlidersHorizontal className="size-4" /> Filter{extra > 0 ? ` (${extra})` : ''}
        </Button>
        {filtered && <Button variant="ghost" size="sm" className="h-9" onClick={reset}><X className="size-4" /> Reset</Button>}
        {data && <span className="ml-auto text-xs text-muted-foreground">{data.meta.total.toLocaleString('id-ID')} request</span>}
      </div>

      {showFilters && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
          {scope !== 'done' && (
            <Select className="h-9 w-full sm:w-48" aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>
              <option value="">All statuses</option>
              {Object.entries(IR_STATUS).filter(([k]) => ['DITUGASKAN', 'MENUNGGU_REVIEW', ...(tasks ? [] : ['DIBATALKAN']), ...(scope === 'mine' ? ['DRAFT'] : [])].includes(k)).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
          )}
          <Select className="h-9 w-full sm:w-40" aria-label="Priority" value={priority} onChange={(e) => { setPriority(e.target.value); setPage(1) }}>
            <option value="">All priorities</option>
            {['URGENT', 'HIGH', 'MEDIUM', 'LOW'].map((p) => <option key={p} value={p}>{p.charAt(0) + p.slice(1).toLowerCase()}</option>)}
          </Select>
          {scope !== 'done' && <label className="flex h-9 items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={overdue} onChange={(e) => { setOverdue(e.target.checked); setPage(1) }} /> Late only</label>}
        </div>
      )}

      {isError && <p className="text-sm text-destructive">Failed to load the list.</p>}
      {isLoading ? <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p> : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed bg-card px-6 py-14 text-center">
          <p className="text-sm text-muted-foreground">{filtered ? 'No requests for this filter.' : meta.empty}</p>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map(([label, list]) => (
            <section key={label || 'all'} className="overflow-hidden rounded-lg border bg-card">
              {/* a group header that folds, its count on the right (like Classroom) */}
              {label && (
                <button type="button" onClick={() => setFolded((f) => ({ ...f, [label]: !f[label] }))} aria-expanded={!folded[label]}
                  className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-muted/40 sm:px-5">
                  <span className={cn('text-sm font-medium', label === 'Terlambat' && 'text-red-600')}>{label}</span>
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">{list.length}<ChevronDown className={cn('size-4 transition-transform', !folded[label] && 'rotate-180')} /></span>
                </button>
              )}
              {!folded[label] && (
                <div className={cn('divide-y', label && 'border-t')}>
                  {list.map((r) => <IrItem key={r.id} r={r} scope={scope} />)}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      {data && data.meta.last_page > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="tabular-nums text-muted-foreground">{data.meta.page} / {data.meta.last_page}</span>
          <Button size="sm" variant="outline" disabled={page >= data.meta.last_page} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  )
}
