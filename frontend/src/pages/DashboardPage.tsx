import { useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { ReminderList } from '@/pages/ModuleDashboardPage'
import { useAuth } from '@/auth/AuthContext'
import { useReminders } from '@/features/reminders/api'
import { useDashboard } from '@/features/dashboard/api'
import { useSyncStatus } from '@/features/sync/api'
import { InventoryDashboard } from '@/components/dashboard/InventoryDashboard'
import { TrackingDashboard } from '@/components/dashboard/OperationsDashboard'
import { ProcurementDashboard } from '@/components/dashboard/ProcurementDashboard'
import { StockCardReport } from '@/components/dashboard/StockCardReport'
import { exportElementToPdf } from '@/lib/exportDashboardPdf'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const SYNC_LABEL: Record<string, string> = { SUCCESS: 'successful', FAILED: 'failed', PARTIAL: 'partial', RUNNING: 'running' }

/** Clearer wording than the API's short labels, in the order of the work. */
const KPI: Record<string, { label: string; to: string; group: string }> = {
  opname_active: { label: 'Opname running', to: '/stock-opnames', group: 'Warehouse' },
  ppb_accurate_open: { label: 'Purchase Request rows waiting for items', to: '/ppb', group: 'Pengadaan' },
  po_open: { label: 'Running POs', to: '/purchase-orders', group: 'Pengadaan' },
  ri_accurate_month: { label: 'Receipt this month', to: '/ri', group: 'Pengadaan' },
  lend_open: { label: 'Items lent', to: '/lend', group: 'Tracking' },
  lend_overdue: { label: 'Overdue loans', to: '/lend', group: 'Tracking' },
  borrow_open: { label: 'Borrowed from outside', to: '/borrow', group: 'Tracking' },
  spk_open: { label: 'Running maintenance SPK', to: '/maintenance', group: 'Tracking' },
}

const TABS = [
  { id: 'ringkasan', label: 'Summary' },
  { id: 'stok', label: 'Stock Condition' },
  { id: 'pengadaan', label: 'Procurement' },
  { id: 'tracking', label: 'Tracking' },
  { id: 'kartu-stock', label: 'Stock Card' },
] as const
type TabId = (typeof TABS)[number]['id']

/** The main doors of each kind of work: only what this account may do, the most common first. */
const SHORTCUTS: { to: string; label: string; perms: string[] }[] = [
  { to: '/approvals', label: 'Approval', perms: ['item_request.approve_manager', 'item_request.approve_director', 'item_request.handover', 'ppb.approve_manager', 'ppb.approve_director', 'po.approve_director', 'npbg.approve_manager', 'npbg.approve_director'] },
  { to: '/item-requests', label: 'Item Request', perms: ['item_request.create', 'item_request.view'] },
  { to: '/important-requests/tugas', label: 'My Tasks', perms: ['important_request.access'] },
  { to: '/ppb/drafts', label: 'Draft Purchase Request', perms: ['ppb.create'] },
  { to: '/purchase-orders/siap-po', label: 'Approved Purchase Request Items', perms: ['po.create'] },
  { to: '/purchase-orders/penawaran', label: 'RFQ', perms: ['po.create', 'po.approve_director'] },
  { to: '/purchase-orders/draft', label: 'Draft PO', perms: ['po.create'] },
  { to: '/ri', label: 'Receipt', perms: ['ri.view'] },
  { to: '/stock-opnames', label: 'Physical Inventory', perms: ['opname.view'] },
  { to: '/stock-card', label: 'Stock Card', perms: ['item.view', 'inventory.view'] },
]

function SideList({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-4 shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
      <h2 className="border-b pb-2 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function AccurateSyncLine() {
  const { hasPermission } = useAuth()
  const canView = hasPermission('sync.accurate.view')
  const { data: sync } = useSyncStatus(canView)
  if (!canView) return null
  return (
    <Link to="/sync/history" className="block text-xs text-muted-foreground hover:text-foreground">
      Last Accurate sync {sync ? `${new Date(sync.started_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })} · ${SYNC_LABEL[sync.status] ?? sync.status}` : 'never'}
    </Link>
  )
}

/**
 * The work first: what waits for this account (each role sees its own, from the reminders), its doors and
 * key numbers beside it. The detailed analytics each have their own tab.
 */
export function DashboardPage() {
  const { user, hasPermission } = useAuth()
  const { data } = useDashboard()
  const exportRootRef = useRef<HTMLDivElement>(null)
  const [exporting, setExporting] = useState(false)
  const [params, setParams] = useSearchParams()

  const { data: waiting } = useReminders()
  const meta = waiting?.meta
  if (!user) return null
  const hour = new Date().getHours()
  const greet = hour < 11 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  const showStockCard = hasPermission('item.view') || hasPermission('inventory.view')
  const tabs = TABS.filter((t) => t.id !== 'kartu-stock' || showStockCard)
  const tab: TabId = (tabs.find((t) => t.id === params.get('tab'))?.id ?? 'ringkasan') as TabId
  const pick = (id: TabId) => setParams(id === 'ringkasan' ? {} : { tab: id }, { replace: true })
  const label = tabs.find((t) => t.id === tab)?.label ?? 'Summary'

  const cards = (data?.cards ?? []).filter((c) => KPI[c.key]).sort((a, b) => Object.keys(KPI).indexOf(a.key) - Object.keys(KPI).indexOf(b.key))
  const shortcuts = SHORTCUTS.filter((s) => s.perms.some((p) => hasPermission(p))).slice(0, 7)

  async function handleExportPdf() {
    if (!exportRootRef.current || exporting) return
    setExporting(true)
    try {
      await exportElementToPdf(exportRootRef.current, {
        title: `STOCKWISE Dashboard · ${label}`,
        subtitle: 'PT Surya Inti Gas',
        filename: `Dashboard-STOCKWISE-${label.replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.pdf`,
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-gradient-to-r from-[#1e3a8a] via-[#1d4ed8] to-[#2563eb] p-4 text-white sm:p-5 print:bg-none print:text-foreground">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">{greet}, {user.name.split(' ')[0]}</h1>
            <p className="mt-0.5 text-[13px] text-blue-100">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · {user.roles.join(', ')}</p>
          </div>
          <div className="flex gap-2 print:hidden">
            <Button size="sm" className="bg-white/15 text-white hover:bg-white/25" onClick={handleExportPdf} disabled={exporting}>
              {exporting && <Loader2 className="size-4 animate-spin" />}{exporting ? 'Creating PDF…' : 'Download PDF'}
            </Button>
            <Button size="sm" className="bg-white/15 text-white hover:bg-white/25" onClick={() => window.print()}>Print</Button>
          </div>
        </div>
        <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
          {[['To do', meta?.total ?? 0], ['Late', meta?.overdue ?? 0], ['Urgent', meta?.urgent ?? 0]].map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-2"><dd className="text-2xl font-semibold tabular-nums">{Number(v).toLocaleString('id-ID')}</dd><dt className="text-[13px] text-blue-100">{k}</dt></div>
          ))}
        </dl>
      </div>

      <nav className="flex gap-1 overflow-x-auto border-b print:hidden" aria-label="Dashboard sections">
        {tabs.map((t) => (
          <button key={t.id} type="button" onClick={() => pick(t.id)} aria-current={tab === t.id ? 'page' : undefined}
            className={cn('-mb-px shrink-0 border-b-2 px-3 pb-2 pt-1 text-[13px] transition-colors max-md:py-2.5',
              tab === t.id ? 'border-primary font-medium text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {t.label}
          </button>
        ))}
      </nav>

      <div ref={exportRootRef}>
        {tab === 'ringkasan' && (
          <div className="grid items-start gap-4 pt-1 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <section className="min-w-0 rounded-lg border bg-card p-4 shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
              <h2 className="pb-2 text-sm font-semibold">To do</h2>
              <ReminderList />
            </section>
            <div className="space-y-4">
              {shortcuts.length > 0 && (
                <SideList title="Quick access">
                  <ul className="divide-y">
                    {shortcuts.map((s) => <li key={s.to}><Link to={s.to} className="block py-2 text-[13px] text-primary hover:underline max-md:py-3">{s.label}</Link></li>)}
                  </ul>
                </SideList>
              )}
              {cards.length > 0 && (
                <SideList title="Key figures">
                  <dl className="divide-y">
                    {cards.map((c) => (
                      <Link key={c.key} to={KPI[c.key].to} className="flex items-baseline justify-between gap-3 py-2 text-[13px] hover:bg-muted/50 max-md:py-3">
                        <dt className="min-w-0 text-muted-foreground">{KPI[c.key].label}</dt>
                        <dd className={cn('font-medium tabular-nums', c.tone === 'danger' && Number(c.value) > 0 && 'text-red-700')}>{Number(c.value).toLocaleString('id-ID')}</dd>
                      </Link>
                    ))}
                  </dl>
                </SideList>
              )}
              <AccurateSyncLine />
            </div>
          </div>
        )}
        {tab === 'stok' && <InventoryDashboard />}
        {tab === 'pengadaan' && <ProcurementDashboard poStatus={data?.charts.po_status} />}
        {tab === 'tracking' && <TrackingDashboard />}
        {tab === 'kartu-stock' && showStockCard && <StockCardReport />}
      </div>
    </div>
  )
}
