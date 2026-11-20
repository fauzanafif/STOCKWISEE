import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Plus, Search, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useCategoryRules, useSaveCategoryRules, type CategoryRule, type CategoryRuleUnit, type RuleStatus, type UomUnit } from '@/features/uom/api'
import { apiErrorMessage } from '@/lib/api'
import { invalidTo } from '@/lib/notify'
import { cn } from '@/lib/utils'

const fmt = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 6 })
const num = (v: string) => Number(v.trim().replace(',', '.'))

const STATUS: Record<RuleStatus, { label: string; variant: 'success' | 'warning' | 'neutral' }> = {
  COMPLETE: { label: 'Complete', variant: 'success' },
  PARTIAL: { label: 'Partial', variant: 'warning' },
  NOT_SET: { label: 'Not set', variant: 'neutral' },
}
const KIND: Record<string, { label: string; variant: 'success' | 'default' | 'warning' | 'neutral' }> = {
  REFERENCE: { label: 'Reference', variant: 'success' },
  BIGGER: { label: 'Bigger', variant: 'default' },
  SMALLER: { label: 'Smaller', variant: 'default' },
  PER_ITEM: { label: 'Per item', variant: 'warning' },
}

/** "1 KG = 1.000 GR" / "1 BOX = per item": the conversion of a unit against its reference, in words. */
function sizeOf(u: Pick<CategoryRuleUnit, 'code' | 'kind' | 'factor' | 'reference'>): string {
  if (u.kind === 'REFERENCE') return 'reference'
  if (u.kind === 'PER_ITEM' || u.factor == null) return 'set per item'
  return u.kind === 'BIGGER' ? `1 ${u.code} = ${fmt(u.factor)} ${u.reference ?? ''}` : `1 ${u.reference ?? ''} = ${fmt(u.factor)} ${u.code}`
}

type Row = { unit_id: number; is_default: boolean; suggested_ratio: string }

