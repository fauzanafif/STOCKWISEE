import { CalendarDays } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * "From – to" dates of a list filter as one control, as tall as the selects beside it
 * (no label above, so the toolbar stays on one line). Empty = no limit.
 */
export function DateRangeFilter({ from, to, onFrom, onTo, className }: {
  from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void; className?: string
}) {
  const input = 'h-full min-w-0 flex-1 bg-transparent text-sm outline-none [color-scheme:light] [&::-webkit-calendar-picker-indicator]:opacity-60'
  return (
    <div className={cn('flex h-9 items-center gap-1.5 rounded-md border border-input bg-card px-2.5 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20', className)}
      role="group" aria-label="Date range">
      <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <input type="date" className={cn(input, !from && 'text-muted-foreground')} value={from} max={to || undefined} onChange={(e) => onFrom(e.target.value)} aria-label="From date" title="From date" />
      <span className="text-muted-foreground">–</span>
      <input type="date" className={cn(input, !to && 'text-muted-foreground')} value={to} min={from || undefined} onChange={(e) => onTo(e.target.value)} aria-label="To date" title="To date" />
    </div>
  )
}
