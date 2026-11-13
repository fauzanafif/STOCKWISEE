import { useMemo, useRef, useState } from 'react'
import { CalendarClock, Check, History, Loader2, Lock, MessageSquare, Paperclip, Pencil, Send, Trash2, X } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { apiErrorMessage } from '@/lib/api'
import { toast } from '@/lib/notify'
import {
  EVENT_LABEL, FIELD_LABEL, downloadAttachment, fmtWhen, showValue, useAssignees, useAudit, useDocActivities, useDocMutations, useFeed,
  type DocActivity, type DocType, type FeedItem,
} from '@/features/documents/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { confirmDialog } from '@/components/ui/confirm'
import { cn } from '@/lib/utils'

type Filter = 'all' | 'messages' | 'notes' | 'changes'

const STATE: Record<DocActivity['state'], { label: string; variant: 'default' | 'warning' | 'danger' | 'success' | 'neutral' }> = {
  PLANNED: { label: 'Planned', variant: 'default' }, TODAY: { label: 'Today', variant: 'warning' }, OVERDUE: { label: 'Overdue', variant: 'danger' },
  DONE: { label: 'Done', variant: 'success' }, CANCELLED: { label: 'Cancelled', variant: 'neutral' },
}
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const fmtDue = (d: string | null | undefined) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'
/** a small text tab: Message / Note / Activity and the timeline filters */
const tab = (active: boolean) => cn('rounded px-2 py-1 text-xs transition-colors', active ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')

/** The message box, always open at the top of the panel. Ctrl+Enter sends. */
function Composer({ type, id, mode }: { type: DocType; id: number; mode: 'MESSAGE' | 'NOTE' }) {
  const m = useDocMutations(type, id)
  const [body, setBody] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const input = useRef<HTMLInputElement>(null)
  const note = mode === 'NOTE'
  const submit = () => {
    if (!body.trim() && files.length === 0) return
    m.post.mutate({ kind: mode, body: body.trim(), files }, {
      onSuccess: () => { toast.success(note ? 'Note logged.' : 'Message sent.'); setBody(''); setFiles([]) },
      onError: (e) => toast.fromError(e, apiErrorMessage(e)),
    })
  }
  return (
    <div className={cn('rounded-md border focus-within:ring-1 focus-within:ring-ring', note ? 'border-amber-200 bg-amber-50/40' : 'bg-background')}>
      <Textarea rows={2} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit() } }}
        aria-label={note ? 'Internal note' : 'Message'}
        className="min-h-[3.5rem] resize-y border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
        placeholder={note ? 'Log an internal note (staff only)…' : 'Write a message…'} />
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1 px-2">{files.map((f, i) => (
          <Badge key={i} variant="neutral" className="max-w-full gap-1"><span className="truncate">{f.name}</span><button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}><X className="size-3" /></button></Badge>
        ))}</div>
      )}
      <div className="flex items-center justify-between gap-2 px-1.5 pb-1.5">
        <input ref={input} type="file" multiple hidden onChange={(e) => { setFiles((x) => [...x, ...Array.from(e.target.files ?? [])].slice(0, 5)); e.target.value = '' }} />
        <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground" title="Attach files (up to 5, 10 MB each)" aria-label="Attach files"
          onClick={() => input.current?.click()} disabled={files.length >= 5}><Paperclip className="size-4" /></Button>
        <Button size="sm" className="h-7" disabled={m.post.isPending || (!body.trim() && files.length === 0)} onClick={submit}>
          {m.post.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} {note ? 'Log' : 'Send'}
        </Button>
      </div>
    </div>
  )
}

