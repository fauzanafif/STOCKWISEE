import { useState } from 'react'
import { Bell, CheckCircle2, ChevronDown, Circle, Loader2, Pencil, Pin, Plus, Trash2, X } from 'lucide-react'
import { NOTE_COLORS, useDashboardNoteActions, type ChecklistItem, type DashboardNote, type NoteColor } from '@/features/dashboardNotes/api'
import { apiErrorMessage } from '@/lib/api'
import { invalidTo } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { confirmDialog } from '@/components/ui/confirm'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { fmtWhen } from './when'

/** [the note itself, its swatch] */
const COLOR: Record<NoteColor, [string, string]> = {
  yellow: ['border-yellow-200 bg-yellow-100 dark:border-yellow-800 dark:bg-yellow-900/40', 'bg-yellow-300'],
  pink: ['border-pink-200 bg-pink-100 dark:border-pink-800 dark:bg-pink-900/40', 'bg-pink-300'],
  green: ['border-emerald-200 bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-900/40', 'bg-emerald-300'],
  blue: ['border-sky-200 bg-sky-100 dark:border-sky-800 dark:bg-sky-900/40', 'bg-sky-300'],
  purple: ['border-violet-200 bg-violet-100 dark:border-violet-800 dark:bg-violet-900/40', 'bg-violet-300'],
  orange: ['border-orange-200 bg-orange-100 dark:border-orange-800 dark:bg-orange-900/40', 'bg-orange-300'],
}

