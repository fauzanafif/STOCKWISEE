import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface AutoRefresh {
  enabled: boolean
  seconds: number
}

export const MIN_SECONDS = 3
export const MAX_SECONDS = 600

export function useAutoRefresh() {
  return useQuery({
    queryKey: ['auto-refresh'],
    queryFn: async () => (await api.get<{ data: AutoRefresh }>('/api/settings/auto-refresh')).data.data,
  })
}

export function useSaveAutoRefresh() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (b: AutoRefresh) => (await api.put<{ data: AutoRefresh }>('/api/settings/auto-refresh', b)).data.data,
    meta: { successMessage: 'Auto refresh saved.' },
    onSuccess: (saved) => qc.setQueryData(['auto-refresh'], saved),
  })
}
