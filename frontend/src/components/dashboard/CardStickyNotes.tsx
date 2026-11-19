import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { GripHorizontal, Minus, Palette, Plus, StickyNote, Trash2 } from 'lucide-react'
import { NOTE_COLOR_CLASSES } from '@/components/dashboard/todo/NotesCard'
import { NOTE_COLORS, cardNotesSupported, useDashboardNoteActions, useDashboardNotes, type DashboardNote, type NoteLayout } from '@/features/dashboardNotes/api'
import { cn } from '@/lib/utils'

/**
 * Sticky notes stuck on the cards of an app overview: each floats over the page where the user left it, can be
 * dragged by its top bar, resized from its corner, folded away and opened again from its card. They are the
 * user's own notes (the same as the header's Sticky notes panel), only with a card and a place on the screen.
 */

const W = 240
const H = 190
const MIN_W = 160
const MIN_H = 120

/** the card a note is stuck on: "<app>:<page path>" */
export const cardAnchor = (appKey: string, to: string) => `${appKey}:${to}`

/** The notes of this user, and whether the server can stick them on cards yet (its migration ran). */
export function useCardNotes() {
  const notes = useDashboardNotes()
  const list = Array.isArray(notes.data) ? notes.data : []
  return { list, supported: notes.isSuccess && cardNotesSupported() }
}