/** ISO → the value of a datetime-local input, in the browser's time */
const toLocalInput = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function StickyNote({ n, onEdit }: { n: DashboardNote; onEdit: () => void }) {
  const act = useDashboardNoteActions()
  const past = n.remind_at && new Date(n.remind_at).getTime() < Date.now()
  const tick = (i: number) => act.update.mutate({ id: n.id, checklist: n.checklist.map((c, j) => (j === i ? { ...c, done: !c.done } : c)) })
  const remove = async () => { if (await confirmDialog({ message: `Delete the note "${n.title || n.body?.slice(0, 40) || 'checklist'}"?`, danger: true, confirmLabel: 'Delete' })) act.remove.mutate(n.id) }
  return (
    <article className={cn('group relative flex min-h-[7.5rem] flex-col rounded-sm border p-3 shadow-[0_2px_4px_rgb(15_23_42/0.08)]', COLOR[n.color]?.[0] ?? COLOR.yellow[0], n.done && 'opacity-60')}>
      <div className="flex items-start gap-1.5">
        <button type="button" onClick={() => act.update.mutate({ id: n.id, done: !n.done })} aria-label={n.done ? 'Mark as not done' : 'Mark as done'} aria-pressed={n.done}
          className="mt-0.5 shrink-0 text-slate-500 hover:text-emerald-700 dark:text-slate-300">
          {n.done ? <CheckCircle2 className="size-4 text-emerald-700 dark:text-emerald-400" /> : <Circle className="size-4" />}
        </button>
        <h3 className={cn('min-w-0 flex-1 break-words text-[13px] font-semibold leading-5 text-slate-800 dark:text-slate-100', n.done && 'line-through')}>{n.title}</h3>
        <button type="button" onClick={() => act.update.mutate({ id: n.id, pinned: !n.pinned })} aria-label={n.pinned ? 'Unpin' : 'Pin'} aria-pressed={n.pinned}
          className={cn('shrink-0 rounded p-0.5 hover:bg-black/5', n.pinned ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100')}>
          <Pin className={cn('size-3.5', n.pinned && 'fill-current')} />
        </button>
      </div>
      {n.body && <p className={cn('mt-1 line-clamp-6 whitespace-pre-wrap break-words text-[13px] text-slate-700 dark:text-slate-200', n.done && 'line-through')}>{n.body}</p>}
      {n.checklist.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {n.checklist.map((c, i) => (
            <li key={i}>
              <label className="flex cursor-pointer items-start gap-1.5 text-[13px] text-slate-700 dark:text-slate-200">
                <input type="checkbox" className="mt-0.5 size-3.5 shrink-0 accent-slate-700" checked={c.done} onChange={() => tick(i)} />
                <span className={cn('min-w-0 break-words', c.done && 'text-slate-500 line-through')}>{c.text}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto flex items-center gap-1 pt-2 text-[11px]">
        {n.remind_at && (
          <span className={cn('inline-flex items-center gap-1 tabular-nums', past && !n.done ? 'font-semibold text-red-700 dark:text-red-400' : 'text-slate-500 dark:text-slate-300')}>
            <Bell className="size-3" />{fmtWhen(n.remind_at)}
          </span>
        )}
        <span className="ml-auto flex gap-0.5 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
          <button type="button" onClick={onEdit} className="rounded p-1 text-slate-500 hover:bg-black/5 hover:text-slate-800" aria-label="Edit note"><Pencil className="size-3.5" /></button>
          <button type="button" onClick={() => void remove()} className="rounded p-1 text-slate-500 hover:bg-black/5 hover:text-red-700" aria-label="Delete note"><Trash2 className="size-3.5" /></button>
        </span>
      </div>
    </article>
  )
}

export function NoteEditor({ note, onClose }: { note: DashboardNote | null; onClose: () => void }) {
  const act = useDashboardNoteActions()
  const [title, setTitle] = useState(note?.title ?? '')
  const [body, setBody] = useState(note?.body ?? '')
  const [items, setItems] = useState<ChecklistItem[]>(note?.checklist ?? [])
  const [newItem, setNewItem] = useState('')
  const [color, setColor] = useState<NoteColor>(note?.color ?? 'yellow')
  const [remind, setRemind] = useState(toLocalInput(note?.remind_at ?? null))
  const [pinned, setPinned] = useState(note?.pinned ?? false)
  const [err, setErr] = useState<string | null>(null)
  const busy = act.create.isPending || act.update.isPending
  const addItem = () => { if (newItem.trim()) { setItems((l) => [...l, { text: newItem.trim(), done: false }]); setNewItem('') } }
  const save = () => {
    setErr(null)
    const list = [...items, ...(newItem.trim() ? [{ text: newItem.trim(), done: false }] : [])].filter((i) => i.text.trim())
    if (!title.trim() && !body.trim() && list.length === 0) return invalidTo(setErr, 'Fill in a title, a note, or a checklist item.')
    const payload = { title: title.trim() || null, body: body.trim() || null, checklist: list, color, pinned, remind_at: remind ? new Date(remind).toISOString() : null }
    const opts = { onSuccess: onClose, onError: (e: unknown) => setErr(apiErrorMessage(e)) }
    if (note) act.update.mutate({ id: note.id, ...payload }, opts)
    else act.create.mutate(payload, opts)
  }
  return (
    <Modal open onClose={onClose} title={note ? 'Edit note' : 'New note'} className="max-w-lg"
      footer={<>
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" disabled={busy} onClick={save}>{busy && <Loader2 className="size-4 animate-spin" />} Save</Button>
      </>}>
      <div className={cn('space-y-3 rounded-md border p-3', COLOR[color][0])}>
        <Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Title" aria-label="Title" className="bg-white/70 dark:bg-black/20" autoFocus />
        <Textarea value={body} maxLength={2000} rows={4} onChange={(e) => setBody(e.target.value)} placeholder="Note" aria-label="Note" className="bg-white/70 dark:bg-black/20" />
        <div className="space-y-1.5">
          <Label>Checklist</Label>
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="checkbox" className="size-4 accent-slate-700" checked={it.done} aria-label={`Done: ${it.text}`}
                onChange={() => setItems((l) => l.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))} />
              <Input className="h-8 bg-white/70 dark:bg-black/20" value={it.text} maxLength={200} aria-label={`Checklist item ${i + 1}`}
                onChange={(e) => setItems((l) => l.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
              <button type="button" className="rounded p-1 text-slate-500 hover:text-red-700" aria-label={`Remove ${it.text}`} onClick={() => setItems((l) => l.filter((_, j) => j !== i))}><X className="size-4" /></button>
            </div>
          ))}
          {items.length < 30 && (
            <div className="flex items-center gap-2">
              <Input className="h-8 bg-white/70 dark:bg-black/20" value={newItem} maxLength={200} placeholder="Add item" aria-label="New checklist item"
                onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem() } }} />
              <Button type="button" size="sm" variant="outline" className="h-8 shrink-0 bg-white/70 px-2.5 dark:bg-black/20" onClick={addItem} disabled={!newItem.trim()} aria-label="Add checklist item">
                <Plus className="size-4" /> Add
              </Button>
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Color</Label>
          <div className="flex gap-1.5" role="radiogroup" aria-label="Color">
            {NOTE_COLORS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} onClick={() => setColor(c)}
                className={cn('size-7 rounded-full border-2', COLOR[c][1], color === c ? 'border-slate-800 dark:border-white' : 'border-transparent')} />
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="note-remind">Reminder <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Input id="note-remind" type="datetime-local" value={remind} onChange={(e) => setRemind(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="size-4 accent-primary" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Pin to the top
        </label>
      </div>
      {err && <p className="mt-2 text-sm text-destructive">{err}</p>}
    </Modal>
  )
}

/** The body of the "My Notes" card: pinned first, the done ones folded away at the bottom. */
export function NotesBody({ notes, loading, onEdit }: { notes: DashboardNote[]; loading: boolean; onEdit: (n: DashboardNote) => void }) {
  const [showDone, setShowDone] = useState(false)
  const open = notes.filter((n) => !n.done)
  const done = notes.filter((n) => n.done)
  if (loading) return <div className="flex h-24 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
  if (notes.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">No notes yet.</p>
  const grid = 'grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(10.5rem,1fr))]'
  return (
    <div className="space-y-3">
      {open.length > 0 && <div className={grid}>{open.map((n) => <StickyNote key={n.id} n={n} onEdit={() => onEdit(n)} />)}</div>}
      {done.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
            <ChevronDown className={cn('size-3.5 transition-transform', !showDone && '-rotate-90')} /> Done ({done.length})
          </button>
          {showDone && <div className={cn(grid, 'mt-2')}>{done.map((n) => <StickyNote key={n.id} n={n} onEdit={() => onEdit(n)} />)}</div>}
        </div>
      )}
    </div>
  )
}
