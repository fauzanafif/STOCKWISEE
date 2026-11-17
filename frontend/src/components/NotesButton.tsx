import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Plus, StickyNote, X } from 'lucide-react'
import { NoteEditor, NotesBody } from '@/components/dashboard/todo/NotesCard'
import { useDashboardNotes, type DashboardNote } from '@/features/dashboardNotes/api'
import { cn } from '@/lib/utils'

/**
 * Sticky notes from any page: a button in the header opens the user's notes in a panel on the
 * right (the same notes as the "My Notes" card of the To-Do), to read, tick, pin, add or edit.
 */
export function NotesButton() {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<DashboardNote | 'new' | null>(null)
  const notes = useDashboardNotes()
  const list = Array.isArray(notes.data) ? notes.data : []
  const openCount = list.filter((n) => !n.done).length

  useEffect(() => {
    if (!open) return
    // Escape closes the panel, unless the note editor (on top of it) is open
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !editing) setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, editing])

  return (
    <>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={`Sticky notes: ${openCount}`} title="Sticky notes"
        className={cn('relative flex size-9 shrink-0 items-center justify-center rounded-md transition-colors', open ? 'bg-amber-100 text-amber-700' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
        <StickyNote className="size-[18px]" />
        {openCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-amber-400 px-1 text-[10px] font-semibold leading-4 text-amber-950 tabular-nums">{openCount > 99 ? '99+' : openCount}</span>
        )}
      </button>

      {/* under <body>: the header's backdrop blur would otherwise trap a fixed panel inside the header */}
      {open && createPortal(
        <>
          {/* a click beside the panel closes it */}
          <div className="fixed inset-0 top-[var(--sw-header,3.5rem)] z-[34] bg-black/10 sm:bg-transparent" onClick={() => setOpen(false)} aria-hidden />
          <aside role="dialog" aria-label="Sticky notes"
            className="fixed bottom-0 right-0 top-[var(--sw-header,3.5rem)] z-[35] flex w-full flex-col border-l bg-card shadow-2xl sm:w-[26rem] sm:max-w-[92vw]">
            <div className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
              <StickyNote className="size-4 text-amber-600" />
              <h2 className="flex-1 text-[15px] font-semibold">Sticky notes</h2>
              <button type="button" onClick={() => setEditing('new')}
                className="flex h-8 items-center gap-1 rounded-md bg-primary px-2.5 text-[13px] font-medium text-primary-foreground hover:bg-primary/90">
                <Plus className="size-4" /> Note
              </button>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
              <NotesBody notes={list} loading={notes.isLoading} onEdit={(n) => setEditing(n)} />
            </div>
            <div className="shrink-0 border-t px-4 py-2 text-right">
              <Link to="/todo" onClick={() => setOpen(false)} className="text-[13px] font-medium text-primary hover:underline">Buka di To-Do</Link>
            </div>
          </aside>
        </>,
        document.body,
      )}

      {editing && <NoteEditor note={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}
