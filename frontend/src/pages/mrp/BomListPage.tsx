import { useNavigate, useSearchParams } from 'react-router-dom'
import { Layers, Plus, X } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { BOM_STATUS, fmtDate, useBoms, type Bom } from '@/features/mrp/api'
import { BomStatusBadge } from '@/components/mrp/MrpParts'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/DataTable'
import { useInfiniteRows } from '@/components/InfiniteRows'
import { FilterBar } from '@/components/FilterBar'
import { useRemembered } from '@/lib/listMemory'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'

const columns: Column<Bom>[] = [
  {
    key: 'product', header: 'Finished product',
    cell: (b) => <div className="leading-tight"><div className="font-medium">{b.product_name}</div><div className="text-xs text-muted-foreground">{b.product_code} · {b.base_unit}</div></div>,
  },
  { key: 'code', header: 'BoM', cell: (b) => <div className="leading-tight"><div className="whitespace-nowrap text-[13px]">{b.code}</div><div className="text-xs text-muted-foreground">{b.name}</div></div> },
  { key: 'rev', header: 'Revision', className: 'text-right', cell: (b) => <span className="tabular-nums">{b.revision}</span> },
  { key: 'lines', header: 'Components', className: 'text-right', cell: (b) => <span className="tabular-nums">{b.lines_count}</span> },
  { key: 'eff', header: 'Effective', cell: (b) => <span className="whitespace-nowrap text-muted-foreground">{fmtDate(b.effective_date)}</span> },
  { key: 'status', header: 'Status', cell: (b) => <BomStatusBadge status={b.status} /> },
]

/** Bills of Materials: active first, then drafts, then archived revisions. */
export function BomListPage() {
  const navigate = useNavigate()
  const { hasPermission } = useAuth()
  const [params] = useSearchParams()
  const [search, setSearch] = useRemembered('mrp-boms', 'search', '')
  const [status, setStatus] = useRemembered('mrp-boms', 'status', params.get('status') ?? '')
  const [page, setPage] = useRemembered('mrp-boms', 'page', 1)
  const { data, isLoading } = useBoms({ search: search || undefined, status: status || undefined, page })
  const { rows, footer } = useInfiniteRows(data, page, setPage, 'mrp-boms')
  const filtered = !!(search || status)

  return (
    <div className="space-y-4">
      <PageHeader title="Bills of Materials" icon={<Layers className="size-5" />}
        actions={hasPermission('mrp.bom.manage') && <Button size="sm" onClick={() => navigate('/mrp/boms/new')}><Plus className="size-4" /> New BoM</Button>} />
      <FilterBar>
        <Input className="w-full sm:max-w-sm" placeholder="Search product, BoM code or name…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
        <div className="w-full sm:w-44"><Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>
          <option value="">All statuses</option>
          {Object.entries(BOM_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select></div>
        {filtered && <Button variant="ghost" size="sm" className="h-10" onClick={() => { setSearch(''); setStatus(''); setPage(1) }}><X className="size-4" /> Reset</Button>}
      </FilterBar>

      <div className="space-y-2 md:hidden">
        {!isLoading && rows.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{filtered ? 'No BoM for this filter.' : 'No Bills of Materials yet.'}</p>}
        {rows.map((b) => (
          <button key={b.id} type="button" onClick={() => navigate(`/mrp/boms/${b.id}`)} className="block w-full rounded-lg border bg-card p-3 text-left active:bg-muted/50">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><div className="font-medium">{b.product_name}</div><div className="text-xs text-muted-foreground">{b.code} · rev {b.revision} · {b.lines_count} components</div></div>
              <BomStatusBadge status={b.status} />
            </div>
          </button>
        ))}
        {footer}
      </div>
      <div className="hidden md:block">
        <DataTable columns={columns} rows={rows} footer={footer} rowKey={(b) => b.id} isLoading={isLoading} scrollMemoryKey="mrp-boms"
          onRowClick={(b) => navigate(`/mrp/boms/${b.id}`)} emptyText={filtered ? 'No BoM for this filter.' : 'No Bills of Materials yet.'} />
      </div>
    </div>
  )
}
