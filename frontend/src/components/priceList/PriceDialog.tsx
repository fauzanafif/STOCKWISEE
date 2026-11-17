import { useEffect, useMemo, useState } from 'react'
import { History, Layers, Loader2, Power } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ItemPicker } from '@/components/ItemPicker'
import { Button } from '@/components/ui/button'
import { confirmDialog } from '@/components/ui/confirm'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useVendors } from '@/features/purchasing/api'
import {
  rupiah, STATUS_LABEL, STATUS_TONE, usePrice, usePriceActions, usePriceHistory, usePurchaseUnits, type PriceHistory, type PriceStatus,
} from '@/features/priceList/api'
import { apiErrorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'

export type PriceTarget =
  | { id: number }
  | { item?: { id: number; code: string; description: string }; vendorId?: number }

export function StatusBadge({ status }: { status: PriceStatus }) {
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset', STATUS_TONE[status])}>{STATUS_LABEL[status]}</span>
}

const FIELD_LABEL: Record<string, string> = {
  unit_id: 'Unit', unit_ratio: 'Unit size', min_qty: 'Min. qty', lead_time_days: 'Lead time', valid_from: 'Valid from', valid_until: 'Valid until', notes: 'Notes', vendor_id: 'Vendor',
}
const ACTION_LABEL: Record<PriceHistory['action'], string> = { CREATE: 'Added', UPDATE: 'Changed', ARCHIVE: 'Deactivated', RESTORE: 'Restored' }

function HistoryList({ id }: { id: number }) {
  const { data, isLoading } = usePriceHistory(id)
  if (isLoading) return <div className="flex h-24 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
  if (!data?.length) return <p className="py-8 text-center text-sm text-muted-foreground">No history yet.</p>
  return (
    <ol className="space-y-3">
      {data.map((h) => {
        const moved = h.old_price != null && h.new_price != null && h.old_price !== h.new_price
        return (
          <li key={h.id} className="rounded-lg border bg-card p-3 text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{ACTION_LABEL[h.action]}</span>
              {h.new_status && h.old_status !== h.new_status && <span className="text-muted-foreground">{h.old_status ? `${h.old_status} → ` : ''}{h.new_status}</span>}
              <span className="ml-auto text-xs text-muted-foreground">{h.user ?? '—'} · {h.at ? new Date(h.at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : ''}</span>
            </div>
            {(h.action === 'CREATE' || moved) && (
              <div className="mt-1 tabular-nums">
                {moved ? <><span className="text-muted-foreground line-through">{rupiah(h.old_price)}</span> → <span className="font-semibold">{rupiah(h.new_price)}</span></> : <span className="font-semibold">{rupiah(h.new_price)}</span>}
              </div>
            )}
            {h.changes && (
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {Object.entries(h.changes).map(([k, [a, b]]) => <li key={k}>{FIELD_LABEL[k] ?? k}: {String(a ?? '—')} → {String(b ?? '—')}</li>)}
              </ul>
            )}
            {h.note && <p className="mt-1 text-xs italic text-muted-foreground">“{h.note}”</p>}
          </li>
        )
      })}
    </ol>
  )
}

/**
 * Add Price / Edit Price / View Price History / Deactivate Price, in one popup: opened from a matrix
 * cell (item and vendor already chosen), a list row, or the Add Price button.
 */
export function PriceDialog({ target, onClose, onAddTier }: { target: PriceTarget; onClose: () => void; onAddTier?: (t: PriceTarget) => void }) {
  const { hasPermission } = useAuth()
  const id = 'id' in target ? target.id : null
  const existing = usePrice(id)
  const p = existing.data
  const canWrite = id ? hasPermission('rfq.update') : hasPermission('rfq.create')
  const [tab, setTab] = useState<'detail' | 'history'>('detail')
  const act = usePriceActions()
  const vendors = useVendors({ is_active: 'true', limit: 2000 })

  const [item, setItem] = useState<{ id: number; code: string; description: string } | null>('item' in target ? target.item ?? null : null)
  const [form, setForm] = useState({
    vendor_id: 'vendorId' in target && target.vendorId ? String(target.vendorId) : '', unit_id: '', price: '', min_qty: '1', lead_time_days: '',
    valid_from: '', valid_until: '', status: 'ACTIVE' as 'DRAFT' | 'ACTIVE', notes: '', change_note: '',
  })
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const [err, setErr] = useState<string | null>(null)

  // an existing price fills the form once it arrives
  useEffect(() => {
    if (!p) return
    setItem({ id: p.item_id, code: p.item_code ?? '', description: p.item_name ?? '' })
    setForm({
      vendor_id: String(p.vendor_id), unit_id: String(p.unit_id), price: String(p.price), min_qty: String(p.min_qty), lead_time_days: p.lead_time_days != null ? String(p.lead_time_days) : '',
      valid_from: p.valid_from ?? '', valid_until: p.valid_until ?? '', status: p.stored_status === 'DRAFT' ? 'DRAFT' : 'ACTIVE', notes: p.notes ?? '', change_note: '',
    })
  }, [p])

  const units = usePurchaseUnits(item?.id ?? null)
  // a new price starts in the item's own unit
  useEffect(() => {
    if (form.unit_id || !units.data?.units.length) return
    const own = units.data.units.find((u) => u.code === units.data?.base) ?? units.data.units[0]
    setForm((f) => ({ ...f, unit_id: String(own.unit_id) }))
  }, [units.data, form.unit_id])
  const unit = units.data?.units.find((u) => String(u.unit_id) === form.unit_id)
  const perBase = useMemo(() => (unit && unit.ratio !== 1 && Number(form.price) > 0 ? Number(form.price) / unit.ratio : null), [unit, form.price])

  const save = () => {
    setErr(null)
    if (!item) return setErr('Choose an item from the Master Item.')
    if (!form.vendor_id) return setErr('Choose a vendor.')
    if (!form.unit_id) return setErr('Choose the purchase unit.')
    if (!(Number(form.price) > 0)) return setErr('The price must be more than zero.')
    act.save.mutate({
      id: id ?? undefined, item_id: id ? undefined : item.id, vendor_id: Number(form.vendor_id), unit_id: Number(form.unit_id), price: Number(form.price),
      min_qty: form.min_qty ? Number(form.min_qty) : 1, lead_time_days: form.lead_time_days === '' ? null : Number(form.lead_time_days),
      valid_from: form.valid_from || null, valid_until: form.valid_until || null, status: form.status, notes: form.notes || null, change_note: form.change_note || null,
    }, { onSuccess: onClose, onError: (e) => setErr(apiErrorMessage(e)) })
  }
  const archive = async () => {
    if (!id) return
    if (!(await confirmDialog({ title: 'Deactivate price?', message: 'The price is archived: it no longer shows in the matrix or as a reference for Purchase Requests. Its history is kept.', confirmLabel: 'Deactivate', danger: true }))) return
    act.archive.mutate({ id, note: form.change_note || undefined }, { onSuccess: onClose, onError: (e) => setErr(apiErrorMessage(e)) })
  }

  const busy = act.save.isPending || act.archive.isPending
  const readOnly = !canWrite
  const field = 'space-y-1.5'
  const vendorName = vendors.data?.find((v) => String(v.id) === form.vendor_id)?.name ?? p?.vendor

  return (
    <Modal open onClose={onClose} className="max-w-2xl"
      title={id ? (p ? `${p.item_code} · ${p.vendor}` : 'Price') : 'Add Price'}
      footer={tab === 'detail' && (
        <div className="flex w-full flex-wrap items-center gap-2">
          {id && canWrite && p && p.status !== 'ARCHIVED' && (
            <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10" disabled={busy} onClick={archive}><Power className="size-4" /> Deactivate</Button>
          )}
          {id && p && onAddTier && hasPermission('rfq.create') && (
            <Button variant="ghost" size="sm" disabled={busy} title="Another price of this vendor for a bigger quantity"
              onClick={() => onAddTier({ item: { id: p.item_id, code: p.item_code ?? '', description: p.item_name ?? '' }, vendorId: p.vendor_id })}>
              <Layers className="size-4" /> Add tier
            </Button>
          )}
          <span className="flex-1" />
          <Button variant="outline" size="sm" onClick={onClose}>{readOnly ? 'Close' : 'Cancel'}</Button>
          {!readOnly && <Button size="sm" disabled={busy || (!!id && !p)} onClick={save}>{act.save.isPending && <Loader2 className="size-4 animate-spin" />} {id ? (p?.status === 'ARCHIVED' ? 'Restore' : 'Save') : 'Add Price'}</Button>}
        </div>
      )}>
      {id && (
        <div className="mb-3 flex items-center gap-1 border-b">
          {(['detail', 'history'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={cn('-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium', tab === t ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
              {t === 'history' && <History className="size-3.5" />}{t === 'detail' ? 'Detail' : 'Price History'}
            </button>
          ))}
          {p && <span className="ml-auto"><StatusBadge status={p.status} /></span>}
        </div>
      )}

      {id && tab === 'history' ? <HistoryList id={id} /> : id && !p ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <fieldset disabled={readOnly || busy} className="space-y-4">
          {p?.needs_review && (
            <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              The base unit of this item changed after this price was kept (now {p.base_unit}). Check the purchase unit and the price, then save.
            </p>
          )}
          <div className={field}>
            <Label>Item</Label>
            {item ? (
              <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <span className="font-medium tabular-nums">{item.code}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{item.description}</span>
                {!id && !('item' in target && target.item) && <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => { setItem(null); setForm((f) => ({ ...f, unit_id: '' })) }}>Change</button>}
              </div>
            ) : <ItemPicker onPick={(it) => { setItem({ id: it.id, code: it.code, description: it.description }); setForm((f) => ({ ...f, unit_id: '' })) }} />}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className={field}>
              <Label htmlFor="pl-vendor">Vendor</Label>
              <Select id="pl-vendor" value={form.vendor_id} onChange={set('vendor_id')}>
                <option value="">Choose vendor…</option>
                {vendors.data?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                {form.vendor_id && !vendors.data?.some((v) => String(v.id) === form.vendor_id) && <option value={form.vendor_id}>{vendorName ?? 'Vendor'}</option>}
              </Select>
            </div>
            <div className={field}>
              <Label htmlFor="pl-price">Vendor price</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">Rp</span>
                <Input id="pl-price" type="number" min="0" step="any" inputMode="decimal" className="pl-9 tabular-nums" value={form.price} onChange={set('price')} placeholder="0" />
              </div>
              {perBase != null && <p className="text-xs text-muted-foreground">= {rupiah(perBase)} per {units.data?.base}</p>}
            </div>
            <div className={field}>
              <Label htmlFor="pl-unit">Purchase UOM</Label>
              <Select id="pl-unit" value={form.unit_id} onChange={set('unit_id')} disabled={!item || units.isLoading}>
                {!form.unit_id && <option value="">{item ? (units.isLoading ? 'Loading…' : 'No unit for this item') : 'Choose an item first'}</option>}
                {units.data?.units.map((u) => <option key={u.unit_id} value={u.unit_id}>{u.code}{u.ratio !== 1 ? ` (= ${u.ratio} ${units.data?.base})` : ''}</option>)}
              </Select>
              {item && units.data && units.data.units.length === 0 && <p className="text-xs text-destructive">This item has no base unit yet. Set it in the UOM menu.</p>}
            </div>
            <div className={field}>
              <Label htmlFor="pl-min">Minimum quantity</Label>
              <Input id="pl-min" type="number" min="0" step="any" className="tabular-nums" value={form.min_qty} onChange={set('min_qty')} />
            </div>
            <div className={field}>
              <Label htmlFor="pl-lead">Lead time (days)</Label>
              <Input id="pl-lead" type="number" min="0" step="1" className="tabular-nums" value={form.lead_time_days} onChange={set('lead_time_days')} placeholder="—" />
            </div>
            <div className={field}>
              <Label htmlFor="pl-status">Status</Label>
              <Select id="pl-status" value={form.status} onChange={set('status')}>
                <option value="ACTIVE">Active: ready as a reference</option>
                <option value="DRAFT">Draft: still being filled in</option>
              </Select>
            </div>
            <div className={field}>
              <Label htmlFor="pl-from">Valid from</Label>
              <Input id="pl-from" type="date" value={form.valid_from} onChange={set('valid_from')} />
            </div>
            <div className={field}>
              <Label htmlFor="pl-until">Valid until</Label>
              <Input id="pl-until" type="date" value={form.valid_until} onChange={set('valid_until')} />
            </div>
          </div>

          <div className={field}>
            <Label htmlFor="pl-notes">Notes</Label>
            <Textarea id="pl-notes" rows={2} maxLength={500} value={form.notes} onChange={set('notes')} placeholder="e.g. price incl. delivery, payment terms" />
          </div>
          {id && !readOnly && (
            <div className={field}>
              <Label htmlFor="pl-change">Reason for change <span className="font-normal text-muted-foreground">(optional, kept in the history)</span></Label>
              <Input id="pl-change" maxLength={500} value={form.change_note} onChange={set('change_note')} placeholder="e.g. new quotation from the vendor" />
            </div>
          )}
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            A price in the Price List is a reference. When a Purchase Request comes, Purchasing still confirms it with the vendor.
          </p>
          {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        </fieldset>
      )}
    </Modal>
  )
}
