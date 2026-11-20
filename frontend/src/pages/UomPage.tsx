import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowRight, Loader2, Pencil, Plus, Ruler, Trash2 } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { confirmDialog } from '@/components/ui/confirm'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { useItemLookup, type ItemLookupResult } from '@/features/inventory/api'
import { convertUom, useItemConversions, useUom, useUomActions, useUomUnmapped, type UomCategory, type UomKind, type UomUnit } from '@/features/uom/api'
import { apiErrorMessage } from '@/lib/api'
import { invalidTo, toast } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { ParentCategoryTab } from '@/pages/uom/ParentCategoryTab'

const fmt = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 6 })
/** "1,5" / "1.5" → a number */
const num = (v: string) => Number(v.trim().replace(',', '.'))

export function kindOf(u: Pick<UomUnit, 'is_reference' | 'ratio'>): UomKind {
  if (u.is_reference) return 'REFERENCE'
  if (u.ratio === null) return 'VARIES'
  return u.ratio >= 1 ? 'BIGGER' : 'SMALLER'
}

/** The size in words: bigger units against the reference, smaller ones the other way round ("1 MTR = 100 CMS"). */
export function sizeText(u: Pick<UomUnit, 'code' | 'is_reference' | 'ratio' | 'factor'>, reference: string | undefined): string {
  if (u.is_reference) return '1'
  if (u.ratio === null) return 'Differs per item'
  if (!reference) return '—'
  // the typed factor is exact (60 MIN in one HOUR); 1/ratio is not (0.016667 → 59.9988)
  return u.ratio >= 1 ? `1 ${u.code} = ${fmt(u.factor ?? u.ratio)} ${reference}` : `1 ${reference} = ${fmt(u.factor ?? Math.round((1 / u.ratio) * 1e6) / 1e6)} ${u.code}`
}

const KIND_LABEL: Record<UomKind, string> = { REFERENCE: 'Reference', BIGGER: 'Bigger', SMALLER: 'Smaller', VARIES: 'Per item' }
const KIND_BADGE: Record<UomKind, 'success' | 'default' | 'neutral' | 'warning'> = { REFERENCE: 'success', BIGGER: 'default', SMALLER: 'default', VARIES: 'warning' }

