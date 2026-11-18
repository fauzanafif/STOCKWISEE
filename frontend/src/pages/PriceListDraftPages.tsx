import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { BadgeCheck, Loader2, Plus, Search, Trash2, X } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { PageHeader } from '@/components/PageHeader'
import { BackLink } from '@/components/BackLink'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { confirmDialog } from '@/components/ui/confirm'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { Textarea } from '@/components/ui/textarea'
import { useAvailableItems, useDraft, useDraftActions, useDrafts, type DraftItem } from '@/features/priceList/drafts'
import { useVendors } from '@/features/purchasing/api'
import { apiErrorMessage } from '@/lib/api'
import { toast } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { VendorPicker } from '@/pages/PoFlowPages'

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-')
const fmtNum = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 2 })
const fail = (e: unknown) => toast.error(apiErrorMessage(e))

function StatusBadge({ status }: { status: 'DRAFT' | 'DONE' }) {
  return status === 'DONE' ? <Badge variant="success">Prices set</Badge> : <Badge variant="neutral">Draft</Badge>
}

/** Master Items no draft holds yet, to tick: an item in another draft is not offered. */
function ItemChooser({ picked, onChange }: { picked: DraftItem[]; onChange: (items: DraftItem[]) => void }) {
  const [q, setQ] = useState('')
  const { data, isFetching } = useAvailableItems(q)
  const on = new Set(picked.map((i) => i.id))
  const toggle = (i: DraftItem) => onChange(on.has(i.id) ? picked.filter((p) => p.id !== i.id) : [...picked, i])
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item code or name" aria-label="Search item" />
      </div>
      <div className="max-h-64 overflow-y-auto rounded-md border">
        {isFetching && !data && <p className="p-3 text-sm text-muted-foreground"><Loader2 className="inline size-4 animate-spin" /> Loading…</p>}
        {data?.length === 0 && <p className="p-3 text-sm text-muted-foreground">No item left without a draft{q ? ` for “${q}”` : ''}.</p>}
        <ul className="divide-y">
          {data?.map((i) => (
            <li key={i.id}>
              <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted/50">
                <input type="checkbox" className="size-4 accent-primary" checked={on.has(i.id)} onChange={() => toggle(i)} />
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{i.description}</span><span className="text-xs text-muted-foreground">{i.code} · {i.unit}</span></span>
              </label>
            </li>
          ))}
        </ul>
      </div>
      {picked.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {picked.map((i) => (
            <span key={i.id} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
              {i.code}<button type="button" aria-label={`Remove ${i.code}`} onClick={() => toggle(i)}><X className="size-3" /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** The active vendors, to tick. */
function VendorChooser({ picked, onChange }: { picked: number[]; onChange: (ids: number[]) => void }) {
  const [q, setQ] = useState('')
  const { data, isLoading } = useVendors({ limit: 2000, is_active: '1' })
  const needle = q.trim().toLowerCase()
  const list = (data ?? []).filter((v) => !needle || `${v.name} ${v.code ?? ''}`.toLowerCase().includes(needle))
  const on = new Set(picked)
  const toggle = (id: number) => onChange(on.has(id) ? picked.filter((p) => p !== id) : [...picked, id])
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vendor name or code" aria-label="Search vendor" />
      </div>
      <div className="max-h-64 overflow-y-auto rounded-md border">
        {isLoading && <p className="p-3 text-sm text-muted-foreground"><Loader2 className="inline size-4 animate-spin" /> Loading…</p>}
        {!isLoading && list.length === 0 && <p className="p-3 text-sm text-muted-foreground">No vendor{q ? ` for “${q}”` : ''}.</p>}
        <ul className="divide-y">
          {list.map((v) => (
            <li key={v.id}>
              <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted/50">
                <input type="checkbox" className="size-4 accent-primary" checked={on.has(v.id)} onChange={() => toggle(v.id)} />
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{v.name}</span>{v.code && <span className="text-xs text-muted-foreground">{v.code}</span>}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/** A new draft: two buttons on top, Items and Vendors, each a list to tick; then a note. */
function NewDraftModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const act = useDraftActions()
  const [items, setItems] = useState<DraftItem[]>([])
  const [vendors, setVendors] = useState<number[]>([])
  const [note, setNote] = useState('')
  const [tab, setTab] = useState<'items' | 'vendors'>('items')
  const create = () => act.create.mutate({ item_ids: items.map((i) => i.id), vendor_ids: vendors, note: note || null }, {
    onSuccess: (d) => { onClose(); navigate(`/price-list/drafts/${d.id}`) },
    onError: fail,
  })
  return (
    <Modal open={open} onClose={onClose} title="New Draft Price List" description="Pick the items and the vendors to price: they become one matrix." className="max-w-2xl"
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={!items.length || !vendors.length || act.create.isPending} onClick={create}>{act.create.isPending && <Loader2 className="size-4 animate-spin" />}Create draft</Button>
      </>}>
      <div className="space-y-4">
        <div role="tablist" aria-label="Pick" className="grid grid-cols-2 gap-2">
          {([['items', 'Items', items.length], ['vendors', 'Vendors', vendors.length]] as const).map(([k, label, n]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={cn('flex h-10 items-center justify-center gap-2 rounded-md border text-sm font-medium transition-colors',
                tab === k ? 'border-primary bg-primary/10 text-primary' : 'bg-card text-muted-foreground hover:bg-muted hover:text-foreground')}>
              {label}<span className={cn('rounded-full px-1.5 text-[11px] leading-[18px] tabular-nums', n ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>{n}</span>
            </button>
          ))}
        </div>
        {tab === 'items' ? <ItemChooser picked={items} onChange={setItems} /> : <VendorChooser picked={vendors} onChange={setVendors} />}
        <div className="space-y-1.5"><Label htmlFor="pl-note">Note</Label><Textarea id="pl-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Q4 2026 prices" /></div>
      </div>
    </Modal>
  )
}

/** The drafts: each one a matrix of items × vendors; "Prices set" once in the Master Price List. */
export function PriceListDraftListPage() {
  const { hasPermission } = useAuth()
  const canCreate = hasPermission('rfq.create')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const { data, isLoading, isError, error } = useDrafts({ status: status || undefined, page })
  const [creating, setCreating] = useState(false)
  const rows = data?.data ?? []

  return (
    <div className="space-y-4">
      <PageHeader title="Draft Price List" actions={canCreate && <Button size="sm" onClick={() => setCreating(true)}><Plus className="size-4" /> New Draft</Button>} />
      <div className="inline-flex rounded-md border bg-card p-0.5" role="tablist">
        {[['', 'All'], ['DRAFT', 'Draft'], ['DONE', 'Prices set']].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={status === k} onClick={() => { setStatus(k); setPage(1) }}
            className={cn('rounded px-3 py-1 text-sm', status === k ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:text-foreground')}>{label}</button>
        ))}
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <tr><th className="px-4 py-2.5 font-medium">Number</th><th className="px-3 py-2.5 font-medium">Note</th><th className="px-3 py-2.5 text-right font-medium">Items</th><th className="px-3 py-2.5 text-right font-medium">Vendors</th><th className="px-3 py-2.5 text-right font-medium">Prices</th><th className="px-3 py-2.5 font-medium">Status</th><th className="px-4 py-2.5 font-medium">Last update</th></tr>
          </thead>
          <tbody className="divide-y">
            {isLoading && <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground"><Loader2 className="inline size-4 animate-spin" /></td></tr>}
            {isError && <tr><td colSpan={7} className="px-4 py-8 text-center text-red-600">{apiErrorMessage(error)}</td></tr>}
            {!isLoading && !isError && rows.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">No draft yet.</td></tr>}
            {rows.map((d) => (
              <tr key={d.id} className="hover:bg-muted/40">
                <td className="px-4 py-2.5"><Link to={`/price-list/drafts/${d.id}`} className="font-medium text-primary hover:underline">{d.number}</Link></td>
                <td className="max-w-xs truncate px-3 py-2.5 text-muted-foreground">{d.note ?? '-'}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{d.items_count}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{d.vendors_count}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{d.cells_count}</td>
                <td className="px-3 py-2.5"><StatusBadge status={d.status} /></td>
                <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{fmtDate(d.updated_at)} · {d.done_by ?? d.created_by}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {(data?.meta?.last_page ?? 1) > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-muted-foreground">{page} / {data!.meta.last_page}</span>
          <Button size="sm" variant="outline" disabled={page >= data!.meta.last_page} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
      {creating && <NewDraftModal open onClose={() => setCreating(false)} />}
    </div>
  )
}

/** More items into the draft: the ones no draft holds yet. */
function AddItemsModal({ onClose, onAdd, pending }: { onClose: () => void; onAdd: (ids: number[]) => void; pending: boolean }) {
  const [items, setItems] = useState<DraftItem[]>([])
  return (
    <Modal open onClose={onClose} title="Add items" className="max-w-xl"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!items.length || pending} onClick={() => onAdd(items.map((i) => i.id))}>Add {items.length || ''}</Button></>}>
      <ItemChooser picked={items} onChange={setItems} />
    </Modal>
  )
}

/** One draft: the Item × Vendor matrix; a price per crossing (in the item's own unit), then "Set Harga". */
export function PriceListDraftPage() {
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const { hasPermission } = useAuth()
  const { data: d, isLoading, isError, error } = useDraft(id)
  const act = useDraftActions(id)
  const [typed, setTyped] = useState<Record<string, string>>({})
  const [adding, setAdding] = useState(false)

  if (isLoading) return <Loader2 className="mx-auto mt-10 size-6 animate-spin text-muted-foreground" />
  if (isError || !d) return <p className="mt-10 text-center text-sm text-red-600">{apiErrorMessage(error)}</p>

  const editable = d.status === 'DRAFT' && hasPermission('rfq.create')
  const filled = Object.keys(d.cells).length
  const save = (itemId: number, vendorId: number) => {
    const key = `${itemId}:${vendorId}`
    const raw = typed[key]
    if (raw === undefined) return
    const price = raw.trim() === '' ? null : Number(raw.replace(/\./g, '').replace(',', '.'))
    if (price !== null && (!Number.isFinite(price) || price <= 0)) { toast.error('Price must be above zero.'); return }
    if (price === (d.cells[key] ?? null)) { setTyped(({ [key]: _, ...t }) => t); return }
    act.setCell.mutate({ item_id: itemId, vendor_id: vendorId, price }, { onSuccess: () => setTyped(({ [key]: _, ...t }) => t), onError: fail })
  }
  const finish = async () => {
    if (await confirmDialog({ title: 'Set prices?', message: `${filled} prices of ${d.number} go to the Master Price List. The draft is then read only; change a price there afterwards.`, confirmLabel: 'Set Harga' }))
      act.finish.mutate(undefined, { onError: fail })
  }
  const remove = async () => {
    if (await confirmDialog({ title: 'Delete draft?', message: `${d.number} and its typed prices are deleted; its items can go into another draft.`, danger: true, confirmLabel: 'Delete' }))
      act.remove.mutate(undefined, { onSuccess: () => navigate('/price-list/drafts'), onError: fail })
  }
  const lowest = (itemId: number) => {
    const ps = d.vendors.map((v) => d.cells[`${itemId}:${v.id}`]).filter((p): p is number => p != null)
    return ps.length > 1 ? Math.min(...ps) : null
  }

  return (
    <div className="space-y-4">
      <BackLink to="/price-list/drafts" label="Draft Price List" />
      <PageHeader title={d.number} actions={editable && <>
        <Button size="sm" variant="outline" className="text-destructive" onClick={() => void remove()}><Trash2 className="size-4" /> Delete</Button>
        <Button size="sm" disabled={!filled || act.finish.isPending} onClick={() => void finish()}>{act.finish.isPending ? <Loader2 className="size-4 animate-spin" /> : <BadgeCheck className="size-4" />} Set Harga</Button>
      </>} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <StatusBadge status={d.status} />
        {d.note && <span>{d.note}</span>}
        <span>{d.items.length} items · {d.vendors.length} vendors · {filled} prices</span>
        <span>Last update {fmtDate(d.updated_at)}{d.done_at ? ` · set by ${d.done_by}` : ''}</span>
      </div>

      <Card className="overflow-hidden">
        {editable && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus className="size-4" /> Add items</Button>
            <VendorPicker picked={[]} exclude={d.vendors.map((v) => v.id)} onChange={(ids) => ids.length && act.addVendors.mutate(ids, { onError: fail })} />
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="sticky left-0 z-10 min-w-[16rem] bg-muted px-3 py-2.5 font-medium">Item</th>
                {d.vendors.map((v) => (
                  <th key={v.id} className="min-w-[10rem] border-l px-3 py-2.5 text-right font-medium text-foreground">
                    <span className="inline-flex items-center gap-1">{v.name}
                      {editable && <button type="button" aria-label={`Remove column ${v.name}`} className="text-muted-foreground hover:text-destructive" onClick={() => act.removeVendor.mutate(v.id, { onError: fail })}><X className="size-3" /></button>}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {d.items.map((i) => {
                const low = lowest(i.id)
                return (
                  <tr key={i.id}>
                    <td className="sticky left-0 z-10 bg-card px-3 py-2 align-top">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1"><div className="font-medium">{i.description}</div><div className="text-xs text-muted-foreground">{i.code} · per {i.unit}</div></div>
                        {editable && <button type="button" aria-label={`Remove ${i.code}`} className="mt-0.5 text-muted-foreground hover:text-destructive" onClick={() => act.removeItem.mutate(i.id, { onError: fail })}><Trash2 className="size-3.5" /></button>}
                      </div>
                    </td>
                    {d.vendors.map((v) => {
                      const key = `${i.id}:${v.id}`
                      const price = d.cells[key]
                      return (
                        <td key={v.id} className="border-l px-2 py-1.5 text-right align-top">
                          {editable
                            ? <Input className="ml-auto h-8 w-32 text-right tabular-nums" inputMode="decimal" placeholder="–" aria-label={`Price ${v.name} for ${i.description}`}
                              value={typed[key] ?? (price != null ? String(price) : '')} onChange={(e) => setTyped((t) => ({ ...t, [key]: e.target.value }))} onBlur={() => save(i.id, v.id)}
                              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                            : <span className="tabular-nums">{price != null ? `Rp ${fmtNum(price)}` : <span className="text-muted-foreground">–</span>}</span>}
                          {price != null && low === price && <div className="mt-0.5 text-[11px] text-emerald-700">Cheapest</div>}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
              {d.items.length === 0 && <tr><td colSpan={d.vendors.length + 1} className="px-4 py-10 text-center text-muted-foreground">No item in this draft.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
      {d.status === 'DONE' && <p className="text-sm text-muted-foreground">These prices are in the <Link to="/price-list" className="text-primary hover:underline">Master Price List</Link>: change them there, each change is kept in its history.</p>}
      {adding && <AddItemsModal pending={act.addItems.isPending} onClose={() => setAdding(false)} onAdd={(ids) => act.addItems.mutate(ids, { onSuccess: () => setAdding(false), onError: fail })} />}
    </div>
  )
}