function ScheduleModal({ type, id, types, onClose }: { type: DocType; id: number; types: Record<string, string>; onClose: () => void }) {
  const m = useDocMutations(type, id)
  const people = useAssignees(type, id, true)
  const { user } = useAuth()
  const [kind, setKind] = useState('TODO')
  const [summary, setSummary] = useState('')
  const [note, setNote] = useState('')
  const [assignee, setAssignee] = useState(user ? String(user.id) : '')
  const [due, setDue] = useState(today())
  const [err, setErr] = useState<string | null>(null)
  const submit = () => {
    setErr(null)
    if (!assignee) return setErr('Select who does it.')
    m.schedule.mutate({ activity_type: kind, summary: summary.trim() || null, note: note.trim() || null, assignee_id: Number(assignee), due_date: due }, {
      onSuccess: () => { toast.success('Activity scheduled.'); onClose() }, onError: (e) => setErr(apiErrorMessage(e)),
    })
  }
  return (
    <Modal open onClose={onClose} form title="Schedule activity"
      footer={<><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" disabled={m.schedule.isPending} onClick={submit}>{m.schedule.isPending && <Loader2 className="size-4 animate-spin" />} Schedule</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Activity type</span>
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></label>
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Due date</span><Input type="date" min={today()} value={due} onChange={(e) => setDue(e.target.value)} /></label>
        <label className="space-y-1 sm:col-span-2"><span className="text-xs text-muted-foreground">Summary</span><Input maxLength={200} value={summary} placeholder={types[kind]} onChange={(e) => setSummary(e.target.value)} /></label>
        <label className="space-y-1 sm:col-span-2"><span className="text-xs text-muted-foreground">Assigned to</span>
          <Select value={assignee} onChange={(e) => setAssignee(e.target.value)}><option value="">Select…</option>{(people.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></label>
        <label className="space-y-1 sm:col-span-2"><span className="text-xs text-muted-foreground">Notes</span><Textarea rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
    </Modal>
  )
}

function AuditModal({ type, id, onClose }: { type: DocType; id: number; onClose: () => void }) {
  const { data, isLoading } = useAudit(type, id, true)
  return (
    <Modal open onClose={onClose} title="Audit trail" page>
      {isLoading ? <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p> : (data ?? []).length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No recorded changes yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-slate-100 text-left text-xs text-slate-600"><tr>
              <th className="px-3 py-2">Time</th><th className="px-3 py-2">User</th><th className="px-3 py-2">Event</th><th className="px-3 py-2">Field</th><th className="px-3 py-2">Before</th><th className="px-3 py-2">After</th><th className="px-3 py-2">Reason</th><th className="px-3 py-2">IP</th>
            </tr></thead>
            <tbody>
              {(data ?? []).flatMap((r) => {
                const fields = Object.entries(r.changes ?? {})
                const rows = fields.length ? fields : [['', [null, null]] as [string, [unknown, unknown]]]
                return rows.map(([f, [b, a]], i) => (
                  <tr key={`${r.id}-${f}`} className={cn(i === 0 && 'border-t')}>
                    <td className="whitespace-nowrap px-3 py-1.5">{i === 0 ? fmtWhen(r.at) : ''}</td>
                    <td className="px-3 py-1.5">{i === 0 ? r.user_name ?? '-' : ''}</td>
                    <td className="px-3 py-1.5">{i === 0 ? `${EVENT_LABEL[r.event] ?? r.event} · ${r.model}` : ''}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{FIELD_LABEL[f] ?? f}</td>
                    <td className="px-3 py-1.5 text-red-700">{f ? showValue(b) : ''}</td>
                    <td className="px-3 py-1.5 text-emerald-700">{f ? showValue(a) : ''}</td>
                    <td className="px-3 py-1.5">{i === 0 ? r.reason ?? '' : ''}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{i === 0 ? r.ip ?? '' : ''}</td>
                  </tr>
                ))
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}

/** Tracked changes show at most 3 fields; the rest is behind "View details" (the Audit trail). */
const SHOWN_FIELDS = 3

function FeedEntry({ type, id, item, onAudit }: { type: DocType; id: number; item: FeedItem; onAudit: () => void }) {
  const m = useDocMutations(type, id)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(item.kind !== 'TRACKING' ? item.body ?? '' : '')
  if (item.kind === 'TRACKING') {
    const fields = Object.entries(item.changes ?? {})
    return (
      <li className="flex gap-2.5">
        <History className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground"><span className="text-foreground">{item.user_name ?? 'System'}</span> · {EVENT_LABEL[item.event] ?? item.event} · {fmtWhen(item.at)}</div>
          {fields.length > 0 && (
            <ul className="mt-0.5 space-y-0.5 text-[13px]">
              {fields.slice(0, SHOWN_FIELDS).map(([f, [b, a]]) => (
                <li key={f} className="break-words"><span className="text-muted-foreground">{FIELD_LABEL[f] ?? f}:</span> {item.event !== 'CREATED' && <><span className="text-muted-foreground line-through">{showValue(b)}</span> → </>}<span>{showValue(a)}</span></li>
              ))}
            </ul>
          )}
          {item.reason && <div className="text-xs text-muted-foreground">Reason: {item.reason}</div>}
          {fields.length > SHOWN_FIELDS && (
            <button type="button" className="mt-0.5 text-xs text-primary hover:underline" onClick={onAudit}>+{fields.length - SHOWN_FIELDS} more · View details</button>
          )}
        </div>
      </li>
    )
  }
  const note = item.kind === 'NOTE'
  return (
    <li className="group flex gap-2.5">
      {note ? <Lock className="mt-0.5 size-3.5 shrink-0 text-amber-600" /> : <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-primary" />}
      <div className={cn('min-w-0 flex-1', note && 'border-l-2 border-amber-300 pl-2')}>
        <div className="flex items-start justify-between gap-2">
          <div className="text-xs text-muted-foreground"><span className="font-medium text-foreground">{item.user_name ?? '-'}</span> · {fmtWhen(item.at)}{note && ' · internal note'}{item.edited && ' · edited'}</div>
          {item.can_edit && !editing && !item.deleted && (
            <div className="flex shrink-0 gap-1.5 opacity-60 group-hover:opacity-100">
              <button type="button" aria-label="Edit message" className="text-muted-foreground hover:text-foreground" onClick={() => setEditing(true)}><Pencil className="size-3.5" /></button>
              <button type="button" aria-label="Delete message" className="text-muted-foreground hover:text-destructive" onClick={async () => {
                if (await confirmDialog({ message: 'Delete this message? It is shown as deleted and kept in the audit trail.', danger: true }))
                  m.remove.mutate(item.message_id, { onError: (e) => toast.fromError(e, apiErrorMessage(e)) })
              }}><Trash2 className="size-3.5" /></button>
            </div>
          )}
        </div>
        {item.deleted ? <div className="text-[13px] italic text-muted-foreground">This message was deleted.</div> : editing ? (
          <div className="mt-1 space-y-1.5">
            <Textarea rows={3} maxLength={5000} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
            <div className="flex justify-end gap-1.5">
              <Button size="sm" variant="ghost" className="h-7" onClick={() => { setEditing(false); setText(item.body ?? '') }}>Cancel</Button>
              <Button size="sm" className="h-7" disabled={!text.trim() || m.edit.isPending} onClick={() => m.edit.mutate({ messageId: item.message_id, body: text.trim() }, { onSuccess: () => setEditing(false), onError: (e) => toast.fromError(e, apiErrorMessage(e)) })}>Save</Button>
            </div>
          </div>
        ) : (
          <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">{item.body}</div>
        )}
        {!item.deleted && item.attachments.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">{item.attachments.map((a) => (
            <button key={a.id} type="button" className="inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-xs text-primary hover:bg-muted"
              onClick={() => downloadAttachment(type, id, a).catch((e) => toast.fromError(e, apiErrorMessage(e)))}><Paperclip className="size-3 shrink-0" /><span className="truncate">{a.name}</span></button>
          ))}</div>
        )}
      </div>
    </li>
  )
}

/**
 * Odoo-style Chatter as a narrow panel beside the document: write (Message / Note / Activity), the planned
 * activities, then one timeline of messages, internal notes (staff only) and tracked changes, newest first.
 * The full Audit Trail opens from "View details" / the history icon.
 */
export function Chatter({ type, id, className }: { type: DocType; id: number; className?: string }) {
  const feed = useFeed(type, id)
  const acts = useDocActivities(type, id)
  const m = useDocMutations(type, id)
  const [mode, setMode] = useState<'MESSAGE' | 'NOTE'>('MESSAGE')
  const [filter, setFilter] = useState<Filter>('all')
  const [scheduling, setScheduling] = useState(false)
  const [auditOpen, setAuditOpen] = useState(false)
  const staff = feed.data?.meta.staff ?? false
  const items = useMemo(() => (feed.data?.data ?? []).filter((i) =>
    filter === 'all' ? true : filter === 'messages' ? i.kind === 'MESSAGE' : filter === 'notes' ? i.kind === 'NOTE' : i.kind === 'TRACKING'), [feed.data, filter])
  const open = (acts.data?.manual ?? []).filter((a) => a.state !== 'DONE' && a.state !== 'CANCELLED')
  const closed = (acts.data?.manual ?? []).filter((a) => a.state === 'DONE' || a.state === 'CANCELLED')
  const system = acts.data?.system ?? []
  const onError = (e: unknown) => toast.fromError(e, apiErrorMessage(e))
  const writeMode = staff ? mode : 'MESSAGE'

  return (
    <section aria-label="Chatter" className={cn('flex flex-col rounded-lg border bg-card text-sm lg:max-h-[calc(100vh-6rem)]', className)}>
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <h2 className="text-sm font-semibold">Chatter</h2>
        <div className="flex items-center gap-0.5">
          <button type="button" aria-pressed={writeMode === 'MESSAGE'} className={tab(writeMode === 'MESSAGE')} onClick={() => setMode('MESSAGE')}>Message</button>
          {staff && <button type="button" aria-pressed={writeMode === 'NOTE'} className={tab(writeMode === 'NOTE')} onClick={() => setMode('NOTE')}>Note</button>}
          {acts.data?.can_schedule && <button type="button" className={tab(false)} onClick={() => setScheduling(true)}>Activity</button>}
        </div>
      </div>

      <div className="space-y-3 border-b p-3">
        <Composer key={writeMode} type={type} id={id} mode={writeMode} />

        {(system.length > 0 || open.length > 0) && (
          <div>
            <div className="mb-0.5 text-xs font-medium text-muted-foreground">Planned activities</div>
            <ul className="divide-y">
              {system.map((s, i) => (
                <li key={`s${i}`} className="flex gap-2 py-1.5">
                  <CalendarClock className={cn('mt-0.5 size-3.5 shrink-0', s.for_you ? 'text-primary' : 'text-muted-foreground')} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] leading-snug">{s.summary}</div>
                    <div className="text-xs text-muted-foreground">{s.responsible}{s.for_you ? ' · you' : ''}{s.since ? ` · since ${fmtWhen(s.since)}` : ''} · from the document status</div>
                  </div>
                </li>
              ))}
              {open.map((a) => (
                <li key={a.id} className="flex gap-2 py-1.5">
                  <CalendarClock className="mt-0.5 size-3.5 shrink-0 text-violet-600" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-1.5">
                      <div className="min-w-0 text-[13px] leading-snug">{a.summary} <span className="text-xs text-muted-foreground">· {a.type_label}</span></div>
                      <Badge variant={STATE[a.state].variant} className="shrink-0">{STATE[a.state].label}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">{a.assignee_name} · due {fmtDue(a.due_date)} · by {a.created_by_name}</div>
                    {a.note && <div className="mt-0.5 whitespace-pre-wrap text-xs">{a.note}</div>}
                    {(a.can_complete || a.can_cancel) && (
                      <div className="mt-1 flex gap-1">
                        {a.can_complete && <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={m.done.isPending} onClick={() => m.done.mutate({ activityId: a.id, note: null }, { onSuccess: () => toast.success('Activity done.'), onError })}><Check className="size-3.5" /> Done</Button>}
                        {a.can_cancel && <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-muted-foreground" aria-label="Cancel activity" onClick={async () => {
                          if (await confirmDialog({ message: 'Cancel this activity?', danger: true })) m.cancel.mutate(a.id, { onError })
                        }}><X className="size-3.5" /> Cancel</Button>}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-1 border-b px-2 py-1.5">
        <div className="flex flex-wrap gap-0.5">
          {(['all', 'messages', ...(staff ? ['notes'] : []), 'changes'] as Filter[]).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={tab(filter === f)}>
              {{ all: 'All', messages: 'Messages', notes: 'Notes', changes: 'Changes' }[f]}
            </button>
          ))}
        </div>
        <button type="button" title="Audit trail" aria-label="Audit trail" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => setAuditOpen(true)}><History className="size-3.5" /></button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {feed.isLoading ? <p className="py-4 text-center text-xs text-muted-foreground">Loading…</p> : items.length === 0 ? <p className="py-4 text-center text-xs text-muted-foreground">Nothing here yet.</p> : (
          <ul className="space-y-3">{items.map((i) => <FeedEntry key={i.id} type={type} id={id} item={i} onAudit={() => setAuditOpen(true)} />)}</ul>
        )}
        {filter === 'changes' && items.length > 0 && (
          <button type="button" className="mt-3 text-xs text-primary hover:underline" onClick={() => setAuditOpen(true)}>View details</button>
        )}
        {closed.length > 0 && (
          <details className="mt-3 border-t pt-2">
            <summary className="cursor-pointer text-xs text-muted-foreground">Completed activities ({closed.length})</summary>
            <ul className="mt-1.5 space-y-1">{closed.map((a) => (
              <li key={a.id} className="text-xs text-muted-foreground"><Badge variant={STATE[a.state].variant}>{STATE[a.state].label}</Badge> {a.summary} · {a.assignee_name}{a.done_at ? ` · ${fmtWhen(a.done_at)} by ${a.done_by_name ?? '-'}` : ''}{a.done_note ? ` · ${a.done_note}` : ''}</li>
            ))}</ul>
          </details>
        )}
      </div>
      {scheduling && acts.data && <ScheduleModal type={type} id={id} types={acts.data.types} onClose={() => setScheduling(false)} />}
      {auditOpen && <AuditModal type={type} id={id} onClose={() => setAuditOpen(false)} />}
    </section>
  )
}
