import { useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { LayoutGrid, Moon, RotateCcw, SearchX, Sun, Sunrise, Sunset } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  closestCenter, DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useAuth } from '@/auth/AuthContext'
import { usePreference, useSavePreference } from '@/features/moduleStats/api'
import { launcherApps, type LauncherApp } from '@/lib/launcher'
import { visibleNav } from '@/lib/navigation'
import { useNavCounts } from '@/lib/navCounts'
import { cn } from '@/lib/utils'

// the tiles of the other modules take turns in these colours (written out whole for Tailwind)
const OTHER_COLORS = ['from-sky-500 to-cyan-600', 'from-indigo-500 to-violet-700', 'from-orange-500 to-amber-600', 'from-emerald-500 to-green-700', 'from-purple-500 to-fuchsia-700', 'from-pink-500 to-rose-600']

/** the user's own order of the apps (on the server: the same on every device) */
const ORDER_KEY = 'launcher:order'

/** "Selamat pagi" … by the hour on this computer */
export function greeting(d = new Date()) {
  const h = d.getHours()
  if (h >= 4 && h < 11) return 'Selamat pagi'
  if (h >= 11 && h < 15) return 'Selamat siang'
  if (h >= 15 && h < 18) return 'Selamat sore'
  return 'Selamat malam'
}

/** The time of day's icon and colours for the greeting. */
function dayPart(d = new Date()) {
  const h = d.getHours()
  if (h >= 4 && h < 11) return { icon: Sunrise, chip: 'from-amber-300 to-orange-400', halo: 'bg-amber-300', spin: false }
  if (h >= 11 && h < 15) return { icon: Sun, chip: 'from-yellow-300 to-amber-500', halo: 'bg-yellow-300', spin: true }
  if (h >= 15 && h < 18) return { icon: Sunset, chip: 'from-orange-400 to-rose-500', halo: 'bg-orange-300', spin: false }
  return { icon: Moon, chip: 'from-indigo-400 to-violet-600', halo: 'bg-indigo-400', spin: false }
}

/** "Selamat pagi, Budi" on top of the launcher: the words rise in once, only the small sun / moon keeps moving. */
function Greeting({ name }: { name: string }) {
  const now = new Date()
  const part = dayPart(now)
  const Icon = part.icon
  const date = now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  return (
    <div className="mx-auto mb-10 flex max-w-3xl flex-col items-center text-center sm:mb-14">
      <span className="sw-rise relative mb-4 flex size-12 items-center justify-center sm:size-14" style={{ '--d': '0ms' } as React.CSSProperties}>
        <span aria-hidden className={cn('sw-halo absolute inset-0 rounded-full blur-xl', part.halo)} />
        <span className={cn('sw-float relative flex size-full items-center justify-center rounded-full bg-gradient-to-br text-white shadow-[0_6px_16px_rgb(15_23_42/0.15)]', part.chip)}>
          <Icon className={cn('size-6 sm:size-7', part.spin && 'sw-turn')} strokeWidth={1.8} aria-hidden />
        </span>
      </span>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-800 sm:text-3xl lg:text-4xl dark:text-slate-100">
        <span className="sw-rise inline-block" style={{ '--d': '120ms' } as React.CSSProperties}>{greeting(now)},</span>{' '}
        {name && (
          <span className="sw-rise inline-block bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 bg-clip-text text-transparent dark:from-sky-300 dark:via-indigo-300 dark:to-violet-300"
            style={{ '--d': '280ms' } as React.CSSProperties}>{name}</span>
        )}
      </h1>
      <p className="sw-rise mt-2 text-sm text-slate-500 sm:text-[15px] dark:text-slate-400" style={{ '--d': '440ms' } as React.CSSProperties}>{date}</p>
    </div>
  )
}

