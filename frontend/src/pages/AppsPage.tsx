import { useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { LayoutGrid, RotateCcw, SearchX } from 'lucide-react'
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

/** One app: a coloured rounded square with its icon, its name under it, and the work waiting in it. */
function Tile({ to, label, icon: Icon, color, count = 0, comingSoon, dragging, title }: { to: string; label: string; icon: LucideIcon; color: string; count?: number; comingSoon?: boolean; dragging?: boolean; title?: string }) {
  return (
    <Link to={to} draggable={false} title={title}
      className="group flex flex-col items-center gap-2 rounded-xl px-1 py-2 text-center outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className={cn('relative flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-[0_2px_6px_rgb(15_23_42/0.18)] transition duration-150 ease-out group-hover:-translate-y-0.5 group-hover:shadow-[0_8px_18px_rgb(15_23_42/0.22)] sm:size-[72px] lg:size-20',
        color, comingSoon && 'opacity-55 saturate-[.35] group-hover:translate-y-0 group-hover:shadow-[0_2px_6px_rgb(15_23_42/0.18)]', dragging && '-translate-y-1 scale-105 shadow-[0_10px_24px_rgb(15_23_42/0.25)]')}>
        <Icon className="size-8 sm:size-9 lg:size-10" strokeWidth={1.7} aria-hidden />
        {count > 0 && (
          <span className="absolute -right-1.5 -top-1.5 min-w-[20px] rounded-full bg-red-600 px-1.5 text-[11px] font-semibold leading-5 text-white ring-2 ring-white tabular-nums dark:ring-slate-900" aria-label={`${count} to do`}>
            {count > 99 ? '99+' : count}
          </span>
        )}
      </span>
      <span className={cn('line-clamp-2 max-w-[8rem] text-[13px] leading-tight sm:text-sm', comingSoon ? 'text-slate-500 dark:text-slate-400' : 'text-slate-800 dark:text-slate-100')}>{label}</span>
      {comingSoon && <span className="-mt-1 text-[10.5px] text-slate-500 dark:text-slate-400">Coming Soon</span>}
    </Link>
  )
}

/** A tile that can be dragged to another place in its group; a plain click still opens the app. */
function SortableTile({ app, count, disabled, justDragged }: { app: LauncherApp; count: number; disabled: boolean; justDragged: React.RefObject<boolean> }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: app.key, disabled })
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} aria-roledescription="ikon yang bisa digeser"
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined, touchAction: disabled ? undefined : 'manipulation' }}
      className={cn('relative rounded-xl', isDragging && 'cursor-grabbing')}
      // the click that ends a drag does not open the app
      onClickCapture={(e) => { if (justDragged.current) { e.preventDefault(); e.stopPropagation(); justDragged.current = false } }}>
      <Tile to={app.to} label={app.label} icon={app.icon} color={app.color} comingSoon={app.comingSoon} count={count} dragging={isDragging} title={app.description} />
    </div>
  )
}

// a centred grid of medium icons: 3 on a phone, 4 on a tablet, 6 on a monitor
const GRID = 'mx-auto grid w-full max-w-4xl grid-cols-3 gap-x-2 gap-y-6 min-[560px]:grid-cols-4 md:gap-x-6 md:gap-y-9 lg:grid-cols-6'

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
    <div className="relative w-full py-6 sm:py-12 lg:py-16">
      {/* the launcher's backdrop: a soft wash over the whole screen, behind the header's line */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(1200px_600px_at_15%_0%,#dbeafe_0%,transparent_60%),radial-gradient(900px_600px_at_90%_10%,#ede9fe_0%,transparent_55%),radial-gradient(900px_700px_at_50%_100%,#ccfbf1_0%,transparent_60%)] bg-slate-50 dark:bg-slate-950 dark:bg-[radial-gradient(1200px_600px_at_15%_0%,#1e3a8a55_0%,transparent_60%),radial-gradient(900px_600px_at_90%_10%,#4c1d9555_0%,transparent_55%)]" />
      <h1 className="sr-only">{greeting()}, {user?.name ?? ''}</h1>

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
              {shownApps.map((a) => (
                <SortableTile key={a.key} app={a} disabled={!!needle} justDragged={justDragged}
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
