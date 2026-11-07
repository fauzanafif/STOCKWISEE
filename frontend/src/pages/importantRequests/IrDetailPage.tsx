import { useEffect, useState } from 'react'
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle, Ban, CalendarClock, CheckCircle2, ChevronDown, CornerDownRight, History, Loader2, Lock, MessageSquare, Pencil, RotateCcw, Send, Trash2, Undo2, Upload, Users,
} from 'lucide-react'
import {
  useDeleteIr, useIr, useIrAct, useIrActivities, useIrAddFiles, useIrCancel, useIrComment, useIrComments, useIrDeadline, useIrDeleteComment, useIrDeleteFile,
  useIrEditComment, useIrReopen, useIrReview, useSendIr, type IrComment, type IrDetail, type IrFile,
} from '@/features/importantRequests/api'
import { IrFileList, IrFilePicker, IrPriorityBadge, IrStatusBadge, fmtDateTime, readyTokens, type PickedFile } from '@/components/importantRequests/IrParts'
import { BackLink } from '@/components/BackLink'
import { useAuth } from '@/auth/AuthContext'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { Textarea } from '@/components/ui/textarea'
import { confirmDialog } from '@/components/ui/confirm'
import { apiErrorMessage } from '@/lib/api'
import { invalidTo, toast } from '@/lib/notify'
import { cn } from '@/lib/utils'

type Tab = 'instructions' | 'results'

/** A mutation call with the app's popups: 😊 on success, 😆 / 😢 on an error. */
function run<T>(m: { mutateAsync: (b: T) => Promise<unknown> }, body: T, ok: string, after?: () => void) {
  return m.mutateAsync(body).then(() => { toast.success(ok); after?.() }).catch((e) => toast.fromError(e, apiErrorMessage(e)))
}

/** A reason (and optionally a date) asked before an action. */
function ReasonDialog({ open, title, label, withDate, dateLabel, required = true, confirm, onClose, onSubmit, busy }: {
  open: boolean; title: string; label: string; withDate?: boolean; dateLabel?: string; required?: boolean; confirm: string
  onClose: () => void; onSubmit: (reason: string, date: string) => void; busy?: boolean
}) {
  const [reason, setReason] = useState('')
  const [date, setDate] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const submit = () => {
    if (required && !reason.trim()) return invalidTo(setErr, `${label} is required.`)
    if (withDate && !date) return invalidTo(setErr, `${dateLabel ?? 'Date'} is required.`)
    onSubmit(reason.trim(), date ? new Date(date).toISOString() : '')
  }
  return (
    <Modal open={open} onClose={onClose} title={title} className="max-w-md"
      footer={<><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" disabled={busy} onClick={submit}>{busy && <Loader2 className="size-4 animate-spin" />}{confirm}</Button></>}>
      <div className="space-y-3">
        {withDate && <div className="space-y-1.5"><Label htmlFor="rd-date">{dateLabel}</Label><Input id="rd-date" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} /></div>}
        <div className="space-y-1.5"><Label htmlFor="rd-reason">{label}{required && ' *'}</Label><Textarea id="rd-reason" rows={3} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} autoFocus /></div>
        {err && <p className="text-sm text-destructive">{err}</p>}
      </div>
    </Modal>
  )
}

