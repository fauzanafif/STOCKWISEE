import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2, PackageOpen, Plus, X } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { apiErrorMessage } from '@/lib/api'
import { toast } from '@/lib/notify'
import { DSA_STATUS, useDsaBom, useDsaStock, useDsaUsers, useDsas, useSaveDsa, type Dsa, type DsaDetail, type DsaItem } from '@/features/disassembly/api'
import { fmtDate, fmtQty } from '@/features/mrp/api'
import { Tabs } from '@/components/mrp/MrpParts'
import { DsaItemPicker, DsaStatusBadge } from '@/components/disassembly/DsaParts'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/DataTable'
import { useInfiniteRows } from '@/components/InfiniteRows'
import { FilterBar } from '@/components/FilterBar'
import { useRemembered } from '@/lib/listMemory'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

type Scope = 'open' | 'done' | 'all'
const SCOPE: Record<Scope, string | undefined> = { open: 'DRAFT,CONFIRMED,IN_PROGRESS,TO_CLOSE', done: 'DONE,CANCELLED', all: undefined }

const columns: Column<Dsa>[] = [
  { key: 'number', header: 'Document', cell: (o) => <span className="whitespace-nowrap text-[13px]">{o.number}</span> },
  {
    key: 'product', header: 'Product',
    cell: (o) => <div className="leading-tight"><div className="font-medium">{o.product_name}</div><div className="text-xs text-muted-foreground">{o.product_code} · {o.bom_code} rev {o.bom_revision}</div></div>,
  },
  { key: 'qty', header: 'Planned', className: 'text-right', cell: (o) => <span className="whitespace-nowrap tabular-nums">{fmtQty(o.planned_qty, 2)} <span className="text-muted-foreground">{o.base_unit}</span>{o.done_qty !== null && o.done_qty !== o.planned_qty && <div className="text-xs text-muted-foreground">done {fmtQty(o.done_qty, 2)}</div>}</span> },
  { key: 'wh', header: 'Warehouse', cell: (o) => <span className="text-muted-foreground">{o.source_warehouse ?? '-'}</span> },
  { key: 'resp', header: 'Responsible', cell: (o) => <span className="text-muted-foreground">{o.responsible_name ?? '-'}</span> },
  { key: 'created', header: 'Created', cell: (o) => <span className="whitespace-nowrap text-muted-foreground">{fmtDate(o.created_at)}</span> },
  { key: 'status', header: 'Status', cell: (o) => <div className="flex flex-wrap gap-1"><DsaStatusBadge status={o.status} />{o.reversed && <Badge variant="neutral">Reversed</Badge>}</div> },
  {
    key: 'accurate', header: 'Accurate',
    cell: (o) => o.status !== 'DONE' || !o.posts_stock ? <span className="text-muted-foreground">-</span> : o.accurate_recorded ? <Badge variant="success">Entered</Badge> : <Badge variant="warning">Not yet</Badge>,
  },
]

