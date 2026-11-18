import {
  BarChart3, Building2, Calculator, BookOpen, ClipboardPen, Factory, FileText, FolderKanban, Handshake,
  type LucideIcon, Settings, ShieldCheck, ShoppingCart, TrendingUp, Warehouse,
} from 'lucide-react'
import { APP_HOMES, type NavChild, type NavGroup, type NavItem } from '@/lib/navigation'

/**
 * What an app holds: a menu of NAV by its label (shown when the menu is visible to the user),
 * or a single page with its own permissions. The first one the user may open is where the app opens.
 */
type Target = string | { to: string; permissions?: string[]; label: string; icon: LucideIcon }

/** The groups of the launcher, in this order. */
export const CATEGORIES = [
  { key: 'daily', label: 'Kerja Harian' },
  { key: 'ops', label: 'Operasional' },
  { key: 'field', label: 'Aset & Lapangan' },
  { key: 'admin', label: 'Organisasi & Sistem' },
  { key: 'soon', label: 'Segera Hadir' },
] as const
export type CategoryKey = (typeof CATEGORIES)[number]['key']

interface LauncherDef {
  key: string
  category: CategoryKey
  label: string
  icon: LucideIcon
  /** tile colour; Tailwind reads these class names from source, keep them written out whole */
  color: string
  description: string
  /** no module yet: the tile opens the Coming Soon page */
  comingSoon?: boolean
  targets?: Target[]
  /** the app's one dashboard (see APP_HOMES): the tile opens it, and it heads the app's menus */
  home?: string
  /**
   * The menu bar in the order of the work: dropdowns of the app's pages. A page is named by its menu
   * label (a menu without sub menus) or its sub menu label; `as` renames it in the dropdown.
   */
  menus?: { label: string; pages: (string | { page: string; as: string })[] }[]
}

/**
 * The apps of the launcher, in this order. Every menu of NAV belongs to one app, so there is no
 * sidebar: inside an app, its menus are the bar under the header.
 */