/** The small note button on a card: how many notes it carries; a click opens them, or sticks a new one. */
export function CardNoteButton({ anchor, label, boardRef }: { anchor: string; label: string; boardRef: RefObject<HTMLElement | null> }) {
  const { list, supported } = useCardNotes()
  const { create, update } = useDashboardNoteActions()
  const btn = useRef<HTMLButtonElement>(null)
  if (!supported) return null
  const mine = list.filter((n) => n.anchor === anchor)
  const closed = mine.filter((n) => !n.layout?.open)

  function onClick() {
    if (closed.length) {
      closed.forEach((n) => update.mutate({ id: n.id, layout: { ...defaultLayout(btn.current, boardRef.current, 0), ...n.layout, open: true } }))
      return
    }
    create.mutate({ anchor, color: 'yellow', layout: defaultLayout(btn.current, boardRef.current, mine.length) })
  }

  return (
    <button ref={btn} type="button" onClick={onClick} disabled={create.isPending}
      aria-label={mine.length ? `Notes on ${label}: ${mine.length}` : `Add a note to ${label}`}
      title={closed.length ? 'Show the notes of this card' : 'Stick a note on this card'}
      className={cn('relative flex size-7 shrink-0 items-center justify-center rounded transition-colors',
        mine.length ? 'text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-500/10' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800')}>
      <StickyNote className="size-4" />
      {mine.length > 0 && <span className="absolute -right-1 -top-1 min-w-3.5 rounded-full bg-amber-400 px-0.5 text-[9px] font-semibold leading-[14px] text-amber-950 tabular-nums">{mine.length}</span>}
    </button>
  )
}

/** A new note's place: just right of the card's note button, a little lower for each note already there. */
function defaultLayout(from: HTMLElement | null, board: HTMLElement | null, nth: number): NoteLayout {
  if (!from || !board) return { x: 24 + nth * 24, y: 24 + nth * 24, w: W, h: H, open: true }
  const b = board.getBoundingClientRect()
  const r = from.getBoundingClientRect()
  const x = Math.min(Math.max(0, r.right - b.left + 8), Math.max(0, b.width - W))
  return { x: Math.round(x + nth * 20), y: Math.round(r.top - b.top + nth * 20), w: W, h: H, open: true }
}

/** Every open note stuck on a card of this app, floating over the board (which must be `position: relative`). */
export function FloatingCardNotes({ appKey, labels, boardRef }: { appKey: string; labels: Record<string, string>; boardRef: RefObject<HTMLElement | null> }) {
  const { list, supported } = useCardNotes()
  if (!supported) return null
  const prefix = `${appKey}:`
  const open = list.filter((n) => n.anchor?.startsWith(prefix) && n.layout?.open)
  return <>{open.map((n) => <FloatingNote key={n.id} note={n} label={labels[n.anchor!] ?? n.anchor!.slice(prefix.length)} boardRef={boardRef} />)}</>
}

type Drag = { kind: 'move' | 'size'; px: number; py: number; start: NoteLayout }

function FloatingNote({ note, label, boardRef }: { note: DashboardNote; label: string; boardRef: RefObject<HTMLElement | null> }) {
  const { create, update, remove } = useDashboardNoteActions()
  const saved: NoteLayout = { x: 24, y: 24, w: W, h: H, open: true, ...note.layout }
  const [box, setBox] = useState<NoteLayout>(saved)
  const [title, setTitle] = useState(note.title ?? '')
  const [body, setBody] = useState(note.body ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const drag = useRef<Drag | null>(null)
  // brought to the front when touched
  const [front, setFront] = useState(0)

  // the server answer (another tab, the header panel) replaces what is shown, unless it is being dragged
  const key = JSON.stringify(note.layout)
  useEffect(() => { if (!drag.current) setBox({ x: 24, y: 24, w: W, h: H, open: true, ...note.layout }) }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setTitle(note.title ?? ''), [note.title])
  useEffect(() => setBody(note.body ?? ''), [note.body])

  const clamp = (l: NoteLayout): NoteLayout => {
    const bw = boardRef.current?.clientWidth || 10_000
    const w = Math.round(Math.min(Math.max(MIN_W, l.w), 900))
    const h = Math.round(Math.min(Math.max(MIN_H, l.h), 900))
    return { ...l, w, h, x: Math.round(Math.min(Math.max(0, l.x), Math.max(0, bw - w))), y: Math.round(Math.max(0, l.y)) }
  }
  const save = (l: NoteLayout) => update.mutate({ id: note.id, layout: l })

  function start(kind: Drag['kind'], e: ReactPointerEvent) {
    if (e.button !== 0) return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { kind, px: e.clientX, py: e.clientY, start: box }
    setFront(Date.now())
  }
  function move(e: ReactPointerEvent) {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.px
    const dy = e.clientY - d.py
    setBox(clamp(d.kind === 'move' ? { ...d.start, x: d.start.x + dx, y: d.start.y + dy } : { ...d.start, w: d.start.w + dx, h: d.start.h + dy }))
  }
  function end() {
    if (!drag.current) return
    drag.current = null
    save(box)
  }
  // the keyboard moves it too (arrows on the top bar; with Shift: resize)
  function onKey(e: React.KeyboardEvent) {
    const step = 16
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
    if (!delta) return
    e.preventDefault()
    const next = clamp(e.shiftKey ? { ...box, w: box.w + delta[0], h: box.h + delta[1] } : { ...box, x: box.x + delta[0], y: box.y + delta[1] })
    setBox(next)
    save(next)
  }

  const writeText = () => {
    const t = title.trim() || null
    const b = body.trim() || null
    if (t !== (note.title ?? null) || b !== (note.body ?? null)) update.mutate({ id: note.id, title: t, body: b })
  }
  const nextColor = () => update.mutate({ id: note.id, color: NOTE_COLORS[(NOTE_COLORS.indexOf(note.color) + 1) % NOTE_COLORS.length] })

  return (
    <section role="dialog" aria-label={`Note on ${label}`}
      onPointerDown={() => setFront(Date.now())}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h, zIndex: front ? 21 : 20 }}
      className={cn('absolute flex flex-col overflow-hidden rounded-sm border shadow-[0_6px_18px_rgb(15_23_42/0.18)]', NOTE_COLOR_CLASSES[note.color]?.[0] ?? NOTE_COLOR_CLASSES.yellow[0], note.done && 'opacity-70')}>
      {/* the top bar: drag it to move the note */}
      <div tabIndex={0} role="toolbar" aria-label="Move the note (arrow keys; Shift + arrows to resize)"
        onPointerDown={(e) => start('move', e)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onKeyDown={onKey}
        className="flex shrink-0 cursor-grab touch-none select-none items-center gap-1 border-b border-black/5 px-1.5 py-1 active:cursor-grabbing dark:border-white/10">
        <GripHorizontal className="size-3.5 shrink-0 text-black/40 dark:text-white/40" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-black/60 dark:text-white/60">{label}</span>
        {[
          { icon: Plus, name: 'Another note on this card', on: () => create.mutate({ anchor: note.anchor, color: note.color, layout: clamp({ ...box, x: box.x + 24, y: box.y + 24 }) }) },
          { icon: Palette, name: 'Change colour', on: nextColor },
          { icon: Minus, name: 'Fold away (open it again from its card)', on: () => save({ ...box, open: false }) },
          { icon: Trash2, name: 'Delete the note', on: () => setConfirmDelete(true) },
        ].map(({ icon: Icon, name, on }) => (
          <button key={name} type="button" aria-label={name} title={name} onPointerDown={(e) => e.stopPropagation()} onClick={on}
            className="flex size-6 shrink-0 items-center justify-center rounded text-black/50 hover:bg-black/10 hover:text-black dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white">
            <Icon className="size-3.5" />
          </button>
        ))}
      </div>

      {confirmDelete ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-3 text-center text-sm">
          <p>Delete this note?</p>
          <div className="flex gap-2">
            <button type="button" className="rounded border border-black/20 px-2.5 py-1 text-xs hover:bg-black/5" onClick={() => setConfirmDelete(false)}>Keep</button>
            <button type="button" className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700" onClick={() => remove.mutate(note.id)}>Delete</button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-1 p-2">
          <input aria-label="Note title" placeholder="Title" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} onBlur={writeText}
            className="w-full bg-transparent text-sm font-semibold text-slate-900 placeholder:text-black/35 focus:outline-none dark:text-slate-100 dark:placeholder:text-white/35" />
          <textarea aria-label="Note" placeholder="Write a note…" maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} onBlur={writeText}
            className="min-h-0 w-full flex-1 resize-none bg-transparent text-[13px] leading-snug text-slate-800 placeholder:text-black/35 focus:outline-none dark:text-slate-200 dark:placeholder:text-white/35" />
          {note.checklist.length > 0 && (
            <p className="shrink-0 text-[11px] text-black/50 dark:text-white/50">{note.checklist.filter((c) => c.done).length}/{note.checklist.length} checklist done · edit it in Sticky notes</p>
          )}
        </div>
      )}

      {/* the corner: drag it to resize */}
      <div aria-hidden onPointerDown={(e) => start('size', e)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
        className="absolute bottom-0 right-0 size-4 cursor-nwse-resize touch-none"
        style={{ background: 'linear-gradient(135deg, transparent 50%, rgb(0 0 0 / 0.18) 50%)' }} />
    </section>
  )
}
