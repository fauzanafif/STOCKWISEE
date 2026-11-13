import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { BackLink } from '@/components/BackLink'

/**
 * The one layout of a document's detail page (PO, PPB, RI, NPBG …):
 *   header   — kind, number, status, the actions this user may take now
 *   main     — what has to be done (workflow) and the document's content
 *   aside    — details, activity and sync: read, not worked in
 * On a phone the aside drops under the main column.
 * With a `chatter`, the right column is the Chatter alone: the aside's details move into the left column
 * (under the content) so the document stays the focus.
 */
export function DocPage({ back, kind, number, status, subtitle, actions, children, aside, chatter }: {
  back: { to: string; label: string }
  /** e.g. "Purchase Order" */
  kind: string
  number: ReactNode
  status?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
  aside?: ReactNode
  /** the document's Chatter: a panel on the right (desktop), under the document on a small screen */
  chatter?: ReactNode
}) {
  return (
    <div className="space-y-4">
      <BackLink to={back.to} label={back.label} />
      <header className="flex flex-col gap-3 border-b pb-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="text-xs font-medium text-muted-foreground">{kind}</div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h1 className="break-all font-mono text-xl font-semibold tracking-tight sm:text-2xl">{number}</h1>
            {status && <div className="flex flex-wrap items-center gap-1.5">{status}</div>}
          </div>
          {subtitle && <div className="text-sm text-muted-foreground">{subtitle}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {chatter ? (
        <ChatterLayout chatter={chatter}>
          {children}
          {aside && <div className="grid items-start gap-4 md:grid-cols-2 md:[&>p]:col-span-2">{aside}</div>}
        </ChatterLayout>
      ) : (
        <div className={cn('grid items-start gap-4', aside && 'lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]')}>
          <div className="min-w-0 space-y-4">{children}</div>
          {aside && <aside className="min-w-0 space-y-4 lg:sticky lg:top-20">{aside}</aside>}
        </div>
      )}
    </div>
  )
}

/**
 * The document on the left, its Chatter as a narrow panel on the right (300–340 px, follows the scroll).
 * Under `lg` the Chatter drops below the document.
 */
export function ChatterLayout({ chatter, children, className }: { chatter: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_340px]', className)}>
      <div className="min-w-0 space-y-4">{children}</div>
      <aside className="min-w-0 lg:sticky lg:top-20">{chatter}</aside>
    </div>
  )
}

/** A titled block of the document (main column or aside). */
export function DocSection({ title, count, actions, children, className, bodyClassName, flush }: {
  title: ReactNode
  count?: number
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  /** the body has no padding (a table that runs edge to edge) */
  flush?: boolean
}) {
  return (
    <section className={cn('overflow-hidden rounded-lg border bg-card', className)} data-pdf-block>
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">
          {title}
          {count != null && <span className="ml-1.5 font-normal text-muted-foreground">{count}</span>}
        </h2>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <div className={cn(!flush && 'p-4', 'text-sm', bodyClassName)}>{children}</div>
    </section>
  )
}

/** Label / value pairs in the aside: one per row, label left, value right. */
export function MetaList({ items }: { items: { label: string; value: ReactNode; hidden?: boolean }[] }) {
  return (
    <dl className="divide-y">
      {items.filter((i) => !i.hidden).map((i) => (
        <div key={i.label} className="flex items-start justify-between gap-4 py-2 first:pt-0 last:pb-0">
          <dt className="shrink-0 text-muted-foreground">{i.label}</dt>
          <dd className="min-w-0 break-words text-right">{i.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Label over value, in a grid (main column). */
export function FieldGrid({ items, cols = 3 }: { items: { label: string; value: ReactNode; wide?: boolean; hidden?: boolean }[]; cols?: 2 | 3 }) {
  return (
    <dl className={cn('grid grid-cols-2 gap-x-6 gap-y-3', cols === 3 && 'sm:grid-cols-3')}>
      {items.filter((i) => !i.hidden).map((i) => (
        <div key={i.label} className={cn('min-w-0', i.wide && 'col-span-2 sm:col-span-full')}>
          <dt className="text-xs text-muted-foreground">{i.label}</dt>
          <dd className="mt-0.5 break-words">{i.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

export type ActivityItem = { id: number | string; label: string; who?: string | null; at?: string | null; note?: string | null; tone?: 'ok' | 'wait' | 'warn' | 'bad' | 'info' }
const DOT = { ok: 'bg-emerald-500', wait: 'bg-amber-500', warn: 'bg-orange-500', bad: 'bg-red-500', info: 'bg-sky-500' }

/** The document's history, newest last: who did what, when, and why. */
export function Activity({ items, empty = 'No activity yet.' }: { items: ActivityItem[]; empty?: string }) {
  if (items.length === 0) return <p className="text-muted-foreground">{empty}</p>
  return (
    <ol className="relative space-y-3 border-l pl-4">
      {items.map((l) => (
        <li key={l.id} className="relative">
          <span className={cn('absolute -left-[1.32rem] top-1.5 size-2.5 rounded-full ring-2 ring-card', DOT[l.tone ?? 'info'])} />
          <div className="font-medium leading-snug">{l.label}</div>
          {(l.who || l.at) && (
            <div className="text-xs text-muted-foreground">
              {[l.who, l.at ? new Date(l.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : null].filter(Boolean).join(' · ')}
            </div>
          )}
          {l.note && <div className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">{l.note}</div>}
        </li>
      ))}
    </ol>
  )
}

/** "Data dari Accurate, sync terakhir …": the aside's last line. */
export function SyncNote({ at, manual }: { at?: string | null; manual?: boolean }) {
  if (manual) return null
  if (!at) return null
  return <p className="px-1 text-xs text-muted-foreground">Data from Accurate · last sync {new Date(at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</p>
}

/** The workflow step that needs someone: a card with a colored edge, its message and its buttons. */
export const TONE_EDGE = {
  wait: '',
  ok: '',
  warn: '',
  bad: '',
  info: '',
} as const
