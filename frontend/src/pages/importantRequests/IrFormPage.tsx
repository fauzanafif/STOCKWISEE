import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Save, Search, Send, X } from 'lucide-react'
import { useCreateIr, useIr, useIrRecipients, useSendIr, useUpdateIr, type IrPayload, type IrPriority } from '@/features/importantRequests/api'
import { IrFilePicker, IrFileList, readyTokens, type PickedFile } from '@/components/importantRequests/IrParts'
import { BackLink } from '@/components/BackLink'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { confirmDialog } from '@/components/ui/confirm'
import { apiErrorMessage } from '@/lib/api'
import { invalidTo, toast } from '@/lib/notify'
import { cn } from '@/lib/utils'

const toLocal = (v: string | null | undefined) => (v ? new Date(new Date(v).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '')

/** Picking a priority sets the deadline: Rendah 3 days, Sedang 2, Tinggi 1, Urgent the end of today. */
const DAYS: Record<IrPriority, number> = { LOW: 3, MEDIUM: 2, HIGH: 1, URGENT: 0 }
const deadlineFor = (p: IrPriority, now = new Date()) => {
  const d = new Date(now)
  if (DAYS[p] === 0) d.setHours(23, 59, 0, 0)
  else d.setDate(d.getDate() + DAYS[p])
  return toLocal(d.toISOString())
}

/** Buat / ubah Important Request: a draft is all editable; once sent, the content and more recipients. */
export function IrFormPage() {
  const { id } = useParams()
  const editId = Number(id) || 0
  const navigate = useNavigate()
  const existing = useIr(editId)
  const r = existing.data
  const sent = !!r && r.status !== 'DRAFT'
  const recipients = useIrRecipients(true)
  const create = useCreateIr()
  const update = useUpdateIr(editId)
  const sendIt = useSendIr(editId)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<IrPriority>('MEDIUM')
  const [deadline, setDeadline] = useState(() => (editId ? '' : deadlineFor('MEDIUM')))
  const [picked, setPicked] = useState<number[]>([])
  const [who, setWho] = useState('')
  const [files, setFiles] = useState<PickedFile[]>([])
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!r) return
    setTitle(r.title); setDescription(r.description); setPriority(r.priority); setDeadline(toLocal(r.deadline))
    setPicked(r.assignees.map((a) => a.user_id))
  }, [r])

  const locked = new Set(sent ? r!.assignees.map((a) => a.user_id) : [])
  const people = useMemo(() => {
    const q = who.trim().toLowerCase()
    return (recipients.data ?? []).filter((p) => !q || `${p.name} ${p.username} ${p.division ?? ''} ${p.position ?? ''}`.toLowerCase().includes(q))
  }, [recipients.data, who])
  const toggle = (uid: number) => !locked.has(uid) && setPicked((p) => (p.includes(uid) ? p.filter((x) => x !== uid) : [...p, uid]))

  const save = async (send: boolean) => {
    setErr(null)
    if (!title.trim()) return invalidTo(setErr, 'The title is required.')
    if (!description.trim()) return invalidTo(setErr, 'Description / instructions are required.')
    if (send && picked.length === 0) return invalidTo(setErr, 'Select at least one recipient.')
    if (send && !deadline) return invalidTo(setErr, 'Fill in the deadline before sending.')
    if (deadline && !sent && new Date(deadline).getTime() <= Date.now()) return invalidTo(setErr, 'The deadline must be later than now.')
    const tokens = readyTokens(files)
    if (tokens === null) return invalidTo(setErr, 'Wait for the file upload to finish (or delete failed ones).')
    if (send && !(await confirmDialog({
      title: 'Send request?',
      message: `"${title.trim()}" sent to ${picked.length} recipients. They get a notification and the request cannot go back to draft.`,
      confirmLabel: 'Send',
    }))) return
    const body: IrPayload = {
      title: title.trim(), description: description.trim(), priority,
      assignee_ids: picked, attachments: tokens,
      ...(sent ? {} : { deadline: deadline ? new Date(deadline).toISOString() : null }),
    }
    try {
      if (editId) {
        await update.mutateAsync(body)
        if (send) await sendIt.mutateAsync(undefined)
        toast.success(send ? 'Request sent.' : 'Changes saved.')
        navigate(`/important-requests/${editId}`)
      } else {
        const made = await create.mutateAsync({ ...body, send })
        toast.success(send ? 'Request sent to recipients.' : 'Draft saved.')
        navigate(`/important-requests/${made.id}`)
      }
    } catch (e) {
      setErr(apiErrorMessage(e))
      toast.fromError(e, apiErrorMessage(e))
    }
  }

  if (editId && existing.isLoading) return <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>
  if (editId && r && !r.me.can_edit) return <p className="text-sm text-destructive">This request cannot be changed.</p>
  const busy = create.isPending || update.isPending

  const chosen = (recipients.data ?? []).filter((p) => picked.includes(p.id))
  const PRIORITY: [IrPriority, string, string][] = [['LOW', 'Rendah', ''], ['MEDIUM', 'Sedang', ''], ['HIGH', 'Tinggi', 'text-orange-700'], ['URGENT', 'Urgent', 'text-red-700']]

  // like Classroom's "Buat tugas": the work on the left, who / when / how urgent on the right, the buttons on top
  return (
    <div className="space-y-4 pb-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <BackLink keep to={editId ? `/important-requests/${editId}` : '/important-requests'} label={editId ? (r?.number ?? 'Request') : 'Important Request'} />
          <h1 className="mt-1 text-xl font-semibold tracking-tight">{editId ? `Edit ${r?.number ?? ''}` : 'Create task'}</h1>
        </div>
        <div className="flex shrink-0 gap-2">
          {sent ? <Button disabled={busy} onClick={() => save(false)}><Save className="size-4" /> Save changes</Button> : <>
            <Button variant="outline" disabled={busy} onClick={() => save(false)}><Save className="size-4" /> Save draft</Button>
            <Button disabled={busy} onClick={() => save(true)}><Send className="size-4" /> Assign</Button>
          </>}
        </div>
      </div>
      {err && <p className="rounded-lg bg-destructive/10 px-4 py-2.5 text-sm text-destructive">{err}</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        {/* the work */}
        <Card className="min-w-0 space-y-5 rounded-lg p-5 sm:p-6">
          <div className="space-y-1.5">
            <Label htmlFor="ir-title">Title *</Label>
            <Input id="ir-title" className="h-11 text-base" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Fix the October sales formula" autoFocus={!editId} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ir-desc">Instructions *</Label>
            <Textarea id="ir-desc" rows={8} value={description} maxLength={20000} onChange={(e) => setDescription(e.target.value)} placeholder="What to do, what to refer to, and the expected result." />
          </div>
          <div className="space-y-2 border-t pt-4">
            <Label>Attachments</Label>
            {r && r.attachments.length > 0 && <IrFileList requestId={r.id} files={r.attachments} cards />}
            <IrFilePicker files={files} onChange={setFiles} maxMb={r?.me.max_mb ?? 20} label="Add file" />
          </div>
        </Card>

        {/* who, when, how urgent */}
        <Card className="min-w-0 space-y-5 rounded-lg p-5 lg:sticky lg:top-20">
          <div className="space-y-2">
            <Label>For * <span className="font-normal text-muted-foreground">({picked.length} people)</span></Label>
            {chosen.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {chosen.map((p) => (
                  <span key={p.id} className="inline-flex max-w-full items-center gap-1 rounded-full bg-primary/10 py-0.5 pl-2.5 pr-1 text-xs font-medium text-primary">
                    <span className="truncate">{p.name}</span>
                    {!locked.has(p.id) && <button type="button" onClick={() => toggle(p.id)} className="rounded-full p-0.5 hover:bg-primary/20" aria-label={`Delete ${p.name}`}><X className="size-3" /></button>}
                  </span>
                ))}
              </div>
            )}
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="h-9 pl-8" placeholder="Search name / division" value={who} onChange={(e) => setWho(e.target.value)} />
            </div>
            <div className="max-h-60 overflow-y-auto rounded-lg border">
              {recipients.isLoading && <p className="p-3 text-sm text-muted-foreground">Loading…</p>}
              {people.map((p) => (
                <label key={p.id} className={cn('flex cursor-pointer items-center gap-2.5 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-muted/40', picked.includes(p.id) && 'bg-primary/5', locked.has(p.id) && 'cursor-not-allowed opacity-70')}>
                  <input type="checkbox" className="size-4 shrink-0 accent-primary" checked={picked.includes(p.id)} disabled={locked.has(p.id)} onChange={() => toggle(p.id)} />
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{p.name}</span><span className="block truncate text-xs text-muted-foreground">{[p.position, p.division].filter(Boolean).join(' · ') || `@${p.username}`}</span></span>
                </label>
              ))}
              {recipients.data && people.length === 0 && <p className="p-3 text-sm text-muted-foreground">No matches.</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ir-deadline">Deadline {!sent && '*'}</Label>
            <Input id="ir-deadline" type="datetime-local" value={deadline} disabled={sent} onChange={(e) => setDeadline(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Priority</Label>
            <div className="grid grid-cols-4 gap-1 rounded-lg border bg-muted/40 p-1" role="radiogroup" aria-label="Priority">
              {PRIORITY.map(([p, label, tone]) => (
                <button key={p} type="button" role="radio" aria-checked={priority === p} onClick={() => { setPriority(p); if (!sent) setDeadline(deadlineFor(p)) }}
                  className={cn('rounded-md px-1 py-1.5 text-xs font-medium', priority === p ? (p === 'URGENT' ? 'bg-red-600 text-white' : cn('bg-card ring-1 ring-border', tone || 'text-primary')) : 'text-muted-foreground hover:text-foreground')}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
