import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface DropdownItem {
  label: string
  icon?: LucideIcon
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
  hidden?: boolean
}

/**
 * A button that opens a short list of actions (Export, row actions…). Closes on
 * choosing, clicking outside or Escape; arrow keys move through the items.
 */
export function DropdownMenu({ label, icon: Icon, items, align = 'end', size = 'sm', variant = 'outline', className, busy, chevron = true, ariaLabel }: {
  label: ReactNode
  icon?: LucideIcon
  items: DropdownItem[]
  align?: 'start' | 'end'
  size?: 'sm' | 'default'
  variant?: 'outline' | 'ghost' | 'default'
  className?: string
  busy?: boolean
  /** false: an icon-only trigger (e.g. ⋯ row actions) */
  chevron?: boolean
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  // the list is placed on the screen (fixed), so a scrolling table never clips it
  const [at, setAt] = useState<{ top: number; left?: number; right?: number; up: boolean } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const shown = items.filter((i) => !i.hidden)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const btns = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)') ?? [])]
        const at = btns.indexOf(document.activeElement as HTMLButtonElement)
        btns[(at + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length]?.focus()
      }
    }
    const onScroll = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onScroll)
    }
  }, [open])

  const toggle = () => {
    if (!open && ref.current) {
      const r = ref.current.getBoundingClientRect()
      const up = window.innerHeight - r.bottom < 40 + shown.length * 38 && r.top > window.innerHeight / 2
      setAt({ top: up ? r.top - 4 : r.bottom + 4, up, ...(align === 'end' ? { right: window.innerWidth - r.right } : { left: r.left }) })
    }
    setOpen((v) => !v)
  }

  if (shown.length === 0) return null
  return (
    <div ref={ref} className={cn('relative inline-block', className)}>
      <Button type="button" size={size} variant={variant} aria-haspopup="menu" aria-expanded={open} disabled={busy} onClick={toggle} aria-label={ariaLabel} title={ariaLabel}
        className={cn(!chevron && 'px-2')}>
        {Icon && <Icon className="size-4" />}{label}{chevron && <ChevronDown className="size-3.5 opacity-60" />}
      </Button>
      {open && at && (
        <div role="menu" className="fixed z-50 min-w-44 rounded-lg border bg-card p-1 shadow-lg"
          style={{ top: at.up ? undefined : at.top, bottom: at.up ? window.innerHeight - at.top : undefined, left: at.left, right: at.right }}>
          {shown.map((i) => {
            const I = i.icon
            return (
              <button key={i.label} type="button" role="menuitem" disabled={i.disabled}
                onClick={() => { setOpen(false); i.onSelect() }}
                className={cn('flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted disabled:opacity-50',
                  i.danger && 'text-destructive')}>
                {I && <I className="size-4 opacity-70" />}{i.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