const LAUNCHER: LauncherDef[] = [
  {
    key: 'dashboard', category: 'daily', label: 'Dashboard', icon: BarChart3, color: 'from-blue-500 to-indigo-700', description: 'To-do harian dan analytics: grafik stok, pengadaan, tracking, kartu stok',
    targets: ['Dashboard'],
  },
  {
    key: 'important', category: 'daily', label: 'Important Request', icon: ClipboardPen, color: 'from-violet-500 to-purple-700', description: 'Instruksi dan tugas dari atasan: request saya, tugas saya, persetujuan hasil',
    targets: ['Important Request'],
  },
  { key: 'approvals', category: 'daily', label: 'Approvals', icon: ShieldCheck, color: 'from-rose-500 to-red-600', description: 'Persetujuan manager, direktur dan serah terima', targets: ['Approval'] },
  {
    key: 'purchase', category: 'ops', label: 'Purchase', icon: ShoppingCart, color: 'from-fuchsia-500 to-pink-600', description: 'Purchase Request, Purchase Order, Price List, Return, Vendor',
    targets: ['Purchase Request', 'Purchase Order', 'Price List', 'Return', 'Vendor'], home: APP_HOMES.purchase,
    menus: [
      { label: 'Orders', pages: ['Draft Purchase Request', { page: 'List Purchase Request', as: 'Purchase Request' }, 'Approved Purchase Request Items', 'Price Quotation', { page: 'List PO', as: 'Purchase Order' }, 'Return'] },
      { label: 'Price List', pages: ['Draft Price List', 'Master Price List'] },
      { label: 'Master Data', pages: ['Vendor'] },
    ],
  },
  {
    key: 'inventory', category: 'ops', label: 'Inventory', icon: Warehouse, color: 'from-teal-500 to-emerald-700', description: 'Permintaan barang, Delivery Order, Receipt, kartu stok, stock opname, safety stock',
    targets: ['Item Request', 'Receipt', 'Barang', 'Jasa', 'Kategori Barang', 'UOM', 'Kartu Stok', 'Physical Inventory', 'Analisis Safety Stock', 'Data Quality'], home: APP_HOMES.inventory,
    menus: [
      { label: 'Operations', pages: [{ page: 'List Request', as: 'Item Request' }, 'Delivery Order', 'Receipt', 'Physical Inventory'] },
      { label: 'Products', pages: ['Barang', 'Jasa', 'Kategori Barang', 'UOM'] },
      { label: 'Reporting', pages: ['Kartu Stok', 'Analisis Safety Stock', 'Data Quality'] },
    ],
  },
  {
    key: 'manufacturing', category: 'ops', label: 'Manufacturing', icon: Factory, color: 'from-indigo-500 to-violet-700', description: 'Manufacturing Order, Bills of Materials, Disassembly',
    targets: ['Manufacturing Orders', 'Bills of Materials', 'Disassembly'], home: APP_HOMES.manufacturing,
    menus: [
      { label: 'Operations', pages: [{ page: 'List MO', as: 'Manufacturing Orders' }, 'Disassembly Orders'] },
      { label: 'Products', pages: ['Bills of Materials'] },
      { label: 'Reporting', pages: ['Production History', 'Disassembly History'] },
    ],
  },
  {
    key: 'tracking', category: 'field', label: 'Tracking', icon: Handshake, color: 'from-emerald-500 to-green-700', description: 'Lending, external borrow, STPP, ban luar, maintenance, barang bekas',
    targets: ['Tracking'], home: APP_HOMES.tracking,
    menus: [
      { label: 'Assets', pages: ['Lending', 'External Borrow', 'Used Items'] },
      { label: 'Field Work', pages: ['STPP', 'Maintenance', 'Outer Tyres', 'Manufacturing'] },
      { label: 'Reporting', pages: ['Task Analytics'] },
    ],
  },
  { key: 'helpdesk', category: 'admin', label: 'Guide', icon: BookOpen, color: 'from-cyan-500 to-teal-600', description: 'Panduan: arti status, istilah dan alur kerja', targets: ['Panduan'] },
  {
    key: 'settings', category: 'admin', label: 'Settings', icon: Settings, color: 'from-gray-500 to-gray-700', description: 'Pengguna, role & hak akses, data pekerja, log aktivitas, sync Accurate',
    targets: ['Pengaturan', 'Pekerja', 'Log Aktivitas'],
    menus: [
      { label: 'Users & Access', pages: ['Users', 'Roles & Permissions', 'Pekerja'] },
      { label: 'Logs', pages: ['User Log', 'Accurate Sync', 'Accurate Online'] },
      { label: 'System', pages: ['Update Alert', 'Auto Refresh'] },
    ],
  },
  { key: 'sales', category: 'soon', label: 'Sales', icon: TrendingUp, color: 'from-orange-500 to-amber-600', description: 'Penjualan dan penawaran ke pelanggan', comingSoon: true },
  { key: 'accounting', category: 'soon', label: 'Accounting', icon: Calculator, color: 'from-sky-600 to-blue-700', description: 'Jurnal, hutang piutang dan laporan keuangan', comingSoon: true },
  { key: 'assets', category: 'soon', label: 'Assets', icon: Building2, color: 'from-stone-500 to-stone-700', description: 'Daftar aset, penyusutan dan penempatan', comingSoon: true },
  { key: 'documents', category: 'soon', label: 'Documents', icon: FileText, color: 'from-amber-500 to-orange-600', description: 'Arsip dokumen dan berkas perusahaan', comingSoon: true },
  { key: 'projects', category: 'soon', label: 'Projects', icon: FolderKanban, color: 'from-violet-500 to-purple-700', description: 'Proyek, tahapan dan tugas tim', comingSoon: true },
]

export const COMING_SOON_PATH = '/coming-soon'

export interface LauncherApp {
  key: string
  category: CategoryKey
  label: string
  icon: LucideIcon
  color: string
  description: string
  to: string
  comingSoon: boolean
  /** its menus the user may open: the bar inside the app, its to-do count and the search */
  items: NavItem[]
  keywords: string
  /** its one dashboard: where the tile opens, first in its menu bar */
  home?: string
  /** its menu bar in the order of the work (dropdowns), when the app defines one */
  menus?: NavItem[]
}

