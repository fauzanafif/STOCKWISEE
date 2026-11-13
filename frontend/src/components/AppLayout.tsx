import { Fragment, useEffect, useRef, useState } from 'react'
import { Link, Outlet, ScrollRestoration, useLocation } from 'react-router-dom'
import { Camera, ChevronDown, ChevronRight, KeyRound, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Search, X } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { APPROVAL_PERMISSIONS, useApprovalCount } from '@/features/itemRequests/api'
import { useIrSummary } from '@/features/importantRequests/api'
import { ChangePasswordModal } from '@/components/ChangePasswordModal'
import { CommandMenu } from '@/components/CommandMenu'
import { Logo } from '@/components/Logo'
import { ProfilePhotoModal, UserAvatar } from '@/components/ProfilePhotoModal'
import { NotificationBell } from '@/components/NotificationBell'
import { ReminderButton, useReminderAlerts } from '@/components/reminders/ReminderCenter'
import { UpdateAlertHost } from '@/components/updateAlerts/UpdateAlertPopup'
import { useLiveSync } from '@/lib/live'
import { crumbsFor, visibleNav, type NavChild, type NavItem } from '@/lib/navigation'
import { usePageViewLog } from '@/lib/pageViewLog'
import { useReminders, type ReminderModule } from '@/features/reminders/api'
import { cn } from '@/lib/utils'

/** The account: name and role at the foot of the sidebar; photo, password and logout above it. */
function UserMenu({ onChangePassword, compact }: { onChangePassword: () => void; compact?: boolean }) {
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
    <div className="relative" ref={ref}>
      <button type="button" className={cn('flex items-center gap-2 rounded p-1.5 hover:bg-muted', compact && 'justify-center')}
        onClick={() => setOpen((v) => !v)} aria-label="Account menu" aria-expanded={open} title={compact ? user?.name : undefined}>
        <UserAvatar user={user} className="size-7 text-[11px]" />
        {!compact && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium leading-tight">{user?.name}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{roles}</span>
          </span>
        )}
      </button>
      {open && (
        <div className={cn('absolute z-50 w-52 rounded border bg-card p-1 shadow-md', compact ? 'left-0 bottom-full mb-1' : 'right-0 top-full mt-1')}>
          <button type="button" className={item} onClick={() => { setOpen(false); setPhoto(true) }}><Camera className="size-3.5" /> Profile photo</button>
          <button type="button" className={item} onClick={() => { setOpen(false); onChangePassword() }}><KeyRound className="size-3.5" /> Change password</button>
          <button type="button" className={cn(item, 'text-destructive')} onClick={() => logout()}><LogOut className="size-3.5" /> Out</button>
        </div>
      )}
      {photo && <ProfilePhotoModal onClose={() => setPhoto(false)} />}
    </div>
  )
}

/** Where the page sits. A phone shows the last two steps, so the way back is still there. */
function Breadcrumb({ pathname }: { pathname: string }) {
  const crumbs = crumbsFor(pathname)
  if (crumbs.length === 0) return null
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-[13px]">
      {crumbs.map((c, i) => (
        <Fragment key={i}>
          {i > 0 && <ChevronRight className={cn('size-3 shrink-0 text-muted-foreground/60', i < crumbs.length - 1 && 'max-sm:hidden')} />}
          {c.to
            ? <Link to={c.to} className={cn('truncate text-muted-foreground hover:text-foreground', i < crumbs.length - 2 && 'max-sm:hidden')}>{c.label}</Link>
            : <span className={cn('truncate', i === crumbs.length - 1 ? 'font-medium text-foreground' : 'text-muted-foreground', i < crumbs.length - 2 && 'max-sm:hidden')}>{c.label}</span>}
        </Fragment>
      ))}
    </nav>
  )
}

const SIDEBAR = { open: '17rem', rail: '3.5rem', header: '3.25rem' }

