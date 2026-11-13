import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { StockSerial } from '@/features/npbg/api'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/** Pick the serial numbers going out: exactly one per unit, only from those still in stock. */
export function SerialPicker({ serials, loading, need, picked, onChange }: {
  serials: StockSerial[]; loading: boolean; need: number; picked: string[]; onChange: (next: string[]) => void
}) {
  const [q, setQ] = useState('')
  const shown = serials.filter((s) => s.serial.toLowerCase().includes(q.trim().toLowerCase()))
  const full = need > 0 && picked.length >= need
  const toggle = (s: string) => onChange(picked.includes(s) ? picked.filter((x) => x !== s) : full ? picked : [...picked, s])
  const ok = need > 0 && picked.length === need
  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">Serial numbers <span className="text-destructive">*</span></span>
        <span className={cn('text-xs font-medium tabular-nums', ok ? 'text-emerald-700' : 'text-amber-700')}>
          {picked.length} of {need || '—'} selected · {serials.length} in stock
        </span>
      </div>
      <Input className="h-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search serial number" aria-label="Search serial number" />
      <div className="max-h-48 overflow-y-auto rounded border bg-card">
        {loading ? <div className="flex h-16 items-center justify-center"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>
          : shown.length === 0 ? <p className="px-3 py-4 text-center text-sm text-muted-foreground">{serials.length ? 'No match.' : 'No serial number in stock for this item.'}</p>
            : (
              <ul className="divide-y">
                {shown.map((s) => {
                  const on = picked.includes(s.serial)
                  return (
                    <li key={s.serial}>
                      <label className={cn('flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted/50', !on && full && 'cursor-not-allowed opacity-50')}>
                        <input type="checkbox" className="size-4 accent-primary" checked={on} disabled={!on && full} onChange={() => toggle(s.serial)} />
                        <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{s.serial}</span>
                        {s.expired && <span className="shrink-0 text-xs text-muted-foreground">exp {new Date(s.expired + 'T00:00:00').toLocaleDateString('en-GB')}</span>}
                        <span className="shrink-0 rounded bg-muted px-1.5 text-[11px] text-muted-foreground">{s.source === 'RI' ? 'Receipt' : 'Accurate'}</span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
      </div>
    </div>
  )
}