/** A launcher app by its key, for the Coming Soon page. */
export function launcherApp(key: string | undefined) {
  return LAUNCHER.find((a) => a.key === key)
}

/**
 * The apps a user sees: an app that exists shows only when they may open one of its targets;
 * a Coming Soon app shows to everyone. `others` are visible menus no app covers (a safety net:
 * a new menu added to NAV but not to an app still shows on the launcher).
 */
export function launcherApps(groups: NavGroup[], hasPermission: (p: string) => boolean): { apps: LauncherApp[]; others: NavItem[] } {
  const visible = groups.flatMap((g) => g.items)
  const byLabel = new Map(visible.map((i) => [i.label, i]))
  const covered = new Set<string>()
  const apps: LauncherApp[] = []

  for (const def of LAUNCHER) {
    const base = { key: def.key, category: def.category, label: def.label, icon: def.icon, color: def.color, description: def.description }
    if (def.comingSoon) {
      apps.push({ ...base, to: `${COMING_SOON_PATH}/${def.key}`, comingSoon: true, items: [], keywords: def.description })
      continue
    }
    const items: NavItem[] = []
    for (const t of def.targets ?? []) {
      if (typeof t === 'string') {
        covered.add(t)
        const item = byLabel.get(t)
        if (item) items.push(item)
      } else if (!t.permissions || t.permissions.some(hasPermission)) {
        items.push({ to: t.to, label: t.label, icon: t.icon, permissions: t.permissions })
      }
    }
    if (items.length === 0) continue
    const keywords = [def.description, ...items.flatMap((i) => [i.label, i.keywords ?? '', ...(i.children ?? []).map((c) => `${c.label} ${c.keywords ?? ''}`)])].join(' ')
    apps.push({ ...base, to: def.home ?? items[0].to, comingSoon: false, items, keywords, home: def.home, menus: def.menus && menuBar(def.menus, items) })
  }

  return { apps, others: visible.filter((i) => !covered.has(i.label)) }
}

/**
 * The app's dropdowns from the pages the user may open: a dropdown with no page left goes, a dropdown
 * of one page is that page.
 */
function menuBar(menus: NonNullable<LauncherDef['menus']>, items: NavItem[]): NavItem[] {
  const pages = new Map<string, NavChild>()
  for (const i of items) {
    if (i.children?.length) for (const c of i.children) pages.set(c.label, c)
    else pages.set(i.label, { to: i.to, label: i.label, keywords: i.keywords, permissions: i.permissions, badge: i.badge })
  }
  const icon = items[0].icon
  const used = new Set<string>()
  const bar = menus.flatMap((m) => {
    const children = m.pages.flatMap((p) => {
      const name = typeof p === 'string' ? p : p.page
      const page = pages.get(name)
      if (page) used.add(name)
      return page ? [typeof p === 'string' ? page : { ...page, label: p.as }] : []
    })
    if (children.length === 0) return []
    return [children.length === 1 ? { ...children[0], icon } : { to: children[0].to, label: m.label, icon, children }]
  })
  // a page no dropdown names (a new menu) still shows, at the end of the bar
  for (const [name, page] of pages) if (!used.has(name)) bar.push({ ...page, icon })
  return bar
}

/** the page path of a menu entry, without its `?kind=` */
const pathOf = (to: string) => to.split('?')[0]

/**
 * The app a page belongs to: the one with the longest menu path that holds it. A page two apps
 * hold (Maintenance is in Tracking too) stays in `prefer`, the app the user is working in.
 */
export function appForPath(apps: LauncherApp[], pathname: string, prefer?: string): LauncherApp | undefined {
  let best: { app: LauncherApp; len: number } | undefined
  for (const app of apps) {
    if (app.comingSoon) continue
    for (const to of [...(app.home ? [app.home] : []), ...app.items.flatMap((i) => [i.to, ...(i.children ?? []).map((c) => c.to)])]) {
      const p = pathOf(to)
      if (p === '/' || !(pathname === p || pathname.startsWith(p + '/'))) continue
      if (!best || p.length > best.len || (p.length === best.len && app.key === prefer)) best = { app, len: p.length }
    }
  }
  return best?.app
}