/** The ERP shell: a narrow sidebar by the flow of work, a thin header, and the whole width for the work. */
export function AppLayout() {
  const { hasPermission, hasRole } = useAuth()
  const location = useLocation()
  usePageViewLog()
  const [mobileOpen, setMobileOpen] = useState(false)
  // desktop: the sidebar folds to a rail (remembered; a small laptop starts folded)
  const [collapsed, setCollapsed] = useState(() => {
    try { const v = localStorage.getItem('sw.sidebar'); if (v) return v === 'closed' } catch { /* private mode */ }
    return typeof window !== 'undefined' && window.innerWidth < 1100
  })
  const toggleSidebar = () => setCollapsed((c) => {
    try { localStorage.setItem('sw.sidebar', c ? 'open' : 'closed') } catch { /* private mode */ }
    return !c
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleSidebar() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  // the rail: a group's menus fly out beside its icon
  const [fly, setFly] = useState<{ key: string; top: number } | null>(null)
  const flyTimer = useRef<number | undefined>(undefined)
  const showFly = (key: string, el: HTMLElement) => { window.clearTimeout(flyTimer.current); setFly({ key, top: el.getBoundingClientRect().top }) }
  const hideFly = () => { flyTimer.current = window.setTimeout(() => setFly(null), 150) }
  useEffect(() => setFly(null), [location.pathname, collapsed])
  const [searching, setSearching] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)

  // Drawer (phone / tablet): close on navigation and Escape, and freeze the page behind it.
  useEffect(() => setMobileOpen(false), [location.pathname])
  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMobileOpen(false)
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [mobileOpen])

  const approvals = useApprovalCount(APPROVAL_PERMISSIONS.some((p) => hasPermission(p)))
  // Important Request: tasks to confirm / revise and results to review (what needs my action)
  const important = useIrSummary(hasPermission('important_request.access'))
  const badges = { approvals: approvals.data ?? 0, important: important.data?.badge ?? 0 }
  const groups = visibleNav(hasPermission, hasRole('super_admin'))
  const [openSubs, setOpenSubs] = useState<Record<string, boolean>>({})

  /** this page is the menu's path, or a page under it; `?kind=` tells Barang from Jasa */
  const matches = (to: string) => {
    const [p, q] = to.split('?')
    if (q) return location.pathname === p && (location.search.includes(q) || (q === 'kind=BARANG' && !location.search.includes('kind=')))
    return p === '/' ? location.pathname === '/' : location.pathname === p || location.pathname.startsWith(p + '/')
  }
  // the one menu entry this page belongs to: the longest path that matches
  const activeTo = groups.flatMap((g) => g.items.flatMap((i) => (i.children?.length ? i.children.map((c) => c.to) : [i.to]))).filter(matches).sort((a, b) => b.length - a.length)[0]
  const inside = (i: NavItem) => (i.children ?? []).some((c) => c.to === activeTo)
  const subOpen = (i: NavItem) => openSubs[i.label] ?? inside(i)
  // one menu open at a time: opening one folds the others, except the one of this page
  const toggleSub = (i: NavItem, open: boolean) => setOpenSubs((o) => {
    const next = { ...o, [i.label]: open }
    if (open) for (const g of groups) for (const it of g.items) if (it.label !== i.label && it.children && !inside(it)) next[it.label] = false
    return next
  })

  // "perlu dikerjakan" of each module (same numbers as the dashboards)
  const reminders = useReminders(undefined, true)
  // the tab title count, the daily heads-up of what is late
  useReminderAlerts()
  // what another account does shows here within seconds
  useLiveSync(true)
  const DASH: Record<string, ReminderModule> = { '/important-requests': 'important', '/item-requests/dashboard': 'request', '/ppb/dashboard': 'ppb', '/purchase-orders/dashboard': 'po', '/ri/dashboard': 'ri' }
  const dashCount = (to: string) => (DASH[to] ? (reminders.data?.data ?? []).filter((r) => r.modules.includes(DASH[to])).reduce((n, r) => n + r.count, 0) : 0)
  const countOf = (i: NavItem | NavChild): number => (i.badge ? badges[i.badge] : 'children' in i && i.children ? i.children.reduce((t, c) => t + countOf(c), 0) : dashCount(i.to))
  const Count = ({ n, strong }: { n: number; strong?: boolean }) => (n > 0
    ? <span className={cn('shrink-0 rounded-full px-1.5 text-[11px] font-medium leading-[18px] tabular-nums', strong ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')} aria-label={`${n} to do`}>{n > 99 ? '99+' : n}</span>
    : null)
  const close = () => setMobileOpen(false)

  const sidebar = (
    <nav className="h-full space-y-4 overflow-y-auto overscroll-contain px-2.5 py-3" aria-label="Main menu">
      {groups.map((g, gi) => (
        <div key={g.label ?? gi} className="space-y-0.5">
          {g.label && <div className="px-2.5 pb-1 text-[11.5px] font-medium text-muted-foreground/90">{g.label}</div>}
          {g.items.map((n) => {
            const Icon = n.icon
            const on = n.to === activeTo && !n.children
            const within = inside(n)
            const open = !!n.children && subOpen(n)
            return (
              <Fragment key={n.label}>
                <div className={cn('group flex items-center rounded-md transition-colors', on ? 'bg-primary/10 text-primary' : 'text-sidebar-foreground hover:bg-muted')}>
                  <Link to={n.to} onClick={() => { close(); if (n.children) toggleSub(n, true) }} aria-current={on ? 'page' : undefined}
                    className={cn('flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 py-2 text-[14px] max-lg:py-2.5', (on || within) && 'font-medium', within && 'text-foreground')}>
                    <Icon className={cn('size-[17px] shrink-0', on || within ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')} />
                    <span className="min-w-0 flex-1 truncate">{n.label}</span>
                    {(!n.children || !open || n.badge) && <Count n={countOf(n)} strong={!!n.badge} />}
                  </Link>
                  {n.children && (
                    <button type="button" onClick={() => toggleSub(n, !open)} aria-label={open ? `Close ${n.label}` : `Open ${n.label}`} aria-expanded={open}
                      className="mr-0.5 flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground max-lg:size-10">
                      <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
                    </button>
                  )}
                </div>
                {n.children && open && (
                  <div className="ml-[19px] space-y-0.5 border-l py-0.5 pl-2.5">
                    {n.children.map((c) => (
                      <Link key={c.label} to={c.to} onClick={close} aria-current={c.to === activeTo ? 'page' : undefined}
                        className={cn('flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13.5px] transition-colors max-lg:py-2.5',
                          c.to === activeTo ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
                        <span className="min-w-0 flex-1 truncate">{c.label}</span>
                        {!n.badge && <Count n={countOf(c)} />}
                      </Link>
                    ))}
                  </div>
                )}
              </Fragment>
            )
          })}
        </div>
      ))}
    </nav>
  )

  // the folded sidebar: one icon per menu, its sub menus in a flyout
  const allItems = groups.flatMap((g) => g.items)
  const flyItem = fly ? allItems.find((n) => n.label === fly.key) : undefined
  const rail = (
    <nav className="flex h-full flex-col items-center gap-0.5 overflow-y-auto overscroll-contain py-2" aria-label="Main menu">
      {groups.map((g, gi) => (
        <Fragment key={g.label ?? gi}>
          {gi > 0 && <div className="my-1 w-6 border-t" />}
          {g.items.map((n) => {
            const Icon = n.icon
            const on = n.to === activeTo || inside(n)
            return (
              <Link key={n.label} to={n.to} aria-label={n.label} title={n.children ? undefined : n.label}
                onMouseEnter={(e) => (n.children ? showFly(n.label, e.currentTarget) : setFly(null))} onMouseLeave={hideFly}
                onFocus={(e) => { if (n.children) showFly(n.label, e.currentTarget) }}
                className={cn('flex size-9 shrink-0 items-center justify-center rounded-md transition-colors',
                  on ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground', fly?.key === n.label && !on && 'bg-muted text-foreground')}>
                <Icon className="size-[18px]" />
              </Link>
            )
          })}
        </Fragment>
      ))}
    </nav>
  )

  // on the root element: the full-page forms are portalled under <body> and fit beside the sidebar
  useEffect(() => {
    const st = document.documentElement.style
    st.setProperty('--sw-sidebar', collapsed ? SIDEBAR.rail : SIDEBAR.open)
    st.setProperty('--sw-header', SIDEBAR.header)
    return () => { st.removeProperty('--sw-sidebar'); st.removeProperty('--sw-header') }
  }, [collapsed])

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-[var(--sw-sidebar)] shrink-0 flex-col border-r bg-sidebar transition-[width] duration-150 lg:flex print:hidden">
        <div className={cn('flex h-[var(--sw-header)] shrink-0 items-center border-b', collapsed ? 'justify-center' : 'px-4')}>
          <Link to="/" aria-label="Dashboard"><Logo withText={!collapsed} /></Link>
        </div>
        <div className="min-h-0 flex-1">{collapsed ? rail : sidebar}</div>
      </aside>

      {collapsed && fly && flyItem?.children && (
        <div className="fixed z-50 hidden max-h-[80vh] w-56 overflow-y-auto rounded-md border bg-card p-1.5 shadow-md lg:block" style={{ left: 'calc(var(--sw-sidebar) - 4px)', top: Math.max(8, Math.min(fly.top, window.innerHeight - 48 - flyItem.children.length * 34)) }}
          onMouseEnter={() => window.clearTimeout(flyTimer.current)} onMouseLeave={hideFly}>
          <div className="px-2.5 py-1 text-[13.5px] font-medium">{flyItem.label}</div>
          {flyItem.children.map((c) => (
            <Link key={c.label} to={c.to} className={cn('flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13.5px] hover:bg-muted', c.to === activeTo ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:text-foreground')}>
              <span className="min-w-0 flex-1 truncate">{c.label}</span>{!flyItem.badge && <Count n={countOf(c)} />}
            </Link>
          ))}
        </div>
      )}

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={close} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-sidebar shadow-lg">
            <div className="flex h-14 shrink-0 items-center justify-between border-b px-4">
              <Logo />
              <button className="flex size-10 items-center justify-center rounded hover:bg-muted" onClick={close} aria-label="Close menu"><X className="size-5" /></button>
            </div>
            <div className="min-h-0 flex-1">{sidebar}</div>
            <div className="shrink-0 border-t p-1.5"><UserMenu onChangePassword={() => setChangingPassword(true)} compact /></div>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b bg-card print:hidden">
          <div className="flex h-[var(--sw-header)] items-center gap-1 px-2 sm:px-3">
            <button className="flex size-10 items-center justify-center rounded hover:bg-muted lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu className="size-5" /></button>
            <button className="hidden size-8 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground lg:flex" onClick={toggleSidebar}
              aria-label={collapsed ? 'Open sidebar' : 'Close sidebar'} title={`${collapsed ? 'Open' : 'Close'} sidebar (Ctrl+B)`}>
              {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            </button>
            <div className="min-w-0 flex-1 pl-1"><Breadcrumb pathname={location.pathname} /></div>
            <button type="button" onClick={() => setSearching(true)} title="Search menu (Ctrl+K)" aria-label="Search menu"
              className="flex size-10 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground lg:size-8">
              <Search className="size-4" />
            </button>
            <ReminderButton />
            {hasPermission('notification.view_own') && <NotificationBell />}
            <UserMenu onChangePassword={() => setChangingPassword(true)} />
            {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}
          </div>
        </header>

        <main className="min-w-0 flex-1 p-3 sm:p-4">
          <div className="w-full space-y-3">
            <Outlet />
            {/* Back / Forward: the page returns where it was left; a new page opens at the top */}
            <ScrollRestoration />
          </div>
        </main>
      </div>
      <CommandMenu groups={groups} open={searching} onOpenChange={setSearching} />
      <UpdateAlertHost />
    </div>
  )
}
