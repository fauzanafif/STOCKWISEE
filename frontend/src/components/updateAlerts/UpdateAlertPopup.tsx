import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ThumbsUp, X } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { useDueAlerts, useMarkAlertSeen, useThumbsUpAlert, type AlertType } from '@/features/updateAlerts/api'
import { Badge } from '@/components/ui/badge'
import { ALERT_TYPES } from '@/components/updateAlerts/alertTypes'
import { cn } from '@/lib/utils'

/** Plain text: lines starting with "- " read as a list, an empty line as a gap. */
function AlertMessage({ text, bullet }: { text: string; bullet: string }) {
  return (
    <div className="space-y-1.5 text-sm leading-relaxed text-muted-foreground">
      {text.split('\n').map((raw, i) => {
        const line = raw.trim()
        if (!line) return <div key={i} className="h-1" />
        if (!line.startsWith('- ')) return <p key={i} className="break-words">{line}</p>
        return (
          <div key={i} className="flex items-start gap-2">
            <span className={cn('mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full', bullet)}><Check className="size-3" strokeWidth={3} /></span>
            <span className="min-w-0 break-words">{line.slice(2)}</span>
          </div>
        )
      })}
    </div>
  )
}

export interface AlertPopupProps {
  alert: { title: string; message: string; type: AlertType; published_at?: string }
  onClose: () => void
  /** the thumb; a preview has none to record, and it only closes */
  onThumbsUp?: () => void
  /** "2 of 3", when several are waiting */
  position?: { index: number; total: number }
}

/** The popup, in the middle of the screen on every device, above whatever is open. */
export function AlertPopup({ alert, onClose, onThumbsUp, position }: AlertPopupProps) {
  const t = ALERT_TYPES[alert.type]
  const Icon = t.icon
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // the focus goes to the popup, not its button: someone typing in a form can't close it unread with Enter
    box.current?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = overflow }
  }, [])

  useEffect(() => {
    // Escape closes this popup only, not the form that may be open beneath it
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const date = alert.published_at ? new Date(alert.published_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm print:hidden">
      <div ref={box} tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby="sw-alert-title"
        className="sw-card relative w-full max-w-md overflow-hidden rounded-2xl bg-card shadow-2xl outline-none ring-1 ring-black/5">
        <div className={cn('relative h-24 overflow-hidden bg-gradient-to-br', t.band)}>
          <span className="absolute -left-6 -top-10 size-32 rounded-full bg-white/40" />
          <span className="absolute -right-8 top-4 size-36 rounded-full bg-white/30" />
          <span className="absolute left-1/2 top-12 size-20 rounded-full bg-white/25" />
          <button type="button" onClick={onClose} aria-label="Close"
            className="absolute right-2.5 top-2.5 flex size-10 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-white/60 hover:text-slate-900 sm:size-8">
            <X className="size-4" />
          </button>
        </div>

        <div className="relative px-6 pb-5 sm:px-7">
          <div className={cn('sw-pop mx-auto -mt-9 flex size-[72px] items-center justify-center rounded-full border-4 border-card text-white shadow-lg', t.circle)}>
            <Icon className="size-8" strokeWidth={1.75} />
          </div>
          <div className="mt-3 text-center">
            <Badge variant={t.badge} className={t.pill}>{t.label}</Badge>
            <h2 id="sw-alert-title" className="mt-2.5 break-words text-xl font-semibold leading-snug">{alert.title}</h2>
          </div>
          <div className="mt-3 max-h-[42dvh] overflow-y-auto overscroll-contain pr-1">
            <AlertMessage text={alert.message} bullet={t.bullet} />
          </div>

          <button type="button" onClick={onThumbsUp ?? onClose} aria-label="Thumbs up" title="Thumbs up"
            className={cn('mt-5 flex h-11 w-full items-center justify-center rounded-xl text-white shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2', t.button)}>
            <ThumbsUp className="size-6" />
          </button>
          <div className="mt-3 flex min-h-4 items-center justify-center gap-2 text-xs text-muted-foreground">
            {date && <span>{date}</span>}
            {date && position && position.total > 1 && <span aria-hidden>·</span>}
            {position && position.total > 1 && <span>{position.index} of {position.total}</span>}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** Shows what is due for this user, one at a time; gone by itself once it is closed in another tab or switched off. */
export function UpdateAlertHost() {
  const { user } = useAuth()
  const due = useDueAlerts(user?.id)
  const seen = useMarkAlertSeen(user?.id)
  const thumbsUp = useThumbsUpAlert(user?.id)
  // counts up through the alerts of this round: 1 of 3, 2 of 3 …
  const [closed, setClosed] = useState(0)
  const list = due.data?.data ?? []
  const alert = list[0]
  if (!alert) {
    if (closed) setClosed(0)
    return null
  }
  return (
    <AlertPopup key={alert.id} alert={alert} position={{ index: closed + 1, total: closed + list.length }}
      onClose={() => { setClosed(closed + 1); seen.mutate(alert.id) }}
      onThumbsUp={() => { setClosed(closed + 1); thumbsUp.mutate(alert.id) }} />
  )
}
