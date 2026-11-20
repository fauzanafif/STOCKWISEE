import { useEffect, useMemo, useState } from 'react'
import { useCreateItem, useItemOptions, useUpdateItem, useWarehouses, useWarehouseLocations } from '@/features/inventory/api'
import { useUomActions } from '@/features/uom/api'
import { apiErrorMessage } from '@/lib/api'
import { invalidTo } from '@/lib/notify'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import type { Item } from '@/types/inventory'

interface Props {
  open: boolean
  onClose: () => void
  item?: Item | null // null/undefined = mode tambah baru
  /** tambah baru: isi awal (mis. dari kata-kata peminta di Request Barang) */
  initial?: { description?: string; kind?: 'BARANG' | 'JASA' }
  /** tambah baru: barang yang baru dibuat (Request Barang langsung memilihnya) */
  onCreated?: (item: Item) => void
}

type CatField = 'induk' | 'anak_1' | 'anak_2' | 'anak_3'
const CAT_FIELDS: [CatField, string][] = [['induk', 'Main Category'], ['anak_1', 'Sub Category 1'], ['anak_2', 'Sub Category 2'], ['anak_3', 'Sub Category 3']]
const NO_CATS: Record<CatField, string> = { induk: '', anak_1: '', anak_2: '', anak_3: '' }

/**
 * Form tambah/ubah Master Barang — kolomnya mengikuti DATA.xlsx DATABASE UTAMA
 * (Kode Barang, Kategori Induk/Anak 1/2/3, Deskripsi, UOM, Perlu Blueprint?,
 * LETAK GUDANG, LETAK RAK, BLUEPRINT 3D VIEW, LEAD TIME).
 */
