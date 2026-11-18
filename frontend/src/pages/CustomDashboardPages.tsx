import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Activity, BarChart3, ClipboardList, Factory, GripVertical, LayoutDashboard, Loader2, Package, Pencil, PieChart, Plus, ShieldCheck,
  ShoppingCart, Star, Trash2, TrendingUp, Users, Warehouse, X, type LucideIcon,
} from 'lucide-react'
import { closestCenter, DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
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
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  useCustomDashboard, useCustomDashboards, useDeleteCustomDashboard, useSaveCustomDashboard,
  type CustomDashboard, type DashboardInput, type Widget, type WidgetHeight, type WidgetType, type WidgetWidth,
} from '@/features/customDashboards/api'
import { canUse, SOURCES, sourceOf, TYPE_LABEL, WidgetBody, widgetTitle } from '@/features/customDashboards/widgets'
import { apiErrorMessage } from '@/lib/api'
import { toast } from '@/lib/notify'
import { cn } from '@/lib/utils'

/** the icons a dashboard may take (the server keeps the same names) */
export const DASHBOARD_ICONS: Record<string, LucideIcon> = {
  'layout-dashboard': LayoutDashboard, 'bar-chart': BarChart3, 'pie-chart': PieChart, 'trending-up': TrendingUp, package: Package, 'shopping-cart': ShoppingCart,
  warehouse: Warehouse, factory: Factory, 'clipboard-list': ClipboardList, 'shield-check': ShieldCheck, activity: Activity, star: Star,
}
/** the app workspace a dashboard opens from */
const APPS: [string, string][] = [['', 'Dashboard only'], ['inventory', 'Inventory'], ['purchase', 'Purchase'], ['manufacturing', 'Manufacturing'], ['tracking', 'Tracking'], ['important', 'Important Request']]
const WIDTHS: [WidgetWidth, string][] = [[3, '1/4'], [4, '1/3'], [6, '1/2'], [8, '2/3'], [12, 'Full']]
const HEIGHTS: [WidgetHeight, string][] = [[1, 'Short'], [2, 'Medium'], [3, 'Tall']]
// Tailwind reads these from source: keep them written out whole
const SPAN: Record<WidgetWidth, string> = { 3: 'md:col-span-3', 4: 'md:col-span-4', 6: 'md:col-span-6', 8: 'md:col-span-8', 12: 'md:col-span-12' }
const HEIGHT: Record<WidgetHeight, string> = { 1: 'h-36', 2: 'h-72', 3: 'h-[27rem]' }
/** a sensible size for a new widget of this type */
const defaultSize = (t: WidgetType): Pick<Widget, 'w' | 'h'> => (t === 'kpi' ? { w: 12, h: 1 } : { w: 6, h: 2 })
const newId = () => Math.random().toString(36).slice(2, 10)
const fail = (e: unknown) => toast.error(apiErrorMessage(e))

export function DashboardIcon({ name, className }: { name: string; className?: string }) {
  const Icon = DASHBOARD_ICONS[name] ?? LayoutDashboard
  return <Icon className={className} />
}

/** The sources this user may pick, by module group. */
function useSources() {
  const { hasPermission } = useAuth()
  return useMemo(() => SOURCES.filter((s) => canUse(s.key, hasPermission)), [hasPermission])
}

