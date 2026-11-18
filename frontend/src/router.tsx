import { createBrowserRouter, Navigate } from 'react-router-dom'
import { recordLocation } from '@/lib/navHistory'
import { RequireAuth, RequirePermission, RequireRole } from '@/auth/guards'
import { AppLayout } from '@/components/AppLayout'
import { DashboardPage } from '@/pages/DashboardPage'
import { AppsPage } from '@/pages/AppsPage'
import { ComingSoonPage } from '@/pages/ComingSoonPage'
import { AppDashboardPage } from '@/pages/AppDashboardPage'
import { CustomDashboardListPage, CustomDashboardPage } from '@/pages/CustomDashboardPages'
import { AnalyticsPage } from '@/pages/AnalyticsPage'
import { VendorsPage } from '@/pages/VendorsPage'
import { EmployeesPage } from '@/pages/EmployeesPage'
import { ItemCategoriesPage } from '@/pages/ItemCategoriesPage'
import { UomPage } from '@/pages/UomPage'
import { IrListPage } from '@/pages/importantRequests/IrListPages'
import { IrDetailPage } from '@/pages/importantRequests/IrDetailPage'
import { IrFormPage } from '@/pages/importantRequests/IrFormPage'
import { IrAnalyticsPage } from '@/pages/importantRequests/IrAnalyticsPage'
import { HealthPage } from '@/pages/HealthPage'
import { InventoryHealthPage } from '@/pages/InventoryHealthPage'
import { ItemsPage } from '@/pages/ItemsPage'
import { LoginPage } from '@/pages/LoginPage'
import { NpbgDetailPage } from '@/pages/NpbgDetailPage'
import { NpbgListPage } from '@/pages/NpbgListPage'
import { OpnameDetailPage } from '@/pages/OpnameDetailPage'
import { OpnameListPage } from '@/pages/OpnameListPage'
import { StockCardPage } from '@/pages/StockCardPage'
import { StockCardProjectsPage } from '@/pages/StockCardProjectsPage'
import { StockCardProjectPage } from '@/pages/StockCardProjectPage'
import { PoDetailPage } from '@/pages/PoDetailPage'
import { PoListPage } from '@/pages/PoListPage'
import { PoDraftPage, PoReadyPage } from '@/pages/PoFlowPages'
import { PriceListPage } from '@/pages/PriceListPage'
import { PriceListDraftListPage, PriceListDraftPage } from '@/pages/PriceListDraftPages'
import { DataQualityPage } from '@/pages/DataQualityPage'
import { PpbDetailPage } from '@/pages/PpbDetailPage'
import { PpbListPage } from '@/pages/PpbListPage'
import { RiDetailPage } from '@/pages/RiDetailPage'
import { RiListPage } from '@/pages/RiListPage'
import { SyncPage } from '@/pages/SyncPage'
import { UserLogPage } from '@/pages/UserLogPage'
import { AccurateOnlinePage } from '@/pages/AccurateOnlinePage'
import { BorrowPage } from '@/pages/tracking/BorrowPage'
import { LendPage } from '@/pages/tracking/LendPage'
import { MaintenancePage } from '@/pages/tracking/MaintenancePage'
import { ManufacturingPage } from '@/pages/tracking/ManufacturingPage'
import { StppPage } from '@/pages/tracking/StppPage'
import { TyrePage } from '@/pages/tracking/TyrePage'
import { UsedReturnPage } from '@/pages/tracking/UsedReturnPage'
import { UsersPage } from '@/pages/UsersPage'
import { RolesPage } from '@/pages/RolesPage'
import { UpdateAlertsPage } from '@/pages/UpdateAlertsPage'
import { AutoRefreshPage } from '@/pages/AutoRefreshPage'
import { GuidePage } from '@/pages/GuidePage'
import { SharedStockCardLayout, SharedStockCardProject } from '@/pages/SharedStockCardLayout'
import { PublicItemRequestPage } from '@/pages/PublicItemRequestPage'
import { ItemRequestListPage } from '@/pages/ItemRequestListPage'
import { ItemRequestDetailPage } from '@/pages/ItemRequestDetailPage'
import { ApprovalPage } from '@/pages/ApprovalPage'
import { PpbDraftListPage, PpbDraftPage } from '@/pages/PpbDraftPage'
import { PurchaseReturnListPage } from '@/pages/PurchaseReturnListPage'
import { PurchaseReturnNewPage } from '@/pages/PurchaseReturnNewPage'
import { PurchaseReturnDetailPage } from '@/pages/PurchaseReturnDetailPage'
import { BomListPage } from '@/pages/mrp/BomListPage'
import { BomDetailPage } from '@/pages/mrp/BomDetailPage'
import { MoListPage } from '@/pages/mrp/MoListPage'
import { MoDetailPage } from '@/pages/mrp/MoDetailPage'
import { ProductionHistoryPage } from '@/pages/mrp/ProductionHistoryPage'
import { DisassemblyListPage } from '@/pages/disassembly/DisassemblyListPage'
import { DisassemblyDetailPage } from '@/pages/disassembly/DisassemblyDetailPage'
import { DisassemblyHistoryPage } from '@/pages/disassembly/DisassemblyHistoryPage'
import { RequestStatusPage } from '@/pages/RequestStatusPage'
import { APPROVAL_PERMISSIONS } from '@/features/itemRequests/api'
import { ModuleDashboardPage } from '@/pages/ModuleDashboardPage'

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/health', element: <HealthPage /> },
  // Kartu Stock through a share link: no account, the link's project only.
  {
    path: '/share/kartu-stock/:token',
    element: <SharedStockCardLayout />,
    children: [
      { index: true, element: <SharedStockCardProject /> },
      { path: 'kartu/:id', element: <StockCardPage /> },
    ],
  },
  // Request Barang through a share link: no account, can only send a request.
  { path: '/form/request/:token', element: <PublicItemRequestPage /> },
  // Cek Permintaan: a requester follows their requests without an account
  { path: '/cek-permintaan', element: <RequestStatusPage /> },
  { path: '/cek-permintaan/:token', element: <RequestStatusPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: '/', element: <AppsPage /> },
          { path: '/todo', element: <DashboardPage /> },
          { path: '/apps', element: <Navigate to="/" replace /> },
          { path: '/coming-soon/:app', element: <ComingSoonPage /> },
          // one dashboard per app (the tile on the launcher opens it); the old menu dashboards lead to it
          { path: '/inventory', element: <AppDashboardPage key="inventory" appKey="inventory" /> },
          { path: '/purchase', element: <AppDashboardPage key="purchase" appKey="purchase" /> },
          { path: '/mrp', element: <AppDashboardPage key="manufacturing" appKey="manufacturing" /> },
          { path: '/tracking', element: <AppDashboardPage key="tracking" appKey="tracking" /> },
          { path: '/analytics', element: <AnalyticsPage /> },
          // custom dashboards: every signed-in user; each widget reads its data with the viewer's permissions
          { path: '/dashboards', element: <CustomDashboardListPage /> },
          { path: '/dashboards/:id', element: <CustomDashboardPage /> },
          { path: '/item-requests/dashboard', element: <Navigate to="/inventory" replace /> },
          { path: '/ri/dashboard', element: <Navigate to="/inventory" replace /> },
          { path: '/ppb/dashboard', element: <Navigate to="/purchase" replace /> },
          { path: '/purchase-orders/dashboard', element: <Navigate to="/purchase" replace /> },
          { path: '/mrp/dashboard', element: <Navigate to="/mrp" replace /> },
          { path: '/disassembly', element: <Navigate to="/mrp" replace /> },
          { path: '/disassembly/dashboard', element: <Navigate to="/mrp" replace /> },
          {
            element: <RequirePermission permission={['item_request.create', 'item_request.view']} />,
            children: [
              { path: '/item-requests', element: <ItemRequestListPage /> },
            ],
          },
          {
            // the requester, admin gudang, and every approver of the request's steps
            element: <RequirePermission permission={['item_request.create', 'item_request.view', ...APPROVAL_PERMISSIONS]} />,
            children: [
              { path: '/item-requests/:id', element: <ItemRequestDetailPage /> },
            ],
          },
          {
            // Draft PPB from the Restock button (Analisis & Safety Stock)
            element: <RequirePermission permission={['ppb.create']} />,
            children: [
              { path: '/ppb/drafts', element: <PpbDraftListPage /> },
              { path: '/ppb/drafts/:id', element: <PpbDraftPage /> },
            ],
          },
          {
            // Master Vendor & Supplier (one master for both)
            element: <RequirePermission permission={['master.vendor.view']} />,
            children: [{ path: '/vendors', element: <VendorsPage /> }],
          },
          {
            // Important Request
            element: <RequirePermission permission={['important_request.access']} />,
            children: [
              { path: '/important-requests', element: <ModuleDashboardPage key="important" module="important" /> },
              { path: '/important-requests/saya', element: <IrListPage key="mine" scope="mine" /> },
              { path: '/important-requests/tugas', element: <IrListPage key="tasks" scope="tasks" /> },
              { path: '/important-requests/persetujuan', element: <IrListPage key="review" scope="review" /> },
              { path: '/important-requests/selesai', element: <IrListPage key="done" scope="done" /> },
              { path: '/important-requests/:id', element: <IrDetailPage /> },
            ],
          },
          {
            element: <RequirePermission permission={['important_request.create']} />,
            children: [
              { path: '/important-requests/baru', element: <IrFormPage key="new" /> },
              { path: '/important-requests/:id/ubah', element: <IrFormPage key="edit" /> },
            ],
          },
          {
            element: <RequirePermission permission={['important_request.analytics']} />,
            children: [{ path: '/analytics/important-requests', element: <IrAnalyticsPage /> }],
          },
          {
            // Master Data · Data Pekerja
            element: <RequirePermission permission={['master.employee.view']} />,
            children: [{ path: '/employees', element: <EmployeesPage /> }],
          },
          {
            // Master Data · Kategori Barang
            element: <RequirePermission permission={['master.unit.view']} />,
            children: [{ path: '/uom', element: <UomPage /> }],
          },
          {
            element: <RequirePermission permission={['master.category.view']} />,
            children: [{ path: '/item-categories', element: <ItemCategoriesPage /> }],
          },
          {
            // Manufacturing (BoM + Manufacturing Order); the Tracking sheet stays at /manufacturing
            element: <RequirePermission permission={['mrp.view']} />,
            children: [
              { path: '/mrp/orders', element: <MoListPage /> },
              { path: '/mrp/orders/:id', element: <MoDetailPage /> },
              { path: '/mrp/history', element: <ProductionHistoryPage /> },
              { path: '/mrp/boms', element: <BomListPage /> },
              { path: '/mrp/boms/:id', element: <BomDetailPage /> },
            ],
          },
          {
            element: <RequirePermission permission={['mrp.bom.manage']} />,
            children: [{ path: '/mrp/boms/new', element: <BomDetailPage key="new" /> }],
          },
          {
            // Disassembly (unbuild): one product taken apart into its BoM components
            element: <RequirePermission permission={['disassembly.view']} />,
            children: [
              { path: '/disassembly/orders', element: <DisassemblyListPage /> },
              { path: '/disassembly/orders/:id', element: <DisassemblyDetailPage /> },
              { path: '/disassembly/history', element: <DisassemblyHistoryPage /> },
            ],
          },
          {
            element: <RequirePermission permission={['purchase_return.view']} />,
            children: [
              { path: '/purchase-returns', element: <PurchaseReturnListPage /> },
              { path: '/purchase-returns/:id', element: <PurchaseReturnDetailPage /> },
            ],
          },
          {
            element: <RequirePermission permission={['purchase_return.manage']} />,
            children: [
              { path: '/purchase-returns/new', element: <PurchaseReturnNewPage /> },
            ],
          },
          {
            element: <RequirePermission permission={APPROVAL_PERMISSIONS} />,
            children: [
              { path: '/approvals', element: <ApprovalPage /> },
            ],
          },
          {
            element: <RequirePermission permission={['npbg.view']} />,
            children: [
              { path: '/npbg', element: <NpbgListPage /> },
              { path: '/npbg/:id', element: <NpbgDetailPage /> },
            ],
          },
          {
            element: <RequirePermission permission={['ppb.view']} />,
            children: [
              { path: '/ppb', element: <PpbListPage /> },
              { path: '/ppb/:id', element: <PpbDetailPage /> },
            ],
          },
          {
            // Data Quality: master data that needs a look (read only)
            element: <RequirePermission permission={['item.view', 'master.unit.view', 'master.vendor.view', 'master.employee.view']} />,
            children: [{ path: '/master-data/quality', element: <DataQualityPage /> }],
          },
          {
            // Price List: the standing prices, Item × Vendor (apart from any Purchase Request)
            element: <RequirePermission permission={['rfq.view']} />,
            children: [
              { path: '/price-list', element: <PriceListPage /> },
              { path: '/price-list/drafts', element: <PriceListDraftListPage /> },
              { path: '/price-list/drafts/:id', element: <PriceListDraftPage /> },
            ],
          },
          {
            // PPB Siap PO → Price Quotation (vendor prices, Director picks, Draft PO)
            element: <RequirePermission permission={['po.create', 'po.approve_director']} />,
            children: [
              { path: '/purchase-orders/siap-po', element: <PoReadyPage /> },
              { path: '/purchase-orders/draft', element: <PoDraftPage /> },
              { path: '/purchase-orders/draft-harga', element: <Navigate to="/purchase-orders/draft" replace /> },
              { path: '/purchase-orders/penawaran', element: <Navigate to="/purchase-orders/draft" replace /> },
            ],
          },
          {
            element: <RequirePermission permission="po.view" />,
            children: [
              { path: '/purchase-orders', element: <PoListPage /> },
              { path: '/purchase-orders/:id', element: <PoDetailPage /> },
            ],
          },
          {
            element: <RequirePermission permission={['ri.view']} />,
            children: [
              { path: '/ri', element: <RiListPage /> },
              { path: '/ri/:id', element: <RiDetailPage /> },
            ],
          },
          {
            element: <RequirePermission permission={['item.view', 'inventory.view']} />,
            children: [
              { path: '/stock-card', element: <StockCardProjectsPage /> },
              { path: '/stock-card/project/:projectId', element: <StockCardProjectPage /> },
              { path: '/stock-card/:id', element: <StockCardPage /> },
            ],
          },
          {
            element: <RequirePermission permission="opname.view" />,
            children: [
              { path: '/stock-opnames', element: <OpnameListPage /> },
              { path: '/stock-opnames/:id', element: <OpnameDetailPage /> },
            ],
          },
          {
            element: <RequirePermission permission="lend.view" />,
            children: [{ path: '/lend', element: <LendPage /> }],
          },
          {
            element: <RequirePermission permission="borrow.view" />,
            children: [{ path: '/borrow', element: <BorrowPage /> }],
          },
          {
            element: <RequirePermission permission="stpp.view" />,
            children: [{ path: '/stpp', element: <StppPage /> }],
          },
          {
            element: <RequirePermission permission="tyre.view" />,
            children: [{ path: '/tyre-changes', element: <TyrePage /> }],
          },
          {
            element: <RequirePermission permission="maintenance.view" />,
            children: [{ path: '/maintenance', element: <MaintenancePage /> }],
          },
          {
            element: <RequirePermission permission="manufacturing.view" />,
            children: [{ path: '/manufacturing', element: <ManufacturingPage /> }],
          },
          {
            element: <RequirePermission permission="used_return.view" />,
            children: [{ path: '/used-returns', element: <UsedReturnPage /> }],
          },
          {
            element: <RequirePermission permission="item.view" />,
            children: [{ path: '/items', element: <ItemsPage /> }],
          },
          {
            element: <RequirePermission permission={['inventory.view_analysis', 'item.safety_stock.view']} />,
            children: [
              { path: '/inventory/analysis', element: <InventoryHealthPage /> },
              // Safety Stock digabung ke halaman di atas (tab); link/bookmark lama tetap jalan
              { path: '/safety-stocks', element: <Navigate to="/inventory/analysis?tab=safety" replace /> },
            ],
          },
          {
            element: <RequirePermission permission="audit_log.view" />,
            children: [{ path: '/activity/users', element: <UserLogPage /> }],
          },
          {
            element: <RequirePermission permission="sync.accurate.view" />,
            children: [
              // Log Agen merged into this same page (as a tab); old links / bookmarks still land there
              { path: '/sync/accurate', element: <Navigate to="/sync/history" replace /> },
              { path: '/sync/agent-log', element: <Navigate to="/sync/history" replace /> },
              { path: '/sync/history', element: <SyncPage /> },
            ],
          },
          {
            element: <RequirePermission permission="accurate.session.view" />,
            children: [{ path: '/accurate/online', element: <AccurateOnlinePage /> }],
          },
          {
            element: <RequirePermission permission="user.view" />,
            children: [{ path: '/settings/users', element: <UsersPage /> }],
          },
          {
            element: <RequirePermission permission="role.view" />,
            children: [{ path: '/settings/roles', element: <RolesPage /> }],
          },
          {
            element: <RequireRole role="super_admin" />,
            children: [
              { path: '/settings/update-alerts', element: <UpdateAlertsPage /> },
              { path: '/settings/auto-refresh', element: <AutoRefreshPage /> },
            ],
          },
          { path: '/panduan', element: <GuidePage /> },
          { path: '*', element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
])

// remember where the user came from, for the sub pages' back control (components/BackLink.tsx)
recordLocation(router.state.location.pathname, router.state.location.search)
router.subscribe((state) => recordLocation(state.location.pathname, state.location.search))
