import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

/** A module's Dashboard (Request Barang, PPB, PO, RI, Important Request): what waits for this user. */
export type ReminderModule = 'important' | 'request' | 'ppb' | 'po' | 'ri'

/** overdue: past due / waiting longer than its SLA · urgent: marked urgent · soon: due within a day */
export type ReminderPriority = 'overdue' | 'urgent' | 'soon' | 'normal'

/** One waiting document, a link to it. */
export interface ReminderItem {
  label: string
  sub: string | null
  to: string
  since: string | null
  age_days: number | null
  due: string | null
  late: boolean
  urgent: boolean
  soon: boolean
}

export interface Reminder {
  key: string
  modules: ReminderModule[]
  count: number
  /** "barang siap di-PO (PPB sudah disetujui)" — shown after the count */
  text: string
  to: string
  tone: 'blue' | 'amber' | 'orange' | 'indigo' | 'emerald' | 'teal'
  /** days a document may wait before it counts as late */
  sla_days: number
  overdue: number
  urgent: number
  soon: number
  priority: ReminderPriority
  oldest_days: number | null
  next_due: string | null
  /** the most pressing first (at most 5) */
  items: ReminderItem[]
}

export interface ReminderMeta { total: number; overdue: number; urgent: number; soon: number }

export function useReminders(module?: ReminderModule, enabled = true) {
  return useQuery({
    enabled,
    queryKey: ['reminders', module ?? 'all'],
    queryFn: async () => (await api.get<{ data: Reminder[]; meta: ReminderMeta }>('/api/reminders', { params: { module } })).data,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
}
