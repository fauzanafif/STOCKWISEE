import { useAuth } from '@/auth/AuthContext'
import { APPROVAL_PERMISSIONS, useApprovalCount } from '@/features/itemRequests/api'
import { useIrSummary } from '@/features/importantRequests/api'
import { useReminders, type ReminderModule } from '@/features/reminders/api'
import type { NavChild, NavItem } from '@/lib/navigation'

/** the menus whose "perlu dikerjakan" count (the to-do of the app dashboard) shows next to them, by label */
const MODULE_OF: Record<string, ReminderModule> = { 'Item Request': 'request', 'Purchase Request': 'ppb', 'Purchase Order': 'po', Receipt: 'ri' }
/** an app dashboard: the to-do of all its modules */
const HOME_MODULES: Record<string, ReminderModule[]> = { '/inventory': ['request', 'ri'], '/purchase': ['ppb', 'po'] }

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
