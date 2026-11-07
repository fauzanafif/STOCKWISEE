import { useSearchParams } from 'react-router-dom'
import { DateRangeFilter } from '@/components/DateRangeFilter'
import { useState } from 'react'
import { Pencil, Recycle, Trash2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import {
  useTrackingAction,
  useTrackingCreate,
  useTrackingDelete,
  useTrackingItem,
  useTrackingUpdate,
  type UsedReturnLineRow,
  type UsedReturnRow,
} from '@/features/tracking/api'
import { useAuth } from '@/auth/AuthContext'
import { apiErrorMessage } from '@/lib/api'
import { ItemPicker } from '@/components/ItemPicker'
import { DocNumberInput } from '@/components/tracking/AccurateInputs'
import { TrackingModule, DetailGrid } from '@/components/tracking/TrackingModule'
import { UsedReturnSheet } from '@/components/tracking/UsedReturnSheets'
import { cn } from '@/lib/utils'
import { DataTable, type Column } from '@/components/DataTable'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { RequestStatusBadge } from '@/components/ui/request-badge'
import { useWarehouses } from '@/features/inventory/api'
import type { ItemLookupResult } from '@/features/inventory/api'
import { DocLink } from '@/components/DocLink'
import { confirmDialog } from '@/components/ui/confirm'
import { DetailFallback } from '@/components/DetailFallback'

function fmtDate(v: string | null) {
  return v ? new Date(v).toLocaleDateString('en-GB') : '—'
}

// Column set/order mirrors RiListPage.tsx (features/ri/api.ts's Ri) as closely
// as the two domains allow, per explicit user instruction — RI has no
// condition/masuk-stok/status concept (it's a read-only mirror with no
// workflow) and UsedReturn has no vendor/harga/PO-link, so those swap in.
const columns: Column<UsedReturnLineRow>[] = [
  { key: 'number', header: 'No UR', cell: (r) => <span className="text-[13px]">{r.number}</span> },
  { key: 'tgl', header: 'Date', cell: (r) => fmtDate(r.return_date) },
  {
    key: 'sumber',
    header: 'Source',
    cell: (r) => (r.from_accurate ? <Badge variant="default">Accurate (RI/NV)</Badge> : <Badge variant="neutral">Manual</Badge>),
  },
  { key: 'kode', header: 'Item Code', cell: (r) => <span className="text-[13px]">{r.kode_barang ?? '—'}</span> },
  { key: 'barang', header: 'Item Description', cell: (r) => r.deskripsi_barang ?? '—' },
  { key: 'qty', header: 'Quantity', cell: (r) => (r.kuantitas != null ? `${r.kuantitas} ${r.satuan ?? ''}` : '—') },
  { key: 'cond', header: 'Condition', cell: (r) => <Badge variant="neutral">{r.condition}</Badge> },
  { key: 'stock', header: 'Into Stock', cell: (r) => (r.into_stock ? 'Ya' : 'No') },
  { key: 'status', header: 'Status', cell: (r) => <RequestStatusBadge status={r.status} /> },
]

interface Line {
  key: string
  item_id?: number
  code?: string
  description: string
  qty: number
  condition: string
  into_stock: boolean
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const create = useTrackingCreate<UsedReturnRow>('used-returns')
  const [npbgRef, setNpbgRef] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [err, setErr] = useState<string | null>(null)

  const add = (it: ItemLookupResult) =>
    setLines((ls) => [
      ...ls,
      { key: crypto.randomUUID(), item_id: it.id, code: it.code, description: it.description, qty: 1, condition: 'USED', into_stock: false },
    ])

  return (
    <div className="space-y-4">
      <DocNumberInput type="npbg" value={npbgRef} onChange={setNpbgRef} label="Source NPBG No." />
      <div>
        <Label>Used items</Label>
        <ItemPicker onPick={add} />
      </div>
      {lines.map((l) => (
        <div key={l.key} className="space-y-2 rounded-md border p-2 text-sm">
          <div className="flex items-center justify-between">
            <span>
              <span className="text-[13px] text-muted-foreground">{l.code}</span> {l.description}
            </span>
            <button className="text-xs text-destructive" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
              delete
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="number"
              step="any"
              className="h-8 w-24"
              value={l.qty}
              onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: Number(e.target.value) } : x)))}
            />
            <Select
              className="h-8 w-36"
              value={l.condition}
              onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, condition: e.target.value } : x)))}
            >
              <option value="REUSABLE">Reusable</option>
              <option value="USED">Used</option>
              <option value="DAMAGED">Damaged</option>
              <option value="SCRAP">Scrap</option>
            </Select>
            <label className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={l.into_stock}
                onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, into_stock: e.target.checked } : x)))}
              />
              into stock
            </label>
          </div>
        </div>
      ))}
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={create.isPending || lines.length === 0}
          onClick={() =>
            create.mutate(
              {
                npbg_ref_raw: npbgRef || undefined,
                items: lines.map((l) => ({
                  item_id: l.item_id,
                  qty: l.qty,
                  condition: l.condition,
                  into_stock: l.into_stock,
                })),
              },
              { onSuccess: onDone, onError: (e) => setErr(apiErrorMessage(e)) },
            )
          }
        >
          Save
        </Button>
      </div>
    </div>
  )
}