/** A person's round initials (like Classroom's avatars). */
function Avatar({ name, className }: { name: string | null; className?: string }) {
  const initials = (name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  return <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary', className)}>{initials || '?'}</span>
}

/** A recipient's part, worded and colored like Classroom ("Ditugaskan", "Diserahkan", "Terlambat"…). */
function partTone(status: string, late?: boolean): string {
  if (late) return 'text-red-600'
  return status === 'SELESAI' ? 'text-emerald-700' : status === 'REVISI' ? 'text-orange-700' : status === 'ON_REVIEW' ? 'text-blue-700' : status.startsWith('DISERAHKAN') ? 'text-emerald-700' : 'text-muted-foreground'
}

/** The creator's other actions (edit, deadline, cancel, delete draft, reopen) — compact, with their dialogs. */
function CreatorActions({ r }: { r: IrDetail }) {
  const navigate = useNavigate()
  const del = useDeleteIr(r.id)
  const deadline = useIrDeadline(r.id)
  const cancel = useIrCancel(r.id)
  const reopen = useIrReopen(r.id)
  const [dialog, setDialog] = useState<null | 'deadline' | 'cancel' | 'reopen'>(null)
  const close = () => setDialog(null)
  const show = (r.me.is_creator && (r.me.can_edit || r.me.can_cancel || r.me.can_delete)) || r.me.can_reopen
  if (!show) return null
  return (
    <>
      <div className="flex flex-wrap gap-1 border-t bg-muted/20 px-2 py-2">
        {r.me.is_creator && r.me.can_edit && <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => navigate(`/important-requests/${r.id}/ubah`)}><Pencil className="size-3.5" /> Edit</Button>}
        {r.me.is_creator && r.me.can_cancel && <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setDialog('deadline')}><CalendarClock className="size-3.5" /> Change deadline</Button>}
        {r.me.can_reopen && <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setDialog('reopen')}><RotateCcw className="size-3.5" /> Reopen</Button>}
        {r.me.is_creator && r.me.can_cancel && <Button size="sm" variant="ghost" className="h-8 text-xs text-red-700 hover:text-red-800" onClick={() => setDialog('cancel')}><Ban className="size-3.5" /> Cancel</Button>}
        {r.me.is_creator && r.me.can_delete && (
          <Button size="sm" variant="ghost" className="h-8 text-xs text-red-700" onClick={async () => { if (await confirmDialog({ message: 'Delete this draft?', danger: true })) run(del, undefined, 'Draft dihapus.', () => navigate('/important-requests/saya')) }}>
            <Trash2 className="size-3.5" /> Delete draft
          </Button>
        )}
      </div>
      <ReasonDialog open={dialog === 'deadline'} title="Change deadline" label="Reason for the change" withDate dateLabel="New deadline" confirm="Save" busy={deadline.isPending} onClose={close}
        onSubmit={(reason, date) => run(deadline, { deadline: date, reason }, 'Tenggat diubah.', close)} />
      <ReasonDialog open={dialog === 'cancel'} title={`Cancel ${r.number}?`} label="Cancellation reason" confirm="Cancel request" busy={cancel.isPending} onClose={close}
        onSubmit={(reason) => run(cancel, { reason }, 'Request dibatalkan.', close)} />
      <ReasonDialog open={dialog === 'reopen'} title={`Reopen ${r.number}?`} label="Reason" confirm="Reopen" busy={reopen.isPending} onClose={close}
        onSubmit={(reason) => run(reopen, { reason }, 'Request dibuka kembali.', close)} />
    </>
  )
}

