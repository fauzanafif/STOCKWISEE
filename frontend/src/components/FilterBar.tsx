import { Children, useEffect, useRef, useState, type ReactNode } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'

/** how many filters a wide screen shows before the rest fold behind "More filters" */
const SHOWN = 4

/**
 * The filter toolbar above a list: search, dates, selects and the like. `end` sits on the right
 * (counts, column picker, reset).
 * A wide screen shows the first few filters on one line and folds the rest behind a button,
 * so the list starts high on the page; a phone shows only the search. The button says how many
 * folded filters are set, so a filter in use is never out of mind.
 */
export function FilterBar({ children, end, className }: { children: ReactNode; end?: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false)
  const kids = Children.toArray(children)
  const ref = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState({ phone: 0, wide: 0 })
  // which children are not filters (a Reset button, Export, a warning badge, an info line): read
  // from the DOM, since a child is any element. They never fold on a wide screen and never count.
  const [others, setOthers] = useState('')

  useEffect(() => {
    const boxes = [...(ref.current?.querySelectorAll<HTMLElement>(':scope > [data-fb-kid]') ?? [])]
    const isFilter = (box: HTMLElement) => !!box.querySelector('select, textarea, input:not([type=checkbox]):not([type=radio]):not([type=hidden])')
    const nextOthers = boxes.map((b, i) => (isFilter(b) ? '' : i)).filter((i) => i !== '').join(',')
    if (nextOthers !== others) setOthers(nextOthers)
    // the folded filters that hold a value (a typed text, a chosen option other than the first "All …")
    const count = (sel: string) => [...(ref.current?.querySelectorAll<HTMLElement>(sel) ?? [])].reduce((n, box) => {
      const set = [...box.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')].some((el) => {
        if (el instanceof HTMLSelectElement) return el.selectedIndex > 0 && el.value !== ''
        if (el.type === 'checkbox' || el.type === 'radio') return false
        return el.value !== ''
      })
      return n + (set ? 1 : 0)
    }, 0)
    const next = { phone: count('[data-fold-phone]'), wide: count('[data-fold-wide]') }
    if (next.phone !== active.phone || next.wide !== active.wide) setActive(next)
  })

  // the n-th filter (not counting the other children) folds on a wide screen from SHOWN on
  const notFilter = new Set(others ? others.split(',').map(Number) : [])
  let nth = 0
  const foldsWide = kids.map((_, i) => !notFilter.has(i) && nth++ >= SHOWN)
  const foldedWide = foldsWide.filter(Boolean).length
  const foldWide = foldedWide > 0
  const Badge = ({ n }: { n: number }) => (n > 0 ? <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-[18px] text-primary-foreground">{n}</span> : null)
  const toggle = cn('flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors',
    open ? 'border-primary bg-primary/5 text-primary' : 'bg-card text-foreground hover:bg-muted')

  return (
    <div ref={ref} className={cn('flex flex-wrap items-end gap-2', className)}>
      {kids.map((k, i) => (
        // `contents` keeps each filter in the toolbar's own flex layout
        <div key={i} data-fb-kid="" className={cn(i === 0 ? 'max-md:min-w-0 max-md:flex-1 md:contents' : 'contents', i > 0 && !open && 'max-md:hidden', foldsWide[i] && !open && 'md:hidden')}
          data-fold-phone={i > 0 ? '' : undefined} data-fold-wide={foldsWide[i] ? '' : undefined}>
          {k}
        </div>
      ))}
      {kids.length > 1 && (
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={cn(toggle, 'md:hidden')}>
          <SlidersHorizontal className="size-4" /> Filter <Badge n={open ? 0 : active.phone} />
        </button>
      )}
      {foldWide && (
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={cn(toggle, 'max-md:hidden')}>
          <SlidersHorizontal className="size-4" /> {open ? 'Sembunyikan filter' : `Filter lainnya (${foldedWide})`} <Badge n={open ? 0 : active.wide} />
        </button>
      )}
      {end && <div className="ml-auto flex flex-wrap items-center gap-2">{end}</div>}
    </div>
  )
}

/** A labelled filter in a FilterBar. */
export function FilterField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1', className)}>
      <span className="block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}