/** Pick a source and how it shows: a widget to add. */
function WidgetPicker({ onPick }: { onPick: (w: Widget) => void }) {
  const sources = useSources()
  const [source, setSource] = useState(sources[0]?.key ?? '')
  const s = sourceOf(source)
  const [type, setType] = useState<WidgetType>(s?.types[0] ?? 'kpi')
  const groups = [...new Set(sources.map((x) => x.group))]
  if (sources.length === 0) return <p className="text-sm text-muted-foreground">No data source is open to your role.</p>
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
      <div className="space-y-1">
        <Label htmlFor="wp-source">Data source</Label>
        <Select id="wp-source" value={source} onChange={(e) => { setSource(e.target.value); setType(sourceOf(e.target.value)?.types[0] ?? 'kpi') }}>
          {groups.map((g) => <optgroup key={g} label={g}>{sources.filter((x) => x.group === g).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</optgroup>)}
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="wp-type">Widget</Label>
        <Select id="wp-type" value={type} onChange={(e) => setType(e.target.value as WidgetType)}>
          {(s?.types ?? []).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </Select>
      </div>
      <Button type="button" variant="outline" onClick={() => onPick({ id: newId(), source, type, title: null, ...defaultSize(type) })}><Plus className="size-4" /> Add widget</Button>
    </div>
  )
}

/** Add New Dashboard / edit its details: name, description, icon, visibility, workspace and (when new) widgets. */
function DashboardForm({ initial, onClose }: { initial?: CustomDashboard; onClose: () => void }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const save = useSaveCustomDashboard()
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [icon, setIcon] = useState(initial?.icon ?? 'layout-dashboard')
  const [visibility, setVisibility] = useState<'PERSONAL' | 'SHARED'>(initial?.visibility ?? 'PERSONAL')
  const [app, setApp] = useState(initial?.app_key ?? params.get('app') ?? '')
  const [widgets, setWidgets] = useState<Widget[]>(initial?.widgets ?? [])
  const [err, setErr] = useState<string | null>(null)
  const submit = () => {
    if (!name.trim()) { setErr('Fill in the dashboard name.'); return }
    const body: DashboardInput = { name: name.trim(), description: description.trim() || null, icon, visibility, app_key: app || null, widgets }
    save.mutate({ ...body, id: initial?.id }, { onSuccess: (d) => { onClose(); if (!initial) navigate(`/dashboards/${d.id}`) }, onError: (e) => setErr(apiErrorMessage(e)) })
  }
  return (
    <Modal open onClose={onClose} title={initial ? 'Dashboard details' : 'Add New Dashboard'} className="max-w-2xl"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={save.isPending} onClick={submit}>{save.isPending && <Loader2 className="size-4 animate-spin" />}{initial ? 'Save' : 'Create dashboard'}</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="cd-name">Dashboard Name</Label><Input id="cd-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="e.g. Purchasing this week" /></div>
          <div className="space-y-1">
            <Label htmlFor="cd-app">Module (opens from its workspace)</Label>
            <Select id="cd-app" value={app} onChange={(e) => setApp(e.target.value)}>{APPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          </div>
        </div>
        <div className="space-y-1"><Label htmlFor="cd-desc">Description</Label><Textarea id="cd-desc" rows={2} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div className="space-y-1.5">
          <Label>Dashboard Icon</Label>
          <div role="radiogroup" aria-label="Dashboard Icon" className="flex flex-wrap gap-1.5">
            {Object.entries(DASHBOARD_ICONS).map(([k, Icon]) => (
              <button key={k} type="button" role="radio" aria-checked={icon === k} aria-label={k} onClick={() => setIcon(k)}
                className={cn('flex size-9 items-center justify-center rounded-md border transition-colors', icon === k ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
                <Icon className="size-4" />
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Dashboard Visibility</Label>
          <div role="radiogroup" aria-label="Dashboard Visibility" className="grid grid-cols-2 gap-2">
            {([['PERSONAL', 'Personal', 'Only you see it'], ['SHARED', 'Shared', 'Everyone can open it; each sees only data their role allows']] as const).map(([k, l, d]) => (
              <button key={k} type="button" role="radio" aria-checked={visibility === k} onClick={() => setVisibility(k)}
                className={cn('rounded-md border p-2.5 text-left text-sm transition-colors', visibility === k ? 'border-primary bg-primary/5' : 'hover:bg-muted')}>
                <span className="block font-medium">{l}</span><span className="block text-xs text-muted-foreground">{d}</span>
              </button>
            ))}
          </div>
        </div>
        {!initial && (
          <div className="space-y-2 rounded-md border p-3">
            <Label>Widgets <span className="font-normal text-muted-foreground">({widgets.length})</span></Label>
            <WidgetPicker onPick={(w) => setWidgets((ws) => [...ws, w])} />
            {widgets.length > 0 && (
              <ul className="divide-y rounded border text-sm">
                {widgets.map((w) => (
                  <li key={w.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                    <span className="truncate">{widgetTitle(w)}</span>
                    <button type="button" aria-label={`Remove ${widgetTitle(w)}`} className="text-muted-foreground hover:text-destructive" onClick={() => setWidgets((ws) => ws.filter((x) => x.id !== w.id))}><X className="size-4" /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {err && <p className="text-sm text-red-600">{err}</p>}
      </div>
    </Modal>
  )
}

/** Every dashboard of mine and the shared ones; the built-in dashboards stay where they are. */
export function CustomDashboardListPage() {
  const [params, setParams] = useSearchParams()
  const { data, isLoading, isError, error } = useCustomDashboards()
  const del = useDeleteCustomDashboard()
  const [editing, setEditing] = useState<CustomDashboard | null>(null)
  const creating = params.get('new') === '1'
  const close = () => setParams((p) => { p.delete('new'); return p }, { replace: true })
  const remove = async (d: CustomDashboard) => {
    if (await confirmDialog({ title: 'Delete dashboard?', message: `“${d.name}” and its layout are deleted. Its data stays where it is.`, danger: true, confirmLabel: 'Delete' })) del.mutate(d.id, { onError: fail })
  }
  return (
    <div className="space-y-4">
      <PageHeader title="Custom Dashboards" actions={<Button size="sm" onClick={() => setParams({ new: '1' })}><Plus className="size-4" /> Add New Dashboard</Button>} />
      {isLoading && <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />}
      {isError && <p className="text-sm text-red-600">{apiErrorMessage(error)}</p>}
      {data?.length === 0 && (
        <Card className="flex flex-col items-center gap-2 border-dashed py-14 text-center text-muted-foreground">
          <LayoutDashboard className="size-8" /><p>No custom dashboard yet. Make one from the data you already work with.</p>
        </Card>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {data?.map((d) => (
          <article key={d.id} aria-label={d.name} className="flex flex-col gap-3 rounded-md border bg-card p-4">
            <Link to={`/dashboards/${d.id}`} className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><DashboardIcon name={d.icon} className="size-4" /></span>
              <span className="min-w-0 flex-1"><span className="block truncate font-semibold hover:text-primary">{d.name}</span><span className="line-clamp-2 text-xs text-muted-foreground">{d.description ?? `${d.widgets.length} widgets`}</span></span>
            </Link>
            <div className="mt-auto flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">{d.visibility === 'SHARED' ? <Badge variant="default"><Users className="mr-1 size-3" />Shared</Badge> : <Badge variant="neutral">Personal</Badge>}{!d.mine && d.owner && <span>by {d.owner}</span>}</span>
              {d.can_edit && (
                <span className="flex gap-1">
                  <button type="button" aria-label={`Edit ${d.name}`} className="rounded p-1 hover:bg-muted hover:text-foreground" onClick={() => setEditing(d)}><Pencil className="size-3.5" /></button>
                  <button type="button" aria-label={`Delete ${d.name}`} className="rounded p-1 hover:bg-muted hover:text-destructive" onClick={() => void remove(d)}><Trash2 className="size-3.5" /></button>
                </span>
              )}
            </div>
          </article>
        ))}
      </div>
      {creating && <DashboardForm onClose={close} />}
      {editing && <DashboardForm initial={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

/** One widget on the page; while editing: a handle to drag it, its title, size and a remove button. */
function WidgetCard({ widget, editing, onChange, onRemove }: { widget: Widget; editing: boolean; onChange: (w: Widget) => void; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: widget.id, disabled: !editing })
  return (
    <section ref={setNodeRef} aria-label={widgetTitle(widget)} style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined }}
      className={cn('col-span-12 flex flex-col rounded-md border bg-card shadow-[0_1px_2px_rgb(15_23_42/0.04)]', SPAN[widget.w], isDragging && 'shadow-lg ring-2 ring-primary/30')}>
      <header className="flex items-center gap-2 border-b px-3 py-2">
        {editing && <button type="button" aria-label={`Move ${widgetTitle(widget)}`} className="cursor-grab touch-none text-muted-foreground hover:text-foreground" {...attributes} {...listeners}><GripVertical className="size-4" /></button>}
        {editing
          ? <Input className="h-7 min-w-0 flex-1 text-sm" value={widget.title ?? ''} placeholder={widgetTitle({ ...widget, title: null })} aria-label="Widget title" maxLength={80} onChange={(e) => onChange({ ...widget, title: e.target.value })} />
          : <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{widgetTitle(widget)}</h2>}
        {editing && (
          <>
            <Select className="h-7 w-20 text-xs" aria-label="Width" value={widget.w} onChange={(e) => onChange({ ...widget, w: Number(e.target.value) as WidgetWidth })}>{WIDTHS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
            <Select className="h-7 w-24 text-xs" aria-label="Height" value={widget.h} onChange={(e) => onChange({ ...widget, h: Number(e.target.value) as WidgetHeight })}>{HEIGHTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
            <button type="button" aria-label={`Remove ${widgetTitle(widget)}`} className="text-muted-foreground hover:text-destructive" onClick={onRemove}><Trash2 className="size-4" /></button>
          </>
        )}
      </header>
      <div className={cn('min-h-0 overflow-hidden p-3', HEIGHT[widget.h])}><WidgetBody widget={widget} /></div>
    </section>
  )
}

/** A custom dashboard: its widgets in a 12-column grid; its owner edits the layout in place and saves it. */
export function CustomDashboardPage() {
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const { data: d, isLoading, isError, error } = useCustomDashboard(id)
  const save = useSaveCustomDashboard()
  const del = useDeleteCustomDashboard()
  const [draft, setDraft] = useState<Widget[] | null>(null)
  const [details, setDetails] = useState(false)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))

  if (isLoading) return <Loader2 className="mx-auto mt-10 size-6 animate-spin text-muted-foreground" />
  if (isError || !d) return <p className="mt-10 text-center text-sm text-red-600">{apiErrorMessage(error)}</p>

  const editing = draft !== null
  const widgets = draft ?? d.widgets
  const onDragEnd = (e: DragEndEvent) => {
    if (!draft || !e.over || e.active.id === e.over.id) return
    const ids = draft.map((w) => w.id)
    setDraft(arrayMove(draft, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id))))
  }
  const saveLayout = () => save.mutate({ id: d.id, name: d.name, description: d.description, icon: d.icon, visibility: d.visibility, app_key: d.app_key, widgets: draft!.map((w) => ({ ...w, title: w.title?.trim() || null })) }, { onSuccess: () => setDraft(null), onError: fail })
  const remove = async () => {
    if (await confirmDialog({ title: 'Delete dashboard?', message: `“${d.name}” and its layout are deleted.`, danger: true, confirmLabel: 'Delete' })) del.mutate(d.id, { onSuccess: () => navigate('/dashboards'), onError: fail })
  }

  return (
    <div className="space-y-4">
      <BackLink to="/dashboards" label="Custom Dashboards" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><DashboardIcon name={d.icon} className="size-5" /></span>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight">{d.name}</h1>
            <p className="truncate text-[13px] text-muted-foreground">{d.description ?? ''}{d.visibility === 'SHARED' ? ` · Shared${d.mine ? '' : ` by ${d.owner}`}` : ' · Personal'}</p>
          </div>
        </div>
        {d.can_edit && (
          <div className="flex flex-wrap gap-2">
            {editing ? (
              <>
                <Button size="sm" variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
                <Button size="sm" disabled={save.isPending} onClick={saveLayout}>{save.isPending && <Loader2 className="size-4 animate-spin" />}Save layout</Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="outline" className="text-destructive" onClick={() => void remove()}><Trash2 className="size-4" /> Delete</Button>
                <Button size="sm" variant="outline" onClick={() => setDetails(true)}>Details</Button>
                <Button size="sm" onClick={() => setDraft(d.widgets)}><Pencil className="size-4" /> Edit layout</Button>
              </>
            )}
          </div>
        )}
      </div>

      {editing && <Card className="p-3"><WidgetPicker onPick={(w) => setDraft((ws) => [...(ws ?? []), w])} /></Card>}
      {widgets.length === 0 && <Card className="border-dashed py-14 text-center text-sm text-muted-foreground">{d.can_edit ? 'No widget yet: click Edit layout, then add one.' : 'This dashboard has no widget yet.'}</Card>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={widgets.map((w) => w.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-12 gap-4">
            {widgets.map((w) => (
              <WidgetCard key={w.id} widget={w} editing={editing}
                onChange={(n) => setDraft((ws) => (ws ?? []).map((x) => (x.id === n.id ? n : x)))}
                onRemove={() => setDraft((ws) => (ws ?? []).filter((x) => x.id !== w.id))} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {details && <DashboardForm initial={d} onClose={() => setDetails(false)} />}
    </div>
  )
}
