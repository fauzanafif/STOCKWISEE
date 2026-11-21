import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Download, Table2, BarChart3 } from 'lucide-react'
import { downloadSvgAsPng } from '@/components/dashboard/ChartCard'
import { cn } from '@/lib/utils'

/**
 * The Analytics design system: a validated categorical palette (dataviz reference instance, checked with its
 * validator in both modes: adjacent CVD ΔE ≥ 9.1 / 8.4, normal-vision ≥ 19.6 / 19.3), fixed status colours, and the
 * chart chrome (recessive grid, axis, tooltip). Light and dark are each selected, not flipped.
 */
const LIGHT = {
  series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  grid: '#e7e5e1', axis: '#8a8984', text: '#52514e', strong: '#0b0b0b', surface: '#ffffff', muted: '#d9d7d2',
}
const DARK = {
  series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'],
  grid: '#2e2e2b', axis: '#8f8e88', text: '#c3c2b7', strong: '#f0efec', surface: '#0f172a', muted: '#3a3a36',
}
/** reserved for state (never a series): good / warning / serious / critical — always with a label */
export const STATUS = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' } as const

export type Viz = typeof LIGHT

/** The palette of the current theme (the app's `dark` class), following a switch while the page is open. */
export function useViz(): Viz {
  const [dark, setDark] = useState(() => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const el = document.documentElement
    const mo = new MutationObserver(() => setDark(el.classList.contains('dark')))
    mo.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => mo.disconnect()
  }, [])
  return dark ? DARK : LIGHT
}

export const fmt = (n: number | null | undefined, digits = 0) => (n == null ? '—' : Number(n).toLocaleString('id-ID', { maximumFractionDigits: digits }))
export const compact = (n: number) => Number(n).toLocaleString('id-ID', { notation: 'compact', maximumFractionDigits: 1 })

/** Recessive chrome shared by every chart: thin grid, quiet axes, no axis lines. */
export function axisProps(v: Viz) {
  return {
    grid: { stroke: v.grid, strokeDasharray: '0', vertical: false } as const,
    tick: { fill: v.text, fontSize: 11 } as const,
    axisLine: false as const,
    tickLine: false as const,
  }
}

/** The tooltip every chart uses: the row's name, then each series with its colour swatch, values in text ink. */
export function VizTooltip({ active, payload, label, unit, labelFormat }: {
  active?: boolean; payload?: { name?: string; value?: number; color?: string; dataKey?: string | number; payload?: Record<string, unknown> }[]; label?: string | number
  unit?: string; labelFormat?: (l: string) => string
}) {
  if (!active || !payload?.length) return null
  const title = String(label ?? payload[0]?.payload?.name ?? '')
  return (
    <div className="min-w-[10rem] rounded-md border bg-card px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 max-w-[16rem] truncate font-medium text-foreground">{labelFormat ? labelFormat(title) : title}</div>
      <ul className="space-y-0.5">
        {payload.map((p) => (
          <li key={String(p.dataKey)} className="flex items-center gap-2">
            <span className="size-2 shrink-0 rounded-sm" style={{ background: p.color }} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{p.name}</span>
            <span className="font-medium tabular-nums text-foreground">{fmt(p.value, 2)}{unit ? ` ${unit}` : ''}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The legend: a swatch and a name per series, in series order (identity never by colour alone). */
export function Legend({ items }: { items: { name: string; color: string }[] }) {
  if (items.length < 2) return null
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((i) => <li key={i.name} className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: i.color }} aria-hidden />{i.name}</li>)}
    </ul>
  )
}

/**
 * A chart panel: title and what it answers, the legend, the chart — and a table of the same numbers one click away
 * (the relief for colours under 3:1 and for screen readers), plus a PNG of the chart.
 */
export function Panel({ title, subtitle, legend, table, children, className, empty, actions }: {
  title: string; subtitle?: string; legend?: { name: string; color: string }[]
  /** the same data as rows (columns, then rows of cells) */
  table?: { columns: string[]; rows: (string | number)[][] }
  children: ReactNode; className?: string; empty?: boolean; actions?: ReactNode
}) {
  const [asTable, setAsTable] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const png = () => {
    const svg = box.current?.querySelector('svg.recharts-surface') as SVGSVGElement | null
    if (svg) void downloadSvgAsPng(svg, title.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
  }
  return (
    <section className={cn('flex min-w-0 flex-col rounded-xl border bg-card p-4 shadow-[0_1px_2px_rgb(15_23_42/0.04)]', className)} aria-label={title}>
      <header className="mb-3 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-[13.5px] font-semibold leading-snug text-foreground">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 print:hidden">
          {actions}
          {table && !empty && (
            <button type="button" onClick={() => setAsTable((v) => !v)} title={asTable ? 'Show the chart' : 'Show as a table'} aria-pressed={asTable}
              className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">{asTable ? <BarChart3 className="size-4" /> : <Table2 className="size-4" />}</button>
          )}
          {!asTable && !empty && <button type="button" onClick={png} title="Download PNG" className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><Download className="size-4" /></button>}
        </div>
      </header>
      {legend && !asTable && !empty && <div className="mb-2"><Legend items={legend} /></div>}
      <div ref={box} className="min-h-0 flex-1">
        {empty ? <div className="flex h-20 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">No data yet.</div>
          : asTable && table ? (
            <div className="max-h-72 overflow-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/80 text-left text-muted-foreground backdrop-blur">
                  <tr>{table.columns.map((c, i) => <th key={c} className={cn('px-2.5 py-1.5 font-medium', i > 0 && 'text-right')}>{c}</th>)}</tr>
                </thead>
                <tbody className="divide-y">
                  {table.rows.map((r, k) => <tr key={k}>{r.map((c, i) => <td key={i} className={cn('px-2.5 py-1.5', i > 0 && 'text-right tabular-nums')}>{typeof c === 'number' ? fmt(c, 2) : c}</td>)}</tr>)}
                </tbody>
              </table>
            </div>
          ) : children}
      </div>
    </section>
  )
}

export type KpiTone = 'good' | 'warning' | 'critical' | null

/** A headline number: label, the number, and what it means; a state wears its colour as a bar and a word, never alone. */
export function Kpi({ label, value, sub, tone, icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: KpiTone; icon?: ReactNode }) {
  return (
    <div className="relative min-w-0 overflow-hidden rounded-xl border bg-card px-4 py-3 shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
      {tone && <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: STATUS[tone] }} />}
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">{icon}{label}</div>
      <div className="mt-1 text-2xl font-semibold leading-tight tracking-tight tabular-nums text-foreground">{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

/** A row of headline numbers. */
export function KpiRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{children}</div>
}

/** One module's analyses: a heading, then its headline numbers and panels. */
export function ModuleSection({ id, title, description, filters, children }: { id: string; title: string; description?: string; filters?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-[calc(var(--sw-header)+5rem)] space-y-4">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2 border-b pb-2">
        <div className="min-w-0 flex-1">
          <h3 id={`${id}-title`} className="text-base font-semibold tracking-tight text-foreground">{title}</h3>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {filters && <div className="flex flex-wrap items-center gap-2 print:hidden">{filters}</div>}
      </div>
      {children}
    </section>
  )
}