/** One app: a coloured rounded square with its icon, its name under it, and the work waiting in it. */
function Tile({ to, label, icon: Icon, color, count = 0, comingSoon, dragging, title, delay = 0 }: { to: string; label: string; icon: LucideIcon; color: string; count?: number; comingSoon?: boolean; dragging?: boolean; title?: string; delay?: number }) {
  return (
    <Link to={to} draggable={false} title={title} style={{ '--d': `${delay}ms` } as React.CSSProperties}
      className="sw-rise group flex flex-col items-center gap-2.5 rounded-xl px-1 py-2 text-center outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className={cn('relative flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-[0_2px_6px_rgb(15_23_42/0.18)] transition duration-150 ease-out group-hover:-translate-y-0.5 group-hover:shadow-[0_8px_18px_rgb(15_23_42/0.22)] sm:size-24 lg:size-28',
        color, comingSoon && 'opacity-55 saturate-[.35] group-hover:translate-y-0 group-hover:shadow-[0_2px_6px_rgb(15_23_42/0.18)]', dragging && '-translate-y-1 scale-105 shadow-[0_10px_24px_rgb(15_23_42/0.25)]')}>
        <Icon className="size-10 sm:size-12 lg:size-14" strokeWidth={1.6} aria-hidden />
        {count > 0 && (
          <span className="absolute -right-2 -top-2 min-w-[22px] rounded-full bg-red-600 px-1.5 text-xs font-semibold leading-[22px] text-white ring-2 ring-white tabular-nums dark:ring-slate-900" aria-label={`${count} to do`}>
            {count > 99 ? '99+' : count}
          </span>
        )}
      </span>
      <span className={cn('line-clamp-2 max-w-[9rem] text-sm font-medium leading-tight sm:text-[15px]', comingSoon ? 'text-slate-500 dark:text-slate-400' : 'text-slate-800 dark:text-slate-100')}>{label}</span>
      {comingSoon && <span className="-mt-1 text-[10.5px] text-slate-500 dark:text-slate-400">Coming Soon</span>}
    </Link>
  )
}

/** A tile that can be dragged to another place in its group; a plain click still opens the app. */
function SortableTile({ app, count, disabled, justDragged, delay }: { app: LauncherApp; count: number; disabled: boolean; justDragged: React.RefObject<boolean>; delay: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: app.key, disabled })
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} aria-roledescription="ikon yang bisa digeser"
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined, touchAction: disabled ? undefined : 'manipulation' }}
      className={cn('relative rounded-xl', isDragging && 'cursor-grabbing')}
      // the click that ends a drag does not open the app
      onClickCapture={(e) => { if (justDragged.current) { e.preventDefault(); e.stopPropagation(); justDragged.current = false } }}>
      <Tile to={app.to} label={app.label} icon={app.icon} color={app.color} comingSoon={app.comingSoon} count={count} dragging={isDragging} title={app.description} delay={delay} />
    </div>
  )
}

// large icons in centred rows: a short last row (or only a few apps) stays in the middle, not on the left
const GRID = 'mx-auto flex w-full max-w-6xl flex-wrap justify-center gap-x-2 gap-y-7 md:gap-x-8 md:gap-y-10 [&>*]:w-[30%] min-[560px]:[&>*]:w-32 lg:[&>*]:w-40'

/** The apps in the user's order: the ones they placed first, a new app at the end in its own order. */
export function orderApps(apps: LauncherApp[], order: string[] | null | undefined): LauncherApp[] {
  if (!order?.length) return apps
  const at = new Map(order.map((k, i) => [k, i]))
  return [...apps].sort((a, b) => (at.get(a.key) ?? Infinity) - (at.get(b.key) ?? Infinity))
}

