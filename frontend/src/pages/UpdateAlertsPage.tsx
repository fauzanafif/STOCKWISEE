import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, Eye, LogIn, Megaphone, Pencil, Plus, Repeat, ThumbsUp, Trash2, type LucideIcon } from 'lucide-react'
import { apiErrorMessage } from '@/lib/api'
import { invalidTo, toast } from '@/lib/notify'
import { scheduleLabel, splitInterval, useAlertClosedBy, useAlertThumbs, useUpdateAlertMutations, useUpdateAlerts, type AlertMode, type AlertStatus, type AlertType, type UpdateAlert } from '@/features/updateAlerts/api'
import { AlertPopup } from '@/components/updateAlerts/UpdateAlertPopup'
import { ALERT_TYPES } from '@/components/updateAlerts/alertTypes'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/DataTable'
import { FilterBar } from '@/components/FilterBar'
import { Modal } from '@/components/ui/modal'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { confirmDialog } from '@/components/ui/confirm'
import { cn } from '@/lib/utils'

const STATUS: Record<AlertStatus, { label: string; variant: 'success' | 'default' | 'neutral' | 'warning' }> = {
  active: { label: 'Active', variant: 'success' },
  scheduled: { label: 'Scheduled', variant: 'default' },
  ended: { label: 'Ended', variant: 'neutral' },
  inactive: { label: 'Inactive', variant: 'warning' },
}

const MODES: { mode: AlertMode; label: string; hint: string; icon: LucideIcon }[] = [
  { mode: 'once', label: 'Once only', hint: 'One time per user', icon: Eye },
  { mode: 'login', label: 'Every login', hint: 'After each sign-in', icon: LogIn },
  { mode: 'interval', label: 'Repeat', hint: 'Every set time', icon: Repeat },
]

const UNITS = [{ minutes: 1, label: 'Minutes' }, { minutes: 60, label: 'Hours' }, { minutes: 1440, label: 'Days' }]