/** New / edit a Disassembly Order: a product with an active BoM, how many to take apart, and from which warehouse. */
export function DsaFormModal({ open, onClose, order }: { open: boolean; onClose: () => void; order?: DsaDetail }) {
  const navigate = useNavigate()
  const save = useSaveDsa()
  const users = useDsaUsers(open)
  const [product, setProduct] = useState<{ id: number; code: string | null; description: string | null; unit: string | null } | null>(
    order ? { id: order.item_id, code: order.product_code, description: order.product_name, unit: order.base_unit } : null)
  const [qty, setQty] = useState(order ? String(order.planned_qty) : '')
  const [source, setSource] = useState(order ? String(order.source_warehouse_id) : '')
  const dest = order?.dest_warehouse_id ? String(order.dest_warehouse_id) : '' // components now go where their Receipt puts them
  const [resp, setResp] = useState(order?.responsible_id ? String(order.responsible_id) : '')
  const [notes, setNotes] = useState(order?.notes ?? '')
  const [err, setErr] = useState<string | null>(null)
  const bom = useDsaBom(product?.id ?? null)
  const stock = useDsaStock(product?.id ?? null)
  const n = Number(qty.replace(',', '.'))
  const free = stock.data?.find((w) => String(w.id) === source)

  const pick = (it: DsaItem) => {
    setProduct({ id: it.id, code: it.code, description: it.description, unit: it.unit })
    setSource(it.default_warehouse_id ? String(it.default_warehouse_id) : '')
  }

  const submit = () => {
    setErr(null)
    if (!product) return setErr('Select the product to take apart.')
    if (!(n > 0)) return setErr('Quantity must be more than 0.')
    if (!source) return setErr('Select the source warehouse.')
    save.mutate({
      id: order?.id,
      data: {
        ...(order ? {} : { item_id: product.id }),
        planned_qty: qty.replace(',', '.').trim(), source_warehouse_id: Number(source), dest_warehouse_id: dest ? Number(dest) : null,
        responsible_id: resp ? Number(resp) : null, notes: notes.trim() || null,
      },
    }, {
      onSuccess: (d) => { toast.success(order ? 'Disassembly Order saved.' : `${d.number} created.`); onClose(); if (!order) navigate(`/disassembly/orders/${d.id}`) },
      onError: (e) => setErr(apiErrorMessage(e)),
    })
  }

  return (
    <Modal open={open} onClose={onClose} form title={order ? `Edit ${order.number}` : 'New Disassembly Order'}
      footer={<><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" disabled={save.isPending} onClick={submit}>{save.isPending && <Loader2 className="size-4 animate-spin" />} {order ? 'Save' : 'Create'}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <span className="text-xs text-muted-foreground">Product to take apart</span>
          {product ? (
            <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
              <div><div className="font-medium">{product.description}</div><div className="text-xs text-muted-foreground">{product.code} · Base UOM {product.unit}{bom.data ? ` · BoM ${bom.data.code} rev ${bom.data.revision}` : ''}</div></div>
              {!order && <Button variant="ghost" size="sm" aria-label="Change product" onClick={() => { setProduct(null); setSource('') }}><X className="size-4" /></Button>}
            </div>
          ) : <DsaItemPicker onPick={pick} />}
        </div>
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Quantity to take apart {product?.unit ? `(${product.unit})` : ''}</span>
          <Input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Source warehouse</span>
          <Select value={source} onChange={(e) => setSource(e.target.value)} disabled={!product}>
            <option value="">Select…</option>
            {(stock.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name} — free {w.stock_known ? fmtQty(w.free, 2) : '?'}</option>)}
          </Select>
          {free && n > 0 && n > free.free && <span className="text-xs text-red-700">Only {fmtQty(free.free, 2)} {product?.unit} free here; confirmation will be refused.</span>}
        </label>
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Responsible person</span>
          <Select value={resp} onChange={(e) => setResp(e.target.value)}><option value="">Me</option>{(users.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></label>
        <label className="space-y-1 sm:col-span-2"><span className="text-xs text-muted-foreground">Notes</span><Textarea rows={2} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} /></label>
      </div>

      {product && bom.data && (
        <div className="mt-4 overflow-hidden rounded-md border">
          <div className="border-b bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">Expected components {n > 0 ? `for ${fmtQty(n, 2)} ${product.unit}` : 'per 1 ' + (product.unit ?? '')}</div>
          <table className="w-full text-[13px]">
            <tbody>
              {bom.data.lines.map((l) => (
                <tr key={l.item_id} className="border-t first:border-t-0">
                  <td className="px-3 py-1.5"><div>{l.description}</div><div className="text-xs text-muted-foreground">{l.code}</div></td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtQty(l.qty * (n > 0 ? n : 1))} <span className="text-muted-foreground">{l.base_unit}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {product && bom.isSuccess && !bom.data && <p className="mt-3 text-sm text-destructive">This product has no active BoM.</p>}
      {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
    </Modal>
  )
}

export function DisassemblyListPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { hasPermission } = useAuth()
  const [scope, setScope] = useRemembered<Scope>('dsa-orders', 'scope', 'open')
  const [search, setSearch] = useRemembered('dsa-orders', 'search', '')
  const [status, setStatus] = useRemembered('dsa-orders', 'status', params.get('status') ?? '')
  const [from, setFrom] = useRemembered('dsa-orders', 'from', '')
  const [to, setTo] = useRemembered('dsa-orders', 'to', '')
  const [page, setPage] = useRemembered('dsa-orders', 'page', 1)
  const notInAccurate = params.get('not_in_accurate') === '1'
  const [creating, setCreating] = useState(false)
  const { data, isLoading } = useDsas({ search: search || undefined, status: status || SCOPE[scope], page, not_in_accurate: notInAccurate, from: from || undefined, to: to || undefined })
  const { rows, footer } = useInfiniteRows(data, page, setPage, 'dsa-orders')
  const filtered = !!(search || status || notInAccurate || from || to)

  return (
    <div className="space-y-4">
      <PageHeader title="Disassembly Orders" icon={<PackageOpen className="size-5" />}
        actions={hasPermission('disassembly.create') && <Button size="sm" onClick={() => setCreating(true)}><Plus className="size-4" /> New Disassembly</Button>} />
      <Tabs<Scope> value={scope} onChange={(v) => { setScope(v); setStatus(''); setPage(1) }} tabs={[{ key: 'open', label: 'Not yet' }, { key: 'done', label: 'Done' }, { key: 'all', label: 'All' }]} />
      <FilterBar>
        <Input className="w-full sm:max-w-xs" placeholder="Search document, product or BoM…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
        <div className="w-full sm:w-40"><Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>
          <option value="">All in this tab</option>
          {Object.entries(DSA_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select></div>
        <Input type="date" aria-label="From" className="w-full sm:w-40" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} />
        <Input type="date" aria-label="To" className="w-full sm:w-40" value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} />
        {notInAccurate && <Badge variant="warning">Done, not yet entered in Accurate</Badge>}
        {filtered && <Button variant="ghost" size="sm" className="h-10" onClick={() => { setSearch(''); setStatus(''); setFrom(''); setTo(''); setPage(1); if (notInAccurate) navigate('/disassembly/orders') }}><X className="size-4" /> Reset</Button>}
      </FilterBar>

      <div className="space-y-2 md:hidden">
        {!isLoading && rows.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No Disassembly Orders.</p>}
        {rows.map((o) => (
          <button key={o.id} type="button" onClick={() => navigate(`/disassembly/orders/${o.id}`)} className="block w-full rounded-lg border bg-card p-3 text-left active:bg-muted/50">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><div className="font-medium">{o.product_name}</div><div className="text-xs text-muted-foreground">{o.number} · {fmtQty(o.planned_qty, 2)} {o.base_unit} · {o.source_warehouse}</div></div>
              <DsaStatusBadge status={o.status} />
            </div>
          </button>
        ))}
        {footer}
      </div>
      <div className="hidden md:block">
        <DataTable columns={columns} rows={rows} footer={footer} rowKey={(o) => o.id} isLoading={isLoading} scrollMemoryKey="dsa-orders"
          onRowClick={(o) => navigate(`/disassembly/orders/${o.id}`)} emptyText={filtered ? 'No Disassembly Orders for this filter.' : 'No Disassembly Orders yet.'} />
      </div>
      {creating && <DsaFormModal open onClose={() => setCreating(false)} />}
    </div>
  )
}