function EditForm({ ur, onDone }: { ur: UsedReturnRow; onDone: () => void }) {
  const update = useTrackingUpdate<UsedReturnRow>('used-returns', ur.id)
  const [npbgRef, setNpbgRef] = useState(ur.npbg_ref ?? '')
  const [note, setNote] = useState(ur.note ?? '')
  const [lines, setLines] = useState<Line[]>(
    (ur.items ?? []).map((l) => ({
      key: crypto.randomUUID(),
      item_id: undefined,
      code: l.item_code ?? undefined,
      description: l.description ?? l.component_type ?? '',
      qty: l.qty,
      condition: l.condition,
      into_stock: l.into_stock,
    })),
  )
  const [err, setErr] = useState<string | null>(null)

  return (
    <div className="space-y-4 rounded-lg border bg-muted/30 p-3">
      <DocNumberInput type="npbg" value={npbgRef} onChange={setNpbgRef} label="Source NPBG No." />
      <div>
        <Label>Notes</Label>
        <Input className="mt-1" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {lines.map((l) => (
        <div key={l.key} className="space-y-2 rounded-md border p-2 text-sm">
          <span>
            <span className="text-[13px] text-muted-foreground">{l.code}</span> {l.description}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="number"
              step="any"
              className="h-8 w-24"
              value={l.qty}
              onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: Number(e.target.value) } : x)))}
            />
            <Select
              className="h-8 w-36"
              value={l.condition}
              onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, condition: e.target.value } : x)))}
            >
              <option value="REUSABLE">Reusable</option>
              <option value="USED">Used</option>
              <option value="DAMAGED">Damaged</option>
              <option value="SCRAP">Scrap</option>
            </Select>
            <label className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={l.into_stock}
                onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, into_stock: e.target.checked } : x)))}
              />
              into stock
            </label>
          </div>
        </div>
      ))}
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={update.isPending}
          onClick={() =>
            update.mutate(
              {
                npbg_ref_raw: npbgRef || undefined,
                note: note || undefined,
                items: lines.map((l) => ({ qty: l.qty, condition: l.condition, into_stock: l.into_stock })),
              },
              { onSuccess: onDone, onError: (e) => setErr(apiErrorMessage(e)) },
            )
          }
        >
          Save
        </Button>
      </div>
    </div>
  )
}

