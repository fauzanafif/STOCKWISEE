import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Factory, Loader2, Plus, X } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { apiErrorMessage } from '@/lib/api'
import { toast } from '@/lib/notify'
import { MO_STATUS, fmtDate, fmtQty, useMos, useMrpUsers, useSaveMo, type Mo, type MoDetail, type MrpItem } from '@/features/mrp/api'
import { MoStatusBadge, MrpItemPicker, Tabs } from '@/components/mrp/MrpParts'
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

const columns: Column<Mo>[] = [
  {
    key: 'product', header: 'Finished product',
    cell: (m) => <div className="leading-tight"><div className="font-medium">{m.product_name}</div><div className="text-xs text-muted-foreground">{m.product_code} · {m.bom_code} rev {m.bom_revision}</div></div>,
  },
  { key: 'number', header: 'MO', cell: (m) => <div className="flex items-center gap-1.5 whitespace-nowrap text-[13px]">{m.number}{m.priority === 'URGENT' && <Badge variant="danger">Urgent</Badge>}</div> },
  { key: 'qty', header: 'Planned / Output', className: 'text-right', cell: (m) => <span className="whitespace-nowrap tabular-nums">{fmtQty(m.planned_qty, 2)} / <b>{fmtQty(m.output_qty, 2)}</b> <span className="text-muted-foreground">{m.base_unit}</span></span> },
  { key: 'resp', header: 'Responsible', cell: (m) => <span className="text-muted-foreground">{m.responsible_name ?? '-'}</span> },
  { key: 'date', header: 'Planned', cell: (m) => <span className="whitespace-nowrap text-muted-foreground">{fmtDate(m.planned_start)} – {fmtDate(m.planned_finish)}</span> },
  {
    key: 'status', header: 'Status',
    cell: (m) => <div className="flex flex-wrap gap-1"><MoStatusBadge status={m.status} />{m.status === 'DONE' && m.posts_stock && !m.accurate_recorded && <Badge variant="warning">Not in Accurate</Badge>}{m.reversed && <Badge variant="neutral">Reversed</Badge>}</div>,
  },
]

