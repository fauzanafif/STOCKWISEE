import { useState } from 'react'
import { BarChart3 } from 'lucide-react'
import { useIrAnalytics } from '@/features/importantRequests/api'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Select } from '@/components/ui/select'

const MONTH = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4" title={hint}>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </Card>
  )
}

/** Tracking & Analytic · Important Request: how requests are being handled (from the real data). */
export function IrAnalyticsPage() {
  const [months, setMonths] = useState(6)
  const { data: a, isLoading, isError } = useIrAnalytics(months)
  return (
    <div className="space-y-4">
      <PageHeader title="Important Request Analytics" icon={<BarChart3 className="size-5" />} subtitle="Completion, delays, task load, and request trends." />
      <div className="w-44">
        <Select aria-label="Period" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
          {[3, 6, 12].map((m) => <option key={m} value={m}>{m} last months</option>)}
        </Select>
      </div>
      {isError && <p className="text-sm text-destructive">Failed to load analytics.</p>}
      {isLoading || !a ? <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi label="Request sent" value={a.total.toLocaleString('id-ID')} />
            <Kpi label="Completion rate" value={a.completion_rate == null ? '-' : `${a.completion_rate}%`} hint={a.definitions.completion_rate} />
            <Kpi label="Average completion time" value={a.avg_hours == null ? '-' : a.avg_hours >= 24 ? `${(a.avg_hours / 24).toFixed(1)} days` : `${a.avg_hours} hours`} hint={a.definitions.avg_hours} />
            <Kpi label="Late (not finished)" value={a.overdue_open.toLocaleString('id-ID')} hint={a.definitions.overdue_open} />
            <Kpi label="Finished past deadline" value={a.late_done.toLocaleString('id-ID')} hint={a.definitions.late_done} />
            <Kpi label="Revision requested before" value={a.revised.toLocaleString('id-ID')} hint={a.definitions.revised} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="overflow-hidden">
              <div className="border-b px-4 py-3 text-sm font-semibold">Requests per recipient division</div>
              <table className="w-full text-sm"><tbody className="divide-y">
                {a.by_divisi.length === 0 && <tr><td className="px-4 py-6 text-center text-muted-foreground">No data yet.</td></tr>}
                {a.by_divisi.map((d) => <tr key={d.divisi}><td className="px-4 py-2">{d.divisi}</td><td className="px-4 py-2 text-right tabular-nums">{d.n}</td></tr>)}
              </tbody></table>
            </Card>
            <Card className="overflow-hidden">
              <div className="border-b px-4 py-3 text-sm font-semibold">Active task load per person</div>
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="px-4 py-2 font-medium">Name</th><th className="px-4 py-2 text-right font-medium">Active</th><th className="px-4 py-2 text-right font-medium">Late</th></tr></thead>
                <tbody className="divide-y">
                  {a.workload.length === 0 && <tr><td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">No active tasks.</td></tr>}
                  {a.workload.map((w) => <tr key={w.name}><td className="px-4 py-2">{w.name}</td><td className="px-4 py-2 text-right tabular-nums">{w.open}</td><td className={`px-4 py-2 text-right tabular-nums ${Number(w.overdue) > 0 ? 'font-semibold text-red-600' : ''}`}>{w.overdue}</td></tr>)}
                </tbody>
              </table>
            </Card>
            <Card className="overflow-hidden">
              <div className="border-b px-4 py-3 text-sm font-semibold">Monthly trend</div>
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="px-4 py-2 font-medium">Month</th><th className="px-4 py-2 text-right font-medium">Created</th><th className="px-4 py-2 text-right font-medium">Done</th></tr></thead>
                <tbody className="divide-y">{a.trend.map((t) => <tr key={t.month}><td className="px-4 py-2">{MONTH(t.month)}</td><td className="px-4 py-2 text-right tabular-nums">{t.dibuat}</td><td className="px-4 py-2 text-right tabular-nums">{t.selesai}</td></tr>)}</tbody>
              </table>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