function CategoryModal({ category, onClose }: { category: UomCategory | 'new'; onClose: () => void }) {
  const act = useUomActions()
  const [name, setName] = useState(category === 'new' ? '' : category.name)
  const [err, setErr] = useState<string | null>(null)
  const save = () => {
    if (!name.trim()) return invalidTo(setErr, 'Fill in the category name.')
    act.saveCategory.mutate({ id: category === 'new' ? undefined : category.id, name: name.trim() }, { onSuccess: onClose, onError: (e) => setErr(apiErrorMessage(e)) })
  }
  return (
    <Modal open onClose={onClose} title={category === 'new' ? 'Add category' : `Edit ${category.name}`} className="max-w-sm"
      footer={<><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" disabled={act.saveCategory.isPending} onClick={save}>Save</Button></>}>
      <div className="space-y-1.5">
        <Label htmlFor="uom-cat">Name *</Label>
        <Input id="uom-cat" value={name} maxLength={60} autoFocus onChange={(e) => setName(e.target.value)} />
        {err && <p className="text-sm text-destructive">{err}</p>}
      </div>
    </Modal>
  )
}

function UnitModal({ unit, categoryId, categories, onClose }: { unit: UomUnit | null; categoryId: number | null; categories: UomCategory[]; onClose: () => void }) {
  const act = useUomActions()
  const [code, setCode] = useState(unit?.code ?? '')
  const [name, setName] = useState(unit?.name ?? '')
  const [category, setCategory] = useState<number | ''>(unit?.uom_category_id ?? categoryId ?? '')
  const [kind, setKind] = useState<UomKind>(unit ? kindOf(unit) : 'VARIES')
  const [factor, setFactor] = useState(unit?.ratio ? String(unit.factor ?? (unit.ratio >= 1 ? unit.ratio : Math.round((1 / unit.ratio) * 1e6) / 1e6)) : '')
  const [rounding, setRounding] = useState(String(unit?.rounding ?? 0.01))
  const [active, setActive] = useState(unit?.is_active ?? true)
  const [err, setErr] = useState<string | null>(null)
  const inCategory = categories.find((c) => c.id === category)
  const reference = inCategory?.units.find((u) => u.is_reference && u.id !== unit?.id)
  const shown = code.trim().toUpperCase() || 'this unit'
  const save = () => {
    setErr(null)
    if (!code.trim() || !name.trim()) return invalidTo(setErr, 'Fill in the code and name.')
    const needsFactor = category !== '' && (kind === 'BIGGER' || kind === 'SMALLER')
    if (needsFactor && !(num(factor) > 0)) return invalidTo(setErr, 'The ratio must be more than 0.')
    if (!(num(rounding) > 0)) return invalidTo(setErr, 'The rounding must be more than 0.')
    act.saveUnit.mutate({
      id: unit?.id, code: code.trim(), name: name.trim(), is_active: active, uom_category_id: category === '' ? null : category,
      kind: category === '' ? null : kind, factor: needsFactor ? num(factor) : null, rounding: num(rounding),
    }, { onSuccess: onClose, onError: (e) => setErr(apiErrorMessage(e)) })
  }
  return (
    <Modal open onClose={onClose} title={unit ? `Edit ${unit.code}` : 'Add unit'} className="max-w-md"
      footer={<><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" disabled={act.saveUnit.isPending} onClick={save}>{act.saveUnit.isPending && <Loader2 className="size-4 animate-spin" />} Save</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
          <div className="space-y-1.5"><Label htmlFor="u-code">Code *</Label><Input id="u-code" value={code} maxLength={20} onChange={(e) => setCode(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="u-name">Name *</Label><Input id="u-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} /></div>
        </div>
        <div className="space-y-1.5"><Label htmlFor="u-cat">Category</Label>
          <Select id="u-cat" value={category} onChange={(e) => setCategory(e.target.value ? Number(e.target.value) : '')}>
            <option value="">No category</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>
        {category !== '' && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="u-kind">Type</Label>
              <Select id="u-kind" value={kind} onChange={(e) => setKind(e.target.value as UomKind)}>
                {(['REFERENCE', 'BIGGER', 'SMALLER', 'VARIES'] as UomKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </Select>
            </div>
            {(kind === 'BIGGER' || kind === 'SMALLER') && (
              <div className="space-y-1.5"><Label htmlFor="u-factor">Ratio *</Label><Input id="u-factor" className="text-right tabular-nums" inputMode="decimal" value={factor} onChange={(e) => setFactor(e.target.value)} /></div>
            )}
          </div>
        )}
        {category !== '' && (kind === 'BIGGER' || kind === 'SMALLER') && (
          <p className="rounded-md bg-muted/50 px-3 py-2 text-sm tabular-nums">
            {kind === 'BIGGER' ? `1 ${shown} = ${factor || '?'} ${reference?.code ?? 'reference'}` : `1 ${reference?.code ?? 'reference'} = ${factor || '?'} ${shown}`}
          </p>
        )}
        <div className="w-40 space-y-1.5"><Label htmlFor="u-rounding">Rounding</Label><Input id="u-rounding" className="text-right tabular-nums" inputMode="decimal" value={rounding} onChange={(e) => setRounding(e.target.value)} /></div>
        {unit && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active</label>}
        {err && <p className="text-sm text-destructive">{err}</p>}
      </div>
    </Modal>
  )
}

function Converter({ units, itemId }: { units: UomUnit[]; itemId?: number | null }) {
  const [qty, setQty] = useState('1')
  const [from, setFrom] = useState<number | ''>('')
  const [to, setTo] = useState<number | ''>('')
  const [out, setOut] = useState<{ text?: string; err?: string }>({})
  useEffect(() => {
    setOut({})
    const n = num(qty)
    if (!from || !to || !(n >= 0)) return
    let live = true
    const t = setTimeout(() => {
      convertUom({ qty: n, from, to, item_id: itemId ?? undefined })
        .then((r) => { if (live) setOut({ text: `${fmt(n)} ${units.find((u) => u.id === from)?.code} = ${fmt(r.result)} ${units.find((u) => u.id === to)?.code}` }) })
        .catch((e) => { if (live) setOut({ err: apiErrorMessage(e) }) })
    }, 250)
    return () => { live = false; clearTimeout(t) }
  }, [qty, from, to, itemId, units])
  const options = units.filter((u) => u.is_active)
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-28 space-y-1"><Label htmlFor="c-qty">Qty</Label><Input id="c-qty" className="h-9 text-right tabular-nums" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
        <div className="w-32 space-y-1"><Label htmlFor="c-from">From</Label><Select id="c-from" className="h-9" value={from} onChange={(e) => setFrom(e.target.value ? Number(e.target.value) : '')}><option value="">Unit…</option>{options.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}</Select></div>
        <ArrowRight className="mb-2.5 size-4 text-muted-foreground" />
        <div className="w-32 space-y-1"><Label htmlFor="c-to">To</Label><Select id="c-to" className="h-9" value={to} onChange={(e) => setTo(e.target.value ? Number(e.target.value) : '')}><option value="">Unit…</option>{options.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}</Select></div>
      </div>
      {out.text && <p className="text-sm font-semibold tabular-nums text-emerald-700">{out.text}</p>}
      {out.err && <p className="text-sm text-amber-700">{out.err}</p>}
    </div>
  )
}

function UnitsTab({ categories, uncategorized, canManage }: { categories: UomCategory[]; uncategorized: UomUnit[]; canManage: boolean }) {
  const act = useUomActions()
  const [editingCategory, setEditingCategory] = useState<UomCategory | 'new' | null>(null)
  const [editingUnit, setEditingUnit] = useState<{ unit: UomUnit | null; categoryId: number | null } | null>(null)
  const removeCategory = async (c: UomCategory) => {
    if (await confirmDialog({ message: `Delete category ${c.name}?`, danger: true })) act.deleteCategory.mutate(c.id, { onError: (e) => toast.fromError(e, apiErrorMessage(e)) })
  }
  const table = (units: UomUnit[], reference: string | undefined) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="whitespace-nowrap border-b bg-muted/40 text-left text-xs text-muted-foreground">
          <tr><th className="px-4 py-2 font-medium">Code</th><th className="px-3 py-2 font-medium">Name</th><th className="px-3 py-2 font-medium">Type</th><th className="px-3 py-2 font-medium">Size</th><th className="px-3 py-2 text-right font-medium">Rounding</th><th className="px-3 py-2 text-right font-medium">Items</th><th className="w-px px-3 py-2" /></tr>
        </thead>
        <tbody className="divide-y">
          {units.map((u) => (
            <tr key={u.id} className={cn(!u.is_active && 'text-muted-foreground')}>
              <td className="whitespace-nowrap px-4 py-2 font-medium">{u.code}{!u.is_active && <span className="ml-1.5 text-xs font-normal">(inactive)</span>}</td>
              <td className="px-3 py-2">{u.name}</td>
              <td className="px-3 py-2"><Badge variant={KIND_BADGE[kindOf(u)]}>{KIND_LABEL[kindOf(u)]}</Badge></td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">{u.is_reference ? '' : sizeText(u, reference)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmt(u.rounding)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{u.items_count.toLocaleString('id-ID')}</td>
              <td className="px-3 py-1.5 text-right">{canManage && <Button size="sm" variant="ghost" className="h-8" aria-label={`Edit ${u.code}`} onClick={() => setEditingUnit({ unit: u, categoryId: u.uom_category_id })}><Pencil className="size-3.5" /></Button>}</td>
            </tr>
          ))}
          {units.length === 0 && <tr><td colSpan={7}className="px-4 py-6 text-center text-muted-foreground">No units yet.</td></tr>}
        </tbody>
      </table>
    </div>
  )
  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditingCategory('new')}><Plus className="size-4" /> Add category</Button>
          <Button size="sm" onClick={() => setEditingUnit({ unit: null, categoryId: null })}><Plus className="size-4" /> Add unit</Button>
        </div>
      )}
      {categories.map((c) => {
        const reference = c.units.find((u) => u.is_reference)?.code
        return (
          <Card key={c.id} className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
              <h2 className="text-sm font-semibold">{c.name}{reference && <span className="ml-2 text-xs font-normal text-muted-foreground">Reference: {reference}</span>}</h2>
              {canManage && (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditingUnit({ unit: null, categoryId: c.id })}>Add unit</Button>
                  <Button size="sm" variant="ghost" className="h-8" aria-label={`Rename ${c.name}`} onClick={() => setEditingCategory(c)}><Pencil className="size-3.5" /></Button>
                  {c.units.length === 0 && <Button size="sm" variant="ghost" className="h-8 text-destructive" aria-label={`Delete ${c.name}`} onClick={() => void removeCategory(c)}><Trash2 className="size-3.5" /></Button>}
                </div>
              )}
            </div>
            {table(c.units, reference)}
          </Card>
        )
      })}
      {uncategorized.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b bg-amber-50 px-4 py-2.5"><h2 className="text-sm font-semibold text-amber-900">No category <span className="font-normal">({uncategorized.length})</span></h2></div>
          {table(uncategorized, undefined)}
        </Card>
      )}
      {editingCategory && <CategoryModal category={editingCategory} onClose={() => setEditingCategory(null)} />}
      {editingUnit && <UnitModal unit={editingUnit.unit} categoryId={editingUnit.categoryId} categories={categories} onClose={() => setEditingUnit(null)} />}
    </div>
  )
}