/** New Manufacturing Order: a product with an active BoM and how many to make (in its Base UOM). */
export function MoFormModal({ open, onClose, mo }: { open: boolean; onClose: () => void; mo?: MoDetail }) {
  const navigate = useNavigate()
  const save = useSaveMo()
  const users = useMrpUsers(open)
  const [product, setProduct] = useState<{ id: number; code: string | null; description: string | null; unit: string | null } | null>(
    mo ? { id: mo.item_id, code: mo.product_code, description: mo.product_name, unit: mo.base_unit } : null)
  const [qty, setQty] = useState(mo ? String(mo.planned_qty) : '')
  const [start, setStart] = useState(mo?.planned_start ?? '')
  const [finish, setFinish] = useState(mo?.planned_finish ?? '')
  const [resp, setResp] = useState(mo?.responsible_id ? String(mo.responsible_id) : '')
  const [priority, setPriority] = useState<'NORMAL' | 'URGENT'>(mo?.priority ?? 'NORMAL')
  const [notes, setNotes] = useState(mo?.notes ?? '')
  const [err, setErr] = useState<string | null>(null)

  const submit = () => {
    setErr(null)
    if (!product) return setErr('Select the finished product.')
    if (!(Number(qty.replace(',', '.')) > 0)) return setErr('Planned quantity must be more than 0.')
    save.mutate({
      id: mo?.id,
      data: {
        ...(mo ? {} : { item_id: product.id }),
        planned_qty: qty.replace(',', '.').trim(), planned_start: start || null, planned_finish: finish || null,
        responsible_id: resp ? Number(resp) : null, priority, notes: notes.trim() || null,
      },
    }, {
      onSuccess: (d) => { toast.success(mo ? 'Manufacturing Order saved.' : `${d.number} created.`); onClose(); if (!mo) navigate(`/mrp/orders/${d.id}`) },
      onError: (e) => setErr(apiErrorMessage(e)),
    })
  }

  return (
    <Modal open={open} onClose={onClose} form title={mo ? `Edit ${mo.number}` : 'New Manufacturing Order'}
      footer={<><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" disabled={save.isPending} onClick={submit}>{save.isPending && <Loader2 className="size-4 animate-spin" />} {mo ? 'Save' : 'Create'}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <span className="text-xs text-muted-foreground">Finished product</span>
          {product ? (
            <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
              <div><div className="font-medium">{product.description}</div><div className="text-xs text-muted-foreground">{product.code} · {product.unit}</div></div>
              {!mo && <Button variant="ghost" size="sm" onClick={() => setProduct(null)}><X className="size-4" /></Button>}
            </div>
          ) : <MrpItemPicker onlyWithBom placeholder="Search a product with an active BoM…" onPick={(it: MrpItem) => setProduct({ id: it.id, code: it.code, description: it.description, unit: it.unit })} />}
        </div>
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Planned quantity {product?.unit ? `(${product.unit})` : ''}</span>
          <Input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Priority</span>
          <Select value={priority} onChange={(e) => setPriority(e.target.value as 'NORMAL' | 'URGENT')}><option value="NORMAL">Normal</option><option value="URGENT">Urgent</option></Select></label>
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Planned start</span><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Planned finish</span><Input type="date" value={finish} onChange={(e) => setFinish(e.target.value)} /></label>
        <label className="space-y-1 sm:col-span-2"><span className="text-xs text-muted-foreground">Responsible person</span>
          <Select value={resp} onChange={(e) => setResp(e.target.value)}><option value="">Me</option>{(users.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></label>
        <label className="space-y-1 sm:col-span-2"><span className="text-xs text-muted-foreground">Notes</span><Textarea rows={2} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} /></label>
      </div>
      {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
    </Modal>
  )
}

export function MoListPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { hasPermission } = useAuth()
  const [scope, setScope] = useRemembered<Scope>('mrp-mos', 'scope', 'open')
  const [search, setSearch] = useRemembered('mrp-mos', 'search', '')
  const [status, setStatus] = useRemembered('mrp-mos', 'status', params.get('status') ?? '')
  const [page, setPage] = useRemembered('mrp-mos', 'page', 1)
  const notInAccurate = params.get('not_in_accurate') === '1'
  const [creating, setCreating] = useState(false)
  const { data, isLoading } = useMos({ search: search || undefined, status: status || SCOPE[scope], page, not_in_accurate: notInAccurate })
  const { rows, footer } = useInfiniteRows(data, page, setPage, 'mrp-mos')
  const filtered = !!(search || status || notInAccurate)

  return (
    <div className="space-y-4">
      <PageHeader title="Manufacturing Orders" icon={<Factory className="size-5" />}
        actions={hasPermission('mrp.create') && <Button size="sm" onClick={() => setCreating(true)}><Plus className="size-4" /> New MO</Button>} />
      <Tabs<Scope> value={scope} onChange={(v) => { setScope(v); setStatus(''); setPage(1) }} tabs={[{ key: 'open', label: 'Not yet' }, { key: 'done', label: 'Done' }, { key: 'all', label: 'All' }]} />
      <FilterBar>
        <Input className="w-full sm:max-w-sm" placeholder="Search MO number, product or BoM…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
        <div className="w-full sm:w-44"><Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>
          <option value="">All in this tab</option>
          {Object.entries(MO_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select></div>
        {notInAccurate && <Badge variant="warning">Done, not yet entered in Accurate</Badge>}
        {filtered && <Button variant="ghost" size="sm" className="h-10" onClick={() => { setSearch(''); setStatus(''); setPage(1); if (notInAccurate) navigate('/mrp/orders') }}><X className="size-4" /> Reset</Button>}
      </FilterBar>

      <div className="space-y-2 md:hidden">
        {!isLoading && rows.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No Manufacturing Orders.</p>}
        {rows.map((m) => (
          <button key={m.id} type="button" onClick={() => navigate(`/mrp/orders/${m.id}`)} className="block w-full rounded-lg border bg-card p-3 text-left active:bg-muted/50">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><div className="font-medium">{m.product_name}</div><div className="text-xs text-muted-foreground">{m.number} · {fmtQty(m.planned_qty, 2)} {m.base_unit} · output {fmtQty(m.output_qty, 2)}</div></div>
              <MoStatusBadge status={m.status} />
            </div>
          </button>
        ))}
        {footer}
      </div>
      <div className="hidden md:block">
        <DataTable columns={columns} rows={rows} footer={footer} rowKey={(m) => m.id} isLoading={isLoading} scrollMemoryKey="mrp-mos"
          onRowClick={(m) => navigate(`/mrp/orders/${m.id}`)} emptyText={filtered ? 'No Manufacturing Orders for this filter.' : 'No Manufacturing Orders yet.'} />
      </div>
      {creating && <MoFormModal open onClose={() => setCreating(false)} />}
    </div>
  )
}