export function ItemFormModal({ open, onClose, item, initial, onCreated }: Props) {
  const isEdit = !!item
  const create = useCreateItem()
  const update = useUpdateItem(item?.id ?? 0)
  const { data: options } = useItemOptions()
  const { data: warehouses } = useWarehouses()

  const [code, setCode] = useState('')
  const [description, setDescription] = useState('')
  // Kategori Induk / Anak 1 / 2 / 3: each picked from its own fixed list
  const [cats, setCats] = useState<Record<CatField, string>>(NO_CATS)
  const [unitId, setUnitId] = useState<number | ''>('')
  const [needsBlueprint, setNeedsBlueprint] = useState(false)
  const [leadTime, setLeadTime] = useState<number | ''>('')
  const [warehouseId, setWarehouseId] = useState<number | ''>('')
  const [locationId, setLocationId] = useState<number | ''>('')
  const [blueprint3d, setBlueprint3d] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [kind, setKind] = useState<'BARANG' | 'JASA'>('BARANG')
  const [err, setErr] = useState<string | null>(null)
  // optional: one alternative unit with this item's own ratio (1 BOX = 12 PCS of this item)
  const [altUnitId, setAltUnitId] = useState<number | ''>('')
  const [altRatio, setAltRatio] = useState('')
  const uomAct = useUomActions()

  // the units its Main Category allows (Master UOM › Parent Category), in that order; none set: the fixed list
  const rule = cats.induk ? options?.uom_rules?.[cats.induk] : undefined
  const allowed = useMemo(() => {
    const all = options?.uom ?? []
    if (rule) return rule.unit_ids.map((id) => all.find((u) => u.id === id)).filter((u): u is NonNullable<typeof u> => !!u)
    const fixed = options?.uom_fixed
    return fixed ? all.filter((u) => fixed.includes(u.id)) : all
  }, [options, rule])
  const altChoices = allowed.filter((u) => u.id !== unitId && u.kind === 'PER_ITEM')
  const unitCode = (id: number | '') => options?.uom?.find((u) => u.id === id)?.code ?? item?.unit?.code ?? ''

  const { data: locations } = useWarehouseLocations(warehouseId || null)

  useEffect(() => {
    if (!open) return
    setCode(item?.code ?? '')
    setDescription(item?.description ?? initial?.description ?? '')
    const b = item?.category_breakdown
    setCats({ induk: b?.induk ?? '', anak_1: b?.anak_1 ?? '', anak_2: b?.anak_2 ?? '', anak_3: b?.anak_3 ?? '' })
    setUnitId(item?.unit?.id ?? '')
    setNeedsBlueprint(item?.needs_blueprint ?? false)
    setLeadTime(item?.lead_time_days ?? '')
    setWarehouseId(item?.default_warehouse?.id ?? '')
    setLocationId(item?.default_location?.id ?? '')
    setBlueprint3d(item?.blueprint_3d_ref ?? '')
    setIsActive(item?.is_active ?? true)
    setKind(item?.product_kind ?? initial?.kind ?? 'BARANG')
    setErr(null)
    setAltUnitId('')
    setAltRatio('')
  }, [open, item]) // eslint-disable-line react-hooks/exhaustive-deps

  // a new item starts with its category's default unit; a unit the new category does not allow is cleared
  function chooseCategory(field: CatField, value: string) {
    setCats((c) => ({ ...c, [field]: value }))
    if (field !== 'induk') return
    const next = value ? options?.uom_rules?.[value] : undefined
    if (!next) return
    if (!isEdit && (unitId === '' || !next.unit_ids.includes(unitId as number)) && next.default_unit_id) setUnitId(next.default_unit_id)
    else if (unitId !== '' && !next.unit_ids.includes(unitId as number) && unitId !== item?.unit?.id) setUnitId('')
  }

  const pending = create.isPending || update.isPending || uomAct.saveItemConversion.isPending

  function submit() {
    setErr(null)
    if (!code.trim() || !description.trim()) {
      invalidTo(setErr, 'Product Code and Description are required.')
      return
    }
    const ratio = Number(altRatio.trim().replace(',', '.'))
    if (altUnitId && !(ratio > 0)) {
      invalidTo(setErr, 'Fill in how many of the main unit one alternative unit holds.')
      return
    }
    // after the item is saved: its own ratio for the alternative unit (validated on the server)
    const withAlt = (saved: Item, done: () => void) => {
      if (!altUnitId) return done()
      uomAct.saveItemConversion.mutate({ itemId: saved.id, unit_id: altUnitId, ratio }, {
        onSuccess: done,
        onError: (e) => setErr(`Item saved, but the alternative unit was not: ${apiErrorMessage(e)}`),
      })
    }
    const payload = {
      code: code.trim(),
      description: description.trim(),
      accurate_category_induk: cats.induk || null,
      accurate_category_anak_1: cats.anak_1 || null,
      accurate_category_anak_2: cats.anak_2 || null,
      accurate_category_anak_3: cats.anak_3 || null,
      unit_id: unitId || null,
      needs_blueprint: needsBlueprint,
      lead_time_days: leadTime === '' ? null : Number(leadTime),
      default_warehouse_id: warehouseId || null,
      default_location_id: locationId || null,
      blueprint_3d_ref: blueprint3d.trim() || null,
      is_active: isActive,
      product_kind: kind,
    }
    const mutation = isEdit ? update.mutate(payload, { onSuccess: (saved) => withAlt(saved ?? item!, onClose), onError: (e) => setErr(apiErrorMessage(e)) })
      : create.mutate(payload, { onSuccess: (made) => withAlt(made, () => { onCreated?.(made); onClose() }), onError: (e) => setErr(apiErrorMessage(e)) })
    return mutation
  }

  return (
    <Modal page
      form
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit Product — ${item?.code}` : 'Add New Product'}
      description="Product Master: items (with stock) or services (no stock)."
      className="max-w-2xl"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={pending} onClick={submit}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>Product type</Label>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Product type">
            {([['BARANG', 'Item', 'Has stock in the warehouse'], ['JASA', 'Services', 'Service, no stock']] as const).map(([k, label, hint]) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
                className={kind === k ? 'rounded-lg border border-primary bg-primary/5 p-2.5 text-left ring-1 ring-primary' : 'rounded-lg border bg-card p-2.5 text-left hover:bg-muted/50'}>
                <div className="text-sm font-semibold">{label}</div>
                <div className="text-xs text-muted-foreground">{hint}</div>
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Product Code</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. PUI.0019" />
          </div>
          <div className="space-y-1.5">
            <Label>UOM</Label>
            <Select value={unitId} onChange={(e) => setUnitId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">— select —</option>
              {/* an Accurate item may have a UOM outside the list: it stays selectable for that item */}
              {item?.unit && !allowed.some((u) => u.id === item.unit!.id) && <option value={item.unit.id}>{item.unit.code} (current)</option>}
              {allowed.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code} — {u.name}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">{rule ? `Units of ${cats.induk}` : 'Standard list'} · set in Master UOM</p>
            {isEdit && item?.unit && unitId === item.unit.id && rule && !rule.unit_ids.includes(item.unit.id) && (
              <p className="text-xs text-amber-700">{item.unit.code} is not a unit of {cats.induk}; it stays, but a new unit must be one of the list.</p>
            )}
          </div>
        </div>

        {kind === 'BARANG' && unitId !== '' && altChoices.length > 0 && (
          <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3">
            <Label>Alternative unit <span className="font-normal text-muted-foreground">(optional, this item only)</span></Label>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>1</span>
              <Select aria-label="Alternative unit" className="h-9 w-32" value={altUnitId} onChange={(e) => setAltUnitId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">—</option>
                {altChoices.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
              </Select>
              <span>=</span>
              <Input aria-label="Alternative unit ratio" className="h-9 w-24 text-right tabular-nums" inputMode="decimal" disabled={!altUnitId} value={altRatio} onChange={(e) => setAltRatio(e.target.value)} placeholder="12" />
              <span>{unitCode(unitId)}</span>
            </div>
            <p className="text-xs text-muted-foreground">The size of a {altUnitId ? unitCode(altUnitId) : 'BOX / SET / ROL'} differs per item, so it is set here for this item. Fixed units (KG ↔ GR) need nothing.</p>
          </div>
        )}

        <div className="space-y-1.5">
          <Label>Product Description</Label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          {CAT_FIELDS.map(([field, label]) => {
            const choices = options?.[field] ?? []
            const current = cats[field]
            return (
              <div key={field} className="space-y-1.5">
                <Label>{label}</Label>
                <Select value={current} onChange={(e) => chooseCategory(field, e.target.value)}>
                  <option value="">— select —</option>
                  {current && !choices.includes(current) && <option value={current}>{current}</option>}
                  {choices.map((o) => <option key={o} value={o}>{o}</option>)}
                </Select>
              </div>
            )
          })}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>LETAK GUDANG</Label>
            <Select
              value={warehouseId}
              onChange={(e) => {
                setWarehouseId(e.target.value ? Number(e.target.value) : '')
                setLocationId('')
              }}
            >
              <option value="">— select —</option>
              {warehouses?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>LETAK RAK</Label>
            <Select value={locationId} onChange={(e) => setLocationId(e.target.value ? Number(e.target.value) : '')} disabled={!warehouseId}>
              <option value="">— select —</option>
              {locations?.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>LEAD TIME (days)</Label>
            <Input type="number" min={0} value={leadTime} onChange={(e) => setLeadTime(e.target.value ? Number(e.target.value) : '')} />
          </div>
          <div className="space-y-1.5">
            <Label>BLUEPRINT 3D VIEW</Label>
            <Input value={blueprint3d} onChange={(e) => setBlueprint3d(e.target.value)} placeholder="rack ref / code" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-5 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={needsBlueprint} onChange={(e) => setNeedsBlueprint(e.target.checked)} />
            Needs Blueprint?
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Active
          </label>
        </div>

        {err && <p className="text-sm text-destructive">{err}</p>}
      </div>
    </Modal>
  )
}
