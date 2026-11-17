import { Fragment, useEffect, useRef, useState } from 'react'
import { Link, Outlet, ScrollRestoration, useLocation, useSearchParams } from 'react-router-dom'
import { Camera, ChevronDown, ChevronRight, KeyRound, LayoutGrid, LogOut, Search, X } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ChangePasswordModal } from '@/components/ChangePasswordModal'
import { CommandMenu } from '@/components/CommandMenu'
import { Logo } from '@/components/Logo'
import { ProfilePhotoModal, UserAvatar } from '@/components/ProfilePhotoModal'
import { NotificationBell } from '@/components/NotificationBell'
import { NotesButton } from '@/components/NotesButton'
import { ReminderButton, useReminderAlerts } from '@/components/reminders/ReminderCenter'
import { UpdateAlertHost } from '@/components/updateAlerts/UpdateAlertPopup'
import { appForPath, launcherApps, type LauncherApp } from '@/lib/launcher'
import { useLiveSync } from '@/lib/live'
import { APPS_HOME, crumbsFor, visibleNav, type NavChild, type NavItem } from '@/lib/navigation'
import { useNavCounts } from '@/lib/navCounts'
import { usePageViewLog } from '@/lib/pageViewLog'
import { cn } from '@/lib/utils'

/** The account: who is signed in, photo and password in its menu, and Logout beside it. */
function UserMenu({ onChangePassword }: { onChangePassword: () => void }) {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const [photo, setPhoto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const roles = `${user?.roles.join(', ') ?? ''}${user?.site ? ` · ${user.site.code}` : ''}`
  const item = 'flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-[13px] hover:bg-muted'

  return (
    <div className="flex items-center gap-0.5">
      <div className="relative" ref={ref}>
        <button type="button" className="flex items-center gap-2 rounded-md p-1 pr-1.5 text-left hover:bg-muted" onClick={() => setOpen((v) => !v)}
          aria-label="Account menu" aria-expanded={open} title={user?.name}>
          <UserAvatar user={user} className="size-8 text-[11px]" />
          <span className="hidden min-w-0 max-w-40 xl:block">
            <span className="block truncate text-[13px] font-medium leading-tight">{user?.name}</span>
            <span className="block truncate text-[11px] leading-tight text-muted-foreground">{roles}</span>
          </span>
        </button>
        {open && (
          <div className="absolute right-0 top-full z-50 mt-1 w-60 rounded-md border bg-card p-1 shadow-lg">
            <div className="flex items-center gap-2.5 border-b px-2.5 pb-2.5 pt-1.5">
              <UserAvatar user={user} className="size-9 text-xs" />
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium leading-tight">{user?.name}</div>
                <div className="truncate text-[11px] text-muted-foreground">{roles}</div>
              </div>
            </div>
            <div className="pt-1">
              <button type="button" className={item} onClick={() => { setOpen(false); setPhoto(true) }}><Camera className="size-3.5" /> Profile photo</button>
              <button type="button" className={item} onClick={() => { setOpen(false); onChangePassword() }}><KeyRound className="size-3.5" /> Change password</button>
              <button type="button" className={cn(item, 'text-destructive')} onClick={() => logout()}><LogOut className="size-3.5" /> Logout</button>
            </div>
          </div>
        )}
        {photo && <ProfilePhotoModal onClose={() => setPhoto(false)} />}
      </div>
      <button type="button" onClick={() => logout()} title="Logout" aria-label="Logout"
        className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive max-sm:hidden">
        <LogOut className="size-4" />
      </button>
    </div>
  )
}

/** Where a detail page sits, with the way back. */
function Breadcrumb({ pathname }: { pathname: string }) {
  const crumbs = crumbsFor(pathname)
  if (crumbs.length < 2) return null
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-[13px] print:hidden">
      {crumbs.map((c, i) => (
        <Fragment key={i}>
          {i > 0 && <ChevronRight className="size-3 shrink-0 text-muted-foreground/60" />}
          {c.to
            ? <Link to={c.to} className="truncate text-muted-foreground hover:text-foreground hover:underline">{c.label}</Link>
            : <span className={cn('truncate', i === crumbs.length - 1 ? 'font-medium text-foreground' : 'text-muted-foreground')}>{c.label}</span>}
        </Fragment>
      ))}
    </nav>
  )
}

const HEADER = '3.5rem'
const APP_BAR = '2.75rem'

/**
 * The menus of the bar: the app's dashboard first, then its menus. An app of one menu with sub menus
 * shows those sub menus themselves.
 */
function barEntries(app: LauncherApp): (NavItem | NavChild)[] {
  const menus = app.menus ?? (app.items.length === 1 && app.items[0].children?.length ? app.items[0].children : app.items)
  return app.home ? [{ to: app.home, label: 'Dashboard', icon: app.icon }, ...menus] : menus
}

