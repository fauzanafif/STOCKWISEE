import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronDown, ClipboardCheck } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { useReminders, type Reminder, type ReminderItem, type ReminderModule } from '@/features/reminders/api'
import { toast } from '@/lib/notify'
import { cn } from '@/lib/utils'

const num = (n: number) => n.toLocaleString('id-ID')
const DAY = 86_400_000

/** "lewat 2 hari" / "hari ini 17:00" / "besok" / "3 hari lagi" */
function dueText(iso: string): string {
  const d = new Date(iso)
  const dateOnly = d.getHours() === 0 && d.getMinutes() === 0
  const end = dateOnly ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59) : d
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - today.getTime()) / DAY)
  const time = dateOnly ? '' : ` ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
  if (end.getTime() < Date.now()) return days >= 0 ? `lewat${time ? ` (${time.trim()})` : ''}` : `${-days} days overdue`
  if (days === 0) return `today${time}`
  if (days === 1) return `besok${time}`
  return `in ${days} days`
}
const ageText = (d: number | null) => (d === null ? '' : d === 0 ? 'today' : `${d} days waiting`)

type Filter = 'all' | 'overdue' | 'urgent' | 'soon'
const keep = (f: Filter) => (r: Reminder) => f === 'all' || (f === 'overdue' ? r.overdue > 0 : f === 'urgent' ? r.urgent > 0 : r.soon > 0)
const keepItem = (f: Filter) => (i: ReminderItem) => f === 'all' || (f === 'overdue' ? i.late : f === 'urgent' ? i.urgent : i.soon)

/** One waiting document: what, when, a direct link. */
function ItemRow({ i }: { i: ReminderItem }) {
  const when = i.due ? dueText(i.due) : ageText(i.age_days)
  return (
    <li>
      <Link to={i.to} className="flex items-baseline gap-3 py-1.5 pl-3 pr-1 hover:bg-muted/60 max-md:py-2.5">
        <span className="min-w-0 flex-1 truncate text-[13px]">{i.label}{i.sub && <span className="text-muted-foreground"> · {i.sub}</span>}</span>
        <span className={cn('shrink-0 text-xs tabular-nums', i.late ? 'font-medium text-red-700' : 'text-muted-foreground')}>{i.urgent ? 'urgent · ' : ''}{when}</span>
      </Link>
    </li>
  )
}

/** One kind of work: how many, how pressing; its documents unfold under it. */
function ReminderRow({ r, filter }: { r: Reminder; filter: Filter }) {
  const [open, setOpen] = useState(false)
  const items = r.items.filter(keepItem(filter))
  const pressing = [r.overdue > 0 && `${r.overdue} terlambat`, r.urgent > 0 && `${r.urgent} urgent`, r.soon > 0 && `${r.soon} jatuh tempo`].filter(Boolean).join(' · ')
  return (
    <li>
      <div className="flex items-center gap-2">
        <Link to={r.to} className="flex min-w-0 flex-1 items-baseline gap-3 py-2 hover:text-primary max-md:py-3">
          <span className={cn('w-9 shrink-0 rounded-md py-0.5 text-center text-xs font-semibold tabular-nums', r.overdue > 0 ? 'bg-red-50 text-red-700' : r.urgent > 0 ? 'bg-orange-50 text-orange-700' : r.soon > 0 ? 'bg-amber-50 text-amber-800' : 'bg-blue-50 text-blue-700')}>{r.count > 999 ? '999+' : num(r.count)}</span>
          <span className="min-w-0 flex-1 text-[13px]">{r.text.charAt(0).toUpperCase() + r.text.slice(1)}</span>
          {pressing && <span className={cn('shrink-0 text-xs', r.overdue > 0 ? 'font-medium text-red-700' : 'text-muted-foreground')}>{pressing}</span>}
        </Link>
        {items.length > 0 && (
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? 'Hide documents' : 'Show documents'}
            className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted max-md:size-10">
            <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
          </button>
        )}
      </div>
      {open && (
        <div className="pb-2 pl-8">
          <ul className="divide-y border-l">{items.map((i, n) => <ItemRow key={`${i.to}-${n}`} i={i} />)}</ul>
          {r.count > items.length && <Link to={r.to} className="block pl-3 pt-1.5 text-xs text-primary hover:underline">View all {num(r.count)}</Link>}
        </div>
      )}
    </li>
  )
}

/** "Perlu dikerjakan": one line per kind of work, the most pressing first. */
export function ReminderList({ module, emptyText, exclude }: { module?: ReminderModule; emptyText?: string; exclude?: string[] }) {
  const { data, isLoading } = useReminders(module)
  const [filter, setFilter] = useState<Filter>('all')
  if (isLoading) return <div className="h-24 animate-pulse rounded bg-muted/50" aria-busy="true" aria-label="Loading" />
  const list = (data?.data ?? []).filter((r) => !exclude?.includes(r.key))
  const meta = data?.meta
  if (list.length === 0 && exclude) return null
  if (list.length === 0) return <p className="border-t py-3 text-[13px] text-muted-foreground">{emptyText ?? 'Nothing to do right now.'}</p>
  const tabs: { key: Filter; label: string; n: number }[] = [
    { key: 'all', label: 'All', n: meta?.total ?? 0 },
    { key: 'overdue', label: 'Late', n: meta?.overdue ?? 0 },
    { key: 'urgent', label: 'Urgent', n: meta?.urgent ?? 0 },
    { key: 'soon', label: 'Due', n: meta?.soon ?? 0 },
  ]
  // the counts are of the whole list: with some left out they would not add up
  const shownTabs = exclude ? [] : tabs.filter((t) => t.key === 'all' || t.n > 0)
  return (
    <div>
      {shownTabs.length > 1 && (
        <div className="flex flex-wrap gap-3 pb-1.5" role="tablist" aria-label="Filter reminders">
          {shownTabs.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={filter === t.key} onClick={() => setFilter(t.key)}
              className={cn('py-0.5 text-xs max-md:py-2', filter === t.key ? 'font-medium text-primary underline underline-offset-4' : 'text-muted-foreground hover:text-foreground')}>
              {t.label} {num(t.n)}
            </button>
          ))}
        </div>
      )}
      <ul className="divide-y border-t">{list.filter(keep(filter)).map((r) => <ReminderRow key={r.key} r={r} filter={filter} />)}</ul>
    </div>
  )
}

/** The header's "Pengingat" button: a number, red when something is late; opens the list in a panel. */
export function ReminderButton() {
  const { data } = useReminders()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const total = data?.meta.total ?? 0
  const late = data?.meta.overdue ?? 0
  const list = data?.data ?? []
  return (
    <div className="relative" ref={box}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`Reminder: ${total} to do${late ? `, ${late} late` : ''}`} title="Reminders"
        className="flex h-10 items-center gap-1 rounded px-2 text-muted-foreground hover:bg-muted hover:text-foreground lg:h-8">
        <ClipboardCheck className="size-4" />
        {total > 0 && <span className={cn('text-xs font-medium tabular-nums', late > 0 && 'text-red-700')}>{total > 99 ? '99+' : total}</span>}
      </button>
      {open && (
        <div className="fixed inset-x-2 top-14 z-50 overflow-hidden rounded border bg-card shadow-md sm:absolute sm:inset-x-auto sm:right-0 sm:top-10 sm:w-[30rem]">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-[13px] font-semibold">Reminders</span>
            <span className="text-xs text-muted-foreground">{total ? `${num(total)} to do${late ? ` · ${late} late` : ''}` : 'none'}</span>
          </div>
          <div className="max-h-[70vh] overflow-y-auto px-3" onClick={(e) => { if ((e.target as HTMLElement).closest('a')) setOpen(false) }}>
            {list.length === 0 ? <p className="py-6 text-center text-[13px] text-muted-foreground">Nothing to do right now.</p>
              : <ul className="divide-y">{list.map((r) => <ReminderRow key={r.key} r={r} filter="all" />)}</ul>}
          </div>
        </div>
      )}
    </div>
  )
}

/** Not to miss anything: the count in the tab title, and once a day a heads-up of what is late. */
export function useReminderAlerts() {
  const { user } = useAuth()
  const { data } = useReminders(undefined, !!user)
  const navigate = useNavigate()
  const total = data?.meta.total ?? 0
  const late = data?.meta.overdue ?? 0
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\+?\)\s*/, '')
    document.title = total > 0 ? `(${total > 99 ? '99+' : total}) ${base}` : base
  }, [total])
  useEffect(() => {
    if (!user || !data || (late === 0 && (data.meta.soon ?? 0) === 0)) return
    const key = `sw.reminder-alert.${user.id}`
    const today = new Date().toISOString().slice(0, 10)
    try { if (localStorage.getItem(key) === today) return; localStorage.setItem(key, today) } catch { /* private mode: show it anyway */ }
    const parts = [late && `${late} terlambat`, data.meta.soon && `${data.meta.soon} due within 24 hours`, data.meta.urgent && `${data.meta.urgent} urgent`].filter(Boolean).join(', ')
    toast.warning(<span>You have {parts}. <button type="button" className="font-semibold text-primary underline" onClick={() => navigate('/')}>View reminders</button></span>,
      { title: 'Do not miss this', duration: 15_000 })
  }, [user, data, late, navigate])
}
