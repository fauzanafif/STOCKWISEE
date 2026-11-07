import { BookOpen, ClipboardCheck, ClipboardList, ClipboardPen, CloudCog, FileOutput, FolderTree, Handshake, LayoutDashboard, type LucideIcon, Package, PackageCheck, PackageOpen, Settings, ShoppingCart, Store, Undo2, Users, Wrench, BookOpenCheck, ShieldCheck, ClipboardType, Ruler } from 'lucide-react'

/** One menu entry: the sidebar, the breadcrumb and the menu search all read this. */
export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  permissions?: string[]
  /** a live count next to the label (e.g. requests waiting for approval) */
  badge?: 'approvals' | 'important'
  /** who may open `to` itself; without them the menu opens its first sub menu they may open */
  selfPermissions?: string[]
  /** other words the menu search finds it by */
  keywords?: string
  /** sub menus shown under it */
  children?: NavChild[]
}

export interface NavChild {
  to: string
  label: string
  keywords?: string
  permissions?: string[]
  badge?: 'approvals' | 'important'
  /** the Super Admin role only: no permission opens it */
  superAdminOnly?: boolean
}

/** A group follows the work. */
export interface NavGroup {
  label: string | null
  /** colours the title of its pages */
  tone: string
  items: NavItem[]
}

const APPROVAL_PERMISSIONS = ['item_request.approve_manager', 'item_request.approve_director', 'item_request.handover', 'ppb.approve_manager', 'ppb.approve_director', 'po.approve_director', 'npbg.approve_manager', 'npbg.approve_director']

