import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export type WidgetType = 'kpi' | 'line' | 'bar' | 'pie' | 'table' | 'list'
export type WidgetWidth = 3 | 4 | 6 | 8 | 12
export type WidgetHeight = 1 | 2 | 3

/** One widget: a source (an API STOCKWISE has), how it shows, its title and size, in page order. */
export interface Widget {
  id: string
  type: WidgetType
  source: string
  title?: string | null
  w: WidgetWidth
  h: WidgetHeight
}

export interface CustomDashboard {
  id: number
  name: string
  description: string | null
  icon: string
  visibility: 'PERSONAL' | 'SHARED'
  app_key: string | null
  widgets: Widget[]
  owner: string | null
  mine: boolean
  can_edit: boolean
  updated_at: string | null
}

export type DashboardInput = Pick<CustomDashboard, 'name' | 'description' | 'icon' | 'visibility' | 'app_key' | 'widgets'>

const KEY = ['custom-dashboards']

export function useCustomDashboards(app?: string) {
  return useQuery({
    queryKey: [...KEY, 'list', app ?? ''],
    queryFn: async () => (await api.get<{ data: CustomDashboard[] }>('/api/custom-dashboards', { params: { app: app || undefined } })).data.data,
  })
}

export function useCustomDashboard(id: number) {
  return useQuery({ queryKey: [...KEY, id], queryFn: async () => (await api.get<{ data: CustomDashboard }>(`/api/custom-dashboards/${id}`)).data.data })
}

export function useSaveCustomDashboard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }: DashboardInput & { id?: number }) => (id
      ? await api.put<{ data: CustomDashboard }>(`/api/custom-dashboards/${id}`, body)
      : await api.post<{ data: CustomDashboard }>('/api/custom-dashboards', body)).data.data,
    meta: { successMessage: 'Dashboard saved.' },
    onSuccess: (d) => { qc.setQueryData([...KEY, d.id], d); void qc.invalidateQueries({ queryKey: [...KEY, 'list'] }) },
  })
}

export function useDeleteCustomDashboard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => (await api.delete(`/api/custom-dashboards/${id}`)).data,
    meta: { successMessage: 'Dashboard deleted.' },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}
