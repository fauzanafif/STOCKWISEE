import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, LabelList } from 'recharts'
import { axisProps, compact, fmt, useViz, VizTooltip } from './viz'

/** a label that fits: long names are shortened on the axis, whole in the tooltip */
const short = (s: string, n = 22) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/**
 * Ranked horizontal bars (a top-N): one series, thin bars with a rounded end, the value written at the bar's end,
 * the name on the left. For magnitude by name, the most readable form.
 */
export function RankedBars({ data, value, name = 'name', label, color, unit, height }: {
  data: Record<string, unknown>[]; value: string; name?: string; label: string; color?: string; unit?: string; height?: number
}) {
  const v = useViz()
  const a = axisProps(v)
  const h = height ?? Math.max(160, data.length * 30 + 16)
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 48, bottom: 0, left: 4 }} barCategoryGap={8}>
        <CartesianGrid {...a.grid} horizontal={false} vertical />
        <XAxis type="number" hide />
        <YAxis type="category" dataKey={name} width={150} tick={a.tick} axisLine={false} tickLine={false} tickFormatter={(s: string) => short(String(s))} />
        <Tooltip cursor={{ fill: v.grid, opacity: 0.5 }} content={<VizTooltip unit={unit} />} />
        <Bar dataKey={value} name={label} fill={color ?? v.series[0]} radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false}>
          <LabelList dataKey={value} position="right" formatter={(x: unknown) => compact(Number(x))} style={{ fill: v.text, fontSize: 11 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/**
 * Stacked bars (part-to-whole per row): segments in a fixed order and colour, a 2 px surface gap between them,
 * horizontal so long names read. `percent` shows each row as 100 % (the mix), otherwise the counts.
 */
export function StackedBars({ data, series, name = 'name', percent, height }: {
  data: Record<string, unknown>[]; series: { key: string; label: string; color: string }[]; name?: string; percent?: boolean; height?: number
}) {
  const v = useViz()
  const a = axisProps(v)
  const rows = percent
    ? data.map((d) => {
      const total = series.reduce((t, s) => t + Number(d[s.key] ?? 0), 0) || 1
      return { ...d, ...Object.fromEntries(series.map((s) => [s.key, Math.round((Number(d[s.key] ?? 0) / total) * 1000) / 10])) }
    })
    : data
  const h = height ?? Math.max(160, rows.length * 30 + 24)
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 4 }} barCategoryGap={8}>
        <CartesianGrid {...a.grid} horizontal={false} vertical />
        <XAxis type="number" tick={a.tick} axisLine={false} tickLine={false} domain={percent ? [0, 100] : undefined} tickFormatter={(x: number) => (percent ? `${x}%` : compact(x))} />
        <YAxis type="category" dataKey={name} width={150} tick={a.tick} axisLine={false} tickLine={false} tickFormatter={(s: string) => short(String(s))} />
        <Tooltip cursor={{ fill: v.grid, opacity: 0.5 }} content={<VizTooltip unit={percent ? '%' : undefined} />} />
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} stackId="s" fill={s.color} stroke={v.surface} strokeWidth={2} maxBarSize={18} isAnimationActive={false}
            radius={i === series.length - 1 ? [0, 4, 4, 0] : 0} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Two (or a few) measures of the same unit side by side per category (vertical, thin, 2 px apart). */
export function GroupedBars({ data, series, name = 'name', height = 240 }: {
  data: Record<string, unknown>[]; series: { key: string; label: string; color: string }[]; name?: string; height?: number
}) {
  const v = useViz()
  const a = axisProps(v)
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="24%">
        <CartesianGrid {...a.grid} />
        <XAxis dataKey={name} tick={a.tick} axisLine={false} tickLine={false} interval={0} tickFormatter={(s: string) => short(String(s), 12)} />
        <YAxis tick={a.tick} axisLine={false} tickLine={false} width={44} tickFormatter={(x: number) => compact(x)} />
        <Tooltip cursor={{ fill: v.grid, opacity: 0.5 }} content={<VizTooltip />} />
        {series.map((s) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />)}
      </BarChart>
    </ResponsiveContainer>
  )
}

/** One series over time as columns (counts per month): thin, rounded tops anchored to the baseline. */
export function Columns({ data, value, name = 'name', label, color, height = 220, unit }: {
  data: Record<string, unknown>[]; value: string; name?: string; label: string; color?: string; height?: number; unit?: string
}) {
  const v = useViz()
  const a = axisProps(v)
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 16, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
        <CartesianGrid {...a.grid} />
        <XAxis dataKey={name} tick={a.tick} axisLine={false} tickLine={false} />
        <YAxis tick={a.tick} axisLine={false} tickLine={false} width={40} tickFormatter={(x: number) => compact(x)} allowDecimals={false} />
        <Tooltip cursor={{ fill: v.grid, opacity: 0.5 }} content={<VizTooltip unit={unit} />} />
        <Bar dataKey={value} name={label} fill={color ?? v.series[0]} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false}>
          {data.length <= 14 && <LabelList dataKey={value} position="top" formatter={(x: unknown) => (Number(x) ? compact(Number(x)) : '')} style={{ fill: v.text, fontSize: 10 }} />}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Lines over time (2 px, markers on hover): a crosshair and a tooltip with every series at that point. */
export function Trend({ data, series, name = 'name', height = 240 }: {
  data: Record<string, unknown>[]; series: { key: string; label: string; color: string }[]; name?: string; height?: number
}) {
  const v = useViz()
  const a = axisProps(v)
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid {...a.grid} />
        <XAxis dataKey={name} tick={a.tick} axisLine={false} tickLine={false} />
        <YAxis tick={a.tick} axisLine={false} tickLine={false} width={40} tickFormatter={(x: number) => compact(x)} allowDecimals={false} />
        <Tooltip cursor={{ stroke: v.axis, strokeWidth: 1 }} content={<VizTooltip />} />
        {series.map((s) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false}
            activeDot={{ r: 4, stroke: v.surface, strokeWidth: 2 }} isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

/** A headline fraction as a thin bar with its parts (no pie): e.g. the stock status mix of every item. */
export function MixBar({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((t, p) => t + p.value, 0) || 1
  return (
    <div className="space-y-2">
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full" role="img" aria-label={parts.map((p) => `${p.label}: ${fmt(p.value)}`).join(', ')}>
        {parts.filter((p) => p.value > 0).map((p) => <span key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} title={`${p.label}: ${fmt(p.value)}`} />)}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-1.5 text-muted-foreground">
            <span className="size-2.5 rounded-sm" style={{ background: p.color }} aria-hidden />{p.label}
            <span className="font-medium tabular-nums text-foreground">{fmt(p.value)}</span>
            <span className="tabular-nums">({fmt((p.value / total) * 100, 1)}%)</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
