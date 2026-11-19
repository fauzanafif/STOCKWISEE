import { useAuth } from '@/auth/AuthContext'
import { APPROVAL_PERMISSIONS, useApprovalCount } from '@/features/itemRequests/api'
import { useIrSummary } from '@/features/importantRequests/api'
import { GRAPH_BUCKETS, useReminders, type ReminderGraph, type ReminderModule } from '@/features/reminders/api'
import type { NavChild, NavItem } from '@/lib/navigation'

/** the menus whose "perlu dikerjakan" count (the to-do of the app dashboard) shows next to them, by label */
const MODULE_OF: Record<string, ReminderModule> = { 'Item Request': 'request', 'Purchase Request': 'ppb', 'Purchase Order': 'po', Receipt: 'ri', 'Physical Inventory': 'opname' }
/** an app dashboard: the to-do of all its modules */
const HOME_MODULES: Record<string, ReminderModule[]> = { '/inventory': ['request', 'ri', 'opname'], '/purchase': ['ppb', 'po'] }

/** The to-do count of a menu entry: the sidebar and the Apps home read the same numbers. */
export function useNavCounts() {
  const { hasPermission } = useAuth()
  const approvals = useApprovalCount(APPROVAL_PERMISSIONS.some((p) => hasPermission(p)))
  // Important Request: tasks to confirm / revise and results to review (what needs my action)
  const important = useIrSummary(hasPermission('important_request.access'))
  const badges = { approvals: approvals.data ?? 0, important: important.data?.badge ?? 0 }
  // "perlu dikerjakan" of each module (same numbers as the dashboards)
  const reminders = useReminders(undefined, true)
  const moduleCount = (mods: ReminderModule[]) => (reminders.data?.data ?? []).filter((r) => r.modules.some((m) => mods.includes(m))).reduce((n, r) => n + r.count, 0)
  const countOf = (i: NavItem | NavChild): number => {
    if (i.badge) return badges[i.badge]
    if (MODULE_OF[i.label]) return moduleCount([MODULE_OF[i.label]])
    if (HOME_MODULES[i.to]) return moduleCount(HOME_MODULES[i.to])
    return 'children' in i && i.children ? i.children.reduce((t, c) => t + countOf(c), 0) : 0
  }
  return countOf
}

/** What an overview card shows of its module: the bars by date and the late / urgent counts (Odoo's Inventory Overview). */
export interface CardStats { graph: ReminderGraph; late: number; urgent: number }

/** The card stats of a menu entry by its label, or undefined when it has no module of its own. */
export function useCardStats() {
  const reminders = useReminders(undefined, true)
  return (label: string): CardStats | undefined => {
    const mod = MODULE_OF[label]
    if (!mod || !reminders.data) return undefined
    const rows = reminders.data.data.filter((r) => r.modules.includes(mod))
    const graph = Object.fromEntries(GRAPH_BUCKETS.map((b) => [b, rows.reduce((n, r) => n + (r.graph?.[b] ?? 0), 0)])) as ReminderGraph
    return { graph, late: rows.reduce((n, r) => n + r.overdue, 0), urgent: rows.reduce((n, r) => n + r.urgent, 0) }
  }
}