function Detail({ id, onDone }: { id: number; onDone: () => void }) {
  const qc = useQueryClient()
  const { hasPermission } = useAuth()
  const { data: ur, isLoading, refetch } = useTrackingItem<UsedReturnRow>('used-returns', id)
  const { data: warehouses } = useWarehouses()
  const action = useTrackingAction<UsedReturnRow>('used-returns', id)
  const del = useTrackingDelete('used-returns')
  const [err, setErr] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [closing, setClosing] = useState(false)
  const [warehouseId, setWarehouseId] = useState<number | ''>('')

  if (isLoading || !ur) return <DetailFallback loading={isLoading} />

  if (editing)
    return (
      <EditForm
        ur={ur}
        onDone={() => {
          setEditing(false)
          refetch()
        }}
      />
    )

  async function remove() {
    if (!(await confirmDialog(`Delete return ${ur!.number}?`))) return
    del.mutate(id, { onSuccess: onDone, onError: (e) => setErr(apiErrorMessage(e)) })
  }

  return (
    <div className="space-y-4">
      <DetailGrid
        rows={[
          ['Number', <span className="text-[13px]">{ur.number}</span>],
          ['Status', <RequestStatusBadge status={ur.status} />],
          ['NPBG asal', ur.npbg_number ?? ur.npbg_ref],
          ['RI bekas (internal)', <DocLink no={ur.ri_number} />],
          ['Date', ur.return_date],
        ]}
      />
      <DataTable
        columns={[
          { key: 'code', header: 'Code', cell: (l) => <span className="text-[13px]">{l.item_code ?? l.component_type ?? '—'}</span> },
          { key: 'desc', header: 'Description', cell: (l) => l.description ?? l.component_type ?? '—' },
          { key: 'qty', header: 'Qty', cell: (l) => l.qty },
          { key: 'cond', header: 'Condition', cell: (l) => <Badge variant="neutral">{l.condition}</Badge> },
          { key: 'stock', header: 'Into Stock', cell: (l) => (l.into_stock ? 'Ya' : 'No') },
        ]}
        rows={ur.items ?? []}
        rowKey={(l) => l.id}
      />
      {ur.status === 'PENDING' && hasPermission('used_return.update') && (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="size-4" /> Edit
          </Button>
          <Button size="sm" variant="destructive" onClick={remove} disabled={del.isPending}>
            <Trash2 className="size-4" /> Delete
          </Button>
        </div>
      )}
      {ur.status === 'PENDING' && hasPermission('used_return.close') && !closing && (
        <Button size="sm" onClick={() => setClosing(true)}>
          Close &amp; Add to Stock
        </Button>
      )}
      {ur.status === 'PENDING' && hasPermission('used_return.close') && closing && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <p className="text-sm text-muted-foreground">
            Closing this return will create &amp; confirm an RI from the item rows above right away; items in Reusable/Used condition marked &ldquo;into stock&rdquo; add to the selected warehouse stock.
          </p>
          <div className="max-w-xs">
            <Label>Destination warehouse</Label>
            <select
              className="mt-1 h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">— select warehouse —</option>
              {warehouses?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setClosing(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={action.isPending || !warehouseId}
              onClick={() =>
                action.mutate(
                  { action: 'close', body: { warehouse_id: warehouseId } },
                  {
                    onSuccess: () => {
                      qc.invalidateQueries({ queryKey: ['used-returns'] })
                      onDone()
                    },
                    onError: (e) => setErr(apiErrorMessage(e)),
                  },
                )
              }
            >
              {action.isPending ? 'Processing…' : 'Confirm Close'}
            </Button>
          </div>
        </div>
      )}
      {err && <p className="text-sm text-destructive">{err}</p>}
    </div>
  )
}

type Sheet = 'matrix' | 'other' | 'ri'

export function UsedReturnPage() {
  const { hasPermission } = useAuth()
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  // the Excel "8. Tracking Pengembalian Bekas" sheets + the RI/NV documents from Accurate
  // ?sheet=other — opened from an NPBG line's "Kembali Bekas" link
  const [urlParams] = useSearchParams()
  const [sheet, setSheet] = useState<Sheet>(() => (['matrix', 'other', 'ri'] as const).find((k) => k === urlParams.get('sheet')) ?? 'matrix')
  const tabs = (
    <div className="flex gap-1 overflow-x-auto border-b" role="tablist">
      {([['matrix', 'Spare Part'], ['other', 'Other Spare Part'], ['ri', 'RI NV (Accurate)']] as const).map(([k, label]) => (
        <button key={k} type="button" role="tab" aria-selected={sheet === k} onClick={() => setSheet(k)}
          className={cn('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium',
            sheet === k ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
          {label}
        </button>
      ))}
    </div>
  )
  if (sheet !== 'ri') return <UsedReturnSheet sheet={sheet} headerExtra={tabs} />

  return (
    <TrackingModule<UsedReturnLineRow>
      key="ri"
      base="used-returns"
      exportDataset="used-returns"
      exportPermission="used_return.view"
      title="Used Item Returns"
      headerExtra={tabs}
 subtitle="RI/NV documents from Accurate; leftover / used / damaged items returned from use"
      icon={<Recycle className="size-5" />}
      columns={columns}
      statuses={['PENDING', 'CLEAR']}
      canCreate={hasPermission('used_return.create')}
      createLabel="Record Return"
      renderCreate={(close) => <CreateForm onDone={close} />}
      renderDetail={(row, close) => <Detail id={row.id} onDone={close} />}
      detailTitle={(row) => row.number}
      rowKey={(row) => row.line_id}
      searchPlaceholder="Search UR no., item code, description…"
      extraFilterParams={{ date_from: dateFrom || undefined, date_to: dateTo || undefined }}
      extraFilter={
        <>
          <DateRangeFilter className="lg:w-72" from={dateFrom} to={dateTo} onFrom={setDateFrom} onTo={setDateTo} />
        </>
      }
    />
  )
}
