import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export type AlertType = 'feature' | 'warning' | 'info'
export type AlertMode = 'once' | 'login' | 'interval'
export type AlertStatus = 'active' | 'scheduled' | 'ended' | 'inactive'

/** What the popup shows. */
export interface DueAlert {
  id: number
  title: string
  message: string
  type: AlertType
  published_at: string
}

export interface UpdateAlert extends Omit<DueAlert, 'published_at'> {
  display_mode: AlertMode
  interval_minutes: number | null
  starts_at: string | null
  ends_at: string | null
  is_active: boolean
  status: AlertStatus
  seen_count: number
  /** how many people gave it a thumbs up */
  thumbs_count: number
  created_by: string | null
  created_at: string
}

export type UpdateAlertInput = Pick<UpdateAlert, 'title' | 'message' | 'type' | 'display_mode' | 'interval_minutes' | 'starts_at' | 'ends_at' | 'is_active'>

interface DuePayload { data: DueAlert[]; meta: { next_in: number | null } }

/** without a schedule to wait for, still look now and then */
const AT_LEAST_EVERY = 30 * 60

/**
 * The alerts this user should see now. A new one arrives through /api/live (lib/live.ts: `alerts`);
 * this only wakes when the server says the next one falls due, so an idle tab asks almost nothing.
 */
export function useDueAlerts(userId: number | undefined) {
  return useQuery({
    queryKey: ['update-alerts', 'due', userId],
    enabled: !!userId,
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryFn: async () => (await api.get<DuePayload>('/api/update-alerts/due')).data,
    refetchInterval: (q) => (Math.min(q.state.data?.meta?.next_in ?? AT_LEAST_EVERY, AT_LEAST_EVERY) + 1) * 1000,
  })
}

/** Closed: off the screen at once, then the server's schedule for it counts from now. */
export function useMarkAlertSeen(userId: number | undefined) {
  const qc = useQueryClient()
  const key = ['update-alerts', 'due', userId]
  return useMutation({
    meta: { silent: true },
    mutationFn: async (id: number) => (await api.post(`/api/update-alerts/${id}/seen`)).data,
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: key })
      qc.setQueryData<DuePayload>(key, (d) => (d ? { ...d, data: d.data.filter((a) => a.id !== id) } : d))
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  })
}

/** A thumbs up: off the screen at once like any close, and on the alert's list of who gave one. */
export function useThumbsUpAlert(userId: number | undefined) {
  const qc = useQueryClient()
  const key = ['update-alerts', 'due', userId]
  return useMutation({
    meta: { silent: true },
    mutationFn: async (id: number) => (await api.post(`/api/update-alerts/${id}/thumbs-up`)).data,
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: key })
      qc.setQueryData<DuePayload>(key, (d) => (d ? { ...d, data: d.data.filter((a) => a.id !== id) } : d))
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  })
}

/** Who gave this alert a thumbs up, newest first. Super Admin. */
export function useAlertThumbs(id: number | null) {
  return useQuery({
    queryKey: ['update-alerts', 'thumbs', id],
    enabled: id != null,
    queryFn: async () => (await api.get<{ data: { id: number; name: string; username: string; at: string }[] }>(`/api/update-alerts/${id}/thumbs-up`)).data.data,
  })
}

/** Who closed this alert, the last time each did, and whether with a thumb. Super Admin. */
export function useAlertClosedBy(id: number | null) {
  return useQuery({
    queryKey: ['update-alerts', 'closed-by', id],
    enabled: id != null,
    queryFn: async () => (await api.get<{ data: { id: number; name: string; username: string; at: string; thumbs_up: boolean }[] }>(`/api/update-alerts/${id}/closed-by`)).data.data,
  })
}

export function useUpdateAlerts() {
  return useQuery({
    queryKey: ['update-alerts', 'list'],
    queryFn: async () => (await api.get<{ data: UpdateAlert[] }>('/api/update-alerts')).data.data,
  })
}

export function useUpdateAlertMutations() {
  const qc = useQueryClient()
  const done = () => qc.invalidateQueries({ queryKey: ['update-alerts'] })
  return {
    create: useMutation({
      mutationFn: async (b: UpdateAlertInput) => (await api.post('/api/update-alerts', b)).data,
      meta: { successMessage: 'Alert saved.' }, onSuccess: done,
    }),
    update: useMutation({
      mutationFn: async ({ id, ...b }: Partial<UpdateAlertInput> & { id: number }) => (await api.put(`/api/update-alerts/${id}`, b)).data,
      meta: { successMessage: 'Alert updated.' }, onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: async (id: number) => (await api.delete(`/api/update-alerts/${id}`)).data,
      meta: { successMessage: 'Alert deleted.' }, onSuccess: done,
    }),
  }
}

/** "Every 90 minutes" as the admin reads it: the largest whole unit. */
export function splitInterval(minutes: number): { value: number; unit: number } {
  for (const unit of [1440, 60]) if (minutes % unit === 0) return { value: minutes / unit, unit }
  return { value: minutes, unit: 1 }
}

export function scheduleLabel(a: Pick<UpdateAlert, 'display_mode' | 'interval_minutes'>): string {
  if (a.display_mode === 'once') return 'Once only'
  if (a.display_mode === 'login') return 'Every login'
  const { value, unit } = splitInterval(a.interval_minutes ?? 0)
  const name = unit === 1440 ? 'day' : unit === 60 ? 'hour' : 'minute'
  return value === 1 ? `Every ${name}` : `Every ${value} ${name}s`
}