export const NAV: NavGroup[] = [
  {
    label: null, tone: 'bg-blue-100 text-blue-700',
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, keywords: 'beranda ringkasan' }],
  },
  {
    label: 'Tasks', tone: 'bg-violet-100 text-violet-700',
    items: [
      {
        to: '/important-requests', label: 'Important Request', icon: ClipboardPen, permissions: ['important_request.access'], badge: 'important', keywords: 'instruksi tugas perintah kerja direktur atasan',
        children: [
          { to: '/important-requests', label: 'Dashboard', keywords: 'ringkasan pengingat perlu dikerjakan', permissions: ['important_request.access'] },
          { to: '/important-requests/saya', label: 'My Requests', keywords: 'request saya buat', permissions: ['important_request.create'] },
          { to: '/important-requests/tugas', label: 'My Tasks', keywords: 'tugas ditugaskan', permissions: ['important_request.access'] },
          { to: '/important-requests/persetujuan', label: 'Needs Approval', keywords: 'review hasil approve', permissions: ['important_request.create'] },
          { to: '/important-requests/selesai', label: 'Done', keywords: 'selesai arsip', permissions: ['important_request.access'] },
        ],
      },
      { to: '/approvals', label: 'Approval', icon: ShieldCheck, keywords: 'manager direktur serah terima persetujuan', permissions: APPROVAL_PERMISSIONS, badge: 'approvals' },
    ],
  },
  {
    label: 'Item Request', tone: 'bg-sky-100 text-sky-700',
    items: [
      {
        to: '/item-requests', label: 'Item Request', icon: ClipboardList, keywords: 'permintaan item request', permissions: ['item_request.create', 'item_request.view'],
        children: [
          { to: '/item-requests/dashboard', label: 'Dashboard', keywords: 'dashboard pengingat perlu dikerjakan', permissions: ['item_request.create', 'item_request.view'] },
          { to: '/item-requests', label: 'List Request', keywords: 'list request', permissions: ['item_request.create', 'item_request.view'] },
        ],
      },
      { to: '/npbg', label: 'Delivery Order', icon: FileOutput, keywords: 'npbg barang keluar pengeluaran', permissions: ['npbg.view'] },
      {
        to: '/ppb', label: 'Purchase Request', icon: PackageOpen, keywords: 'ppb permintaan pembelian', permissions: ['ppb.view', 'ppb.create'],
        children: [
          { to: '/ppb/dashboard', label: 'Dashboard', keywords: 'dashboard pengingat perlu dikerjakan', permissions: ['ppb.view'] },
          { to: '/ppb/drafts', label: 'Draft Purchase Request', keywords: 'draft ppb perbandingan harga vendor penawaran', permissions: ['ppb.create'] },
          { to: '/ppb', label: 'List Purchase Request', keywords: 'ppb permintaan pembelian', permissions: ['ppb.view'] },
        ],
      },
      {
        to: '/purchase-orders', label: 'Purchase Order', icon: ShoppingCart, keywords: 'po purchasing pembelian', permissions: ['po.view', 'po.create', 'po.approve_director'],
        children: [
          { to: '/purchase-orders/dashboard', label: 'Dashboard', keywords: 'dashboard pengingat perlu dikerjakan siap po', permissions: ['po.view'] },
          { to: '/purchase-orders/siap-po', label: 'Approved Purchase Request Items', keywords: 'ppb siap po disetujui', permissions: ['po.create'] },
          { to: '/purchase-orders/penawaran', label: 'RFQ', keywords: 'price quotation penawaran harga vendor perbandingan ketersediaan eta pilihan direktur', permissions: ['po.create', 'po.approve_director'] },
          { to: '/purchase-orders/draft', label: 'Draft PO', keywords: 'draft po pilihan direktur vendor matriks', permissions: ['po.create'] },
          { to: '/purchase-orders', label: 'List PO', keywords: 'po purchasing pembelian', permissions: ['po.view'] },
        ],
      },
      {
        to: '/ri', label: 'Receipt', icon: PackageCheck, keywords: 'ri penerimaan barang masuk', permissions: ['ri.view'],
        children: [
          { to: '/ri/dashboard', label: 'Dashboard', keywords: 'dashboard pengingat perlu dikerjakan', permissions: ['ri.view'] },
          { to: '/ri', label: 'List Receipt', keywords: 'list ri', permissions: ['ri.view'] },
        ],
      },
      { to: '/purchase-returns', label: 'Return', icon: Undo2, keywords: 'purchase return retur vendor', permissions: ['purchase_return.view'] },
    ],
  },
  {
    label: 'INVENTARIS', tone: 'bg-emerald-100 text-emerald-700',
    items: [
      {
        to: '/lend', label: 'Tracking', icon: Handshake, keywords: 'tracking analytic', selfPermissions: ['lend.view'],
        permissions: ['lend.view', 'borrow.view', 'stpp.view', 'tyre.view', 'maintenance.view', 'manufacturing.view', 'used_return.view', 'important_request.analytics'],
        children: [
            { to: '/lend', label: 'Lending', keywords: 'lend tracking', permissions: ['lend.view'] },
            { to: '/borrow', label: 'External Borrow', keywords: 'borrow tracking', permissions: ['borrow.view'] },
            { to: '/stpp', label: 'STPP', keywords: 'tracking', permissions: ['stpp.view'] },
            { to: '/tyre-changes', label: 'Outer Tyres', keywords: 'tyre tracking', permissions: ['tyre.view'] },
            { to: '/maintenance', label: 'Maintenance', keywords: 'tracking', permissions: ['maintenance.view'] },
            { to: '/manufacturing', label: 'Manufacturing', keywords: 'assembly tracking', permissions: ['manufacturing.view'] },
            { to: '/used-returns', label: 'Used Items', keywords: 'pengembalian bekas tracking', permissions: ['used_return.view'] },
            { to: '/analytics/important-requests', label: 'Task Analytics', keywords: 'analitik instruksi tugas kinerja important request', permissions: ['important_request.analytics'] },
        ],
      },
      { to: '/inventory/analysis', label: 'Analisis Safety Stock', icon: ClipboardType, keywords: 'analisis persediaan inventory safety stock', permissions: ['inventory.view_analysis', 'item.safety_stock.view'] },
      { to: '/stock-opnames', label: 'Physical Inventory', icon: ClipboardCheck, keywords: 'stock opname so hitung fisik penyesuaian', permissions: ['opname.view'] },
      { to: '/stock-card', label: 'Kartu Stok', icon: BookOpenCheck, keywords: 'stock card kartu stok proyek', permissions: ['item.view', 'inventory.view'] },
    ],
  },
  {
    label: 'MASTER DATA', tone: 'bg-amber-100 text-amber-700',
    items: [
      { to: '/items?kind=BARANG', label: 'Barang', icon: Package, keywords: 'items master barang stok produk', permissions: ['item.view'] },
      { to: '/items?kind=JASA', label: 'Jasa', icon: Wrench, keywords: 'services master jasa servis layanan', permissions: ['item.view'] },
      { to: '/vendors', label: 'Vendor', icon: Store, keywords: 'master vendor supplier pemasok', permissions: ['master.vendor.view'] },
      { to: '/employees', label: 'Pekerja', icon: Users, keywords: 'employees master pekerja karyawan pegawai roster', permissions: ['master.employee.view'] },
      { to: '/item-categories', label: 'Kategori Barang', icon: FolderTree, keywords: 'item categories master kategori induk anak prefix barang produk', permissions: ['master.category.view'] },
      { to: '/uom', label: 'UOM', icon: Ruler, keywords: 'uom satuan konversi unit measure pack pcs', permissions: ['master.unit.view'] },
    ],
  },
  {
    label: 'SISTEM', tone: 'bg-teal-100 text-teal-700',
    items: [
      {
        to: '/sync/history', label: 'Sinkronisasi Accurate', icon: CloudCog, keywords: 'sync accurate integrasi', selfPermissions: ['sync.accurate.view'],
        permissions: ['sync.accurate.view', 'accurate.session.view'],
        children: [
            { to: '/sync/history', label: 'Accurate Sync', keywords: 'sync audit log', permissions: ['sync.accurate.view'] },
            { to: '/accurate/online', label: 'Accurate Online', keywords: 'sesi koneksi', permissions: ['accurate.session.view'] },
        ],
      },
      {
        to: '/settings/users', label: 'Pengaturan', icon: Settings, keywords: 'settings pengaturan', selfPermissions: ['user.view'],
        permissions: ['user.view', 'role.view'],
        children: [
            { to: '/settings/users', label: 'Users', keywords: 'user akun settings', permissions: ['user.view'] },
            { to: '/settings/roles', label: 'Roles & Permissions', keywords: 'permission settings', permissions: ['role.view'] },
            { to: '/settings/update-alerts', label: 'Update Alert', keywords: 'peringatan pengumuman fitur baru popup notifikasi settings', superAdminOnly: true },
            { to: '/settings/auto-refresh', label: 'Auto Refresh', keywords: 'muat ulang otomatis interval detik live settings', superAdminOnly: true },
        ],
      },
      { to: '/panduan', label: 'Panduan', icon: BookOpen, keywords: 'guide panduan bantuan help arti status istilah alur cara' },
    ],
  },
]

