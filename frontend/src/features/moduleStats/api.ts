import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { ReminderModule } from '@/features/reminders/api'

export type Tone = 'amber' | 'blue' | 'violet' | 'indigo' | 'emerald' | 'slate' | 'orange' | 'teal' | 'red'

/** A menu's Dashboard analytics (GET /api/module-stats/{module}). */
export interface ModuleStats {
  kpis: { key: string; label: string; value: number; format?: 'rupiah'; tone?: Tone; to?: string }[]
  trend: { label: string; points: { date: string; value: number }[] }
  status: { key: string; label: string; value: number; tone: Tone }[]
  status_label?: string
  top: { label: string; unit: 'qty' | 'rupiah' | 'tugas'; rows: { name: string; sub: string | null; value: number }[] }
}

export function useModuleStats(module: ReminderModule) {
  return useQuery({
    queryKey: ['module-stats', module],
    queryFn: async () => (await api.get<{ data: ModuleStats }>(`/api/module-stats/${module}`)).data.data,
    refetchInterval: 120_000,
  })
}

/** The user's own setting (on the server: the same on every device). */
export function usePreference<T>(key: string) {
  return useQuery({
    queryKey: ['preference', key],
    queryFn: async () => (await api.get<{ data: T | null }>(`/api/preferences/${key}`)).data.data,
    staleTime: Infinity,
  })
}

export function useSavePreference<T>(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (value: T | null) => (await api.put<{ data: T | null }>(`/api/preferences/${key}`, { value })).data.data,
    onSuccess: (v) => qc.setQueryData(['preference', key], v),
  })
}
