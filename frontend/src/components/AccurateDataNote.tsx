import { Link } from 'react-router-dom'
import { CloudCog } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { useSyncStatus } from '@/features/sync/api'
import { cn } from '@/lib/utils'

/** When the Sync Agent pulls Accurate data (Task Scheduler on the server) — one place to keep it right. */
export const SYNC_SCHEDULE = '12:10 & 20:40'

/** the status dot of the chip (full class names: Tailwind keeps only what it can read) */
const DOT: Record<string, string> = { SUCCESS: 'bg-emerald-500', PARTIAL: 'bg-amber-500', FAILED: 'bg-red-500', RUNNING: 'bg-primary' }

const LABEL: Record<string, { text: string; tone: string }> = {
  SUCCESS: { text: 'successful', tone: 'text-emerald-600' },
  PARTIAL: { text: 'partial', tone: 'text-amber-600' },
  FAILED: { text: 'failed', tone: 'text-red-600' },
  RUNNING: { text: 'in progress', tone: 'text-primary' },
}

/**
 * One-line "this data comes from Accurate, last updated …" note for the
 * Accurate-mirror pages (NPBG, PPB, PO, RI, Stock Opname). Replaces the
 * per-page "Sync Accurate" buttons: syncing lives on one page only.
 */
export function AccurateDataNote({ className }: { className?: string }) {
  const { hasPermission } = useAuth()
  const canView = hasPermission('sync.accurate.view')
  const { data: sync } = useSyncStatus(canView)
  const s = sync ? LABEL[sync.status] : undefined

  const at = sync ? new Date(sync.finished_at ?? sync.started_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null
  const tip = `Data dari Accurate (hanya-baca), diperbarui otomatis jam ${SYNC_SCHEDULE}${at ? ` · terakhir ${at}${s ? ` (${s.text})` : ''}` : ''}`
  const chip = (
    <>
      <CloudCog className="size-3.5 shrink-0" />
      <span>Accurate{at ? ` · ${at}` : ''}</span>
      {s && <span className={cn('size-1.5 rounded-full', DOT[sync!.status])} aria-label={s.text} />}
    </>
  )
  const cls = cn('inline-flex w-fit items-center gap-1.5 rounded-md border bg-card px-2 py-0.5 text-xs text-muted-foreground', className)
  return canView
    ? <Link to="/sync" title={`${tip} — click to see the sync`} className={cn(cls, 'transition-colors hover:border-primary/40 hover:text-foreground')}>{chip}</Link>
    : <span title={tip} className={cls}>{chip}</span>
}