/** Classroom's "Tugas Anda": my part — add the work and hand it in, or withdraw it while not reviewed. */
function MyWork({ r }: { r: IrDetail }) {
  const act = useIrAct(r.id)
  const [note, setNote] = useState('')
  const [files, setFiles] = useState<PickedFile[]>([])
  const mine = r.me.assignee!
  const open = !['SELESAI', 'DIBATALKAN', 'DRAFT'].includes(r.status)
  const toDo = open && ['DITUGASKAN', 'REVISI'].includes(mine.status)
  const handedIn = open && ['DISERAHKAN', 'DISERAHKAN_TERLAMBAT', 'ON_REVIEW'].includes(mine.status)
  const onReview = mine.status === 'ON_REVIEW'
  const lateNow = !!r.deadline && new Date(r.deadline).getTime() < Date.now()
  const myWork = r.submissions.filter((s) => s.assignee_id === mine.id)
  const last = myWork[0]
  const returned = mine.status === 'REVISI' ? myWork.find((s) => s.status === 'REVISI') : undefined
  const state = mine.status === 'SELESAI' ? 'Done' : onReview ? 'On Review' : handedIn ? (mine.status === 'DISERAHKAN_TERLAMBAT' ? 'Submitted (terlambat)' : 'Submitted')
    : mine.status === 'REVISI' ? 'Needs revision' : mine.late ? 'Terlambat' : 'Ditugaskan'

  const submit = async () => {
    const tokens = readyTokens(files)
    if (tokens === null) return toast.invalid('Wait for the file upload to finish.')
    if (!note.trim() && tokens.length === 0) return toast.invalid('Add a result file or write a work note.')
    if (!(await confirmDialog({ title: 'Submit the task?', message: `Result sent to ${r.creator ?? 'request creator'} for review.${lateNow ? ' The deadline has passed: recorded as submitted late.' : ''} Until it is reviewed, you can still withdraw it.`, confirmLabel: 'Submit' }))) return
    run(act, { action: 'submit', note: note.trim() || null, attachments: tokens }, lateNow ? 'Task submitted (late).' : 'Task submitted.', () => { setNote(''); setFiles([]) })
  }

  return (
    <Card className="overflow-hidden rounded-lg shadow-md">
      <div className="space-y-3 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-normal">Your tasks</h2>
          <span className={cn('text-sm font-medium', partTone(mine.status, mine.late && toDo))}>{state}</span>
        </div>
        {returned?.review_note && (
          <div className="rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-900"><span className="block text-xs font-medium">Returned {returned.reviewed_by ? `by ${returned.reviewed_by}` : ''}</span>{returned.review_note}</div>
        )}

        {toDo && (
          <div className="space-y-2.5">
            <div className="[&>div>button]:w-full [&>div>button]:justify-center [&>div>button]:text-primary"><IrFilePicker files={files} onChange={setFiles} maxMb={r.me.max_mb} label="Add file" compact /></div>
            <Textarea rows={2} value={note} maxLength={5000} onChange={(e) => setNote(e.target.value)} placeholder="Notes for the task giver (optional)" />
            <Button className="w-full" disabled={act.isPending} onClick={submit}><Upload className="size-4" /> {mine.status === 'REVISI' ? 'Submit revision' : 'Submit'}</Button>
            {lateNow && <p className="text-center text-xs text-red-600">The deadline has passed: it will be recorded as late.</p>}
          </div>
        )}

        {!toDo && last && (
          <div className="space-y-2">
            {last.note && <p className="whitespace-pre-wrap rounded-lg bg-muted/50 px-3 py-2 text-sm">{last.note}</p>}
            <IrFileList requestId={r.id} files={last.files} />
            <p className="text-xs text-muted-foreground">Handed Over {fmtDateTime(last.created_at)}{last.reviewed_by ? ` · reviewed ${last.reviewed_by}` : ''}</p>
          </div>
        )}

        {onReview && <p className="text-sm text-blue-700">{r.creator ?? 'Task giver'} is reviewing your result.</p>}
        {handedIn && !onReview && (
          <Button variant="outline" className="w-full" disabled={act.isPending}
            onClick={async () => { if (await confirmDialog({ title: 'Withdraw the submission?', message: 'The result is withdrawn so it can be corrected and submitted again.', confirmLabel: 'Withdraw' })) run(act, { action: 'unsubmit' }, 'Penyerahan ditarik.') }}>
            <Undo2 className="size-4" /> Withdraw submission
          </Button>
        )}
        {mine.status === 'SELESAI' && <p className="flex items-center gap-1.5 text-sm text-emerald-700"><CheckCircle2 className="size-4" /> Your result is approved.</p>}
      </div>
    </Card>
  )
}

/** The creator's card: how many handed in / assigned (like Classroom's counts), the send button for a draft. */
function RecipientsCard({ r, onResults }: { r: IrDetail; onResults: () => void }) {
  const send = useSendIr(r.id)
  const handed = r.assignees.filter((a) => a.status.startsWith('DISERAHKAN') || a.status === 'ON_REVIEW').length
  const done = r.assignees.filter((a) => a.status === 'SELESAI').length
  const todo = r.assignees.length - handed - done
  const toReview = r.submissions.filter((s) => s.can_review).length
  return (
    <Card className="overflow-hidden rounded-lg shadow-md">
      <div className="space-y-4 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-normal">Recipient</h2>
          <span className="text-xs text-muted-foreground">{r.assignees.length} people</span>
        </div>
        {r.status === 'DRAFT' ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Still a draft: not visible to the recipient yet.</p>
            {r.me.can_send && <Button className="w-full" onClick={async () => { if (await confirmDialog({ title: 'Send request?', message: `${r.number} sent to ${r.assignees.length} recipients.`, confirmLabel: 'Send' })) run(send, undefined, 'Request sent.') }}><Send className="size-4" /> Assign</Button>}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 divide-x text-center">
              {([[handed, 'Handed Over'], [todo, 'Assigned'], [done, 'Done']] as const).map(([n, label]) => (
                <div key={label}><div className="text-3xl font-light tabular-nums">{n}</div><div className="text-xs text-muted-foreground">{label}</div></div>
              ))}
            </div>
            <Button variant={toReview ? 'default' : 'outline'} className="w-full" onClick={onResults}>
              {toReview ? `Review ${toReview} result` : 'View assignee results'}
            </Button>
          </>
        )}
        <ul className="space-y-2">
          {r.assignees.map((a) => (
            <li key={a.id} className="flex items-center gap-2.5 text-sm">
              <Avatar name={a.name} />
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
              <span className={cn('shrink-0 text-xs', partTone(a.status, a.late))}>{a.late ? 'Late' : a.status_label}</span>
            </li>
          ))}
        </ul>
      </div>
      <CreatorActions r={r} />
    </Card>
  )
}

