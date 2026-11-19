import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, pointerWithin, useSensor, useSensors, type CollisionDetection, type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Eye, EyeOff, GripVertical, Loader2, MoveDiagonal2, Plus, RotateCcw } from 'lucide-react'
import { useReminders, type Reminder, type ReminderItem, type ReminderModule } from '@/features/reminders/api'
import { usePreference, useSavePreference } from '@/features/moduleStats/api'
import { useDashboardNotes, type DashboardNote } from '@/features/dashboardNotes/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { confirmDialog } from '@/components/ui/confirm'
import { DropdownMenu } from '@/components/ui/dropdown'
import { cn } from '@/lib/utils'
import { NoteEditor, NotesBody } from './NotesCard'
import { fmtWhen } from './when'

type W = 1 | 2 | 3 | 4
type H = 1 | 2 | 3
interface CardCfg { id: string; w: W; h: H; hidden: boolean }
interface Layout { v: 1; cards: CardCfg[] }

const PREF = 'dashboard:home'
const NOTES = 'notes'
/** width in columns of the 4-column grid (2 on a tablet, 1 on a phone) */
const W_CLASS: Record<W, string> = { 1: '', 2: 'md:col-span-2', 3: 'md:col-span-2 xl:col-span-3', 4: 'md:col-span-2 xl:col-span-4' }
const H_PX: Record<H, number> = { 1: 260, 2: 380, 3: 540 }
/** documents shown per height before "View all" */
const ROWS: Record<H, number> = { 1: 3, 2: 5, 3: 8 }
const MODULE: Record<ReminderModule, string> = { important: 'Important Request', request: 'Item Request', ppb: 'Purchase Request', po: 'Purchase Order', ri: 'Receipt', opname: 'Stock Opname' }

/** the card under the pointer wins (cards differ in size); the keyboard has no pointer, so the nearest one */
const collide: CollisionDetection = (args) => { const hit = pointerWithin(args); return hit.length ? hit : closestCenter(args) }

const defaults = (id: string): CardCfg => (id === NOTES ? { id, w: 2, h: 2, hidden: false } : { id, w: 1, h: 2, hidden: false })

/** a saved layout is only trusted card by card; cards new since then join at the end */
function merge(saved: Layout | null | undefined, available: string[]): Layout {
  const seen = new Set<string>()
  const cards: CardCfg[] = []
  for (const c of Array.isArray(saved?.cards) ? saved!.cards.slice(0, 60) : []) {
    if (!c || typeof c.id !== 'string' || seen.has(c.id) || c.id.length > 80) continue
    seen.add(c.id)
    cards.push({ id: c.id, w: ([1, 2, 3, 4].includes(c.w) ? c.w : 1) as W, h: ([1, 2, 3].includes(c.h) ? c.h : 2) as H, hidden: !!c.hidden })
  }
  for (const id of available) if (!seen.has(id)) cards.push(defaults(id))
  return { v: 1, cards }
}

/** the reminder text names its module already ("Item requests need verification"); the module shows as a hover hint */
const title = (r: Reminder) => `${r.text.charAt(0).toUpperCase()}${r.text.slice(1)}`
const moduleOf = (r: Reminder) => MODULE[r.modules[0]] ?? ''

function ItemLine({ i }: { i: ReminderItem }) {
  return (
    <li>
      <Link to={i.to} className="block rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60 max-md:py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{i.label}</span>
          {i.late && <Badge variant="danger">Late</Badge>}
          {i.urgent && <Badge variant="warning">Urgent</Badge>}
          {i.soon && <Badge>Due soon</Badge>}
        </div>
        <div className="flex gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">{i.sub}</span>
          <span className={cn('shrink-0 tabular-nums', i.late && 'font-medium text-red-700')}>{i.due ? `Due ${fmtWhen(i.due)}` : i.since ? `Since ${fmtWhen(i.since)}` : ''}</span>
        </div>
      </Link>
    </li>
  )
}

