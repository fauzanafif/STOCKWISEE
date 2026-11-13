import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { History, X } from 'lucide-react'
import { useDsaHistory } from '@/features/disassembly/api'
import { fmtDate, fmtQty, type MrpItem } from '@/features/mrp/api'
import { MrpItemPicker } from '@/components/mrp/MrpParts'
import { DsaStatusBadge } from '@/components/disassembly/DsaParts'
import { PageHeader } from '@/components/PageHeader'
import { FilterBar } from '@/components/FilterBar'
import { DocSection } from '@/components/doc/DocLayout'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'

const iso = (d: Date) => d.toISOString().slice(0, 10)
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d) }

/** Validated disassemblies: what was taken apart and, per component, what came out good, scrapped or missing. */
export function DisassemblyHistoryPage() {
  const navigate = useNavigate()
  const [from, setFrom] = useState(() => daysAgo(90))
  const [to, setTo] = useState(() => daysAgo(0))
  const [search, setSearch] = useState('')
  const [item, setItem] = useState<MrpItem | null>(null)
  const { data, isLoading } = useDsaHistory({ from, to, search: search || undefined, item_id: item?.id ?? null })
  const rows = data?.data ?? []

  return (
    <div className="space-y-4">
      <PageHeader title="Disassembly History" icon={<History className="size-5" />} subtitle={data ? `${data.meta.count} validated order(s)` : undefined} />
      <FilterBar>
        <Input type="date" aria-label="From" className="w-full sm:w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" aria-label="To" className="w-full sm:w-40" value={to} onChange={(e) => setTo(e.target.value)} />
        <Input className="w-full sm:max-w-xs" placeholder="Search document or product…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {item ? (
          <Badge variant="default" className="h-8 gap-1">{item.code}<button type="button" aria-label="Clear item" onClick={() => setItem(null)}><X className="size-3" /></button></Badge>
        ) : <div className="w-full sm:w-72"><MrpItemPicker onPick={setItem} placeholder="Product or component…" /></div>}
      </FilterBar>

      {isLoading && <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && rows.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No validated disassembly in this period.</p>}
      {rows.map((o) => (
        <DocSection key={o.id} flush
          title={<button type="button" className="text-left hover:underline" onClick={() => navigate(`/disassembly/orders/${o.id}`)}>{o.number} · {o.product_name}</button>}
          actions={<div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="tabular-nums">{fmtQty(o.done_qty ?? o.planned_qty, 2)} {o.base_unit}</span><span>{o.source_warehouse}</span><span>{fmtDate(o.done_at)}</span>
            <DsaStatusBadge status={o.status} />{o.reversed && <Badge variant="neutral">Reversed</Badge>}
            {o.status === 'DONE' && (o.accurate_recorded ? <Badge variant="success">In Accurate</Badge> : <Badge variant="warning">Not in Accurate</Badge>)}
          </div>}>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-slate-100 text-left text-xs text-slate-600"><tr>
                <th className="px-3 py-2">Component</th><th className="px-3 py-2 text-right">Good</th><th className="px-3 py-2 text-right">Scrap</th><th className="px-3 py-2 text-right">Missing</th>
              </tr></thead>
              <tbody>
                {o.components.map((c) => (
                  <tr key={c.item_id} className="border-t">
                    <td className="px-3 py-1.5"><span className="font-medium">{c.description}</span> <span className="text-xs text-muted-foreground">{c.code}{c.is_extra ? ' · outside BoM' : ''}</span></td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">{fmtQty(c.good)} <span className="text-muted-foreground">{c.base_unit}</span></td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtQty(c.scrap)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtQty(c.missing)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DocSection>
      ))}
    </div>
  )
}
