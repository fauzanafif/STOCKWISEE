import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

import type { Range } from '@/lib/range'

/**
 * A from–to filter for a number column (QTY, Available, Lead Time …). Either side may stay empty: "from 10" or
 * "up to 5". A from bigger than the to is shown in red (nothing would match).
 */
export function RangeFilter({ label, value, onChange, unit, step = 'any' }: {
  label: string; value: Range; onChange: (v: Range) => void; unit?: string; step?: string
}) {
  const bad = value.min !== '' && value.max !== '' && Number(value.min) > Number(value.max)
  const active = value.min !== '' || value.max !== ''
  const box = cn('h-9 w-20 rounded-md border bg-card px-2 text-sm tabular-nums outline-none focus:ring-2 focus:ring-ring/30',
    bad ? 'border-red-400 text-red-700' : 'border-input')
  return (
    <div className={cn('flex h-9 items-center gap-1 rounded-md border px-2 text-sm', active ? 'border-primary/40 bg-primary/5' : 'border-transparent')}
      role="group" aria-label={`${label} range`} title={bad ? 'From is bigger than To: nothing matches' : undefined}>
      <span className="whitespace-nowrap text-muted-foreground">{label}</span>
      <input type="number" inputMode="decimal" step={step} className={box} placeholder="From" aria-label={`${label} from`}
        value={value.min} onChange={(e) => onChange({ ...value, min: e.target.value })} />
      <span className="text-muted-foreground">–</span>
      <input type="number" inputMode="decimal" step={step} className={box} placeholder="To" aria-label={`${label} to`}
        value={value.max} onChange={(e) => onChange({ ...value, max: e.target.value })} />
      {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      {active && <button type="button" aria-label={`Clear ${label} range`} className="text-muted-foreground hover:text-foreground" onClick={() => onChange({ min: '', max: '' })}><X className="size-3.5" /></button>}
    </div>
  )
}
