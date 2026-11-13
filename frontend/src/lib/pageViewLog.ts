import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '@/lib/api'
import { crumbsFor } from '@/lib/navigation'

/** "Purchase Order › RFQ" plus the tab, e.g. "Item Request (tab: proses)" */
function titleOf(pathname: string, search: string): string {
  const name = crumbsFor(pathname).map((c) => c.label).join(' › ') || pathname
  const tab = new URLSearchParams(search).get('tab')
  return tab ? `${name} (tab: ${tab})` : name
}

/** User Log: every page and tab opened is written to the activity log (a lost write is ignored). */
export function usePageViewLog() {
  const { pathname, search } = useLocation()
  const last = useRef('')
  useEffect(() => {
    const path = pathname + search
    if (path === last.current) return
    const t = setTimeout(() => {
      last.current = path
      api.post('/api/activity/page-view', { path: path.slice(0, 255), title: titleOf(pathname, search).slice(0, 160) }).catch(() => {})
    }, 600)
    return () => clearTimeout(t)
  }, [pathname, search])
}