/** Pages reached from another menu entry (detail / new pages, older paths). */
const EXTRA: { prefix: string; parent: string; label: string }[] = [
  { prefix: '/purchase-returns/new', parent: '/purchase-returns', label: 'Create return' },
  { prefix: '/ppb/drafts/', parent: '/ppb', label: 'Draft Purchase Request' },
  { prefix: '/purchase-orders/draft', parent: '/purchase-orders', label: 'Draft PO' },
  { prefix: '/stock-card/project', parent: '/stock-card', label: 'Project' },
  { prefix: '/safety-stocks', parent: '/inventory/analysis', label: 'Detail' },
  { prefix: '/sync/', parent: '/sync/history', label: 'Detail' },
  { prefix: '/important-requests/baru', parent: '/important-requests', label: 'Create request' },
  { prefix: '/important-requests/', parent: '/important-requests', label: 'Detail' },
]

export interface Crumb { label: string; to?: string }

type Entry = { to: string; label: string; children?: Entry[] }
/** the menu entries down to the one of exactly this path, deepest first (Item Request › Purchase Order › Dashboard) */
function trailTo(entries: Entry[], pathname: string): Entry[] | null {
  let best: Entry[] | null = null
  for (const e of entries) {
    const below = e.children ? trailTo(e.children, pathname) : null
    const here = below ? [e, ...below] : e.to.split('?')[0] === pathname ? [e] : null
    if (here && (!best || here.length > best.length)) best = here
  }
  return best
}

/** Breadcrumb of a path: group › menu › sub menu, or › detail. */
export function crumbsFor(pathname: string): Crumb[] {
  if (pathname === '/') return [{ label: 'Dashboard' }]
  // a page of its own in the menu (also a sub menu): its trail
  for (const g of NAV) {
    const trail = trailTo(g.items as Entry[], pathname)
    if (trail) return [...trail.map((e, i) => ({ label: e.label, to: i < trail.length - 1 ? e.to : undefined }))]
  }
  const all = NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label })))
  const extra = EXTRA.find((e) => pathname.startsWith(e.prefix) && pathname !== e.parent)
  const base = extra ? all.find((i) => i.to === extra.parent) : [...all].filter((i) => i.to !== '/' && (pathname === i.to || pathname.startsWith(i.to + '/')))
    .sort((a, b) => b.to.length - a.to.length)[0]
  if (!base) return []
  const out: Crumb[] = []
  if (pathname === base.to) {
    out.push({ label: base.label })
  } else {
    out.push({ label: base.label, to: base.to })
    out.push({ label: extra?.label ?? 'Detail' })
  }
  return out
}

/** The menu entries a user can open. */
export function visibleNav(hasPermission: (p: string) => boolean, isSuperAdmin = false): NavGroup[] {
  const can = (perms?: string[]) => !perms || perms.some((p) => hasPermission(p))
  return NAV.map((g) => ({
    ...g,
    items: g.items.filter((n) => can(n.permissions)).map((n) => {
      if (!n.children) return n
      const children = n.children.filter((c) => can(c.permissions) && (!c.superAdminOnly || isSuperAdmin))
      // without the right to open the menu's own page, it opens its first sub menu the user may open (e.g. only Vendor & Supplier)
      return { ...n, children, to: can(n.selfPermissions) || children.length === 0 ? n.to : children[0].to }
    }),
  })).filter((g) => g.items.length > 0)
}

/** The icon and colour of the menu a page belongs to. */
export function pageMeta(pathname: string): { icon: LucideIcon; tone: string } | null {
  let best: { icon: LucideIcon; tone: string; len: number } | null = null
  for (const g of NAV) for (const i of g.items) for (const to of [i.to, ...(i.children ?? []).map((c) => c.to)]) {
    const p = to.split('?')[0]
    if (p !== '/' && (pathname === p || pathname.startsWith(p + '/')) && (!best || p.length > best.len)) best = { icon: i.icon, tone: g.tone, len: p.length }
  }
  return best
}
