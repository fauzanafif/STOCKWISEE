import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, ChevronDown, ExternalLink, Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface QualityCheck {
  key: string
  title: string
  hint: string
  count: number
  columns: string[]
  rows: Record<string, string | number | null>[]
  fix: string | null
}

export function useMasterDataQuality() {
  return useQuery({
    queryKey: ['master-data-quality'],
    queryFn: async () => (await api.get<{ data: QualityCheck[] }>('/api/master-data/quality')).data.data,
  })
}

function CheckCard({ c }: { c: QualityCheck }) {
  const ok = c.count === 0
  const [open, setOpen] = useState(false)
  return (
    <section className="overflow-hidden rounded-lg border bg-card shadow-[0_1px_2px_rgb(15_23_42/0.05)]" aria-labelledby={`dq-${c.key}`}>
      <button type="button" onClick={() => !ok && setOpen((v) => !v)} aria-expanded={ok ? undefined : open} disabled={ok}
        className={cn('flex w-full items-start gap-3 px-4 py-3 text-left', !ok && 'hover:bg-muted/40')}>
        {ok
          ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden />
          : <span className="mt-0.5 min-w-[2.25rem] shrink-0 rounded-full bg-amber-100 px-2 text-center text-[13px] font-semibold leading-6 text-amber-800 tabular-nums dark:bg-amber-950 dark:text-amber-300">{c.count.toLocaleString('id-ID')}</span>}
        <span className="min-w-0 flex-1">
          <span id={`dq-${c.key}`} className="block text-[14px] font-semibold">{c.title}</span>
          <span className="block text-[13px] text-muted-foreground">{ok ? 'Nothing to fix.' : c.hint}</span>
        </span>
        {!ok && <ChevronDown className={cn('mt-1 size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />}
      </button>
      {open && !ok && (
        <div className="border-t">
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-slate-100 text-left dark:bg-slate-900">
                <tr>{c.columns.map((h) => <th key={h} className="whitespace-nowrap px-4 py-2">{h}</th>)}</tr>
              </thead>
              <tbody>
                {c.rows.map((r, i) => <tr key={i} className="border-t">{c.columns.map((h) => <td key={h} className="px-4 py-1.5 align-top">{r[h] ?? '—'}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
            <span>{c.count > c.rows.length ? `Showing the first ${c.rows.length} of ${c.count.toLocaleString('id-ID')}.` : `${c.count} in total.`}</span>
            {c.fix && <Link to={c.fix} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">Fix it there <ExternalLink className="size-3" /></Link>}
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * Data Quality: master data that needs a person's look (items without a unit, look-alike vendors,
 * conversions to review…). Read only, from STOCKWISE's own masters; nothing is merged automatically.
 */
export function DataQualityPage() {
  const { data, isLoading } = useMasterDataQuality()
  const open = (data ?? []).filter((c) => c.count > 0).length
  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <PageHeader title="Data Quality" />
      <p className="text-sm text-muted-foreground">
        {isLoading ? 'Checking the master data…' : open === 0 ? 'All checks are clear.' : `${open} of ${data?.length ?? 0} checks need a look. Nothing here is changed automatically: open a check to see what to fix and where.`}
      </p>
      {isLoading
        ? <div className="flex h-32 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        : <div className="space-y-3">{[...(data ?? [])].sort((a, b) => Number(b.count > 0) - Number(a.count > 0)).map((c) => <CheckCard key={c.key} c={c} />)}</div>}
    </div>
  )
}
