import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Boxes, CalendarDays, Check, ClipboardList, Search, Users, X } from 'lucide-react'
import { useCreateOrder, useFormOptions, type OrderInput } from '@/features/opname/workflow'
import { apiErrorMessage } from '@/lib/api'
import { invalidTo } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/PageHeader'
import { ItemPicker } from '@/components/ItemPicker'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

/** Today in the user's own timezone (toISOString would give yesterday before 07:00 WIB). */
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10) }
const fmtDate = (v: string) => (v ? new Date(`${v}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '-')

/** A numbered block of the form: step number, title, a one-line hint, then the fields. */
function Step({ n, icon: Icon, title, hint, children }: { n: number; icon: typeof Boxes; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-4 border-b p-5 last:border-b-0 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{n}</span>
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold"><Icon className="size-4 text-muted-foreground" /> {title}</h2>
          {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
        </div>
      </div>
      <div className="space-y-4 sm:pl-11">{children}</div>
    </section>
  )
}

function Field({ id, label, hint, required, children, className }: { id?: string; label: string; hint?: string; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id}>{label}{required && <span className="text-destructive"> *</span>}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** Two big radio cards side by side: the choice and what it means. */
function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<[T, string, string]>; onChange: (v: T) => void }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={label}>
        {options.map(([v, title, desc]) => {
          const on = value === v
          return (
            <button key={v} type="button" role="radio" aria-checked={on} onClick={() => onChange(v)}
              className={cn('flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                on ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'bg-card hover:border-primary/40 hover:bg-muted/40')}>
              <span className={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border', on ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40')}>
                {on && <Check className="size-3" />}
              </span>
              <span className="min-w-0">
                <span className={cn('block text-sm font-medium', on && 'text-primary')}>{title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{desc}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right font-medium">{children}</span>
    </div>
  )
}

/**
 * Create page for a Stock Opname order, laid out like the other full-page forms (Create task): back link,
 * title and the buttons on top; the order on the left, who counts + a summary on the right. Items come from
 * STOCKWISE's own masters: all items of the warehouse (narrowed by location / category), or chosen ones;
 * Cycle Count picks the items not counted longest.
 */
export function OpnameOrderPage() {
  const navigate = useNavigate()
  const { data: opt, isLoading } = useFormOptions()
  const create = useCreateOrder()
  const [f, setF] = useState<OrderInput>({
    scheduled_date: today(),
    warehouse_id: undefined,
    warehouse_location_id: null,
    category_id: null,
    scope: 'ALL',
    count_method: 'FULL',
    cycle_days: 90,
    cycle_limit: 50,
    responsible_id: null,
    team_ids: [],
    notes: '',
  })
  const [items, setItems] = useState<Map<number, string>>(new Map())
  const [who, setWho] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const set = (patch: Partial<OrderInput>) => setF((v) => ({ ...v, ...patch }))

  const locations = useMemo(() => (opt?.locations ?? []).filter((l) => l.warehouse_id === f.warehouse_id), [opt, f.warehouse_id])
  const counters = useMemo(() => (opt?.users ?? []).filter((u) => u.counter), [opt])
  const shownCounters = useMemo(() => {
    const q = who.trim().toLowerCase()
    return counters.filter((u) => !q || u.name.toLowerCase().includes(q))
  }, [counters, who])
  const team = f.team_ids ?? []
  const toggleTeam = (id: number) => set({ team_ids: team.includes(id) ? team.filter((x) => x !== id) : [...team, id] })
  const busy = create.isPending

  const warehouse = opt?.warehouses.find((w) => w.id === f.warehouse_id)
  const location = locations.find((l) => l.id === f.warehouse_location_id)
  const category = opt?.categories.find((c) => c.id === f.category_id)
  const responsible = opt?.users.find((u) => u.id === f.responsible_id)
  const selected = f.scope === 'SELECTED'
  const cycle = f.count_method === 'CYCLE'

  async function submit() {
    setErr(null)
    if (!f.scheduled_date) return invalidTo(setErr, 'Fill in the counting date.')
    if (!f.warehouse_id) return invalidTo(setErr, 'Choose the warehouse to count in.')
    if (selected && items.size === 0) return invalidTo(setErr, 'Add at least one item, or choose “All items”.')
    if (cycle && (!f.cycle_days || !f.cycle_limit)) return invalidTo(setErr, 'Fill in the Cycle Count days and maximum items.')
    try {
      const o = await create.mutateAsync({ ...f, notes: f.notes || null, item_ids: selected ? [...items.keys()] : undefined,
        cycle_days: cycle ? f.cycle_days : undefined, cycle_limit: cycle ? f.cycle_limit : undefined })
      navigate(`/stock-opnames/${o.id}`)
    } catch (e) {
      setErr(apiErrorMessage(e))
    }
  }

  const actions = <>
    <Button variant="outline" disabled={busy} onClick={() => navigate('/stock-opnames')}>Cancel</Button>
    <Button disabled={busy || isLoading} onClick={submit}><ClipboardList className="size-4" /> {busy ? 'Creating…' : 'Create Draft'}</Button>
  </>

  return (
    <div className="space-y-4 pb-20 lg:pb-8">
      <PageHeader title="New Stock Opname" actions={<div className="flex gap-2 max-lg:hidden">{actions}</div>} />
      {err && <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-2.5 text-sm text-destructive">{err}</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_24rem]">
        {/* the order: when / where, then what */}
        <Card className="min-w-0">
          <Step n={1} icon={CalendarDays} title="When & where" hint="The warehouse to count, optionally narrowed to one rack or category.">
            <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
              <Field id="so-date" label="Counting date" required>
                <Input id="so-date" type="date" value={f.scheduled_date} onChange={(e) => set({ scheduled_date: e.target.value })} />
              </Field>
              <Field id="so-wh" label="Warehouse" required>
                <Select id="so-wh" value={f.warehouse_id ?? ''} onChange={(e) => set({ warehouse_id: e.target.value ? Number(e.target.value) : undefined, warehouse_location_id: null })}>
                  <option value="">— choose a warehouse —</option>
                  {opt?.warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
                </Select>
              </Field>
              <Field id="so-loc" label="Storage location" hint={f.warehouse_id ? 'Only items whose default location is this rack.' : 'Choose a warehouse first.'}>
                <Select id="so-loc" value={f.warehouse_location_id ?? ''} disabled={!f.warehouse_id} onChange={(e) => set({ warehouse_location_id: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">All locations</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.code}{l.description ? ` — ${l.description}` : ''}</option>)}
                </Select>
              </Field>
              <Field id="so-cat" label="Item category" hint="Includes its sub-categories.">
                <Select id="so-cat" value={f.category_id ?? ''} onChange={(e) => set({ category_id: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">All categories</option>
                  {opt?.categories.map((c) => <option key={c.id} value={c.id}>{c.path ?? c.name}</option>)}
                </Select>
              </Field>
            </div>
          </Step>

          <Step n={2} icon={Boxes} title="What to count" hint="Every item in scope, or only hand-picked items — then how they are counted.">
 <div className="grid gap-5 xl:grid-cols-2 xl:items-start">
            <div className="min-w-0 space-y-3">
            <Choice label="Items" value={f.scope ?? 'ALL'} onChange={(v) => set({ scope: v })} options={[
              ['ALL', 'All items', 'Every item in the warehouse, narrowed by location and category.'],
              ['SELECTED', 'Selected items', 'Only the specific items you pick.'],
            ]} />

            {selected && (
              <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">Picked items</span>
                  {items.size > 0 && (
                    <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => setItems(new Map())}>Clear all ({items.size})</button>
                  )}
                </div>
                <ItemPicker onPick={(it) => setItems((m) => new Map(m).set(it.id, `${it.code} — ${it.description}`))} />
                <div className="flex max-h-48 min-h-8 flex-wrap gap-1.5 overflow-y-auto">
                  {[...items].map(([id, label]) => (
                    <span key={id} className="inline-flex max-w-full items-center gap-1 rounded-full bg-primary/10 py-0.5 pl-2.5 pr-1 text-xs font-medium text-primary">
                      <span className="truncate">{label}</span>
                      <button type="button" className="rounded-full p-0.5 hover:bg-primary/20" aria-label={`Remove ${label}`}
                        onClick={() => setItems((m) => { const n = new Map(m); n.delete(id); return n })}><X className="size-3" /></button>
                    </span>
                  ))}
                  {items.size === 0 && <span className="py-1 text-xs text-muted-foreground">No items yet — search and pick above.</span>}
                </div>
              </div>
            )}

            </div>
            <div className="min-w-0 space-y-3">
            <Choice label="Count method" value={f.count_method ?? 'FULL'} onChange={(v) => set({ count_method: v })} options={[
              ['FULL', 'Full Count', 'Count every item in the selection.'],
              ['CYCLE', 'Cycle Count', 'Only the items not counted for a while — longest overdue first.'],
            ]} />
            {cycle && (
              <div className="grid gap-4 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
                <Field id="so-days" label="Not counted for (days)">
                  <Input id="so-days" type="number" min={1} value={f.cycle_days ?? ''} onChange={(e) => set({ cycle_days: Number(e.target.value) || null })} />
                </Field>
                <Field id="so-limit" label="At most (items)">
                  <Input id="so-limit" type="number" min={1} value={f.cycle_limit ?? ''} onChange={(e) => set({ cycle_limit: Number(e.target.value) || null })} />
                </Field>
              </div>
            )}
            </div>
            </div>
          </Step>

          <Step n={3} icon={ClipboardList} title="Notes" hint="Optional — visible to everyone on this order.">
            <Textarea rows={3} maxLength={2000} placeholder="e.g. Count before the monthly closing…" value={f.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} />
          </Step>
        </Card>

        {/* who counts + summary */}
        <div className="min-w-0 space-y-4 lg:sticky lg:top-[calc(var(--sw-header,3.5rem)+1rem)]">
          <Card className="space-y-5 p-5">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold"><Users className="size-4 text-muted-foreground" /> Who's counting</h2>
            <Field id="so-pic" label="Person in charge">
              <Select id="so-pic" value={f.responsible_id ?? ''} onChange={(e) => set({ responsible_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">— choose —</option>
                {opt?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </Field>
            <div className="space-y-2">
              <Label>Counting team <span className="font-normal text-muted-foreground">({team.length} people)</span></Label>
              <p className="text-xs text-muted-foreground">Empty: anyone with counting access. Set: only the team.</p>
              {counters.length > 6 && (
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input className="h-9 pl-8" placeholder="Search name" value={who} onChange={(e) => setWho(e.target.value)} />
                </div>
              )}
              <div className="max-h-60 overflow-y-auto rounded-lg border">
                {isLoading && <p className="p-3 text-sm text-muted-foreground">Loading…</p>}
                {shownCounters.map((u) => (
                  <label key={u.id} className={cn('flex cursor-pointer items-center gap-2.5 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-muted/40', team.includes(u.id) && 'bg-primary/5')}>
                    <input type="checkbox" className="size-4 shrink-0 accent-primary" checked={team.includes(u.id)} onChange={() => toggleTeam(u.id)} />
                    <span className="truncate">{u.name}</span>
                  </label>
                ))}
                {opt && counters.length === 0 && <p className="p-3 text-sm text-muted-foreground">No counting users.</p>}
                {counters.length > 0 && shownCounters.length === 0 && <p className="p-3 text-sm text-muted-foreground">No matches.</p>}
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="mb-2 text-sm font-semibold">Summary</h2>
            <div className="divide-y">
              <SummaryRow label="Date">{fmtDate(f.scheduled_date)}</SummaryRow>
              <SummaryRow label="Warehouse">{warehouse ? warehouse.code : <span className="text-destructive">not chosen</span>}</SummaryRow>
              <SummaryRow label="Location">{location ? location.code : 'All'}</SummaryRow>
              <SummaryRow label="Category">{category ? (category.path ?? category.name) : 'All'}</SummaryRow>
              <SummaryRow label="Items">{selected ? `${items.size} selected` : 'All items'}</SummaryRow>
              <SummaryRow label="Method">{cycle ? `Cycle · ${f.cycle_days ?? '?'} days · max ${f.cycle_limit ?? '?'}` : 'Full Count'}</SummaryRow>
              <SummaryRow label="In charge">{responsible?.name ?? '—'}</SummaryRow>
              <SummaryRow label="Team">{team.length ? `${team.length} people` : 'Anyone'}</SummaryRow>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Saved as a draft — you can still edit it and add items before confirming the order.</p>
          </Card>
        </div>
      </div>

      {/* on a phone the buttons stay at hand at the bottom */}
      <div className="fixed inset-x-0 bottom-0 z-20 flex justify-end gap-2 border-t bg-card px-3 py-2.5 shadow-[0_-2px_8px_rgb(15_23_42/0.06)] lg:hidden [&>button]:flex-1 sm:[&>button]:flex-none">
        {actions}
      </div>
    </div>
  )
}
