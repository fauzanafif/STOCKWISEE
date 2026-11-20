import { useEffect, useSyncExternalStore } from 'react'

/**
 * The name a detail page gives itself in the breadcrumb (Odoo shows the record: "Purchase Request / PPB-001"),
 * instead of the generic "Detail". Set by the page while it is open, cleared when it leaves.
 */
let title: { path: string; label: string } | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function useSetCrumbTitle(label: string | null | undefined): void {
  useEffect(() => {
    if (!label) return
    const path = window.location.pathname
    title = { path, label }
    emit()
    return () => {
      if (title?.path === path) {
        title = null
        emit()
      }
    }
  }, [label])
}

export function useCrumbTitle(pathname: string): string | null {
  const t = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => title)
  return t && t.path === pathname ? t.label : null
}
