import { toast as sonner, type ExternalToast } from 'sonner'
import { X } from 'lucide-react'
import { AxiosError } from 'axios'
import { cn } from '@/lib/utils'

/**
 * The app's popups: one card with an emoticon that says how it went, the reason under it.
 * success 😊👍 · invalid (not as required, a 4xx answer) 😆 · fail (server / connection) 😢 · info 💡
 * A drop-in for sonner's `toast` (success / error / info / warning / message), plus `invalid`.
 */
type Kind = 'success' | 'invalid' | 'fail' | 'info'

const LOOK: Record<Kind, { emoji: string; sub?: string; title: string; card: string; badge: string; bar: string; anim: string }> = {
  success: { emoji: '😊', sub: '👍', title: 'Success!', card: 'before:bg-emerald-500', badge: 'bg-emerald-50', bar: 'bg-emerald-500/60', anim: 'sw-pop' },
  invalid: { emoji: '😆', title: 'Oops, not right yet', card: 'before:bg-amber-500', badge: 'bg-amber-50', bar: 'bg-amber-500/60', anim: 'sw-wobble' },
  fail: { emoji: '😢', title: 'Failed', card: 'before:bg-rose-500', badge: 'bg-rose-50', bar: 'bg-rose-500/60', anim: 'sw-sink' },
  info: { emoji: '💡', title: 'Info', card: 'before:bg-sky-500', badge: 'bg-sky-50', bar: 'bg-sky-500/60', anim: 'sw-pop' },
}

const DURATION: Record<Kind, number> = { success: 3500, invalid: 6500, fail: 7000, info: 5000 }

function Card({ id, kind, message, title, duration }: { id: string | number; kind: Kind; message: React.ReactNode; title?: string; duration: number }) {
  const look = LOOK[kind]
  // a list of reasons ("• a\n• b") shows as points
  const lines = typeof message === 'string' ? message.split('\n').map((l) => l.replace(/^•\s*/, '').trim()).filter(Boolean) : null
  return (
    <div role={kind === 'fail' || kind === 'invalid' ? 'alert' : 'status'}
      className={cn('sw-card relative w-[min(92vw,22rem)] overflow-hidden rounded-xl border bg-card py-3 pl-4 pr-9 shadow-lg before:absolute before:inset-y-0 before:left-0 before:w-1', look.card)}>
      <div className="flex items-start gap-3">
        <span className={cn('relative flex size-9 shrink-0 select-none items-center justify-center rounded-lg text-lg leading-none', look.badge, look.anim)} aria-hidden="true">
          {look.emoji}
          {look.sub && <span className="sw-thumb absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full bg-white text-[10px] shadow ring-1 ring-black/5">{look.sub}</span>}
        </span>
        <div className="min-w-0 pt-0.5">
          <div className="text-sm font-semibold text-foreground">{title ?? look.title}</div>
          {lines ? (
            lines.length > 1 ? (
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-muted-foreground">{lines.map((l, i) => <li key={i} className="break-words">{l}</li>)}</ul>
            ) : <p className="mt-0.5 break-words text-sm text-muted-foreground">{lines[0]}</p>
          ) : <div className="mt-0.5 text-sm text-muted-foreground">{message}</div>}
        </div>
      </div>
      <button type="button" aria-label="Close" onClick={() => sonner.dismiss(id)}
        className="absolute right-2 top-2 rounded-full p-1 text-muted-foreground hover:bg-black/5 hover:text-foreground"><X className="size-4" /></button>
      {/* how long it stays */}
      <span className={cn('sw-timer absolute bottom-0 left-0 h-0.5 w-full origin-left', look.bar)} style={{ animationDuration: `${duration}ms` }} />
    </div>
  )
}

function show(kind: Kind, message: React.ReactNode, opts?: ExternalToast & { title?: string }) {
  const duration = opts?.duration ?? DURATION[kind]
  return sonner.custom((id) => <Card id={id} kind={kind} message={message} title={opts?.title} duration={duration} />, { ...opts, duration, unstyled: true })
}

/** 4xx (a rule not met: validation, not allowed, not found) → invalid; the rest (5xx, no connection) → fail */
export function errorKind(error: unknown): Kind {
  if (error instanceof AxiosError) {
    const s = error.response?.status
    return s && s >= 400 && s < 500 ? 'invalid' : 'fail'
  }
  return 'fail'
}

type Msg = React.ReactNode
type Opts = ExternalToast & { title?: string }

export const toast = Object.assign((message: Msg, opts?: Opts) => show('info', message, opts), {
  success: (message: Msg, opts?: Opts) => show('success', message, opts),
  /** not as required (validation): 😆 */
  invalid: (message: Msg, opts?: Opts) => show('invalid', message, opts),
  /** it failed: 😢 */
  error: (message: Msg, opts?: Opts) => show('fail', message, opts),
  warning: (message: Msg, opts?: Opts) => show('invalid', message, opts),
  info: (message: Msg, opts?: Opts) => show('info', message, opts),
  message: (message: Msg, opts?: Opts) => show('info', message, opts),
  /** an API error: invalid or fail by its status */
  fromError: (error: unknown, message: Msg, opts?: Opts) => show(errorKind(error), message, opts),
  dismiss: sonner.dismiss,
})

/** A form rule not met: the reason under the form and as a popup (😆). */
export function invalidTo(set: (message: string | null) => void, message: string) {
  set(message)
  toast.invalid(message)
}