/** The app search of the launcher, in the navbar: it filters the icons by name (?q=). */
function AppSearch() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const set = (v: string) => setParams(v ? { q: v } : {}, { replace: true })
  return (
    <label className="relative mx-auto block w-full max-w-md">
      <span className="sr-only">Cari aplikasi</span>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input type="search" value={q} onChange={(e) => set(e.target.value)} placeholder="Cari aplikasi…"
        onKeyDown={(e) => e.key === 'Escape' && set('')}
        className="h-9 w-full rounded-full border bg-muted/50 pl-9 pr-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:bg-card focus-visible:ring-2 focus-visible:ring-primary/20 [&::-webkit-search-cancel-button]:hidden" />
      {q && (
        <button type="button" onClick={() => set('')} aria-label="Hapus pencarian" className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="size-3.5" />
        </button>
      )}
    </label>
  )
}

/** The ERP shell: a header with the open app and its menus, and the whole width for the work. */
export function AppLayout() {
  const { hasPermission, hasRole } = useAuth()
  const location = useLocation()
  // the Apps home is the menu itself: no app menus there
  const home = location.pathname === APPS_HOME
  usePageViewLog()
  const [searching, setSearching] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)

  const groups = visibleNav(hasPermission, hasRole('super_admin'))
  const { apps } = launcherApps(groups, hasPermission)

  // the open app: the one that holds this page; a page no menu lists (a detail page) stays in the app it was opened from
  const lastApp = useRef<string | undefined>(undefined)
  const app = home || location.pathname.startsWith('/coming-soon/')
    ? undefined
    : appForPath(apps, location.pathname, lastApp.current) ?? apps.find((a) => a.key === lastApp.current && !a.comingSoon)
  lastApp.current = home ? undefined : app?.key ?? lastApp.current

  /** this page is the menu's path, or a page under it; `?kind=` tells Barang from Jasa */
  const matches = (to: string) => {
    const [p, q] = to.split('?')
    if (q) return location.pathname === p && (location.search.includes(q) || (q === 'kind=BARANG' && !location.search.includes('kind=')))
    return p === '/' ? location.pathname === '/' : location.pathname === p || location.pathname.startsWith(p + '/')
  }
  const entries = app ? barEntries(app) : []
  const flat = entries.flatMap((e) => ('children' in e && e.children?.length ? e.children.map((c) => c.to) : [e.to]))
  // the one menu entry this page belongs to: the longest path that matches
  const activeTo = flat.filter(matches).sort((a, b) => b.length - a.length)[0]
  // a page of the menu itself needs no breadcrumb; a detail page under it does
  const isMenuPage = app ? [app.home ?? '', ...app.items.flatMap((i) => [i.to, ...(i.children ?? []).map((c) => c.to)])].some((to) => to.split('?')[0] === location.pathname) : true

  // a menu's sub menus drop down under it (fixed, so the scrolling bar of a phone does not clip them)
  const [drop, setDrop] = useState<{ label: string; left: number; top: number } | null>(null)
  const dropRef = useRef<HTMLDivElement>(null)
  useEffect(() => setDrop(null), [location.pathname, location.search])
  useEffect(() => {
    if (!drop) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (!dropRef.current?.contains(t) && !t.closest('[data-app-menu]')) setDrop(null)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrop(null)
    const onResize = () => setDrop(null)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [drop])

  // to-do counts next to the menus (same numbers as the dashboards)
  const countOf = useNavCounts()
  // the tab title count, the daily heads-up of what is late
  useReminderAlerts()
  // what another account does shows here within seconds
  useLiveSync(true)
  const Count = ({ n, strong }: { n: number; strong?: boolean }) => (n > 0
    ? <span className={cn('shrink-0 rounded-full px-1.5 text-[11px] font-medium leading-[18px] tabular-nums', strong ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')} aria-label={`${n} to do`}>{n > 99 ? '99+' : n}</span>
    : null)

  // wide screens: the app menus sit in the header row; narrower: a second row under it
  const [wide, setWide] = useState(() => typeof window === 'undefined' || window.matchMedia('(min-width: 1024px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const on = () => setWide(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  // the full-page forms are portalled under <body> and open below the header
  useEffect(() => {
    const st = document.documentElement.style
    st.setProperty('--sw-header', app && !wide ? `calc(${HEADER} + ${APP_BAR})` : HEADER)
    return () => { st.removeProperty('--sw-header') }
  }, [app, wide])

  const dropEntry = drop ? entries.find((e) => e.label === drop.label) : undefined
  const dropChildren = dropEntry && 'children' in dropEntry ? dropEntry.children ?? [] : []
  const AppIcon = app?.icon

  const menus = app && (
    <nav aria-label={`Menu ${app.label}`} className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
      {entries.map((e) => {
        const subs = 'children' in e ? e.children ?? [] : []
        const on = subs.length ? subs.some((c) => c.to === activeTo) : e.to === activeTo
        const cls = cn('relative flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[13.5px] transition-colors',
          on ? 'font-medium text-primary after:absolute after:inset-x-3 after:-bottom-[10px] after:h-0.5 after:rounded-full after:bg-primary max-lg:after:-bottom-[4px]' : 'text-muted-foreground hover:bg-muted hover:text-foreground')
        if (!subs.length) {
          return (
            <Link key={e.label} to={e.to} className={cls} aria-current={on ? 'page' : undefined}>
              {e.label}<Count n={countOf(e)} strong={!!e.badge} />
            </Link>
          )
        }
        const open = drop?.label === e.label
        return (
          <button key={e.label} type="button" data-app-menu="" className={cn(cls, open && !on && 'bg-muted text-foreground')} aria-expanded={open} aria-haspopup="menu"
            onClick={(ev) => {
              const r = ev.currentTarget.getBoundingClientRect()
              setDrop(open ? null : { label: e.label, left: Math.min(r.left, window.innerWidth - 248), top: r.bottom + 6 })
            }}>
            {e.label}<Count n={countOf(e)} strong={!!e.badge} />
            <ChevronDown className={cn('size-3.5 opacity-70 transition-transform', open && 'rotate-180')} />
          </button>
        )
      })}
    </nav>
  )

  return (
    <div className="flex min-h-screen flex-col">
      {/* no backdrop blur here: it would trap the header's fixed popups (reminders on a phone, notes) inside it */}
      <header className="sticky top-0 z-30 border-b bg-card print:hidden">
        <div className="flex h-14 items-center gap-2 px-3 sm:px-4">
          {home ? (
            <Link to={APPS_HOME} aria-label="STOCKWISE" className="flex shrink-0 items-center gap-2">
              <Logo className="max-[480px]:[&>span]:hidden" />
              <span className="rounded bg-primary/10 px-1.5 text-[11px] font-semibold leading-5 tracking-wide text-primary max-md:hidden">App Launcher</span>
            </Link>
          ) : (
            <>
              <Link to={APPS_HOME} title="Semua aplikasi" aria-label="Apps"
                className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <LayoutGrid className="size-[18px]" />
              </Link>
              {app && AppIcon ? (
                <Link to={app.to} className="flex shrink-0 items-center gap-2 rounded-md py-1 pr-2">
                  <span className={cn('flex size-7 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow-sm', app.color)}><AppIcon className="size-4" /></span>
                  <span className="text-[15px] font-semibold tracking-tight">{app.label}</span>
                </Link>
              ) : (
                <Link to={APPS_HOME} className="flex shrink-0 items-center"><Logo /></Link>
              )}
              {app && wide && <div className="mx-1 h-6 w-px shrink-0 bg-border" />}
            </>
          )}

          <div className="flex min-w-0 flex-1 items-center">
            {home ? <AppSearch /> : wide && menus}
          </div>

          {!home && (
            <button type="button" onClick={() => setSearching(true)} title="Cari menu (Ctrl+K)" aria-label="Search menu"
              className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <Search className="size-[18px]" />
            </button>
          )}
          <NotesButton />
          <ReminderButton />
          {hasPermission('notification.view_own') && <NotificationBell />}
          <div className="mx-0.5 h-6 w-px shrink-0 bg-border max-sm:hidden" />
          <UserMenu onChangePassword={() => setChangingPassword(true)} />
          {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}
        </div>

        {app && !wide && <div className="flex h-11 items-center border-t px-2 sm:px-3">{menus}</div>}
      </header>

      {drop && dropChildren.length > 0 && (
        <div ref={dropRef} role="menu" className="fixed z-50 max-h-[70vh] w-60 overflow-y-auto rounded-lg border bg-card p-1.5 shadow-lg" style={{ left: Math.max(8, drop.left), top: drop.top }}>
          {dropChildren.map((c) => (
            <Link key={c.label} to={c.to} role="menuitem" onClick={() => setDrop(null)}
              className={cn('flex items-center gap-2 rounded-md px-3 py-2 text-[13.5px] transition-colors', c.to === activeTo ? 'bg-primary/10 font-medium text-primary' : 'text-foreground/80 hover:bg-muted hover:text-foreground')}>
              <span className="min-w-0 flex-1 truncate">{c.label}</span>{!dropEntry?.badge && <Count n={countOf(c)} />}
            </Link>
          ))}
        </div>
      )}

      <main className="min-w-0 flex-1 px-3 py-4 sm:px-5 sm:py-5">
        <div className="w-full space-y-4">
          {!home && !isMenuPage && <Breadcrumb pathname={location.pathname} />}
          <Outlet />
          {/* Back / Forward: the page returns where it was left; a new page opens at the top */}
          <ScrollRestoration />
        </div>
      </main>
      <CommandMenu groups={groups} open={searching} onOpenChange={setSearching} />
      <UpdateAlertHost />
    </div>
  )
}