/** Classroom's class comments: everyone on the request talks here. */
function Comments({ r }: { r: IrDetail }) {
  const { user } = useAuth()
  const [page, setPage] = useState(1)
  const { data, isLoading } = useIrComments(r.id, page)
  const [replyTo, setReplyTo] = useState<number | null>(null)
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-[15px] font-medium"><Users className="size-4 text-muted-foreground" /> Comments{data?.meta.total ? ` (${data.meta.total})` : ''}</h2>
      {isLoading && <p className="text-sm text-muted-foreground">Loading comments…</p>}
      <div className="space-y-3">
        {data?.data.map((c) => (
          <div key={c.id} className="flex gap-3">
            <Avatar name={c.user} />
            <div className="min-w-0 flex-1 space-y-2">
              <CommentItem r={r} c={c} onReply={() => setReplyTo(replyTo === c.id ? null : c.id)} />
              {(c.replies?.length ?? 0) > 0 && (
                <div className="space-y-2 border-l-2 pl-3">
                  {c.replies!.map((x) => <div key={x.id} className="flex gap-1.5"><CornerDownRight className="mt-2 size-3.5 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><CommentItem r={r} c={x} /></div></div>)}
                </div>
              )}
              {replyTo === c.id && r.me.can_comment && <div className="border-l-2 pl-3"><Composer r={r} parentId={c.id} onDone={() => setReplyTo(null)} placeholder={`Reply ${c.user}…`} /></div>}
            </div>
          </div>
        ))}
      </div>
      {data && data.meta.last_page > 1 && (
        <div className="flex justify-center gap-2 text-sm">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</Button>
          <span className="self-center tabular-nums text-muted-foreground">{data.meta.page} / {data.meta.last_page}</span>
          <Button size="sm" variant="outline" disabled={page >= data.meta.last_page} onClick={() => setPage(page + 1)}>Older</Button>
        </div>
      )}
      {r.me.can_comment ? (
        <div className="flex gap-3"><Avatar name={user?.name ?? null} /><div className="min-w-0 flex-1"><Composer r={r} placeholder="Add a comment… mention people with @username" /></div></div>
      ) : r.me.discussion_closed ? (
        <p className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground"><Lock className="size-4 shrink-0" />
          Forum closed; the request is already {r.status === 'SELESAI' ? 'approved & completed' : 'cancelled'}. The discussion can still be read.</p>
      ) : <p className="text-sm text-muted-foreground">Comments open after the request is assigned.</p>}
    </section>
  )
}

const ACTIVITY: Record<string, string> = {
  CREATED: 'Created the request', EDITED: 'Edited the request', ASSIGNEES_CHANGED: 'Changed the recipients', SENT: 'Assigned the request',
  CONFIRMED: 'Confirmed the task', FILE_UPLOADED: 'Added a file', FILE_DELETED: 'Deleted a file', SUBMITTED: 'Submitted a result', UNSUBMITTED: 'Withdrew a submission',
  REVIEW_STARTED: 'Started the review', APPROVED: 'Approved a result', REVISION_REQUESTED: 'Returned a result for revision',
  DEADLINE_CHANGED: 'Changed the deadline', CANCELLED: 'Cancelled the request', REOPENED: 'Reopened the request', COMPLETED: 'Request completed', OVERDUE: 'Deadline passed',
  COMMENTED: 'Commented', REPLIED: 'Replied', COMMENT_EDITED: 'Edited a comment', COMMENT_DELETED: 'Deleted a comment',
}

/** What happened on the request, newest first; read-only, so it stays open after the forum closes. Loaded when unfolded. */
function ActivityHistory({ r }: { r: IrDetail }) {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(1)
  const { data, isLoading, isError } = useIrActivities(r.id, page, open)
  return (
    <section className="space-y-3">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 text-left text-[15px] font-medium">
        <History className="size-4 text-muted-foreground" /> Activity history
        <ChevronDown className={cn('ml-auto size-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && isLoading && <p className="text-sm text-muted-foreground">Loading history…</p>}
      {open && isError && <p className="text-sm text-destructive">Failed to load the history.</p>}
      {open && data && (
        <ul className="space-y-2.5">
          {data.data.map((a) => {
            const why = a.meta?.alasan ?? a.meta?.catatan
            return (
              <li key={a.id} className="text-sm">
                <span className="font-medium">{a.user}</span> <span className="text-muted-foreground">· {ACTIVITY[a.action] ?? a.action} · {fmtDateTime(a.created_at)}</span>
                {typeof why === 'string' && why && <p className="whitespace-pre-wrap text-muted-foreground">{why}</p>}
              </li>
            )
          })}
        </ul>
      )}
      {open && data && data.meta.last_page > 1 && (
        <div className="flex justify-center gap-2 text-sm">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</Button>
          <span className="self-center tabular-nums text-muted-foreground">{data.meta.page} / {data.meta.last_page}</span>
          <Button size="sm" variant="outline" disabled={page >= data.meta.last_page} onClick={() => setPage(page + 1)}>Older</Button>
        </div>
      )}
    </section>
  )
}

function CommentItem({ r, c, onReply }: { r: IrDetail; c: IrComment; onReply?: () => void }) {
  const edit = useIrEditComment(r.id)
  const del = useIrDeleteComment(r.id)
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(c.body ?? '')
  return (
    <div className={cn('rounded-lg px-3 py-2', c.is_new && 'bg-amber-50 ring-1 ring-amber-200', c.kind === 'BLOCKER' && 'bg-red-50', c.kind === 'PROGRESS' && 'bg-blue-50/60')}>
      <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
        <span className="font-semibold text-foreground">{c.user}</span>
        <span className="text-muted-foreground">{fmtDateTime(c.created_at)}{c.edited && ' · edited'}</span>
        {c.is_new && <span className="rounded bg-amber-500 px-1.5 text-[10px] font-semibold text-white">new</span>}
        {c.kind === 'PROGRESS' && <span className="text-blue-700">progress</span>}
        {c.kind === 'BLOCKER' && <span className="text-red-700">problems</span>}
      </div>
      {c.deleted ? <p className="mt-1 text-sm italic text-muted-foreground">Message deleted.</p> : editing ? (
        <div className="mt-1 space-y-2">
          <Textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="flex gap-2"><Button size="sm" disabled={edit.isPending} onClick={() => run(edit, { comment: c.id, body }, 'Comment changed.', () => setEditing(false))}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button></div>
        </div>
      ) : <p className="mt-1 whitespace-pre-wrap text-sm">{c.body}</p>}
      {c.files.length > 0 && <div className="mt-2"><IrFileList requestId={r.id} files={c.files} /></div>}
      {!c.deleted && !editing && (
        <div className="mt-1 flex gap-3 text-xs">
          {onReply && r.me.can_comment && <button type="button" className="font-medium text-primary hover:underline" onClick={onReply}>Reply</button>}
          {c.can_edit && <button type="button" className="text-muted-foreground hover:underline" onClick={() => setEditing(true)}>Edit</button>}
          {c.can_delete && <button type="button" className="text-muted-foreground hover:text-destructive hover:underline" onClick={async () => { if (await confirmDialog({ message: 'Delete this comment?', danger: true })) run(del, c.id, 'Comment deleted.') }}>Delete</button>}
        </div>
      )}
    </div>
  )
}

function Composer({ r, parentId, onDone, placeholder }: { r: IrDetail; parentId?: number; onDone?: () => void; placeholder: string }) {
  const add = useIrComment(r.id)
  const [body, setBody] = useState('')
  const [files, setFiles] = useState<PickedFile[]>([])
  const [wide, setWide] = useState(false)
  const submit = () => {
    const tokens = readyTokens(files)
    if (tokens === null) return toast.invalid('Wait for the file upload to finish.')
    if (!body.trim() && tokens.length === 0) return toast.invalid('Write a comment or attach a file.')
    run(add, { body: body.trim(), parent_id: parentId ?? null, attachments: tokens }, parentId ? 'Balasan terkirim.' : 'Comment sent.', () => { setBody(''); setFiles([]); onDone?.() })
  }
  return (
    // one line like Classroom's comment box; it grows (with the file button) once you write
    <div className="space-y-2">
      <div className={cn('flex items-end gap-2 rounded-lg border bg-card px-3 py-1.5 focus-within:border-primary', wide && 'rounded-lg')}>
        <Textarea rows={wide ? 3 : 1} value={body} maxLength={5000} onChange={(e) => setBody(e.target.value)} onFocus={() => setWide(true)} placeholder={placeholder}
          className="min-h-0 flex-1 resize-none border-0 bg-transparent px-1 py-1.5 shadow-none focus-visible:ring-0" />
        <Button size="sm" variant="ghost" className="h-8 w-8 shrink-0 rounded-full p-0 text-primary" disabled={add.isPending} onClick={submit} aria-label={parentId ? 'Reply' : 'Send comment'}><Send className="size-4" /></Button>
      </div>
      {(wide || files.length > 0) && <IrFilePicker files={files} onChange={setFiles} maxMb={r.me.max_mb} label="Attach file" compact />}
    </div>
  )
}

const SUB_STATUS: Record<string, { label: string; cls: string }> = {
  MENUNGGU_REVIEW: { label: 'Submitted', cls: 'bg-amber-50 text-amber-800' },
  DISETUJUI: { label: 'Approved', cls: 'bg-emerald-50 text-emerald-700' },
  REVISI: { label: 'Returned for revision', cls: 'bg-orange-50 text-orange-800' },
  OTOMATIS: { label: 'Done', cls: 'bg-emerald-50 text-emerald-700' },
  DITARIK: { label: 'Withdrawn', cls: 'bg-slate-100 text-slate-600' },
}

/** "Petunjuk": what to do — instructions, files, comments (left of the page). */
function Instructions({ r }: { r: IrDetail }) {
  const add = useIrAddFiles(r.id)
  const del = useIrDeleteFile(r.id)
  const [files, setFiles] = useState<PickedFile[]>([])
  const remove = async (f: IrFile) => { if (await confirmDialog({ message: `Delete ${f.name}?`, danger: true })) run(del, f.id, 'File dihapus.') }
  return (
    <div className="space-y-4">
      {r.cancel_reason && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">Cancelled: {r.cancel_reason}</div>}
      <div className="whitespace-pre-wrap text-[15px] leading-relaxed">{r.description}</div>
      {(r.attachments.length > 0 || r.me.can_edit) && (
        <div className="space-y-2">
          <IrFileList requestId={r.id} files={r.attachments} onDelete={r.me.can_edit ? remove : undefined} cards />
          {r.me.can_edit && (
            <div className="space-y-2">
              <IrFilePicker files={files} onChange={setFiles} maxMb={r.me.max_mb} label="+ Add attachment" />
              {files.length > 0 && <Button size="sm" disabled={add.isPending} onClick={() => { const t = readyTokens(files); if (!t) return toast.invalid('Wait for the upload to finish.'); run(add, { attachments: t }, 'File ditambahkan.', () => setFiles([])) }}>Save file</Button>}
            </div>
          )}
        </div>
      )}
      <div className="border-t pt-5"><Comments r={r} /></div>
      {r.status !== 'DRAFT' && <div className="border-t pt-4"><ActivityHistory r={r} /></div>}
    </div>
  )
}

/** "Hasil penerima" (Classroom's student work): the people on the left, the picked one's work and its review. */
function Results({ r }: { r: IrDetail }) {
  const review = useIrReview(r.id)
  // the reviewer's note (optional), for approving or returning
  const [notes, setNotes] = useState<Record<number, string>>({})
  const noteOf = (id: number) => notes[id]?.trim() || null
  const first = r.assignees.find((a) => r.submissions.some((s) => s.assignee_id === a.id && s.can_review)) ?? r.assignees[0]
  const [picked, setPicked] = useState<number | null>(first?.id ?? null)
  const who = r.assignees.find((a) => a.id === picked)
  const work = r.submissions.filter((s) => s.assignee_id === picked)
  return (
    <div className="grid gap-4 md:grid-cols-[16rem_minmax(0,1fr)]">
      <Card className="h-fit overflow-hidden rounded-lg">
        <ul className="divide-y">
          {r.assignees.map((a) => {
            const waiting = r.submissions.some((s) => s.assignee_id === a.id && s.can_review)
            return (
              <li key={a.id}>
                <button type="button" onClick={() => setPicked(a.id)}
                  className={cn('flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-muted/50', picked === a.id && 'bg-blue-50 shadow-[inset_3px_0_0_theme(colors.blue.500)]')}>
                  <Avatar name={a.name} />
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{a.name}</span>
                    <span className={cn('block text-xs', partTone(a.status, a.late))}>{a.late ? 'Late' : a.status_label}</span></span>
                  {waiting && <span className="size-2 shrink-0 rounded-full bg-amber-500" title="Waiting for review" />}
                </button>
              </li>
            )
          })}
        </ul>
      </Card>

      <div className="space-y-3">
        {who && (
          <div className="flex items-center gap-3 px-1">
            <Avatar name={who.name} className="size-10 text-sm" />
            <div><div className="font-medium">{who.name}</div><div className="text-xs text-muted-foreground">{[who.position, who.submitted_at && `diserahkan ${fmtDateTime(who.submitted_at)}`].filter(Boolean).join(' · ')}</div></div>
          </div>
        )}
        {work.length === 0 && <Card className="rounded-lg p-8 text-center text-sm text-muted-foreground">No results submitted yet.</Card>}
        {work.map((s) => (
          <Card key={s.id} className="space-y-3 rounded-lg p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm">{s.round > 1 ? `Revision no.${s.round - 1}` : 'First result'} · <span className="text-muted-foreground">{fmtDateTime(s.created_at)}</span></div>
              {s.status === 'MENUNGGU_REVIEW' && who?.status === 'ON_REVIEW'
                ? <span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">On Review</span>
                : <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', SUB_STATUS[s.status]?.cls)}>{SUB_STATUS[s.status]?.label ?? s.status}</span>}
            </div>
            {s.note && <p className="whitespace-pre-wrap text-sm">{s.note}</p>}
            <IrFileList requestId={r.id} files={s.files} cards />
            {s.reviewed_by && <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm"><span className="font-medium">{s.reviewed_by}</span> · {fmtDateTime(s.reviewed_at)}{s.review_note ? `: ${s.review_note}` : ''}</div>}
            {s.can_review && (
              <div className="space-y-2 border-t pt-3">
                <Label htmlFor={`rv-note-${s.id}`}>Notes <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Textarea id={`rv-note-${s.id}`} rows={2} maxLength={2000} value={notes[s.id] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [s.id]: e.target.value }))}
                  placeholder="e.g. what needs revising, or a note for the recipient" />
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="outline" className="border-orange-300 text-orange-700 hover:bg-orange-50" disabled={review.isPending}
                    onClick={async () => { if (await confirmDialog({ title: 'Return for revision?', message: `Result ${s.user} returned for correction.`, confirmLabel: 'Return' })) run(review, { submission: s.id, approve: false, note: noteOf(s.id) }, 'Returned for revision.', () => setNotes((n) => ({ ...n, [s.id]: '' }))) }}>
                    <Undo2 className="size-4" /> Return
                  </Button>
                  <Button className="" disabled={review.isPending}
                    onClick={async () => { if (await confirmDialog({ title: 'Approve the result?', message: `Result ${s.user} approved: this part is done.`, confirmLabel: 'Approve' })) run(review, { submission: s.id, approve: true, note: noteOf(s.id) }, 'Result approved.', () => setNotes((n) => ({ ...n, [s.id]: '' }))) }}>
                    <CheckCircle2 className="size-4" /> Approve
                  </Button>
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}

/**
 * The reviewer leaving a request with results still On Review: a popup asks the last status first —
 * "On Review" (leave it, review later) or "Selesai Review" (approve them) — and only then the page closes.
 */
function ReviewLeaveGuard({ r }: { r: IrDetail }) {
  const review = useIrReview(r.id)
  const pending = r.submissions.filter((s) => s.can_review)
  const blocker = useBlocker(({ currentLocation, nextLocation }) => pending.length > 0 && currentLocation.pathname !== nextLocation.pathname)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!pending.length) return
    // closing the tab / reloading: the browser's own "leave the page?" (a custom popup is not allowed there)
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [pending.length])
  if (blocker.state !== 'blocked') return null
  const finish = async () => {
    setBusy(true)
    try {
      for (const s of pending) await review.mutateAsync({ submission: s.id, approve: true, note: null })
      toast.success(`${pending.length} results approved: review finished.`)
      blocker.proceed?.()
    } catch (e) {
      toast.fromError(e, apiErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={() => !busy && blocker.reset?.()} title="Last review status?" className="max-w-md">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          There is still <b className="text-foreground">{pending.length} result</b> ({pending.map((s) => s.user).filter(Boolean).join(', ')}) you are reviewing. Pick the last status before closing the page.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="outline" className="h-auto flex-col gap-0.5 border-blue-300 py-3 text-blue-700 hover:bg-blue-50" disabled={busy} onClick={() => blocker.proceed?.()}>
            <span className="font-semibold">On Review</span><span className="text-xs font-normal">continue the review later</span>
          </Button>
          <Button className="h-auto flex-col gap-0.5 bg-emerald-600 py-3 text-white hover:bg-emerald-700" disabled={busy} onClick={finish}>
            <span className="flex items-center gap-1.5 font-semibold">{busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Review Finished</span><span className="text-xs font-normal">approve the result</span>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Needs revision? <button type="button" className="text-primary hover:underline" disabled={busy} onClick={() => blocker.reset?.()}>Back to page</button> then click Return in Assignee results.</p>
      </div>
    </Modal>
  )
}

/**
 * Important Request, laid out like a Google Classroom assignment: the instructions on the left (title,
 * from whom, the due date, files, comments) and "Tugas Anda" on the right; the creator also gets
 * "Hasil penerima" — each recipient's work to approve or return.
 */
export function IrDetailPage() {
  const { id } = useParams()
  const { data: r, isLoading, isError } = useIr(Number(id))
  const [tab, setTab] = useState<Tab>('instructions')
  if (isError) return <div className="space-y-4"><BackLink keep to="/important-requests" label="Important Request" /><p className="text-sm text-destructive">Request not found or not for you.</p></div>
  if (isLoading || !r) return <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>
  const closed = ['SELESAI', 'DIBATALKAN', 'DRAFT'].includes(r.status)
  const toReview = r.submissions.filter((s) => s.can_review).length

  return (
    <div className="space-y-4 pb-8">
      <BackLink keep to={r.me.is_creator ? '/important-requests/saya' : '/important-requests/tugas'} label={r.me.is_creator ? 'My Requests' : 'My Tasks'} />

      {r.me.is_creator && r.status !== 'DRAFT' && (
        // like Classroom's "Petunjuk | Tugas siswa"
        <div className="flex justify-center border-b" role="tablist">
          {([['instructions', 'Instructions'], ['results', 'Assignee results']] as const).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={cn('-mb-px flex items-center gap-1.5 border-b-[3px] px-5 pb-2.5 pt-1 text-sm font-medium', tab === k ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
              {label}{k === 'results' && toReview > 0 && <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">{toReview}</span>}
            </button>
          ))}
        </div>
      )}

      {tab === 'results' && r.me.is_creator ? <Results r={r} /> : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-5">
            <header className="flex gap-3 border-b-2 border-primary/70 pb-4 sm:gap-4">
              <div className="min-w-0 flex-1 space-y-1">
                <h1 className="break-words text-xl font-semibold leading-tight tracking-tight sm:text-2xl">{r.title}</h1>
                <div className="text-sm text-muted-foreground">{r.creator ?? '-'} · {fmtDateTime(r.sent_at ?? r.created_at)}</div>
                <div className="flex flex-wrap items-center gap-2 pt-1 text-sm">
                  <span className="text-[13px] text-muted-foreground">{r.number}</span>
                  <IrPriorityBadge priority={r.priority} />
                  <IrStatusBadge status={r.status} label={r.status_label} />
                  {r.unread_comments > 0 && <span className="inline-flex items-center gap-1 text-xs text-primary"><MessageSquare className="size-3.5" />{r.unread_comments} new comments</span>}
                </div>
              </div>
              {/* the due date, top right like Classroom's "Tenggat" */}
              <div className="shrink-0 text-right">
                <div className="text-xs text-muted-foreground">Deadline</div>
                <div className={cn('text-sm font-medium', r.overdue && !closed && 'text-red-600')}>{r.deadline ? fmtDateTime(r.deadline) : 'No deadline'}</div>
                {r.overdue && !closed && <div className="inline-flex items-center gap-1 text-xs font-medium text-red-600"><AlertTriangle className="size-3" /> Late</div>}
              </div>
            </header>
            {/* phone: my part right under the title */}
            <div className="space-y-4 lg:hidden">
              {r.me.assignee && <MyWork r={r} />}
              {r.me.is_creator && <RecipientsCard r={r} onResults={() => setTab('results')} />}
            </div>
            <Instructions r={r} />
          </div>
          <aside className="hidden lg:block">
            <div className="sticky top-20 space-y-4">
              {r.me.assignee && <MyWork r={r} />}
              {r.me.is_creator && <RecipientsCard r={r} onResults={() => setTab('results')} />}
              {!r.me.assignee && !r.me.is_creator && <CreatorActions r={r} />}
            </div>
          </aside>
        </div>
      )}
      {r.me.is_creator && <ReviewLeaveGuard r={r} />}
      {r.me.is_creator && r.status === 'DRAFT' && <p className="text-xs text-muted-foreground">Draft: not visible to the recipient yet. <Link to={`/important-requests/${r.id}/ubah`} className="text-primary hover:underline">Complete</Link> then assign.</p>}
    </div>
  )
}
