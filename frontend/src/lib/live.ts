import { useEffect, useRef } from 'react'
import { useQueryClient, type Query } from '@tanstack/react-query'
import { api } from '@/lib/api'

/** what each area of GET /api/live refreshes (query key roots) */
const AREA_KEYS: Record<string, string[]> = {
  request: ['item-requests', 'reminders', 'module-stats', 'dashboard', 'npbg', 'ppb-drafts'],
  important: ['important-requests', 'reminders'],
  purchasing: ['purchase-orders', 'po-draft-lines', 'ppb', 'ppb-drafts', 'item-requests', 'reminders', 'module-stats'],
  notifications: ['notifications'],
  alerts: ['update-alerts'],
}
/** until the server says otherwise (Settings · Auto Refresh) */
const DEFAULT_SECONDS = 15
/** switched off: only look now and then whether it is back on */
const OFF_CHECK_SECONDS = 60

interface LivePayload {
  data: Record<string, string>
  meta?: { refresh?: { enabled: boolean; seconds: number } }
}

/** images / files: never refetched for a change elsewhere */
const isFile = (q: Query) => q.queryKey.some((k) => typeof k === 'string' && (k.endsWith('-file') || k === 'my-profile' || k === 'image'))

/**
 * Updates between accounts in seconds: every few seconds (while the tab is visible) asks /api/live which
 * areas changed, and refetches only the lists / pages of those areas that are on screen. The server sets
 * how often, for every open tab; it handles one request at a time on one HDD.
 */
export function useLiveSync(enabled: boolean) {
  const qc = useQueryClient()
  const last = useRef<Record<string, string> | null>(null)
  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    let wait = DEFAULT_SECONDS
    const tick = async () => {
      if (document.visibilityState === 'visible') {
        try {
          const { data: now, meta } = (await api.get<LivePayload>('/api/live')).data
          const refresh = meta?.refresh
          wait = refresh ? (refresh.enabled ? refresh.seconds : OFF_CHECK_SECONDS) : DEFAULT_SECONDS
          // switched off: no stamps; the last ones stay, so what changed meanwhile refreshes when it is back on
          if (!refresh || refresh.enabled) {
            const before = last.current
            last.current = now
            if (before) {
              const roots = new Set(Object.keys(now).filter((a) => before[a] !== now[a]).flatMap((a) => AREA_KEYS[a] ?? []))
              if (roots.size) qc.invalidateQueries({ predicate: (q) => roots.has(String(q.queryKey[0])) && !isFile(q) })
            }
          }
        } catch { /* offline / signed out: try again next time */ }
      }
      if (!stopped) timer = setTimeout(tick, wait * 1000)
    }
    const onVisible = () => { if (document.visibilityState === 'visible') { clearTimeout(timer); tick() } }
    tick()
    document.addEventListener('visibilitychange', onVisible)
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [enabled, qc])
}
