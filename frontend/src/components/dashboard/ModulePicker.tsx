import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ClipboardPen, Factory, Handshake, LayoutGrid, ShoppingCart, Warehouse, type LucideIcon } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import type { ReminderModule } from '@/features/reminders/api'
import { cn } from '@/lib/utils'

export type DashboardModule = 'all' | 'inventory' | 'purchase' | 'manufacturing' | 'tracking' | 'important'

/** the analytics sections (AnalyticsPage ids) */
export type AnalyticsSection = 'stok' | 'pengadaan' | 'tracking' | 'kartu-stock'

/**
 * The apps the one Dashboard shows on their own: their Overview (cards per feature), their To-Do cards (by the
 * reminder's module) and their analyses. The apps have no dashboard of their own any more: their icons open
 * their work, and every dashboard is here.
 */
export const DASHBOARD_MODULES: { key: Exclude<DashboardModule, 'all'>; label: string; icon: LucideIcon; reminders: ReminderModule[]; analytics: AnalyticsSection[]; overview: boolean; permissions: string[] }[] = [
  { key: 'inventory', label: 'Inventory', icon: Warehouse, reminders: ['request', 'ppb', 'ri', 'opname'], analytics: ['stok', 'kartu-stock'], overview: true,
    permissions: ['item.view', 'inventory.view', 'item_request.view', 'item_request.create', 'ppb.view', 'ri.view', 'opname.view'] },
  { key: 'purchase', label: 'Purchase', icon: ShoppingCart, reminders: ['po'], analytics: ['pengadaan'], overview: true, permissions: ['po.view', 'rfq.view'] },
  { key: 'manufacturing', label: 'Manufacturing', icon: Factory, reminders: [], analytics: [], overview: true, permissions: ['mrp.view', 'disassembly.view'] },
  { key: 'tracking', label: 'Tracking', icon: Handshake, reminders: [], analytics: ['tracking'], overview: true, permissions: ['lend.view', 'borrow.view', 'stpp.view', 'tyre.view', 'maintenance.view', 'used_return.view'] },
  { key: 'important', label: 'Important Request', icon: ClipboardPen, reminders: ['important'], analytics: [], overview: true, permissions: ['important_request.access'] },
]

const KEY = 'sw.dashboard.module'

/** The module chosen on the Dashboard (?module=, remembered between To-Do and Analytics). */
export function useDashboardModule(): [DashboardModule, (m: DashboardModule) => void] {
  const [params, setParams] = useSearchParams()
  const asked = params.get('module') as DashboardModule | null
  const valid = (m: string | null): m is DashboardModule => m === 'all' || DASHBOARD_MODULES.some((d) => d.key === m)
  let remembered: string | null = null
  try { remembered = localStorage.getItem(KEY) } catch { /* private mode */ }
  const current: DashboardModule = valid(asked) ? asked : valid(remembered) ? remembered : 'all'
  // carry the remembered choice into the address, so a shared link shows the same
  useEffect(() => {
    if (!asked && current !== 'all') setParams((p) => { const n = new URLSearchParams(p); n.set('module', current); return n }, { replace: true })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (m: DashboardModule) => {
    try { localStorage.setItem(KEY, m) } catch { /* private mode */ }
    setParams((p) => { const n = new URLSearchParams(p); if (m === 'all') n.delete('module'); else n.set('module', m); return n }, { replace: true })
  }
  return [current, set]
}

/** A row of buttons: All, then each app the user may open that has something on this page. */
export function ModulePicker({ value, onChange, has, counts }: {
  value: DashboardModule
  onChange: (m: DashboardModule) => void
  /** whether the app has anything on this page (cards / sections) */
  has: (m: (typeof DASHBOARD_MODULES)[number]) => boolean
  counts?: Partial<Record<DashboardModule, number>>
}) {
  const { hasPermission } = useAuth()
  const shown = DASHBOARD_MODULES.filter((m) => m.permissions.some(hasPermission) && has(m))
  if (shown.length === 0) return null
  const all = [{ key: 'all' as const, label: 'All', icon: LayoutGrid }, ...shown]
  return (
    <div role="tablist" aria-label="Module" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 print:hidden">
      {all.map((m) => {
        const on = value === m.key
        const n = counts?.[m.key]
        return (
          <button key={m.key} type="button" role="tab" aria-selected={on} onClick={() => onChange(m.key)}
            className={cn('inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition-colors',
              on ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground')}>
            <m.icon className="size-4" />{m.label}
            {n != null && n > 0 && <span className={cn('rounded-full px-1.5 text-[11px] leading-[18px] tabular-nums', on ? 'bg-white/25' : 'bg-muted text-foreground')}>{n > 99 ? '99+' : n}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** The same choice as one compact dropdown ("Module: All ▾"): fewer things on the page. */
export function ModuleSelect({ value, onChange, has, counts }: {
  value: DashboardModule
  onChange: (m: DashboardModule) => void
  has: (m: (typeof DASHBOARD_MODULES)[number]) => boolean
  counts?: Partial<Record<DashboardModule, number>>
}) {
  const { hasPermission } = useAuth()
  const shown = DASHBOARD_MODULES.filter((m) => m.permissions.some(hasPermission) && has(m))
  if (shown.length === 0) return null
  const label = (key: DashboardModule, name: string) => (counts?.[key] ? `${name} (${counts[key]! > 99 ? '99+' : counts[key]})` : name)
  // a module the page has nothing of (chosen on another page) still shows as chosen
  const current = value !== 'all' && !shown.some((m) => m.key === value) ? DASHBOARD_MODULES.find((m) => m.key === value) : undefined
  return (
    <label className="inline-flex items-center gap-2 text-[13px] text-muted-foreground print:hidden">
      <span className="font-medium">Module</span>
      <select value={value} onChange={(e) => onChange(e.target.value as DashboardModule)} aria-label="Module"
        className="h-9 rounded-md border bg-card px-2.5 pr-8 text-[13px] font-medium text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40">
        <option value="all">{label('all', 'All modules')}</option>
        {current && <option value={current.key}>{current.label}</option>}
        {shown.map((m) => <option key={m.key} value={m.key}>{label(m.key, m.label)}</option>)}
      </select>
    </label>
  )
}