/** for <input type="datetime-local">: the moment in this browser's own time */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null)

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function AlertForm({ alert, open, onClose }: { alert: UpdateAlert | null; open: boolean; onClose: () => void }) {
  const m = useUpdateAlertMutations()
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [type, setType] = useState<AlertType>('feature')
  const [mode, setMode] = useState<AlertMode>('once')
  const [every, setEvery] = useState('30')
  const [unit, setUnit] = useState(1)
  const [starts, setStarts] = useState('')
  const [ends, setEnds] = useState('')
  const [active, setActive] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)

  useEffect(() => {
    if (!open) return
    const split = alert?.interval_minutes ? splitInterval(alert.interval_minutes) : { value: 30, unit: 1 }
    setTitle(alert?.title ?? '')
    setMessage(alert?.message ?? '')
    setType(alert?.type ?? 'feature')
    setMode(alert?.display_mode ?? 'once')
    setEvery(String(split.value))
    setUnit(split.unit)
    setStarts(toLocalInput(alert?.starts_at ?? null))
    setEnds(toLocalInput(alert?.ends_at ?? null))
    setActive(alert?.is_active ?? true)
    setErr(null)
    setPreview(false)
  }, [open, alert])

  const busy = m.create.isPending || m.update.isPending
  const filled = title.trim() !== '' && message.trim() !== ''

  const submit = () => {
    setErr(null)
    if (!title.trim()) return invalidTo(setErr, 'The title is required.')
    if (!message.trim()) return invalidTo(setErr, 'The message is required.')
    const count = Number(every)
    if (mode === 'interval' && (!Number.isInteger(count) || count < 1)) return invalidTo(setErr, 'Fill in how often the alert repeats, 1 or more.')
    if (starts && ends && new Date(ends) <= new Date(starts)) return invalidTo(setErr, 'The end must be after the start.')
    const body = {
      title: title.trim(), message: message.trim(), type, display_mode: mode,
      interval_minutes: mode === 'interval' ? count * unit : null,
      starts_at: fromLocalInput(starts), ends_at: fromLocalInput(ends), is_active: active,
    }
    const opts = { onSuccess: onClose, onError: (e: unknown) => setErr(apiErrorMessage(e)) }
    if (alert) m.update.mutate({ id: alert.id, ...body }, opts)
    else m.create.mutate(body, opts)
  }

  return (
    <>
      <Modal form open={open} onClose={onClose} title={alert ? 'Edit alert' : 'New alert'} className="max-w-2xl"
        footer={<>
          <Button variant="outline" size="sm" className="mr-auto" disabled={!filled} onClick={() => setPreview(true)}><Eye className="size-4" /> Preview</Button>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </>}>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Type">
              {(Object.keys(ALERT_TYPES) as AlertType[]).map((k) => {
                const t = ALERT_TYPES[k]
                const Icon = t.icon
                return (
                  <button key={k} type="button" role="radio" aria-checked={type === k} onClick={() => setType(k)}
                    className={cn('flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition-colors', type === k ? cn('border-transparent font-medium ring-2 ring-current', t.pill) : 'text-muted-foreground hover:bg-muted')}>
                    <Icon className="size-4" /> {t.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ua-title">Title *</Label>
            <Input id="ua-title" autoFocus value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ua-message">Message *</Label>
            <Textarea id="ua-message" rows={5} value={message} maxLength={2000} onChange={(e) => setMessage(e.target.value)} placeholder={'Write the message.\n- A line starting with a dash becomes a list item'} />
          </div>

          <div className="space-y-1.5">
            <Label>When to show</Label>
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="When to show">
              {MODES.map(({ mode: k, label, hint, icon: Icon }) => (
                <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)}
                  className={cn('flex items-center gap-2.5 rounded-lg border p-2.5 text-left transition-colors', mode === k ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted')}>
                  <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-md', mode === k ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}><Icon className="size-4" /></span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="block text-xs text-muted-foreground">{hint}</span>
                  </span>
                </button>
              ))}
            </div>
            {mode === 'interval' && (
              <div className="flex items-center gap-2 pt-1">
                <Label htmlFor="ua-every" className="shrink-0">Every</Label>
                <Input id="ua-every" type="number" min={1} step={1} className="w-24" value={every} onChange={(e) => setEvery(e.target.value)} />
                <div className="w-32">
                  <Select aria-label="Unit" value={unit} onChange={(e) => setUnit(Number(e.target.value))}>
                    {UNITS.map((u) => <option key={u.minutes} value={u.minutes}>{u.label}</option>)}
                  </Select>
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ua-starts">Active from</Label>
              <Input id="ua-starts" type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ua-ends">Active until</Label>
              <Input id="ua-ends" type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
          </label>
          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>
      </Modal>
      {preview && <AlertPopup alert={{ title: title.trim(), message: message.trim(), type }} onClose={() => setPreview(false)} />}
    </>
  )
}

/** Who gave this alert a thumbs up, and when. */
function ThumbsModal({ alert, onClose }: { alert: UpdateAlert; onClose: () => void }) {
  const { data, isLoading, isError } = useAlertThumbs(alert.id)
  return (
    <Modal open onClose={onClose} title="Thumbs up history" description={alert.title} className="max-w-md"
      footer={<Button variant="outline" size="sm" onClick={onClose}>Close</Button>}>
      {isLoading ? <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        : isError ? <p className="py-6 text-center text-sm text-destructive">Failed to load the list.</p>
          : !data?.length ? <p className="py-6 text-center text-sm text-muted-foreground">No thumbs up yet.</p>
            : (
              <ul className="max-h-[55vh] divide-y overflow-auto rounded-lg border text-sm">
                {data.map((p) => (
                  <li key={p.id} className="flex items-baseline justify-between gap-3 px-3 py-2">
                    <span className="min-w-0"><span className="block truncate font-medium">{p.name}</span><span className="block truncate text-xs text-muted-foreground">{p.username}</span></span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{when(p.at)}</span>
                  </li>
                ))}
              </ul>
            )}
    </Modal>
  )
}

/** Who closed this alert and when; a thumb marks those who closed it with one. */
function ClosedByModal({ alert, onClose }: { alert: UpdateAlert; onClose: () => void }) {
  const { data, isLoading, isError } = useAlertClosedBy(alert.id)
  return (
    <Modal open onClose={onClose} title={`Closed by (${data?.length ?? alert.seen_count})`} description={alert.title} className="max-w-md"
      footer={<Button variant="outline" size="sm" onClick={onClose}>Close</Button>}>
      {isLoading ? <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        : isError ? <p className="py-6 text-center text-sm text-destructive">Failed to load the list.</p>
          : !data?.length ? <p className="py-6 text-center text-sm text-muted-foreground">Nobody has closed it yet.</p>
            : (
              <ul className="max-h-[55vh] divide-y overflow-auto rounded-lg border text-sm">
                {data.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0"><span className="block truncate font-medium">{p.name}</span><span className="block truncate text-xs text-muted-foreground">{p.username}</span></span>
                    <span className="flex shrink-0 items-center gap-2 text-xs tabular-nums text-muted-foreground">
                      {p.thumbs_up && <ThumbsUp className="size-3.5 text-primary" aria-label="Thumbs up" />}{when(p.at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
    </Modal>
  )
}

/** Settings · Update Alert (Super Admin): the notices every user gets as a popup. */
export function UpdateAlertsPage() {
  const { data, isLoading } = useUpdateAlerts()
  const m = useUpdateAlertMutations()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [editing, setEditing] = useState<UpdateAlert | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [preview, setPreview] = useState<UpdateAlert | null>(null)
  const [thumbsOf, setThumbsOf] = useState<UpdateAlert | null>(null)
  const [closedOf, setClosedOf] = useState<UpdateAlert | null>(null)

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data ?? []).filter((a) => (!q || a.title.toLowerCase().includes(q) || a.message.toLowerCase().includes(q)) && (!status || a.status === status))
  }, [data, search, status])

  const openForm = (a: UpdateAlert | null) => { setEditing(a); setFormOpen(true) }
  const onError = (e: unknown) => toast.error(apiErrorMessage(e))

  const columns: Column<UpdateAlert>[] = [
    {
      key: 'title', header: 'Alert',
      cell: (a) => {
        const t = ALERT_TYPES[a.type]
        const Icon = t.icon
        return (
          <div className="flex w-[280px] items-start gap-2.5">
            <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg', t.pill)} title={t.label}><Icon className="size-4" /></span>
            <span className="min-w-0">
              <span className="block truncate font-medium">{a.title}</span>
              <span className="block truncate text-xs text-muted-foreground">{a.message}</span>
            </span>
          </div>
        )
      },
    },
    { key: 'schedule', header: 'When to show', cell: (a) => <span className="whitespace-nowrap">{scheduleLabel(a)}</span> },
    {
      key: 'period', header: 'Active period',
      cell: (a) => (a.starts_at || a.ends_at
        ? <span className="flex items-center gap-2 whitespace-nowrap text-xs">
            <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" />
            <span><span className="block">{a.starts_at ? when(a.starts_at) : 'Now'}</span><span className="block text-muted-foreground">until {a.ends_at ? when(a.ends_at) : 'no end'}</span></span>
          </span>
        : <span className="text-[13px] text-muted-foreground">No limit</span>),
    },
    { key: 'status', header: 'Status', cell: (a) => <Badge variant={STATUS[a.status].variant}>{STATUS[a.status].label}</Badge> },
    { key: 'seen', header: 'Closed by', className: 'text-right', cell: (a) => (
      <button type="button" aria-label={`Closed by ${a.title}`} onClick={() => setClosedOf(a)} className="rounded-md px-2 py-1 tabular-nums text-primary hover:bg-primary/10">{a.seen_count.toLocaleString('id-ID')}</button>
    ) },
    {
      key: 'thumbs', header: 'Thumbs up', className: 'text-right',
      cell: (a) => (
        <button type="button" aria-label={`Thumbs up history ${a.title}`} onClick={() => setThumbsOf(a)} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 tabular-nums text-primary hover:bg-primary/10">
          <ThumbsUp className="size-3.5" /> {a.thumbs_count.toLocaleString('id-ID')}
        </button>
      ),
    },
    {
      key: 'aksi', header: <span className="sr-only">Actions</span>, className: 'text-right',
      cell: (a) => (
        <span className="inline-flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-8" onClick={() => setPreview(a)}><Eye className="size-3.5" /> Preview</Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={() => openForm(a)}><Pencil className="size-3.5" /> Edit</Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={() => m.update.mutate({ id: a.id, is_active: !a.is_active }, { onError })}>{a.is_active ? 'Deactivate' : 'Activate'}</Button>
          <Button size="sm" variant="ghost" className="h-8 text-muted-foreground hover:text-destructive" aria-label={`Delete ${a.title}`}
            onClick={async () => { if (await confirmDialog({ message: `Delete alert "${a.title}"?`, danger: true })) m.remove.mutate(a.id, { onError }) }}>
            <Trash2 className="size-3.5" />
          </Button>
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader title="Settings · Update Alert" icon={<Megaphone className="size-5" />}
        actions={<Button size="sm" onClick={() => openForm(null)}><Plus className="size-4" /> New alert</Button>} />

      <FilterBar end={<span className="text-xs text-muted-foreground">{rows.length.toLocaleString('id-ID')} alerts</span>}>
        <Input className="w-full sm:max-w-sm" placeholder="Search title or message…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="w-full sm:w-44">
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {(Object.keys(STATUS) as AlertStatus[]).map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
          </Select>
        </div>
      </FilterBar>

      <DataTable columns={columns} rows={rows} rowKey={(a) => a.id} isLoading={isLoading}
        emptyText={search || status ? 'No alerts for this filter.' : 'No alerts yet.'} />

      <AlertForm alert={editing} open={formOpen} onClose={() => setFormOpen(false)} />
      {preview && <AlertPopup alert={{ ...preview, published_at: preview.starts_at ?? preview.created_at }} onClose={() => setPreview(null)} />}
      {thumbsOf && <ThumbsModal alert={thumbsOf} onClose={() => setThumbsOf(null)} />}
      {closedOf && <ClosedByModal alert={closedOf} onClose={() => setClosedOf(null)} />}
    </div>
  )
}