function Editor({ category, units, canManage }: { category: CategoryRule; units: UomUnit[]; canManage: boolean }) {
  const save = useSaveCategoryRules()
  const [rows, setRows] = useState<Row[]>([])
  const [adding, setAdding] = useState<number | ''>('')
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    setRows(category.units.map((u) => ({ unit_id: u.unit_id, is_default: u.is_default, suggested_ratio: u.suggested_ratio == null ? '' : String(u.suggested_ratio) })))
    setErr(null)
  }, [category])

  const byId = useMemo(() => new Map(units.map((u) => [u.id, u])), [units])
  const known = new Map(category.units.map((u) => [u.unit_id, u]))
  const reference = (u: UomUnit) => units.find((x) => x.is_reference && x.uom_category_id === u.uom_category_id && u.uom_category_id != null)?.code ?? null
  const info = (id: number): CategoryRuleUnit => {
    const k = known.get(id)
    if (k) return k
    const u = byId.get(id)!
    return { unit_id: id, code: u.code, name: u.name, is_default: false, kind: u.kind ?? null, factor: u.factor ?? null, reference: reference(u), suggested_ratio: null, items_count: 0, is_active: u.is_active }
  }
  const usage = new Map([...category.units.map((u) => [u.unit_id, u.items_count] as const), ...category.outside.map((o) => [o.unit_id, o.items_count] as const)])
  const dirty = JSON.stringify(rows) !== JSON.stringify(category.units.map((u) => ({ unit_id: u.unit_id, is_default: u.is_default, suggested_ratio: u.suggested_ratio == null ? '' : String(u.suggested_ratio) })))
  const addable = units.filter((u) => u.is_active && !rows.some((r) => r.unit_id === u.id))

  const add = (id: number) => setRows((r) => [...r, { unit_id: id, is_default: r.length === 0, suggested_ratio: '' }])
  const move = (i: number, d: -1 | 1) => setRows((r) => { const n = [...r]; const j = i + d; if (j < 0 || j >= n.length) return r; [n[i], n[j]] = [n[j], n[i]]; return n })
  const submit = () => {
    setErr(null)
    if (rows.length > 0 && rows.filter((r) => r.is_default).length !== 1) return invalidTo(setErr, 'Choose one default unit (the main unit of a new item).')
    const bad = rows.find((r) => r.suggested_ratio !== '' && !(num(r.suggested_ratio) > 0))
    if (bad) return invalidTo(setErr, `The suggested ratio of ${info(bad.unit_id).code} must be more than 0.`)
    save.mutate({ categoryId: category.id, units: rows.map((r) => ({ unit_id: r.unit_id, is_default: r.is_default, suggested_ratio: r.suggested_ratio === '' ? null : num(r.suggested_ratio) })) },
      { onError: (e) => setErr(apiErrorMessage(e)) })
  }

  return (
    <Card className="min-w-0 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{category.name}</h2>
          <p className="text-xs text-muted-foreground">{category.items_count.toLocaleString('id-ID')} items · {category.parent_id ? `overrides its parent (${category.path})` : 'parent category'}</p>
        </div>
        <Badge variant={STATUS[category.status].variant}>{STATUS[category.status].label}</Badge>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="whitespace-nowrap border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Default</th><th className="px-3 py-2 font-medium">Unit</th><th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Conversion</th><th className="px-3 py-2 font-medium">Suggested per item</th><th className="px-3 py-2 text-right font-medium">Items</th><th className="w-px px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r, i) => {
              const u = info(r.unit_id)
              const perItem = u.kind === 'PER_ITEM'
              const def = rows.find((x) => x.is_default)
              return (
                <tr key={r.unit_id} className={cn(r.is_default && 'bg-primary/5')}>
                  <td className="px-4 py-2">
                    <input type="radio" name={`default-${category.id}`} className="size-4 accent-primary" aria-label={`Default ${u.code}`} disabled={!canManage}
                      checked={r.is_default} onChange={() => setRows((all) => all.map((x) => ({ ...x, is_default: x.unit_id === r.unit_id })))} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2"><span className="font-medium">{u.code}</span> <span className="text-muted-foreground">{u.name}</span>{!u.is_active && <span className="ml-1 text-xs text-destructive">(inactive)</span>}</td>
                  <td className="px-3 py-2">{u.kind ? <Badge variant={KIND[u.kind].variant}>{KIND[u.kind].label}</Badge> : <span className="text-xs text-muted-foreground">no category</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">{sizeOf(u)}</td>
                  <td className="px-3 py-1.5">
                    {perItem ? (
                      <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                        1 {u.code} =
                        <Input aria-label={`Suggested ratio ${u.code}`} className="h-8 w-20 text-right tabular-nums" inputMode="decimal" placeholder="—" disabled={!canManage}
                          value={r.suggested_ratio} onChange={(e) => setRows((all) => all.map((x) => (x.unit_id === r.unit_id ? { ...x, suggested_ratio: e.target.value } : x)))} />
                        {def && def.unit_id !== r.unit_id ? info(def.unit_id).code : 'base'}
                      </span>
                    ) : <span className="text-xs text-muted-foreground">fixed</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{(usage.get(r.unit_id) ?? 0).toLocaleString('id-ID')}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right">
                    {canManage && (
                      <span className="inline-flex">
                        <Button size="sm" variant="ghost" className="h-8 px-2" aria-label={`Move ${u.code} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-3.5" /></Button>
                        <Button size="sm" variant="ghost" className="h-8 px-2" aria-label={`Move ${u.code} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-3.5" /></Button>
                        <Button size="sm" variant="ghost" className="h-8 px-2 text-destructive" aria-label={`Remove ${u.code}`}
                          onClick={() => setRows((all) => { const left = all.filter((x) => x.unit_id !== r.unit_id); return r.is_default && left[0] ? left.map((x, k) => ({ ...x, is_default: k === 0 })) : left })}><Trash2 className="size-3.5" /></Button>
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">No units yet: items of this category can use the standard list. Add the units below.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {category.outside.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t bg-amber-50 px-4 py-2.5 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="size-3.5 shrink-0" />
          <span>Items of this category also use units not listed (they stay as they are; changing their unit will need a listed one):</span>
          {category.outside.map((o) => (
            <button key={o.unit_id} type="button" disabled={!canManage || rows.some((r) => r.unit_id === o.unit_id)} onClick={() => add(o.unit_id)}
              className="rounded-full border border-amber-300 bg-white px-2 py-0.5 font-medium hover:bg-amber-100 disabled:opacity-50 dark:bg-transparent">
              + {o.code} <span className="font-normal">({o.items_count})</span>
            </button>
          ))}
        </div>
      )}

      {canManage && (
        <div className="flex flex-wrap items-center gap-2 border-t bg-muted/20 px-4 py-3">
          <Select aria-label="Add unit" className="h-9 w-44" value={adding} onChange={(e) => setAdding(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Add a unit…</option>
            {addable.map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
          </Select>
          <Button size="sm" variant="outline" className="h-9" disabled={!adding} onClick={() => { if (adding) { add(adding); setAdding('') } }}><Plus className="size-4" /> Add</Button>
          <div className="ml-auto flex items-center gap-2">
            {dirty && <Button size="sm" variant="ghost" className="h-9" onClick={() => setRows(category.units.map((u) => ({ unit_id: u.unit_id, is_default: u.is_default, suggested_ratio: u.suggested_ratio == null ? '' : String(u.suggested_ratio) })))}>Undo</Button>}
            <Button size="sm" className="h-9" disabled={!dirty || save.isPending} onClick={submit}>{save.isPending ? 'Saving…' : 'Save'}</Button>
          </div>
          {err && <p role="alert" className="w-full text-sm text-destructive">{err}</p>}
        </div>
      )}
    </Card>
  )
}

/**
 * Master UOM › Parent Category: for each parent category of Master Barang, which shared units its items may use
 * and which one a new item starts with. Ratios stay where they belong: fixed ones in Units, the per-item ones
 * (BOX, SET, ROL …) on each item.
 */
export function ParentCategoryTab({ units, canManage }: { units: UomUnit[]; canManage: boolean }) {
  const { data, isLoading, isError, error } = useCategoryRules()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<RuleStatus | ''>('')
  const [picked, setPicked] = useState<number | null>(null)
  const list = (data ?? []).filter((c) => (!q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()) || c.units.some((u) => u.code.toLowerCase() === q.trim().toLowerCase())) && (!status || c.status === status))
  const current = data?.find((c) => c.id === picked) ?? list[0]

  if (isLoading) return <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
  if (isError) return <Card className="p-6 text-sm text-destructive">Failed to load: {apiErrorMessage(error)}</Card>
  if (!data?.length) return <Card className="p-8 text-center text-sm text-muted-foreground">No item categories yet. Add them in Kategori Barang first.</Card>

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <Card className="min-w-0 overflow-hidden lg:sticky lg:top-[calc(var(--sw-header,3.5rem)+1rem)]">
        <div className="space-y-2 border-b p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-9 pl-8" placeholder="Search category or unit" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search category" />
          </div>
          <Select className="h-9" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as RuleStatus | '')}>
            <option value="">All statuses</option>
            {(Object.keys(STATUS) as RuleStatus[]).map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
          </Select>
        </div>
        <ul className="max-h-[60vh] divide-y overflow-y-auto">
          {list.map((c) => {
            const on = current?.id === c.id
            const def = c.units.find((u) => u.is_default)
            return (
              <li key={c.id}>
                <button type="button" onClick={() => setPicked(c.id)} aria-current={on}
                  className={cn('block w-full px-3 py-2.5 text-left transition-colors hover:bg-muted/50', on && 'bg-primary/5 ring-1 ring-inset ring-primary/30')}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn('min-w-0 truncate text-sm font-medium', on && 'text-primary', c.parent_id && 'pl-3')}>{c.parent_id ? `↳ ${c.name}` : c.name}</span>
                    {c.status === 'COMPLETE' ? <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-label="Complete" /> : <Badge variant={STATUS[c.status].variant}>{STATUS[c.status].label}</Badge>}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {c.items_count.toLocaleString('id-ID')} items{def ? ` · ${def.code}` : ''}{c.units.length > 1 ? ` + ${c.units.filter((u) => !u.is_default).map((u) => u.code).join(', ')}` : ''}
                  </div>
                </button>
              </li>
            )
          })}
          {list.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">No category matches.</li>}
        </ul>
      </Card>
      {current ? <Editor category={current} units={units} canManage={canManage} /> : <Card className="p-8 text-center text-sm text-muted-foreground">Choose a category.</Card>}
    </div>
  )
}
