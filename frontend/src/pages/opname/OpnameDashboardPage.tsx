import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, ClipboardList, FileText, Plus, X } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useFormOptions, useOpnameDashboard, type DashboardFilters } from '@/features/opname/workflow'
import { FLOW, FLOW_FILTERS, FlowBadge } from '@/features/opname/status'
import { useAuth } from '@/auth/AuthContext'
import { apiErrorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/PageHeader'
import { ChartCard } from '@/components/dashboard/ChartCard'
import { SwatchLegend } from '@/components/dashboard/OperationsDashboard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { EVENT_LABELS, VarianceValue, fmtDateTime, fmtQty } from './OpnameWorkspacePage'
import { OpnameOrderForm } from './OpnameOrderForm'

const ACCURACY = '#2563eb'
const DONE = '#10b981'
const OPEN = '#94a3b8'

function Kpi({ label, value, tone, to, hint }: { label: string; value: ReactNode; tone?: 'warn' | 'good' | 'bad'; to?: string; hint?: string }) {
  const body = (
    <>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={cn('mt-1 text-2xl font-semibold tabular-nums', tone === 'warn' && 'text-amber-600', tone === 'good' && 'text-emerald-600', tone === 'bad' && 'text-red-600')}>{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </>
  )
  const cls = 'block rounded-lg border bg-card p-3 transition-shadow'
  return to ? <Link to={to} className={cn(cls, 'hover:shadow-md')}>{body}</Link> : <div className={cls}>{body}</div>
}

function Panel({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-2.5"><h2 className="text-sm font-semibold">{title}</h2>{action}</div>
      <div className="p-2">{children}</div>
    </section>
  )
}

/**
 * The one Stock Opname dashboard: KPIs, what waits for me, latest activity, stock accuracy by month,
 * per warehouse, and the largest variances — filtered by date, warehouse, status and person in charge.
 */
export function OpnameDashboardPage() {
  const { hasPermission } = useAuth()
  const navigate = useNavigate()
  const [f, setF] = useState<DashboardFilters>({})
  const [creating, setCreating] = useState(false)
  const { data, isLoading, error } = useOpnameDashboard(f)
  const { data: opt } = useFormOptions()
  const set = (p: Partial<DashboardFilters>) => setF((v) => ({ ...v, ...p }))
  const filtered = Object.values(f).some((v) => v !== undefined && v !== '')
  const list = (status?: string) => `/stock-opnames?view=docs&source=internal${status ? `&status=${status}` : ''}`

  return (
    <div className="space-y-4">
      <PageHeader title="Stock Opname" actions={<>
        <Button size="sm" variant="outline" onClick={() => navigate('/stock-opnames')}><FileText className="size-4" /> Documents</Button>
        {hasPermission('opname.schedule') && <Button size="sm" onClick={() => setCreating(true)}><Plus className="size-4" /> New Stock Opname</Button>}
      </>} />

      {/* filters: one row above everything */}
      <div className="card-surface flex flex-wrap items-end gap-3 p-3">
        <label className="space-y-1"><span className="block text-xs font-medium text-muted-foreground">Date</span>
          <div className="flex items-center gap-1.5">
            <Input type="date" aria-label="Date from" className="h-9 w-40" value={f.date_from ?? ''} onChange={(e) => set({ date_from: e.target.value || undefined })} />
            <span className="text-muted-foreground">–</span>
            <Input type="date" aria-label="Date to" className="h-9 w-40" value={f.date_to ?? ''} onChange={(e) => set({ date_to: e.target.value || undefined })} />
          </div>
        </label>
        <label className="space-y-1"><span className="block text-xs font-medium text-muted-foreground">Warehouse</span>
          <Select aria-label="Warehouse" className="h-9 w-44" value={f.warehouse_id ?? ''} onChange={(e) => set({ warehouse_id: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">All warehouses</option>
            {opt?.warehouses.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}
          </Select>
        </label>
        <label className="space-y-1"><span className="block text-xs font-medium text-muted-foreground">Status</span>
          <Select aria-label="Status" className="h-9 w-44" value={f.status ?? ''} onChange={(e) => set({ status: e.target.value || undefined })}>
            <option value="">All statuses</option>
            {FLOW_FILTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
        </label>
        <label className="space-y-1"><span className="block text-xs font-medium text-muted-foreground">Person in charge</span>
          <Select aria-label="Person in charge" className="h-9 w-44" value={f.responsible_id ?? ''} onChange={(e) => set({ responsible_id: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">Everyone</option>
            {opt?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        </label>
        {filtered && <Button size="sm" variant="ghost" className="h-9" onClick={() => setF({})}><X className="size-4" /> Reset</Button>}
      </div>

      {error && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{apiErrorMessage(error)}</p>}
      {isLoading && <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
            <Kpi label="Total Stock Opname" value={data.kpi.total} to={list()} />
            <Kpi label="Draft" value={data.kpi.draft} to={list('DRAFT')} />
            <Kpi label="Being Counted" value={data.kpi.counting} to={list('COUNTING')} hint="confirmed · counting · recount" />
            <Kpi label="Waiting Review" value={data.kpi.review} tone={data.kpi.review ? 'warn' : undefined} to={list('REVIEW')} />
            <Kpi label="Waiting Approval" value={data.kpi.approval} tone={data.kpi.approval ? 'warn' : undefined} to={list('WAITING_APPROVAL')} />
            <Kpi label="Finished" value={data.kpi.done} tone="good" to={list('DONE')} hint="posted · done" />
            <Kpi label="Items with Variance" value={data.kpi.variance_lines} tone={data.kpi.variance_lines ? 'bad' : undefined} />
            <Kpi label="Stock Accuracy" value={data.kpi.accuracy != null ? `${data.kpi.accuracy}%` : '—'} hint="counted lines matching the book" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="To do" action={<ClipboardList className="size-4 text-muted-foreground" />}>
              {data.todo.length === 0 ? <p className="px-2 py-6 text-center text-sm text-muted-foreground">Nothing waits for you.</p> : (
                <ul className="divide-y">
                  {data.todo.map((t) => (
                    <li key={`${t.id}-${t.action}`}>
                      <Link to={`/stock-opnames/${t.id}`} className="flex items-center gap-3 rounded px-2 py-2 text-sm hover:bg-muted/60">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">{t.action} <span className="font-normal text-muted-foreground">· {t.number}</span></div>
                          <div className="text-xs text-muted-foreground">{t.warehouse ?? '—'} · {t.items_count} items · {t.scheduled_date}</div>
                        </div>
                        {t.late && <span className="inline-flex items-center gap-1 text-xs text-red-600"><AlertTriangle className="size-3.5" />Late</span>}
                        <FlowBadge status={t.flow_status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="Recent activity">
              {data.recent.length === 0 ? <p className="px-2 py-6 text-center text-sm text-muted-foreground">No activity yet.</p> : (
                <ul className="divide-y">
                  {data.recent.map((e) => (
                    <li key={e.id} className="px-2 py-2 text-sm">
                      <Link to={`/stock-opnames/${e.opname?.id}`} className="font-medium hover:text-primary">{e.opname?.number}</Link>{' '}
                      <span>{EVENT_LABELS[e.event] ?? e.event}</span>
                      {e.to_status && e.from_status !== e.to_status && <span className="text-muted-foreground"> → {FLOW[e.to_status]?.label ?? e.to_status}</span>}
                      <div className="text-xs text-muted-foreground">{e.user ?? 'System'} · {fmtDateTime(e.at)}{e.note ? ` · “${e.note}”` : ''}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Stock accuracy by month" subtitle="Share of counted lines that matched the book quantity (finished opnames)" empty={data.accuracy.length === 0}>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.accuracy} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} fontSize={12} />
                  <Tooltip cursor={{ fill: 'rgb(148 163 184 / 0.15)' }}
                    formatter={(v, _n, p) => [`${v}% (${p?.payload?.matched}/${p?.payload?.counted} lines)`, 'Accuracy']} />
                  <Bar dataKey="accuracy" name="Accuracy" fill={ACCURACY} radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Stock opname per warehouse" empty={data.by_warehouse.length === 0}>
              <SwatchLegend items={[[DONE, 'Finished'], [OPEN, 'Open']]} />
              <ResponsiveContainer width="100%" height={Math.max(160, data.by_warehouse.length * 36 + 40)}>
                <BarChart data={data.by_warehouse} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid horizontal={false} stroke="#e2e8f0" />
                  <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis type="category" dataKey="code" width={90} tickLine={false} axisLine={false} fontSize={12} />
                  <Tooltip cursor={{ fill: 'rgb(148 163 184 / 0.15)' }} />
                  <Bar dataKey="finished" name="Finished" stackId="w" fill={DONE} stroke="#fff" strokeWidth={2} />
                  <Bar dataKey="open" name="Open" stackId="w" fill={OPEN} stroke="#fff" strokeWidth={2} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {data.top_variances && (
            <Panel title="Largest variances">
              {data.top_variances.length === 0 ? <p className="px-2 py-6 text-center text-sm text-muted-foreground">No variance found.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[40rem] text-sm">
                    <thead className="text-left text-xs text-muted-foreground"><tr><th className="px-2 py-1.5">Item</th><th className="px-2">Document</th><th className="px-2 text-right">System</th><th className="px-2 text-right">Counted</th><th className="px-2 text-right">Variance</th><th className="px-2">Status</th></tr></thead>
                    <tbody>
                      {data.top_variances.map((v) => (
                        <tr key={v.line_id} className="cursor-pointer border-t hover:bg-muted/50" onClick={() => navigate(`/stock-opnames/${v.opname_id}`)}>
                          <td className="px-2 py-1.5"><div className="text-[13px] text-muted-foreground">{v.item_code}</div>{v.description}</td>
                          <td className="px-2 text-primary">{v.number}</td>
                          <td className="px-2 text-right tabular-nums">{fmtQty(v.system_qty)}</td>
                          <td className="px-2 text-right tabular-nums">{fmtQty(v.physical_qty)}</td>
                          <td className="px-2 text-right"><VarianceValue value={v.variance} pct={v.variance_pct} /></td>
                          <td className="px-2"><FlowBadge status={v.flow_status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          )}
        </>
      )}
      {creating && <OpnameOrderForm onClose={() => setCreating(false)} />}
    </div>
  )
}