/** One card of the board: the grip moves it, the corner resizes it; everything inside works as usual. */
function BoardCard({ cfg, heading, hint, count, tone, actions, footer, onHide, onResize, children }: {
  cfg: CardCfg; heading: string; hint?: string; count: number; tone?: 'danger' | 'warning'; actions?: ReactNode; footer?: ReactNode
  onHide: () => void; onResize: (w: W, h: H) => void; children: ReactNode
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging, isOver } = useSortable({ id: cfg.id })
  const [preview, setPreview] = useState<{ w: W; h: H } | null>(null)
  const w = preview?.w ?? cfg.w
  const h = preview?.h ?? cfg.h

  const startResize = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const handle = e.currentTarget
    const card = handle.closest('section')!.getBoundingClientRect()
    const grid = handle.closest('[data-board-grid]') as HTMLElement
    const cs = getComputedStyle(grid)
    const cols = cs.gridTemplateColumns.split(' ').filter(Boolean).length || 1
    const gap = parseFloat(cs.columnGap) || 16
    const colW = (grid.clientWidth - gap * (cols - 1)) / cols
    const x0 = e.clientX, y0 = e.clientY
    let next = { w: cfg.w, h: cfg.h }
    handle.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      const span = Math.min(cols, Math.max(1, Math.round((card.width + ev.clientX - x0 + gap) / (colW + gap))))
      const nw = (cols >= 4 ? span : cols === 2 ? (span >= 2 ? Math.max(cfg.w, 2) : 1) : cfg.w) as W
      const px = card.height + ev.clientY - y0
      const nh = ([1, 2, 3] as H[]).reduce((best, k) => (Math.abs(H_PX[k] - px) < Math.abs(H_PX[best] - px) ? k : best), cfg.h)
      next = { w: nw, h: nh }
      setPreview(next)
    }
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      setPreview(null)
      if (next.w !== cfg.w || next.h !== cfg.h) onResize(next.w, next.h)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }
  const keyResize = (e: React.KeyboardEvent) => {
    const dw = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    const dh = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    if (!dw && !dh) return
    e.preventDefault()
    onResize(Math.min(4, Math.max(1, cfg.w + dw)) as W, Math.min(3, Math.max(1, cfg.h + dh)) as H)
  }

  return (
    <section ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition, height: H_PX[h] }}
      className={cn('relative flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card shadow-[0_1px_2px_rgb(15_23_42/0.05)]', W_CLASS[w],
        isDragging && 'opacity-40 outline-dashed outline-2 outline-primary',
        isOver && !isDragging && 'ring-2 ring-primary/60',
        preview && 'outline-dashed outline-2 outline-primary/60')}>
      <header className="flex items-center gap-1.5 border-b px-2 py-2">
        <button ref={setActivatorNodeRef} type="button" {...attributes} {...listeners} aria-label={`Move ${heading}`}
          className="touch-none cursor-grab rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing">
          <GripVertical className="size-4" />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold" title={hint ? `${hint} · ${heading}` : heading}>{heading}</h2>
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
          tone === 'danger' ? 'bg-red-50 text-red-700' : tone === 'warning' ? 'bg-amber-50 text-amber-800' : 'bg-primary/10 text-primary')}>{count}</span>
        {actions}
        <button type="button" onClick={onHide} aria-label={`Hide ${heading}`} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><EyeOff className="size-4" /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">{children}</div>
      {footer}
      <button type="button" onPointerDown={startResize} onKeyDown={keyResize} aria-label={`Resize ${heading}`}
        className="absolute bottom-0.5 right-0.5 z-10 touch-none cursor-nwse-resize rounded p-0.5 text-muted-foreground/60 hover:bg-muted hover:text-foreground">
        <MoveDiagonal2 className="size-3.5" />
      </button>
    </section>
  )
}

/**
 * The main dashboard's To-Do board: one card per kind of work waiting for this account (the reminders, so only
 * what its permissions allow, following the documents' status) and its private sticky notes. Arranged freely,
 * kept per user on the server.
 */