/** The App Launcher: the home after login, every module the user may open as an icon. */
export function AppsPage() {
  const { user, hasPermission, hasRole } = useAuth()
  const countOf = useNavCounts()
  // the search box is in the navbar (AppLayout): ?q=
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const { apps, others } = useMemo(
    () => launcherApps(visibleNav(hasPermission, hasRole('super_admin')), hasPermission),
    [hasPermission, hasRole],
  )

  const saved = usePreference<string[]>(ORDER_KEY)
  const save = useSavePreference<string[]>(ORDER_KEY)
  // what the user just dropped shows at once, before the server answers
  const [local, setLocal] = useState<string[] | null>(null)
  const order = local ?? saved.data
  const ordered = orderApps(apps, order)
  const justDragged = useRef(false)

  const sensors = useSensors(
    // a small move starts a drag, so a click still opens the app
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    // a phone: hold the icon, then drag (a swipe still scrolls the page)
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const onDragEnd = (e: DragEndEvent) => {
    justDragged.current = true
    window.setTimeout(() => { justDragged.current = false }, 0)
    if (!e.over || e.active.id === e.over.id) return
    const keys = ordered.map((a) => a.key)
    // keep the place of apps this role does not see, so another role's order is not lost
    const next = arrayMove(keys, keys.indexOf(String(e.active.id)), keys.indexOf(String(e.over.id)))
    const hidden = (order ?? []).filter((k) => !keys.includes(k))
    const value = [...next, ...hidden]
    setLocal(value)
    save.mutate(value)
  }
  const reset = () => { setLocal([]); save.mutate(null) }

  // search by name: the app's name or the name of a menu in it
  const needle = q.trim().toLowerCase()
  const hit = (...words: (string | undefined)[]) => !needle || words.join(' ').toLowerCase().includes(needle)
  const shownApps = ordered.filter((a) => hit(a.label, ...a.items.flatMap((i) => [i.label, ...(i.children ?? []).map((c) => c.label)])))
  const shownOthers = others.filter((i) => hit(i.label, ...(i.children ?? []).map((c) => c.label)))
  const custom = !!order?.length
  // nothing to open at all (Coming Soon only)
  const nothing = !apps.some((a) => !a.comingSoon) && others.length === 0

  return (
    <div className="relative w-full py-8 sm:py-12 lg:py-16">
      {/* the launcher's backdrop: soft colours drifting slowly behind the icons (index.css .sw-aurora) */}
      <div aria-hidden className="sw-aurora"><i /><i /><i /><i /></div>
      <Greeting name={user?.name ?? ''} />

      {nothing && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-card px-6 py-14 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground"><LayoutGrid className="size-7" /></span>
          <div className="space-y-1">
            <h2 className="font-semibold">Belum ada aplikasi untuk akun Anda</h2>
            <p className="max-w-sm text-sm text-muted-foreground">Akun Anda belum diberi akses ke aplikasi mana pun. Hubungi administrator untuk mendapatkan hak akses.</p>
          </div>
        </div>
      )}

      {!nothing && needle && shownApps.length === 0 && shownOthers.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-14 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground"><SearchX className="size-6" /></span>
          <p className="text-sm text-muted-foreground">Tidak ada aplikasi bernama “{q}”.</p>
          <button type="button" onClick={() => setParams({}, { replace: true })} className="text-sm font-medium text-primary hover:underline">Hapus pencarian</button>
        </div>
      )}

      {!nothing && shownApps.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          {/* while searching only part of the apps shows: no dragging then */}
          <SortableContext items={shownApps.map((a) => a.key)} strategy={rectSortingStrategy} disabled={!!needle}>
            <section role="region" aria-label="Aplikasi" className={GRID}>
              {shownApps.map((a, i) => (
                <SortableTile key={a.key} app={a} disabled={!!needle} justDragged={justDragged} delay={560 + i * 60}
                  count={a.items.reduce((n, i) => n + countOf(i), 0)} />
              ))}
              {/* a menu no app covers yet (a safety net) sits after the apps */}
              {shownOthers.map((i, n) => (
                <Tile key={i.label} to={i.to} label={i.label} icon={i.icon} color={OTHER_COLORS[n % OTHER_COLORS.length]} count={countOf(i)} />
              ))}
            </section>
          </SortableContext>
        </DndContext>
      )}

      {custom && !needle && (
        <div className="mx-auto mt-10 flex max-w-4xl justify-center">
          <button type="button" onClick={reset} title="Kembalikan urutan ikon ke awal"
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] text-slate-500 transition-colors hover:bg-white/70 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-slate-100">
            <RotateCcw className="size-3.5" /> Reset urutan ikon
          </button>
        </div>
      )}
    </div>
  )
}
