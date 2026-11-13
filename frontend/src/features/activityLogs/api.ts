import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export type ActivityEvent = 'LOGIN' | 'LOGIN_FAILED' | 'LOGOUT' | 'PAGE_VIEW' | 'CREATE' | 'UPDATE' | 'DELETE' | 'ACTION'

export interface ActivityLog {
  id: number
  at: string
  user_id: number | null
  user_name: string | null
  event: ActivityEvent
  module: string | null
  description: string | null
  subject: string | null
  method: string | null
  path: string | null
  route: string | null
  status: number | null
  ip: string | null
  user_agent: string | null
  details: { input?: unknown; files?: number; error?: string | null; errors?: Record<string, string> } | null
}

export interface ActivityLogFilters {
  user_id?: string
  event?: string
  module?: string
  from?: string
  to?: string
  search?: string
  page?: number
}

export interface ActivityLogMeta {
  page: number
  last_page: number
  total: number
  per_page: number
  users: { id: number; name: string; username: string }[]
  modules: string[]
}

export function useActivityLogs(f: ActivityLogFilters) {
  const params = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '' && v !== undefined))
  return useQuery({
    queryKey: ['activity-logs', params],
    queryFn: async () => (await api.get<{ data: ActivityLog[]; meta: ActivityLogMeta }>('/api/activity-logs', { params })).data,
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  })
}