function ItemTab({ units, canManage }: { units: UomUnit[]; canManage: boolean }) {
  const act = useUomActions()
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<ItemLookupResult | null>(null)
  const { data: found, isFetching } = useItemLookup(picked ? '' : search)
  const { data, isLoading } = useItemConversions(picked?.id ?? null)
  const [unitId, setUnitId] = useState<number | ''>('')
  const [ratio, setRatio] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const base = data?.item.unit ?? picked?.unit ?? '—'
  const add = () => {
    setErr(null)
    if (!picked || !unitId) return invalidTo(setErr, 'Select a unit.')
    if (!(num(ratio) > 0)) return invalidTo(setErr, 'The ratio must be more than 0.')
    act.saveItemConversion.mutate({ itemId: picked.id, unit_id: unitId, ratio: num(ratio) }, { onSuccess: () => { setUnitId(''); setRatio('') }, onError: (e) => setErr(apiErrorMessage(e)) })
  }
  return (
    <div className="space-y-4">
      <Card className="space-y-2 p-4">
        <Label htmlFor="uom-item">Item</Label>
        {picked ? (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="min-w-0"><span className="font-semibold">{picked.code}</span> · {picked.description} · <span className="text-muted-foreground">main unit {base}</span></span>
            <Button size="sm" variant="ghost" onClick={() => { setPicked(null); setSearch(''); setErr(null) }}>Change item</Button>
          </div>
        ) : (
          <>
            <Input id="uom-item" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item code or name" />
            {isFetching && <p className="text-xs text-muted-foreground">Searching…</p>}
            {search.trim().length >= 2 && (found?.length ?? 0) > 0 && (
              <ul className="max-h-56 divide-y overflow-auto rounded-md border text-sm">
                {found!.map((i) => <li key={i.id}><button type="button" className="block w-full px-3 py-2 text-left hover:bg-muted" onClick={() => setPicked(i)}><span className="text-[13px] text-muted-foreground">{i.code}</span> {i.description}</button></li>)}
              </ul>
            )}
          </>
        )}
      </Card>
      {picked && (
        <>
          <Card className="overflow-hidden">
            <div className="border-b px-4 py-2.5 text-sm font-semibold">Conversions of this item</div>
            <ul className="divide-y text-sm">
              {data?.conversions.map((c) => (
                <li key={c.code} className={cn('flex items-center justify-between gap-2 px-4 py-2', c.needs_review && 'bg-amber-50 dark:bg-amber-950/30')}>
                  <span className="min-w-0">
                    <span className={cn('tabular-nums', c.needs_review && 'text-muted-foreground line-through')}>1 {c.code} = {fmt(c.ratio)} {c.needs_review ? c.set_against : base}</span>
                    {c.needs_review && (
                      <span className="block text-xs text-amber-800 dark:text-amber-300">
                        Set when the base unit was {c.set_against}; it is now {base}. Not used until you confirm it or save a new ratio below.
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {c.needs_review && canManage && c.id != null && (
                      <Button size="sm" variant="outline" className="h-8" disabled={act.confirmItemConversion.isPending}
                        title={`1 ${c.code} is still ${fmt(c.ratio)} ${base}`}
                        onClick={() => act.confirmItemConversion.mutate({ itemId: picked.id, id: c.id! }, { onError: (e) => toast.fromError(e, apiErrorMessage(e)) })}>
                        Still right
                      </Button>
                    )}
                    {c.source === 'ACCURATE' ? <Badge variant="neutral">Accurate</Badge> : canManage && c.id != null && (
                      <Button size="sm" variant="ghost" className="h-8 text-destructive" aria-label={`Delete ${c.code}`}
                        onClick={async () => { if (await confirmDialog({ message: `Delete the ${c.code} conversion of this item?`, danger: true })) act.deleteItemConversion.mutate({ itemId: picked.id, id: c.id! }, { onError: (e) => toast.fromError(e, apiErrorMessage(e)) }) }}><Trash2 className="size-3.5" /></Button>
                    )}
                  </span>
                </li>
              ))}
              {!isLoading && data?.conversions.length === 0 && <li className="px-4 py-6 text-center text-muted-foreground">No conversions for this item yet.</li>}
            </ul>
            {canManage && (
              <div className="flex flex-wrap items-end gap-2 border-t bg-muted/20 px-4 py-3">
                <span className="mb-2 text-sm">1</span>
                <div className="w-32 space-y-1"><Label htmlFor="ic-unit">Unit</Label>
                  <Select id="ic-unit" className="h-9" value={unitId} onChange={(e) => setUnitId(e.target.value ? Number(e.target.value) : '')}>
                    <option value="">Unit…</option>
                    {units.filter((u) => u.is_active && u.code !== base).map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
                  </Select>
                </div>
                <span className="mb-2 text-sm">=</span>
                <div className="w-28 space-y-1"><Label htmlFor="ic-ratio">Ratio</Label><Input id="ic-ratio" className="h-9 text-right tabular-nums" inputMode="decimal" value={ratio} onChange={(e) => setRatio(e.target.value)} /></div>
                <span className="mb-2 text-sm">{base}</span>
                <Button size="sm" className="h-9" disabled={act.saveItemConversion.isPending} onClick={add}>Save</Button>
                {err && <p className="w-full text-sm text-destructive">{err}</p>}
              </div>
            )}
          </Card>
          <Card className="p-4"><Converter units={units} itemId={picked.id} /></Card>
        </>
      )}
    </div>
  )
}

/** What cannot be converted yet: nothing is guessed, someone decides. */
function MappingTab({ units, canManage }: { units: UomUnit[]; canManage: boolean }) {
  const act = useUomActions()
  const { data, isLoading } = useUomUnmapped(true)
  const [picked, setPicked] = useState<Record<number, number>>({})
  if (isLoading || !data) return <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
  const empty = data.items.length === 0 && data.units.length === 0 && data.requested.length === 0
  return (
    <div className="space-y-4">
      {empty && <Card className="p-8 text-center text-sm text-muted-foreground">Nothing needs mapping.</Card>}
      {data.items.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b px-4 py-2.5 text-sm font-semibold">Items with no Base UOM <span className="font-normal text-muted-foreground">({data.items_total})</span></div>
          <ul className="divide-y text-sm">
            {data.items.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span className="min-w-0"><span className="text-[13px] text-muted-foreground">{i.code}</span> {i.description}</span>
                {canManage && (
                  <span className="flex items-center gap-2">
                    <Select className="h-8 w-28" aria-label={`Base UOM ${i.code}`} value={picked[i.id] ?? ''} onChange={(e) => setPicked((p) => ({ ...p, [i.id]: Number(e.target.value) }))}>
                      <option value="">Unit…</option>
                      {units.filter((u) => u.is_active).map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
                    </Select>
                    <Button size="sm" className="h-8" disabled={!picked[i.id] || act.setBaseUnit.isPending}
                      onClick={() => act.setBaseUnit.mutate({ itemId: i.id, unit_id: picked[i.id] }, { onError: (e) => toast.fromError(e, apiErrorMessage(e)) })}>Set</Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {data.units.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b px-4 py-2.5 text-sm font-semibold">Units with no category <span className="font-normal text-muted-foreground">({data.units.length})</span></div>
          <p className="px-4 py-2.5 text-sm">{data.units.map((u) => u.code).join(', ')}</p>
        </Card>
      )}
      {data.requested.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b px-4 py-2.5 text-sm font-semibold">Words on Item Requests that are no unit</div>
          <ul className="divide-y text-sm">{data.requested.map((r) => <li key={r.unit} className="flex justify-between gap-2 px-4 py-2"><span>{r.unit}</span><span className="tabular-nums text-muted-foreground">{r.lines_count} lines</span></li>)}</ul>
        </Card>
      )}
    </div>
  )
}

/** The fixed conversions of each measurement category (read only) and a converter; per-item ones live on the item. */
function ConversionRules({ categories, units }: { categories: UomCategory[]; units: UomUnit[] }) {
  return (
    <div className="space-y-4">
      <Card className="p-4"><Converter units={units} /></Card>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {categories.map((c) => {
          const reference = c.units.find((u) => u.is_reference)
          const fixed = c.units.filter((u) => u.is_active && !u.is_reference && u.ratio !== null)
          const perItem = c.units.filter((u) => u.is_active && u.ratio === null)
          return (
            <Card key={c.id} className="overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
                <h2 className="text-sm font-semibold">{c.name}</h2>
                {reference && <Badge variant="success">{reference.code}</Badge>}
              </div>
              <ul className="divide-y text-sm">
                {fixed.map((u) => <li key={u.id} className="px-4 py-1.5 tabular-nums">{sizeText(u, reference?.code)}</li>)}
                {fixed.length === 0 && <li className="px-4 py-2 text-xs text-muted-foreground">No fixed conversions.</li>}
              </ul>
              {perItem.length > 0 && <p className="border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground">Per item: {perItem.map((u) => u.code).join(', ')}</p>}
            </Card>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">Units of different categories never convert (KG ↔ LTR, MTR ↔ KG). A per-item unit (BOX, SET, ROL…) converts with the ratio set on each item.</p>
    </div>
  )
}

/** Master UOM: units in categories (one reference each), and what a pack or box holds for one item. */
export function UomPage() {
  const { hasPermission } = useAuth()
  const canManage = hasPermission('master.unit.manage')
  const { data, isLoading } = useUom()
  const [params, setParams] = useSearchParams()
  const TABS = ['units', 'parent', 'item', 'convert', 'mapping'] as const
  const asked = params.get('tab') as (typeof TABS)[number] | null
  const tab = asked && TABS.includes(asked) ? asked : 'units'
  const categories = data?.categories ?? []
  const uncategorized = data?.uncategorized ?? []
  const units = [...categories.flatMap((c) => c.units), ...uncategorized].sort((a, b) => a.code.localeCompare(b.code))
  return (
    <div className="space-y-4">
      <PageHeader title="UOM" subtitle="Units of measure, their categories and conversions." icon={<Ruler className="size-5" />} />
      <div className="-mb-px flex overflow-x-auto border-b" role="tablist">
        {([['units', 'Units & categories'], ['parent', 'Parent Category'], ['item', 'Per item'], ['convert', 'Conversion rules'], ['mapping', 'Needs mapping']] as const).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setParams({ tab: k })}
            className={cn('whitespace-nowrap border-b-2 px-4 pb-2.5 pt-1 text-sm font-medium', tab === k ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>{label}</button>
        ))}
      </div>
      {isLoading ? <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
        : tab === 'units' ? <UnitsTab categories={categories} uncategorized={uncategorized} canManage={canManage} />
          : tab === 'parent' ? <ParentCategoryTab units={units} canManage={canManage} />
          : tab === 'item' ? <ItemTab units={units} canManage={canManage} />
            : tab === 'mapping' ? <MappingTab units={units} canManage={canManage} />
              : <ConversionRules categories={categories} units={units} />}
    </div>
  )
}
