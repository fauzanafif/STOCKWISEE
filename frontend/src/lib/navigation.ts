import { Factory, Layers, PackageMinus, BookOpen, ClipboardCheck, ClipboardList, ClipboardPen, History, FolderTree, Handshake, LayoutDashboard, type LucideIcon, Package, PackageCheck, PackageOpen, Settings, ShoppingCart, Store, Undo2, Users, Wrench, BookOpenCheck, ShieldCheck, ClipboardType, Ruler, Tags, ShieldAlert } from 'lucide-react'

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
    items: [{
      to: '/overview', label: 'Dashboard', icon: LayoutDashboard, keywords: 'beranda ringkasan',
      children: [
        // every dashboard of every app lives here (a button per app on each page)
        { to: '/overview', label: 'Overview', keywords: 'beranda ringkasan overview kartu fitur modul inventory purchase manufacturing tracking' },
        { to: '/todo', label: 'To-Do', keywords: 'beranda tugas catatan pengingat todo' },
        { to: '/analytics', label: 'Analytics', keywords: 'analitik analytics grafik visualisasi stok pengadaan tracking kartu stock' },
        { to: '/dashboards', label: 'Custom Dashboards', keywords: 'dashboard kustom sendiri buat widget grafik kpi tabel new dashboard' },
      ],
    }],
  },
  {
    label: 'Tasks', tone: 'bg-violet-100 text-violet-700',
    items: [
      {
        to: '/important-requests/tugas', label: 'Important Request', icon: ClipboardPen, permissions: ['important_request.access'], badge: 'important', keywords: 'instruksi tugas perintah kerja direktur atasan',
        children: [
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
        to: '/item-requests', label: 'Item Request', icon: ClipboardList, keywords: 'permintaan item request',
        selfPermissions: ['item_request.create', 'item_request.view'],
        permissions: ['item_request.create', 'item_request.view', 'npbg.view'],
        children: [
          { to: '/item-requests', label: 'List Request', keywords: 'list request', permissions: ['item_request.create', 'item_request.view'] },
          { to: '/npbg', label: 'Delivery Order', keywords: 'npbg barang keluar pengeluaran', permissions: ['npbg.view'] },
        ],
      },
      {
        to: '/ppb', label: 'Purchase Request', icon: PackageOpen, keywords: 'ppb permintaan pembelian', permissions: ['ppb.view', 'ppb.create'],
        children: [
          { to: '/ppb/drafts', label: 'Draft Purchase Request', keywords: 'draft ppb perbandingan harga vendor penawaran', permissions: ['ppb.create'] },
          { to: '/ppb', label: 'List Purchase Request', keywords: 'ppb permintaan pembelian', permissions: ['ppb.view'] },
        ],
      },
      {
        to: '/purchase-orders', label: 'Purchase Order', icon: ShoppingCart, keywords: 'po purchasing pembelian', permissions: ['po.view', 'po.create', 'po.approve_director'],
        children: [
          { to: '/purchase-orders/siap-po', label: 'Approved Purchase Request Items', keywords: 'ppb siap po disetujui', permissions: ['po.create'] },
          { to: '/purchase-orders/draft', label: 'Price Quotation', keywords: 'rfq price quotation penawaran harga vendor perbandingan ketersediaan eta pilihan direktur draft po matriks', permissions: ['po.create', 'po.approve_director'] },
          { to: '/purchase-orders', label: 'List PO', keywords: 'po purchasing pembelian', permissions: ['po.view'] },
        ],
      },
      {
        to: '/ri', label: 'Receipt', icon: PackageCheck, keywords: 'ri penerimaan barang masuk list receipt', permissions: ['ri.view'],
      },
      {
        to: '/price-list', label: 'Purchase Information', icon: Tags, keywords: 'price list daftar harga matrix vendor item harga beli referensi pricelist', permissions: ['rfq.view'],
        children: [
          { to: '/price-list/drafts', label: 'Draft Purchase Information', keywords: 'draft price list buat harga matrix item vendor set harga', permissions: ['rfq.view'] },
          { to: '/price-list', label: 'Purchase Information', keywords: 'purchase information master price list pricelist harga resmi vendor riwayat history last update', permissions: ['rfq.view'] },
        ],
      },
      { to: '/purchase-returns', label: 'Return', icon: Undo2, keywords: 'purchase return retur vendor', permissions: ['purchase_return.view'] },
    ],
  },
  {
    label: 'Manufacturing', tone: 'bg-indigo-100 text-indigo-700',
    items: [
      {
        to: '/mrp/orders', label: 'Manufacturing Orders', icon: Factory, keywords: 'mo produksi production assembly perakitan manufaktur', permissions: ['mrp.view'],
        children: [
          { to: '/mrp/orders', label: 'List MO', keywords: 'manufacturing order produksi', permissions: ['mrp.view'] },
          { to: '/mrp/history', label: 'Production History', keywords: 'riwayat laporan produksi pemakaian scrap traceability', permissions: ['mrp.view'] },
        ],
      },
      { to: '/mrp/boms', label: 'Bills of Materials', icon: Layers, keywords: 'bom komponen resep bahan rakitan', permissions: ['mrp.view'] },
      {
        to: '/disassembly/orders', label: 'Disassembly', icon: PackageMinus, keywords: 'disassembly unbuild bongkar pembongkaran urai', permissions: ['disassembly.view'],
        children: [
          { to: '/disassembly/orders', label: 'Disassembly Orders', keywords: 'bongkar unbuild', permissions: ['disassembly.view'] },
          { to: '/disassembly/history', label: 'Disassembly History', keywords: 'riwayat pembongkaran scrap hilang', permissions: ['disassembly.view'] },
        ],
      },
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
      { to: '/master-data/quality', label: 'Data Quality', icon: ShieldAlert, keywords: 'kualitas data master duplikat ganda satuan kosong vendor mirip departemen konversi tinjau review', permissions: ['item.view', 'master.unit.view', 'master.vendor.view', 'master.employee.view'] },
      { to: '/uom', label: 'UOM', icon: Ruler, keywords: 'uom satuan konversi unit measure pack pcs', permissions: ['master.unit.view'] },
    ],
  },
  {
    label: 'SISTEM', tone: 'bg-teal-100 text-teal-700',
    items: [
      {
        to: '/activity/users', label: 'Log Aktivitas', icon: History, keywords: 'log aktivitas activity audit riwayat sync accurate integrasi', selfPermissions: ['audit_log.view'],
        permissions: ['audit_log.view', 'sync.accurate.view', 'accurate.session.view'],
        children: [
            { to: '/activity/users', label: 'User Log', keywords: 'log user aktivitas login logout halaman transaksi edit hapus audit jejak', permissions: ['audit_log.view'] },
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

/** The App Launcher: the home after login (see lib/launcher.ts). */
export const APPS_HOME = '/'

/**
 * The one dashboard of each app (lib/launcher.ts opens it from the tile): its to-do, its key figures,
 * every menu of the app and its analysis. The menus' own dashboards were folded into these.
 */
export const APP_HOMES = { inventory: '/inventory', purchase: '/purchase', manufacturing: '/mrp', tracking: '/tracking' } as const
const HOME_LABELS: Record<string, string> = { '/inventory': 'Inventory', '/purchase': 'Purchase', '/mrp': 'Manufacturing', '/tracking': 'Tracking' }

/** Pages reached from another menu entry (detail / new pages, older paths). */
const EXTRA: { prefix: string; parent: string; label: string }[] = [
  { prefix: '/purchase-returns/new', parent: '/purchase-returns', label: 'Create return' },
  { prefix: '/ppb/drafts/', parent: '/ppb', label: 'Draft Purchase Request' },
  { prefix: '/purchase-orders/draft', parent: '/purchase-orders', label: 'Price Quotation' },
  { prefix: '/price-list/drafts/', parent: '/price-list/drafts', label: 'Draft' },
  { prefix: '/dashboards/', parent: '/dashboards', label: 'Dashboard' },
  { prefix: '/stock-card/project', parent: '/stock-card', label: 'Project' },
  { prefix: '/safety-stocks', parent: '/inventory/analysis', label: 'Detail' },
  { prefix: '/sync/', parent: '/sync/history', label: 'Detail' },
  { prefix: '/important-requests/baru', parent: '/important-requests/tugas', label: 'Create request' },
  { prefix: '/important-requests/', parent: '/important-requests/tugas', label: 'Detail' },
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
  if (pathname === APPS_HOME) return [{ label: 'Apps' }]
  if (pathname.startsWith('/coming-soon/')) return [{ label: 'Apps', to: APPS_HOME }, { label: 'Coming Soon' }]
  if (HOME_LABELS[pathname]) return [{ label: HOME_LABELS[pathname] }, { label: 'Dashboard' }]
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