export function TodoBoard() {
  const { data: rem, isLoading: remLoading } = useReminders()
  const notes = useDashboardNotes()
  const saved = usePreference<Layout>(PREF)
  const save = useSavePreference<Layout>(PREF)
  const [layout, setLayout] = useState<Layout | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [editing, setEditing] = useState<DashboardNote | 'new' | null>(null)
  const dirty = useRef(false)

  const reminders = useMemo(() => (Array.isArray(rem?.data) ? rem.data.filter((r) => r && Array.isArray(r.items)) : []), [rem])
  const byId = useMemo(() => new Map(reminders.map((r) => [`sys:${r.key}`, r])), [reminders])
  const available = useMemo(() => [...byId.keys(), NOTES], [byId])
  const availableKey = available.join('|')

  useEffect(() => {
    if (saved.isSuccess || saved.isError) setLayout((l) => merge(l ?? saved.data, available))
  }, [saved.isSuccess, saved.isError, availableKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!dirty.current || !layout) return
    const t = setTimeout(() => { dirty.current = false; save.mutate(layout) }, 700)
    return () => clearTimeout(t)
  }, [layout]) // eslint-disable-line react-hooks/exhaustive-deps

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  if (!layout) return <div className="flex h-24 items-center justify-center rounded-lg border bg-card"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>

  const change = (fn: (l: Layout) => Layout) => { dirty.current = true; setLayout((l) => (l ? fn(l) : l)) }
  const setCard = (id: string, patch: Partial<CardCfg>) => change((l) => ({ ...l, cards: l.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))
  const present = new Set(available)
  const visible = layout.cards.filter((c) => !c.hidden && present.has(c.id))
  const hidden = layout.cards.filter((c) => c.hidden && present.has(c.id))
  const noteList = Array.isArray(notes.data) ? notes.data : []
  const openNotes = noteList.filter((n) => !n.done).length
  const headingOf = (id: string) => (id === NOTES ? 'My Notes' : byId.get(id) ? title(byId.get(id)!) : id)

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null)
    const over = e.over?.id
    if (!over || over === e.active.id) return
    change((l) => {
      const from = l.cards.findIndex((c) => c.id === e.active.id)
      const to = l.cards.findIndex((c) => c.id === over)
      return from < 0 || to < 0 ? l : { ...l, cards: arrayMove(l.cards, from, to) }
    })
  }
  const reset = async () => {
    if (!(await confirmDialog({ title: 'Reset layout?', message: 'All cards go back to their default place and size, and hidden cards are shown again. Notes are kept.', confirmLabel: 'Reset' }))) return
    dirty.current = false
    setLayout(merge(null, available))
    save.mutate(null)
  }

  return (
    <section className="space-y-2 print:hidden" aria-label="My To-Do">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">My To-Do</h2>
        <span className="text-xs tabular-nums text-muted-foreground">{(rem?.meta?.total ?? 0).toLocaleString('id-ID')} waiting · {openNotes} notes</span>
        {(save.isPending || remLoading) && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Saving" />}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditing('new')}><Plus className="size-4" /> Note</Button>
          <DropdownMenu label="Add card" icon={Eye} ariaLabel="Add card"
            items={hidden.length ? hidden.map((c) => ({ label: headingOf(c.id), onSelect: () => setCard(c.id, { hidden: false }) })) : [{ label: 'All cards are shown', onSelect: () => {}, disabled: true }]} />
          <Button size="sm" variant="ghost" onClick={() => void reset()}><RotateCcw className="size-4" /> Reset layout</Button>
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={collide} onDragStart={(e) => setActiveId(String(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <SortableContext items={visible.map((c) => c.id)} strategy={rectSortingStrategy}>
          <div data-board-grid className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {visible.map((c) => {
              const hide = () => setCard(c.id, { hidden: true })
              const resize = (w: W, h: H) => setCard(c.id, { w, h })
              if (c.id === NOTES) {
                return (
                  <BoardCard key={c.id} cfg={c} heading="My Notes" count={openNotes} onHide={hide} onResize={resize}
                    actions={<button type="button" onClick={() => setEditing('new')} aria-label="New note" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><Plus className="size-4" /></button>}>
                    <div className="p-1"><NotesBody notes={noteList} loading={notes.isLoading} onEdit={(n) => setEditing(n)} /></div>
                  </BoardCard>
                )
              }
              const r = byId.get(c.id)!
              const items = r.items.slice(0, ROWS[c.h])
              return (
                <BoardCard key={c.id} cfg={c} heading={title(r)} hint={moduleOf(r)} count={r.count} onHide={hide} onResize={resize}
                  tone={r.overdue ? 'danger' : r.urgent ? 'warning' : undefined}
                  footer={r.count > items.length && <Link to={r.to} className="block border-t px-3 py-2 text-center text-xs font-medium text-primary hover:bg-muted/40">View all ({r.count.toLocaleString('id-ID')})</Link>}>
                  {(r.overdue > 0 || r.urgent > 0 || r.soon > 0) && (
                    <div className="flex flex-wrap gap-1 px-2 pb-1.5">
                      {r.overdue > 0 && <Badge variant="danger">{r.overdue} late</Badge>}
                      {r.urgent > 0 && <Badge variant="warning">{r.urgent} urgent</Badge>}
                      {r.soon > 0 && <Badge>{r.soon} due soon</Badge>}
                    </div>
                  )}
                  <ul className="divide-y">{items.map((i, k) => <ItemLine key={`${i.to}-${k}`} i={i} />)}</ul>
                </BoardCard>
              )
            })}
            {visible.length === 0 && (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground md:col-span-2 xl:col-span-4">
                All cards are hidden. <button type="button" className="font-medium text-primary hover:underline" onClick={() => change((l) => ({ ...l, cards: l.cards.map((c) => ({ ...c, hidden: false })) }))}>Show all</button>
              </div>
            )}
          </div>
        </SortableContext>
        <DragOverlay>
          {activeId && (
            <div className="flex items-center gap-2 rounded-lg border-2 border-primary bg-card px-3 py-2.5 text-sm font-semibold shadow-xl">
              <GripVertical className="size-4 text-primary" />{headingOf(activeId)}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {editing && <NoteEditor note={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  )
}
