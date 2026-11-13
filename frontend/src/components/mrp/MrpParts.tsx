import { useState, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { AVAILABILITY, BOM_STATUS, MO_STATUS, fmtQty, useMrpItems, type BomStatus, type MoStatus, type MrpItem } from '@/features/mrp/api'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export function MoStatusBadge({ status }: { status: MoStatus }) {
  const s = MO_STATUS[status]
  return <Badge variant={s.variant}>{s.label}</Badge>
}

export function BomStatusBadge({ status }: { status: BomStatus }) {
  const s = BOM_STATUS[status]
  return <Badge variant={s.variant}>{s.label}</Badge>
}

export function AvailabilityBadge({ status }: { status: string }) {
  const s = AVAILABILITY[status] ?? { label: status, variant: 'neutral' as const }
  return <Badge variant={s.variant}>{s.label}</Badge>
}

/** A quantity with its unit; the Base UOM equivalent under it when the unit differs. */
export function Qty({ qty, unit, baseQty, baseUnit, className }: { qty: number; unit?: string | null; baseQty?: number; baseUnit?: string | null; className?: string }) {
  const converted = baseUnit && unit && unit !== baseUnit && baseQty !== undefined
  return (
    <span className={cn('inline-flex flex-col items-end leading-tight tabular-nums', className)}>
      <span>{fmtQty(qty)} <span className="text-muted-foreground">{unit ?? ''}</span></span>
      {converted && <span className="text-xs text-muted-foreground">= {fmtQty(baseQty)} {baseUnit}</span>}
    </span>
  )
}

/** A warning line inside a page: amber (attention) or red (blocks the step). */
export function Warn({ children, tone = 'warn' }: { children: ReactNode; tone?: 'warn' | 'bad' | 'info' }) {
  return (
    <div className={cn('flex items-start gap-2 rounded-lg border px-3 py-2 text-sm',
      tone === 'bad' ? 'border-red-200 bg-red-50 text-red-800' : tone === 'info' ? 'border-sky-200 bg-sky-50 text-sky-800' : 'border-amber-200 bg-amber-50 text-amber-900')}>
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** Stock items with a Base UOM (no services), searched by code or name. */
export function MrpItemPicker({ onPick, placeholder = 'Search item code or name (min 2 letters)…', exclude = [], onlyWithBom = false }: {
  onPick: (item: MrpItem) => void
  placeholder?: string
  exclude?: number[]
  /** products only: those with an active BoM */
  onlyWithBom?: boolean
}) {
  const [q, setQ] = useState('')
  const { data, isFetching } = useMrpItems(q)
  const open = q.trim().length >= 2
  const rows = (data ?? []).filter((i) => !exclude.includes(i.id))

  return (
    <div className="relative">
      <Input placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
      {open && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-card shadow-md">
          {isFetching && rows.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">Searching…</li>}
          {!isFetching && rows.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No results.</li>}
          {rows.map((it) => {
            const blocked = onlyWithBom && !it.active_bom_id
            return (
              <li key={it.id}>
                <button type="button" disabled={blocked}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => { onPick(it); setQ('') }}>
                  <span className="text-[13px] text-muted-foreground">{it.code}</span> {it.description}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {it.unit} · available {it.stock_known ? fmtQty(it.available, 2) : '?'}{blocked ? ' · no active BoM' : ''}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** One row of tabs under a page header. */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={value === t.key} onClick={() => onChange(t.key)}
          className={cn('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm', value === t.key ? 'border-primary font-medium text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
          {t.label}{t.count != null && <span className="ml-1.5 text-xs text-muted-foreground">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}
