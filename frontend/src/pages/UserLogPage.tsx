import { Fragment, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Loader2, RotateCcw } from 'lucide-react'
import { useActivityLogs, type ActivityEvent, type ActivityLog } from '@/features/activityLogs/api'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'

const EVENT: Record<ActivityEvent, [string, 'default' | 'neutral' | 'success' | 'warning' | 'danger']> = {
  LOGIN: ['Login', 'success'],
  LOGIN_FAILED: ['Login failed', 'danger'],
  LOGOUT: ['Logout', 'neutral'],
  PAGE_VIEW: ['Page opened', 'neutral'],
  CREATE: ['Create', 'default'],
  UPDATE: ['Edit', 'warning'],
  DELETE: ['Delete', 'danger'],
  ACTION: ['Action', 'default'],
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'long' })
const date = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

function Details({ l }: { l: ActivityLog }) {
  const rows: [string, string][] = [
    ['When', `${day(l.at)}, ${date(l.at)} ${time(l.at)}`],
    ['Request', [l.method, l.path].filter(Boolean).join(' ') || '—'],
    ['Route', l.route ?? '—'],
    ['Status', l.status ? String(l.status) : '—'],
    ['IP', l.ip ?? '—'],
    ['Device', l.user_agent ?? '—'],
  ]
  return (
    <div className="grid gap-3 bg-muted/30 px-4 py-3 text-xs lg:grid-cols-2">
      <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1">
        {rows.map(([k, v]) => <Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd className="break-all">{v}</dd></Fragment>)}
      </dl>
      <div className="min-w-0 space-y-2">
        {l.details?.error && <p className="rounded bg-red-50 px-2 py-1 text-red-700">{l.details.error}</p>}
        {l.details?.errors && (
          <ul className="list-inside list-disc text-red-700">{Object.entries(l.details.errors).map(([k, v]) => <li key={k}><b>{k}</b>: {String(v)}</li>)}</ul>
        )}
        {l.details?.input !== undefined && (
          <div><div className="mb-1 text-muted-foreground">Data sent{l.details.files ? ` · ${l.details.files} file(s)` : ''}</div>
            <pre className="max-h-64 overflow-auto rounded border bg-card p-2 text-[11px] leading-4">{JSON.stringify(l.details.input, null, 2)}</pre></div>
        )}
        {!l.details && <p className="text-muted-foreground">No data sent.</p>}
      </div>
    </div>
  )
}

/** User Log: every login, page and tab opened, and change made, with the day, date and time to the second. */
export function UserLogPage() {
  const [f, setF] = useState({ search: '', user_id: '', event: '', module: '', from: '', to: '' })
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<number | null>(null)
  const { data, isLoading, isFetching, isError } = useActivityLogs({ ...f, page })
  const set = (k: keyof typeof f, v: string) => { setF((x) => ({ ...x, [k]: v })); setPage(1) }
  const meta = data?.meta
  const rows = data?.data ?? []
  const any = Object.values(f).some(Boolean)

  return (
    <div className="space-y-3">
      <PageHeader title="User Log" subtitle="Logins, pages opened and every change, to the second." />

      <Card className="space-y-2 p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
          <Input value={f.search} onChange={(e) => set('search', e.target.value)} placeholder="Search activity, document, page, user, IP" aria-label="Search" />
          <Select value={f.user_id} onChange={(e) => set('user_id', e.target.value)} aria-label="User">
            <option value="">All users</option>
            {(meta?.users ?? []).map((u) => <option key={u.id} value={u.id}>{u.name} ({u.username})</option>)}
          </Select>
          <Select value={f.event} onChange={(e) => set('event', e.target.value)} aria-label="Activity">
            <option value="">All activities</option>
            {Object.entries(EVENT).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
          </Select>
          <Select value={f.module} onChange={(e) => set('module', e.target.value)} aria-label="Module">
            <option value="">All modules</option>
            {(meta?.modules ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1.5 text-muted-foreground">From <Input type="date" className="h-9 w-40" value={f.from} onChange={(e) => set('from', e.target.value)} /></label>
          <label className="flex items-center gap-1.5 text-muted-foreground">To <Input type="date" className="h-9 w-40" value={f.to} onChange={(e) => set('to', e.target.value)} /></label>
          {any && <Button size="sm" variant="ghost" onClick={() => { setF({ search: '', user_id: '', event: '', module: '', from: '', to: '' }); setPage(1) }}><RotateCcw className="size-4" /> Reset</Button>}
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {isFetching && <Loader2 className="mr-1 inline size-3.5 animate-spin" />}{(meta?.total ?? 0).toLocaleString('id-ID')} entries
          </span>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="whitespace-nowrap border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 font-medium">Day</th>
                <th className="px-3 py-2.5 font-medium">Date</th>
                <th className="px-3 py-2.5 font-medium">Time</th>
                <th className="px-3 py-2.5 font-medium">User</th>
                <th className="px-3 py-2.5 font-medium">Activity</th>
                <th className="px-3 py-2.5 font-medium">Module</th>
                <th className="px-3 py-2.5 font-medium">Detail</th>
                <th className="px-3 py-2.5 font-medium">IP</th>
                <th className="w-8 px-2 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((l) => {
                const [label, tone] = EVENT[l.event] ?? [l.event, 'neutral']
                const failed = (l.status ?? 0) >= 400
                return (
                  <Fragment key={l.id}>
                    <tr className={cn('cursor-pointer hover:bg-muted/40', open === l.id && 'bg-muted/40')} onClick={() => setOpen(open === l.id ? null : l.id)}
                      aria-expanded={open === l.id}>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{day(l.at)}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{date(l.at)}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-medium tabular-nums">{time(l.at)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{l.user_name ?? '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <Badge variant={tone}>{label}</Badge>
                        {failed && l.event !== 'LOGIN_FAILED' && <Badge variant="danger" className="ml-1">Failed {l.status}</Badge>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{l.module ?? '—'}</td>
                      <td className="min-w-[16rem] px-3 py-2">
                        <span>{l.description}</span>
                        {l.subject && l.event !== 'PAGE_VIEW' && <span className="font-medium"> · {l.subject}</span>}
                        {l.event === 'PAGE_VIEW' && l.path && <div className="truncate text-xs text-muted-foreground">{l.path}</div>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-muted-foreground">{l.ip ?? '—'}</td>
                      <td className="px-2 py-2 text-muted-foreground"><ChevronDown className={cn('size-4 transition-transform', open === l.id && 'rotate-180')} /></td>
                    </tr>
                    {open === l.id && <tr><td colSpan={9} className="p-0"><Details l={l} /></td></tr>}
                  </Fragment>
                )
              })}
              {rows.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-12 text-center text-muted-foreground">
                  {isLoading ? <Loader2 className="mx-auto size-5 animate-spin" /> : isError ? 'Failed to load the log.' : 'No activity found.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        {meta && meta.last_page > 1 && (
          <div className="flex items-center justify-between gap-2 border-t px-3 py-2 text-sm">
            <span className="text-muted-foreground">Page {meta.page} of {meta.last_page}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft className="size-4" /></Button>
              <Button size="sm" variant="outline" disabled={page >= meta.last_page} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRight className="size-4" /></Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
