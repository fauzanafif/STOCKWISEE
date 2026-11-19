import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { useCreateOrder, useFlowActions, useFormOptions, type FlowOpname, type OrderInput } from '@/features/opname/workflow'
import { apiErrorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ItemPicker } from '@/components/ItemPicker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

const today = () => new Date().toISOString().slice(0, 10)

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 sm:grid-cols-[10rem_1fr] sm:items-start sm:gap-3">
      <span className="pt-2 text-sm font-medium">{label}</span>
      <span className="space-y-1">{children}{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span>
    </label>
  )
}

function Segment<T extends string>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border bg-muted/40 p-1 text-sm" role="radiogroup">
      {options.map(([v, label]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={cn('rounded-md px-3 py-1.5 font-medium', value === v ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{label}</button>
      ))}
    </div>
  )
}

/**
 * The Stock Opname order: one form for a new order (POST /orders) and for editing a draft (PUT /draft).
 * Items come from STOCKWISE's own masters: all items of the warehouse (narrowed by location / category), or
 * chosen ones; Cycle Count picks the items not counted the longest.
 */
export function OpnameOrderForm({ existing, onClose }: { existing?: FlowOpname; onClose: () => void }) {
  const navigate = useNavigate()
  const { data: opt } = useFormOptions()
  const create = useCreateOrder()
  const actions = useFlowActions(existing?.id ?? 0)
  const [f, setF] = useState<OrderInput>({
    scheduled_date: existing?.scheduled_date ?? today(),
    warehouse_id: existing?.warehouse?.id,
    warehouse_location_id: existing?.location?.id ?? null,
    category_id: existing?.category?.id ?? null,
    scope: 'ALL',
    count_method: existing?.count_method ?? 'FULL',
    cycle_days: 90,
    cycle_limit: 50,
    responsible_id: existing?.responsible?.id ?? null,
    team_ids: existing?.team.map((t) => t.id) ?? [],
    notes: existing?.notes ?? '',
  })
  const [items, setItems] = useState<Map<number, string>>(new Map())
  const [err, setErr] = useState<string | null>(null)
  const set = (patch: Partial<OrderInput>) => setF((v) => ({ ...v, ...patch }))

  const locations = useMemo(() => (opt?.locations ?? []).filter((l) => l.warehouse_id === f.warehouse_id), [opt, f.warehouse_id])
  const counters = (opt?.users ?? []).filter((u) => u.counter)
  const busy = create.isPending || actions.updateDraft.isPending

  async function submit() {
    setErr(null)
    if (!existing && !f.warehouse_id) return setErr('Choose the warehouse.')
    if (!existing && f.scope === 'SELECTED' && items.size === 0) return setErr('Add at least one item, or choose “All items”.')
    try {
      if (existing) {
        await actions.updateDraft.mutateAsync({ scheduled_date: f.scheduled_date, warehouse_location_id: f.warehouse_location_id, category_id: f.category_id,
          count_method: f.count_method, responsible_id: f.responsible_id, team_ids: f.team_ids, notes: f.notes || null })
        onClose()
      } else {
        const o = await create.mutateAsync({ ...f, notes: f.notes || null, item_ids: f.scope === 'SELECTED' ? [...items.keys()] : undefined,
          cycle_days: f.count_method === 'CYCLE' ? f.cycle_days : undefined, cycle_limit: f.count_method === 'CYCLE' ? f.cycle_limit : undefined })
        onClose()
        navigate(`/stock-opnames/${o.id}`)
      }
    } catch (e) {
      setErr(apiErrorMessage(e))
    }
  }

  return (
    <Modal open form page onClose={onClose} title={existing ? `Edit ${existing.number}` : 'New Stock Opname'}
      footer={<>
        {err && <span role="alert" className="mr-auto text-sm text-destructive">{err}</span>}
        <Button size="sm" variant="outline" onClick={onClose}>Discard</Button>
        <Button size="sm" onClick={submit} disabled={busy}>{busy ? 'Saving…' : existing ? 'Save' : 'Create Draft'}</Button>
      </>}>
      <div className="mx-auto max-w-3xl space-y-4">
        <Row label="Date"><Input type="date" className="w-48" value={f.scheduled_date} onChange={(e) => set({ scheduled_date: e.target.value })} /></Row>
        <Row label="Warehouse">
          {existing ? <span className="block pt-2 text-sm">{existing.warehouse?.code} — {existing.warehouse?.name}</span> : (
            <Select aria-label="Warehouse" value={f.warehouse_id ?? ''} onChange={(e) => set({ warehouse_id: e.target.value ? Number(e.target.value) : undefined, warehouse_location_id: null })}>
              <option value="">— choose —</option>
              {opt?.warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </Select>
          )}
        </Row>
        <Row label="Storage location" hint="Only the items whose default location is this rack (All items).">
          <Select aria-label="Storage location" value={f.warehouse_location_id ?? ''} disabled={!f.warehouse_id} onChange={(e) => set({ warehouse_location_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">All locations</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.code}{l.description ? ` — ${l.description}` : ''}</option>)}
          </Select>
        </Row>
        <Row label="Item category" hint="Includes its sub-categories (STOCKWISE Item Categories).">
          <Select aria-label="Item category" value={f.category_id ?? ''} onChange={(e) => set({ category_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">All categories</option>
            {opt?.categories.map((c) => <option key={c.id} value={c.id}>{c.path ?? c.name}</option>)}
          </Select>
        </Row>
        {!existing && (
          <Row label="Items">
            <Segment value={f.scope ?? 'ALL'} options={[['ALL', 'All items'], ['SELECTED', 'Selected items']]} onChange={(v) => set({ scope: v })} />
            {f.scope === 'SELECTED' && (
              <div className="space-y-2 pt-2">
                <ItemPicker onPick={(it) => setItems((m) => new Map(m).set(it.id, `${it.code} — ${it.description}`))} />
                <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
                  {[...items].map(([id, label]) => (
                    <span key={id} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs">{label}
                      <button type="button" aria-label={`Remove ${label}`} onClick={() => setItems((m) => { const n = new Map(m); n.delete(id); return n })}><X className="size-3" /></button>
                    </span>
                  ))}
                  {items.size === 0 && <span className="text-xs text-muted-foreground">No items yet — search and pick above.</span>}
                </div>
              </div>
            )}
          </Row>
        )}
        <Row label="Method" hint={f.count_method === 'CYCLE' ? 'Cycle Count: only the items not counted for N days, the longest first.' : 'Full Count: every item of the selection.'}>
          <Segment value={f.count_method ?? 'FULL'} options={[['FULL', 'Full Count'], ['CYCLE', 'Cycle Count']]} onChange={(v) => set({ count_method: v })} />
          {f.count_method === 'CYCLE' && !existing && (
            <div className="flex flex-wrap items-center gap-2 pt-2 text-sm">
              Not counted for <Input aria-label="Days" type="number" min={1} className="h-8 w-20" value={f.cycle_days ?? ''} onChange={(e) => set({ cycle_days: Number(e.target.value) || null })} /> days, at most
              <Input aria-label="Max items" type="number" min={1} className="h-8 w-20" value={f.cycle_limit ?? ''} onChange={(e) => set({ cycle_limit: Number(e.target.value) || null })} /> items
            </div>
          )}
        </Row>
        <Row label="Person in charge">
          <Select aria-label="Person in charge" value={f.responsible_id ?? ''} onChange={(e) => set({ responsible_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">—</option>
            {opt?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        </Row>
        <Row label="Counting team" hint="Empty: anyone with counting access may count. Set: only the team (and the person in charge / reviewers).">
          <div className="flex flex-wrap gap-1.5">
            {counters.map((u) => {
              const on = f.team_ids?.includes(u.id)
              return (
                <button key={u.id} type="button" aria-pressed={on} onClick={() => set({ team_ids: on ? f.team_ids!.filter((x) => x !== u.id) : [...(f.team_ids ?? []), u.id] })}
                  className={cn('rounded-full border px-2.5 py-1 text-xs', on ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted')}>{u.name}</button>
              )
            })}
            {counters.length === 0 && <span className="pt-2 text-xs text-muted-foreground">No counting users.</span>}
          </div>
        </Row>
        <Row label="Notes"><Textarea rows={3} maxLength={2000} value={f.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} /></Row>
      </div>
    </Modal>
  )
}
