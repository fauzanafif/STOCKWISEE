<?php

use App\Http\Controllers\Api\AccurateSessionController;
use App\Http\Controllers\Api\ActivityLogController;
use App\Http\Controllers\Api\Agent\AccurateIngestController;
use App\Http\Controllers\Api\AgentLogController;
use App\Http\Controllers\Api\AgentRunController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\AutoRefreshController;
use App\Http\Controllers\Api\AvatarController;
use App\Http\Controllers\Api\CustomDashboardController;
use App\Http\Controllers\Api\DashboardController;
use App\Http\Controllers\Api\DashboardNoteController;
use App\Http\Controllers\Api\Disassembly\DisassemblyController;
use App\Http\Controllers\Api\DocumentController;
use App\Http\Controllers\Api\EmployeeController;
use App\Http\Controllers\Api\ExportController;
use App\Http\Controllers\Api\HealthController;
use App\Http\Controllers\Api\ImportantRequestController;
use App\Http\Controllers\Api\InventoryController;
use App\Http\Controllers\Api\InventoryDashboardController;
use App\Http\Controllers\Api\ItemCategoryController;
use App\Http\Controllers\Api\ItemController;
use App\Http\Controllers\Api\ItemRequestController;
use App\Http\Controllers\Api\ItemRequestLinkController;
use App\Http\Controllers\Api\LegacyExportController;
use App\Http\Controllers\Api\LiveController;
use App\Http\Controllers\Api\MasterDataController;
use App\Http\Controllers\Api\ModuleStatsController;
use App\Http\Controllers\Api\Mrp\BomController;
use App\Http\Controllers\Api\Mrp\MrpReportController;
use App\Http\Controllers\Api\Mrp\ProductionController;
use App\Http\Controllers\Api\NotificationController;
use App\Http\Controllers\Api\NpbgController;
use App\Http\Controllers\Api\NpbgVerificationController;
use App\Http\Controllers\Api\OperationsDashboardController;
use App\Http\Controllers\Api\PermissionController;
use App\Http\Controllers\Api\PoDraftController;
use App\Http\Controllers\Api\PpbController;
use App\Http\Controllers\Api\PpbDraftController;
use App\Http\Controllers\Api\PreferenceController;
use App\Http\Controllers\Api\PriceListController;
use App\Http\Controllers\Api\PriceListDraftController;
use App\Http\Controllers\Api\PublicItemRequestController;
use App\Http\Controllers\Api\PublicStockCardController;
use App\Http\Controllers\Api\PurchaseOrderController;
use App\Http\Controllers\Api\PurchaseReturnController;
use App\Http\Controllers\Api\PurchasingApprovalController;
use App\Http\Controllers\Api\RecordNoteController;
use App\Http\Controllers\Api\ReminderController;
use App\Http\Controllers\Api\RiController;
use App\Http\Controllers\Api\RoleController;
use App\Http\Controllers\Api\SafetyStockController;
use App\Http\Controllers\Api\SignatureController;
use App\Http\Controllers\Api\StockCardController;
use App\Http\Controllers\Api\StockCardDashboardController;
use App\Http\Controllers\Api\StockCardProjectController;
use App\Http\Controllers\Api\StockCardShareLinkController;
use App\Http\Controllers\Api\StockOpnameController;
use App\Http\Controllers\Api\StockOpnameWorkflowController;
use App\Http\Controllers\Api\SyncController;
use App\Http\Controllers\Api\Tracking;
use App\Http\Controllers\Api\UomController;
use App\Http\Controllers\Api\UpdateAlertController;
use App\Http\Controllers\Api\UserController;
use App\Http\Controllers\Api\VendorController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| API Routes
|--------------------------------------------------------------------------
| PHASE 1 — health probe.
| PHASE 2 — auth (login/logout/me) + RBAC (roles/permissions) + route protection.
| Later phases add module routes (see docs/api-spec.md).
*/

Route::get('/ping', HealthController::class)->name('api.ping');

// Named 'login' route so the auth middleware has a redirect target for
// non-JSON guests; this API only ever answers 401.
Route::get('/login', fn () => response()->json(['message' => 'Unauthenticated.'], 401))
    ->name('login');

// a PO's PDF for its vendor (Send to vendor › WhatsApp): a signed link that expires, relative to STOCKWISE_SHARE_URL
Route::get('/public/purchase-orders/{purchaseOrder}/pdf', [PurchaseOrderController::class, 'publicPdf'])->whereNumber('purchaseOrder')
    ->middleware(['signed:relative', 'throttle:60,1'])->name('api.po.public-pdf');

// a profile photo through its signed URL (User::avatarUrl): an <img> sends no token
Route::get('/avatars/{user}', [AvatarController::class, 'show'])->whereNumber('user')
    ->middleware('throttle:600,1,avatars')->name('api.avatars.show');

// an e-sign image through its signed URL (User::signatureUrl): an <img> sends no token
Route::get('/signatures/{user}', [SignatureController::class, 'show'])->whereNumber('user')
    ->middleware('throttle:600,1,signatures')->name('api.signatures.show');

Route::post('/login', [AuthController::class, 'login'])
    ->middleware('throttle:20,1')
    ->name('api.login');

/*
| Kartu Stock through a share link (no account): the token is the access, limited
| to the link's project and its VIEW / EDIT / FULL right. Throttled per IP.
*/
/*
| Request Barang through a share link (no account): can only SEND a request.
| The admin turns each link on / off (ItemRequestLinkController).
*/
Route::get('public/item-request/{token}', [PublicItemRequestController::class, 'show'])
    ->middleware('throttle:60,1')->name('api.public.item-request.show');
Route::post('public/item-request/{token}', [PublicItemRequestController::class, 'store'])
    ->middleware('throttle:6,1,public-request-store')->name('api.public.item-request.store');
// the form opens for a STOCKWISE account: username + password, the requester's data comes back for the form
Route::post('public/item-request/{token}/login', [PublicItemRequestController::class, 'login'])
    ->middleware('throttle:10,1,public-request-login')->name('api.public.item-request.login');
// Cek Permintaan: the requester follows their requests by track token (kept on their device)
// or finds one by number + name. Only the status and the items are shown.
Route::get('public/request-status', [PublicItemRequestController::class, 'status'])
    ->middleware('throttle:60,1')->name('api.public.request-status');
Route::get('public/request-status/image', [PublicItemRequestController::class, 'image'])
    ->middleware('throttle:120,1')->name('api.public.request-status.image');
Route::post('public/request-status/proxy', [PublicItemRequestController::class, 'createProxy'])
    ->middleware('throttle:10,1')->name('api.public.request-status.proxy');
Route::get('public/request-status/proxy-people', [PublicItemRequestController::class, 'proxyPeople'])
    ->middleware('throttle:120,1,public-proxy-people')->name('api.public.request-status.proxy-people');
Route::delete('public/request-status/proxy', [PublicItemRequestController::class, 'cancelProxy'])
    ->middleware('throttle:10,1')->name('api.public.request-status.proxy-cancel');
Route::post('public/request-status/mine', [PublicItemRequestController::class, 'mine'])
    ->middleware('throttle:60,1,public-request-mine')->name('api.public.request-status.mine');
Route::post('public/request-status/lookup', [PublicItemRequestController::class, 'lookup'])
    ->middleware('throttle:10,1')->name('api.public.request-status.lookup');

Route::prefix('public/kartu-stock/{token}')->middleware('throttle:240,1')->controller(PublicStockCardController::class)->group(function (): void {
    Route::get('/', 'project')->name('api.public.stock-card.project');
    Route::get('/pdf', 'projectPdf')->name('api.public.stock-card.project-pdf');
    Route::get('/items', 'items')->name('api.public.stock-card.items');
    Route::get('/next-number', 'nextNumber')->name('api.public.stock-card.next-number');
    Route::post('/cards', 'store')->name('api.public.stock-card.store');
    Route::get('/cards/{card}', 'show')->whereNumber('card')->name('api.public.stock-card.show');
    Route::put('/cards/{card}', 'update')->whereNumber('card')->name('api.public.stock-card.update');
    Route::delete('/cards/{card}', 'destroy')->whereNumber('card')->name('api.public.stock-card.destroy');
    Route::get('/cards/{card}/pdf', 'cardPdf')->whereNumber('card')->name('api.public.stock-card.pdf');
    Route::post('/cards/{card}/entries', 'storeEntry')->whereNumber('card')->name('api.public.stock-card.entries.store');
    Route::put('/cards/{card}/entries/{entry}', 'updateEntry')->whereNumber(['card', 'entry'])->name('api.public.stock-card.entries.update');
    Route::delete('/cards/{card}/entries/{entry}', 'destroyEntry')->whereNumber(['card', 'entry'])->name('api.public.stock-card.entries.destroy');
    Route::post('/files', 'upload')->name('api.public.stock-card.files.store');
    Route::get('/files/{photo}', 'file')->whereNumber('photo')->name('api.public.stock-card.files.show');
    Route::delete('/files/{photo}', 'deleteFile')->whereNumber('photo')->name('api.public.stock-card.files.destroy');
});

/*
|--------------------------------------------------------------------------
| Sync Agent ingest (docs/sync-architecture.md) — office Agent only, never a
| human user. Gated by the Sanctum `agent:sync` ability (see
| App\Console\Commands\Accurate\AgentTokenCommand), deliberately separate
| from the RBAC `permission:` middleware used by every route below.
|--------------------------------------------------------------------------
*/
Route::middleware(['auth:sanctum', 'abilities:agent:sync', 'agent.token'])->prefix('agent/sync')->group(function (): void {
    Route::post('/sessions', [AccurateIngestController::class, 'startSession'])->name('api.agent.sync.start');
    Route::post('/sessions/{syncBatch}/tables/{table}', [AccurateIngestController::class, 'pushTable'])->name('api.agent.sync.push-table');
    Route::post('/sessions/{syncBatch}/complete', [AccurateIngestController::class, 'complete'])->name('api.agent.sync.complete');
    Route::get('/sessions/{syncBatch}', [AccurateIngestController::class, 'show'])->name('api.agent.sync.show');
    Route::post('/sessions/{syncBatch}/fail', [AccurateIngestController::class, 'fail'])->name('api.agent.sync.fail');
});

Route::middleware('auth:sanctum')->group(function (): void {
    Route::post('/logout', [AuthController::class, 'logout'])->name('api.logout');
    Route::get('/me', [AuthController::class, 'me'])->name('api.me');
    Route::get('/user', fn (Request $request) => $request->user())->name('api.user');

    // "Catatan" column on every data table (any signed-in user)
    Route::get('/record-notes', [RecordNoteController::class, 'index'])->name('api.record-notes.index');
    Route::put('/record-notes', [RecordNoteController::class, 'upsert'])->name('api.record-notes.upsert');

    Route::get('/roles', [RoleController::class, 'index'])
        ->middleware('permission:role.view')->name('api.roles.index');
    Route::get('/permissions', [PermissionController::class, 'index'])
        ->middleware('permission:permission.view|role.manage')->name('api.permissions.index');

    // Profile photo (any logged-in user, their own)
    Route::post('/me/avatar', [AvatarController::class, 'update'])->middleware('throttle:20,1')->name('api.me.avatar');
    Route::delete('/me/avatar', [AvatarController::class, 'destroy'])->name('api.me.avatar.destroy');

    // E-sign (any logged-in user, their own)
    Route::post('/me/signature', [SignatureController::class, 'update'])->middleware('throttle:20,1')->name('api.me.signature');
    Route::delete('/me/signature', [SignatureController::class, 'destroy'])->name('api.me.signature.destroy');

    // Self-service password change (any logged-in user).
    Route::post('/me/password', [AuthController::class, 'changePassword'])
        ->middleware('throttle:10,1')->name('api.me.password');

    // Role management (Pengaturan -> Role & Hak Akses).
    Route::middleware('permission:role.manage')->group(function () {
        Route::post('/roles', [RoleController::class, 'store'])->name('api.roles.store');
        Route::match(['put', 'patch'], '/roles/{role}', [RoleController::class, 'update'])->name('api.roles.update');
        Route::delete('/roles/{role}', [RoleController::class, 'destroy'])->name('api.roles.destroy');
    });

    // User management (Pengaturan -> Pengguna).
    Route::get('/users/options', [UserController::class, 'options'])
        ->middleware('permission:user.view|user.create|user.update')->name('api.users.options');
    Route::get('/users', [UserController::class, 'index'])->middleware('permission:user.view')->name('api.users.index');
    Route::post('/users', [UserController::class, 'store'])->middleware('permission:user.create')->name('api.users.store');
    Route::get('/users/{user}', [UserController::class, 'show'])->middleware('permission:user.view')->name('api.users.show');
    Route::match(['put', 'patch'], '/users/{user}', [UserController::class, 'update'])
        ->middleware('permission:user.update')->name('api.users.update');
    Route::post('/users/{user}/password', [UserController::class, 'resetPassword'])
        ->middleware(['permission:user.update', 'throttle:20,1'])->name('api.users.password');
    Route::delete('/users/{user}', [UserController::class, 'destroy'])->middleware('permission:user.delete')->name('api.users.destroy');

    // Accurate Online: PCs connected to Accurate + manual disconnect. Standalone —
    // not tied to the Sync Agent or the sync (see AccurateSessionMonitor).
    Route::get('/accurate/sessions', [AccurateSessionController::class, 'index'])
        ->middleware('permission:accurate.session.view')->name('api.accurate.sessions');
    Route::post('/accurate/sessions/terminate', [AccurateSessionController::class, 'terminate'])
        ->middleware(['permission:accurate.session.terminate', 'throttle:30,1'])->name('api.accurate.sessions.terminate');
    Route::put('/accurate/ip-labels', [AccurateSessionController::class, 'saveLabel'])
        ->middleware(['permission:accurate.session.terminate', 'throttle:60,1'])->name('api.accurate.ip-labels.save');

    // Manual Sync Agent run (copy Accurate .GDB -> staging [-> sync]) — Log Agen page.
    Route::get('/agent-runs/status', [AgentRunController::class, 'status'])
        ->middleware('permission:sync.accurate.view')->name('api.agent-runs.status');
    Route::post('/agent-runs', [AgentRunController::class, 'store'])
        ->middleware(['permission:sync.accurate.trigger', 'throttle:10,1'])->name('api.agent-runs.store');

    Route::middleware('permission:notification.view_own')->group(function () {
        Route::get('/notifications', [NotificationController::class, 'index'])->name('api.notifications.index');
        Route::get('/notifications/unread-count', [NotificationController::class, 'unreadCount'])->name('api.notifications.unread-count');
        Route::post('/notifications/{notification}/read', [NotificationController::class, 'markRead'])->name('api.notifications.read');
        Route::post('/notifications/read-all', [NotificationController::class, 'markAllRead'])->name('api.notifications.read-all');
    });

    /*
    |--------------------------------------------------------------------------
    | PHASE 3 — Master Data + Inventory + Calculation Engine
    |--------------------------------------------------------------------------
    */
    // Master Kategori Barang (Kategori Induk / Anak 1 / 2 / 3 of a Master Produk)
    Route::get('/item-categories', [ItemCategoryController::class, 'index'])
        ->middleware('permission:master.category.view')->name('api.item-categories.index');
    Route::middleware('permission:master.category.manage')->controller(ItemCategoryController::class)->group(function (): void {
        Route::post('/item-categories', 'store')->name('api.item-categories.store');
        Route::put('/item-categories/{id}', 'update')->whereNumber('id')->name('api.item-categories.update');
        Route::delete('/item-categories/{id}', 'destroy')->whereNumber('id')->name('api.item-categories.destroy');
    });
    Route::middleware('permission:master.category.view')->group(function () {
        Route::get('/master-data/quality', [MasterDataController::class, 'quality'])
            ->middleware('permission:item.view|master.unit.view|master.vendor.view|master.employee.view')->name('api.master-data.quality');
        Route::get('/categories', [MasterDataController::class, 'categories'])->name('api.categories');
        Route::get('/categories/tree', [MasterDataController::class, 'categoryTree'])->name('api.categories.tree');
    });
    // Master UOM: categories, their units and ratios; conversions per item
    Route::get('/uom', [UomController::class, 'index'])->middleware('permission:master.unit.view')->name('api.uom.index');
    Route::get('/uom/preview', [UomController::class, 'preview'])->middleware('permission:ri.create|npbg.create|ppb.create|item_request.process|po.create|master.unit.view')->name('api.uom.preview');
    Route::get('/uom/unmapped', [UomController::class, 'unmapped'])->middleware('permission:master.unit.view')->name('api.uom.unmapped');
    Route::get('/uom/convert', [UomController::class, 'convert'])->middleware('permission:master.unit.view')->name('api.uom.convert');
    Route::get('/uom/category-rules', [UomController::class, 'categoryRules'])->middleware('permission:master.unit.view')->name('api.uom.category-rules');
    Route::get('/items/{item}/unit-conversions', [UomController::class, 'itemConversions'])->whereNumber('item')->middleware('permission:master.unit.view')->name('api.items.unit-conversions');
    // an item's own ratio (1 BOX = 12 PCS of this item): who manages units, or who may edit the item from its form
    Route::post('/items/{item}/unit-conversions', [UomController::class, 'saveItemConversion'])->whereNumber('item')->middleware('permission:master.unit.manage|item.update|item.create')->name('api.items.unit-conversions.store');
    Route::middleware('permission:master.unit.manage')->controller(UomController::class)->group(function (): void {
        Route::put('/items/{item}/base-unit', 'setBaseUnit')->whereNumber('item')->name('api.items.base-unit');
        Route::post('/uom/categories', 'storeCategory')->name('api.uom.categories.store');
        Route::put('/uom/categories/{category}', 'updateCategory')->name('api.uom.categories.update');
        Route::delete('/uom/categories/{category}', 'destroyCategory')->name('api.uom.categories.destroy');
        Route::post('/uom/units', 'storeUnit')->name('api.uom.units.store');
        Route::put('/uom/units/{unit}', 'updateUnit')->name('api.uom.units.update');
        Route::put('/uom/category-rules/{category}', 'saveCategoryRules')->whereNumber('category')->name('api.uom.category-rules.save');
        Route::post('/items/{item}/unit-conversions/{conversion}/confirm', 'confirmItemConversion')->whereNumber(['item', 'conversion'])->name('api.items.unit-conversions.confirm');
        Route::delete('/items/{item}/unit-conversions/{conversion}', 'destroyItemConversion')->whereNumber('item')->name('api.items.unit-conversions.destroy');
    });
    Route::get('/units', [MasterDataController::class, 'units'])
        ->middleware('permission:master.unit.view|item_request.create|item.view')->name('api.units');
    Route::get('/warehouses', [MasterDataController::class, 'warehouses'])
        ->middleware('permission:master.warehouse.view')->name('api.warehouses');
    Route::get('/sites', [MasterDataController::class, 'sites'])
        ->middleware('permission:master.warehouse.view|po.create')->name('api.sites');
    Route::get('/warehouse-locations', [MasterDataController::class, 'warehouseLocations'])
        ->middleware('permission:master.location.view')->name('api.warehouse-locations');

    Route::get('/items/lookup', [ItemController::class, 'lookup'])
        ->middleware('permission:item.lookup|item.view')->name('api.items.lookup');
    Route::middleware('permission:item.view')->group(function () {
        Route::get('/items', [ItemController::class, 'index'])->name('api.items.index');
        Route::get('/items/accurate-categories', [ItemController::class, 'accurateCategoryOptions'])->name('api.items.accurate-categories');
        Route::get('/items/options', [ItemController::class, 'options'])->name('api.items.options');
        Route::get('/items/ids', [ItemController::class, 'ids'])->name('api.items.ids');
        // Smart Search popup: for a specification, which brands are in the warehouse, how many items each, total stock
        Route::get('/items/smart-search', [ItemController::class, 'smartSearch'])->middleware('throttle:120,1')->name('api.items.smart-search');
        Route::get('/items/{item}', [ItemController::class, 'show'])->name('api.items.show');
        Route::get('/items/{item}/history', [ItemController::class, 'history'])->name('api.items.history');
        Route::get('/items/{item}/serials', [ItemController::class, 'serials'])->name('api.items.serials');
    });
    Route::post('/items', [ItemController::class, 'store'])
        ->middleware('permission:item.create')->name('api.items.store');
    Route::match(['put', 'patch'], '/items/{item}', [ItemController::class, 'update'])
        ->middleware('permission:item.update')->name('api.items.update');
    Route::delete('/items/{item}', [ItemController::class, 'destroy'])
        ->middleware('permission:item.delete')->name('api.items.destroy');

    Route::middleware('permission:item.safety_stock.view')->group(function () {
        Route::get('/safety-stocks', [SafetyStockController::class, 'index'])->name('api.safety-stocks.index');
        Route::get('/safety-stocks/{safetyStock}', [SafetyStockController::class, 'show'])->name('api.safety-stocks.show');
    });
    Route::middleware('permission:item.safety_stock.update')->group(function () {
        Route::post('/safety-stocks', [SafetyStockController::class, 'store'])->name('api.safety-stocks.store');
        Route::match(['put', 'patch'], '/safety-stocks/{safetyStock}', [SafetyStockController::class, 'update'])
            ->name('api.safety-stocks.update');
        Route::delete('/safety-stocks/{safetyStock}', [SafetyStockController::class, 'destroy'])
            ->name('api.safety-stocks.destroy');
    });
    Route::post('/safety-stocks/{safetyStock}/resolve-conflict', [SafetyStockController::class, 'resolveConflict'])
        ->middleware('permission:item.safety_stock.resolve_conflict')->name('api.safety-stocks.resolve-conflict');

    Route::middleware('permission:sync.accurate.view')->group(function () {
        Route::get('/sync/status', [SyncController::class, 'status'])->name('api.sync.status');
        Route::get('/sync/history', [SyncController::class, 'history'])->name('api.sync.history');
        Route::get('/sync/history/{syncBatch}', [SyncController::class, 'show'])->name('api.sync.history.show');
        Route::get('/sync/agent-log', [AgentLogController::class, 'index'])->name('api.sync.agent-log');
    });
    Route::post('/sync/accurate', [SyncController::class, 'store'])
        ->middleware('permission:sync.accurate.trigger')->name('api.sync.accurate.store');

    Route::middleware('permission:inventory.view')->group(function () {
        Route::get('/inventory', [InventoryController::class, 'index'])->name('api.inventory.index');
        Route::get('/inventory/analysis', [InventoryController::class, 'analysis'])
            ->middleware('permission:inventory.view_analysis')->name('api.inventory.analysis');
        Route::get('/inventory/{item}', [InventoryController::class, 'show'])->name('api.inventory.show');
    });
    Route::post('/inventory/projected', [InventoryController::class, 'projected'])
        ->middleware('permission:item_request.create|inventory.view')->name('api.inventory.projected');

    /*
    | Request Barang — karyawan request, admin gudang turns lines into NPBG / PPB.
    | Own requests with item_request.create; all of them with item_request.view.
    */
    Route::get('/item-requests/requesters', [ItemRequestController::class, 'requesters'])
        ->middleware('permission:item_request.process')->name('api.item-requests.requesters');
    Route::get('/item-requests', [ItemRequestController::class, 'index'])
        ->middleware('permission:item_request.create|item_request.view')->name('api.item-requests.index');
    Route::post('/item-requests', [ItemRequestController::class, 'store'])
        ->middleware('permission:item_request.create')->name('api.item-requests.store');
    // the requester's own data (Data Pekerja) to fill the Buat Request form, like the form via link
    Route::get('/item-requests/my-profile', [ItemRequestController::class, 'myProfile'])
        ->middleware('permission:item_request.create')->name('api.item-requests.my-profile');
    Route::get('/item-request-forms', [ItemRequestController::class, 'forms'])
        ->middleware('permission:item_request.create|item_request.view')->name('api.item-request-forms.index');
    Route::get('/item-requests/{itemRequest}', [ItemRequestController::class, 'show'])
        ->middleware('permission:item_request.create|item_request.view|item_request.approve_manager|item_request.approve_director|item_request.handover')->name('api.item-requests.show');
    Route::post('/item-requests/{itemRequest}/process', [ItemRequestController::class, 'process'])
        ->middleware('permission:item_request.process')->name('api.item-requests.process');
    Route::put('/item-requests/{itemRequest}/lines/{line}/match', [ItemRequestController::class, 'matchLine'])
        ->middleware(['permission:item_request.process', 'throttle:120,1'])->name('api.item-requests.match-line');
    Route::put('/item-requests/{itemRequest}/urgency', [ItemRequestController::class, 'urgency'])
        ->middleware('permission:item_request.process')->name('api.item-requests.urgency');
    // Approval: Manager → Direktur → Lapangan Gudang → serah terima (ItemRequestApprovalService)
    Route::get('/approvals', [ItemRequestController::class, 'approvals'])
        ->middleware('permission:item_request.approve_manager|item_request.approve_director|item_request.handover|ppb.approve_manager|ppb.approve_director|po.approve_director|npbg.approve_manager|npbg.approve_director')->name('api.approvals.index');
    // each menu's Dashboard: basic analytics (permission per module, checked in the controller) and the user's own layout
    Route::get('/module-stats/{module}', [ModuleStatsController::class, 'show'])->name('api.module-stats');
    // Custom dashboards: the layout only; each widget reads an existing API with the viewer's permissions
    // the figures of every feature card of the Dashboard's Overview (each by the user's own permissions)
    Route::get('/dashboard/feature-stats', \App\Http\Controllers\Api\FeatureStatsController::class)->middleware('throttle:120,1')->name('api.dashboard.feature-stats');
    Route::get('/custom-dashboards', [CustomDashboardController::class, 'index'])->name('api.custom-dashboards.index');
    Route::post('/custom-dashboards', [CustomDashboardController::class, 'store'])->middleware('throttle:30,1')->name('api.custom-dashboards.store');
    Route::get('/custom-dashboards/{id}', [CustomDashboardController::class, 'show'])->whereNumber('id')->name('api.custom-dashboards.show');
    Route::put('/custom-dashboards/{id}', [CustomDashboardController::class, 'update'])->whereNumber('id')->middleware('throttle:120,1')->name('api.custom-dashboards.update');
    Route::delete('/custom-dashboards/{id}', [CustomDashboardController::class, 'destroy'])->whereNumber('id')->middleware('throttle:30,1')->name('api.custom-dashboards.destroy');
    Route::get('/preferences/{key}', [PreferenceController::class, 'show'])->name('api.preferences.show');
    Route::put('/preferences/{key}', [PreferenceController::class, 'update'])->middleware('throttle:60,1')->name('api.preferences.update');
    // User Log: pages opened are written by the app; reading the log needs audit_log.view
    Route::post('/activity/page-view', [ActivityLogController::class, 'pageView'])->middleware('throttle:240,1')->name('api.activity.page-view');
    Route::get('/activity-logs', [ActivityLogController::class, 'index'])->middleware('permission:audit_log.view')->name('api.activity-logs.index');
    // main dashboard sticky notes: the user's own only (scoped in the controller)
    Route::get('/dashboard-notes', [DashboardNoteController::class, 'index'])->name('api.dashboard-notes.index');
    Route::post('/dashboard-notes', [DashboardNoteController::class, 'store'])->middleware('throttle:60,1')->name('api.dashboard-notes.store');
    Route::put('/dashboard-notes/{note}', [DashboardNoteController::class, 'update'])->whereNumber('note')->middleware('throttle:120,1')->name('api.dashboard-notes.update');
    Route::delete('/dashboard-notes/{note}', [DashboardNoteController::class, 'destroy'])->whereNumber('note')->middleware('throttle:60,1')->name('api.dashboard-notes.destroy');
    // the work waiting for this user across STOCKWISE (Important Request home: "Perlu dikerjakan")
    Route::get('/reminders', [ReminderController::class, 'index'])->name('api.reminders');
    // Update Alert: the popup for every user (due / seen); managing them is Super Admin only (checked in the controller)
    Route::get('/update-alerts/due', [UpdateAlertController::class, 'due'])->name('api.update-alerts.due');
    Route::post('/update-alerts/{updateAlert}/seen', [UpdateAlertController::class, 'seen'])->whereNumber('updateAlert')->middleware('throttle:60,1')->name('api.update-alerts.seen');
    Route::post('/update-alerts/{updateAlert}/thumbs-up', [UpdateAlertController::class, 'thumbsUp'])->whereNumber('updateAlert')->middleware('throttle:60,1')->name('api.update-alerts.thumbs-up');
    Route::get('/update-alerts/{updateAlert}/closed-by', [UpdateAlertController::class, 'closedBy'])->whereNumber('updateAlert')->name('api.update-alerts.closed-by');
    Route::get('/update-alerts/{updateAlert}/thumbs-up', [UpdateAlertController::class, 'thumbs'])->whereNumber('updateAlert')->name('api.update-alerts.thumbs');
    Route::get('/update-alerts', [UpdateAlertController::class, 'index'])->name('api.update-alerts.index');
    Route::post('/update-alerts', [UpdateAlertController::class, 'store'])->name('api.update-alerts.store');
    Route::put('/update-alerts/{updateAlert}', [UpdateAlertController::class, 'update'])->whereNumber('updateAlert')->name('api.update-alerts.update');
    Route::delete('/update-alerts/{updateAlert}', [UpdateAlertController::class, 'destroy'])->whereNumber('updateAlert')->name('api.update-alerts.destroy');
    // Settings · Auto Refresh: Super Admin only (checked in the controller)
    Route::get('/settings/auto-refresh', [AutoRefreshController::class, 'show'])->name('api.settings.auto-refresh.show');
    Route::put('/settings/auto-refresh', [AutoRefreshController::class, 'update'])->name('api.settings.auto-refresh.update');
    // what changed since the last look (the app refetches only that area): updates between accounts in seconds
    Route::get('/live', [LiveController::class, 'index'])->name('api.live');
    Route::get('/approvals/count', [ItemRequestController::class, 'approvalCount'])
        ->middleware('permission:item_request.approve_manager|item_request.approve_director|item_request.handover|ppb.approve_manager|ppb.approve_director|po.approve_director|npbg.approve_manager|npbg.approve_director')->name('api.approvals.count');
    // STOCKWISE PPB (Manager → Direktur) and PO (Direktur) waiting for this user
    Route::get('/approvals/purchasing', [PurchasingApprovalController::class, 'index'])
        ->middleware('permission:ppb.approve_manager|ppb.approve_director|po.approve_director|npbg.approve_manager|npbg.approve_director')->name('api.approvals.purchasing');
    Route::post('/item-requests/{itemRequest}/approval', [ItemRequestController::class, 'decide'])
        ->middleware(['permission:item_request.approve_manager|item_request.approve_director|item_request.handover', 'throttle:60,1'])->name('api.item-requests.approval');
    Route::post('/item-requests/{itemRequest}/handover', [ItemRequestController::class, 'handover'])
        ->middleware(['permission:item_request.handover', 'throttle:30,1'])->name('api.item-requests.handover');
    // Gudang fulfils an approved request from real stock: NPBG #1, #2 …, each with its own serah terima
    Route::post('/item-requests/{itemRequest}/fulfillments', [ItemRequestController::class, 'fulfill'])
        ->middleware(['permission:item_request.handover', 'throttle:60,1'])->name('api.item-requests.fulfill');
    Route::post('/item-requests/{itemRequest}/fulfillments/{fulfillment}/confirm', [ItemRequestController::class, 'confirmFulfillment'])
        ->middleware(['permission:item_request.handover', 'throttle:60,1'])->name('api.item-requests.fulfillment-confirm');
    Route::post('/item-requests/{itemRequest}/fulfillments/{fulfillment}/handover', [ItemRequestController::class, 'handoverFulfillment'])
        ->middleware(['permission:item_request.handover', 'throttle:30,1'])->name('api.item-requests.fulfillment-handover');
    Route::get('/item-requests/{itemRequest}/fulfillments/{fulfillment}/file/{slot}', [ItemRequestController::class, 'fulfillmentFile'])
        ->whereIn('slot', ['handover', 'signature'])
        ->middleware('permission:item_request.create|item_request.view|item_request.approve_manager|item_request.approve_director|item_request.handover')->name('api.item-requests.fulfillment-file');
    Route::post('/item-requests/{itemRequest}/close', [ItemRequestController::class, 'close'])
        ->middleware(['permission:item_request.handover|item_request.process', 'throttle:30,1'])->name('api.item-requests.close');
    Route::get('/item-requests/{itemRequest}/lines/{line}/image/{slot}', [ItemRequestController::class, 'lineImage'])->whereIn('slot', ['img1', 'img2', 'img3'])
        ->middleware('permission:item_request.create|item_request.view|item_request.approve_manager|item_request.approve_director|item_request.handover')->name('api.item-requests.line-image');
    Route::get('/item-requests/{itemRequest}/image/{slot}', [ItemRequestController::class, 'image'])->whereIn('slot', ['img1', 'img2', 'img3'])
        ->middleware('permission:item_request.create|item_request.view|item_request.approve_manager|item_request.approve_director|item_request.handover')->name('api.item-requests.image');
    Route::get('/item-requests/{itemRequest}/handover/{slot}', [ItemRequestController::class, 'handoverFile'])
        ->whereIn('slot', ['handover', 'signature'])
        ->middleware('permission:item_request.create|item_request.view|item_request.approve_manager|item_request.approve_director|item_request.handover')->name('api.item-requests.handover-file');
    // pickup by a representative: the requester's own (checked in the controller)
    Route::post('/item-requests/{itemRequest}/proxy', [ItemRequestController::class, 'createProxy'])
        ->middleware(['permission:item_request.create', 'throttle:20,1'])->name('api.item-requests.proxy');
    Route::get('/item-requests/{itemRequest}/proxy-people', [ItemRequestController::class, 'proxyPeople'])
        ->middleware('permission:item_request.create')->name('api.item-requests.proxy-people');
    Route::delete('/item-requests/{itemRequest}/proxy', [ItemRequestController::class, 'cancelProxy'])
        ->middleware(['permission:item_request.create', 'throttle:20,1'])->name('api.item-requests.proxy-cancel');
    Route::post('/item-requests/{itemRequest}/cancel', [ItemRequestController::class, 'cancel'])
        ->middleware('permission:item_request.create|item_request.process')->name('api.item-requests.cancel');
    Route::get('/share-base', [ItemRequestLinkController::class, 'shareBase'])->name('api.share-base');
    Route::middleware('permission:item_request.process')->group(function () {
        Route::get('/item-request-links', [ItemRequestLinkController::class, 'index'])->name('api.item-request-links.index');
        Route::post('/item-request-links', [ItemRequestLinkController::class, 'store'])->name('api.item-request-links.store');
        Route::put('/item-request-links/{link}', [ItemRequestLinkController::class, 'update'])->name('api.item-request-links.update');
        Route::delete('/item-request-links/{link}', [ItemRequestLinkController::class, 'destroy'])->name('api.item-request-links.destroy');
    });

    /*
    |--------------------------------------------------------------------------
    | NPBG — Accurate ARINV/ARINVDET mirror (read-mostly; only a few
    | Stockwise-owned fields are editable). Populated by "Sync Accurate"
    | (see the sync.accurate routes above), never created manually.
    |--------------------------------------------------------------------------
    */
    Route::get('/npbg', [NpbgController::class, 'index'])
        ->middleware('permission:npbg.view')->name('api.npbg.index');
    Route::post('/npbg', [NpbgController::class, 'store'])
        ->middleware('permission:npbg.create')->name('api.npbg.store');
    Route::get('/npbg/serials', [NpbgController::class, 'serials'])
        ->middleware('permission:npbg.create|npbg.view|item_request.handover')->name('api.npbg.serials');
    Route::get('/npbg/klasifikasi', [NpbgController::class, 'klasifikasiOptions'])
        ->middleware('permission:npbg.view')->name('api.npbg.klasifikasi');
    // old name, for pages still open on the previous version
    Route::get('/npbg/jenis-pengeluaran', [NpbgController::class, 'klasifikasiOptions'])
        ->middleware('permission:npbg.view')->name('api.npbg.jenis-pengeluaran');
    Route::post('/npbg/{npbg}/approval', [NpbgController::class, 'decide'])
        ->middleware(['permission:npbg.approve_manager|npbg.approve_director', 'throttle:60,1'])->name('api.npbg.approval');
    // sent back by the Manager / Direktur: admin revises it and sends it again
    Route::post('/npbg/{npbg}/resubmit', [NpbgController::class, 'resubmit'])
        ->middleware(['permission:npbg.create', 'throttle:30,1'])->name('api.npbg.resubmit');
    Route::get('/npbg/{npbg}', [NpbgController::class, 'show'])
        ->middleware('permission:npbg.view')->name('api.npbg.show');
    Route::get('/npbg/{npbg}/print', [NpbgController::class, 'print'])
        ->middleware('permission:npbg.view')->name('api.npbg.print');
    Route::put('/npbg/{npbg}/kembali-bekas', [NpbgController::class, 'kembaliBekas'])
        ->middleware(['permission:npbg.view', 'permission:used_return.update'])->name('api.npbg.kembali-bekas');
    Route::get('/npbg/{npbg}/print-pdf', [NpbgController::class, 'printPdf'])
        ->middleware('permission:npbg.view')->name('api.npbg.print-pdf');
    Route::match(['put', 'patch'], '/npbg/{npbg}', [NpbgController::class, 'update'])
        ->middleware('permission:npbg.update')->name('api.npbg.update');

    /*
    |--------------------------------------------------------------------------
    | NPBG — Klarifikasi/Verifikasi Barang (barang alternatif beda type/spek).
    |--------------------------------------------------------------------------
    */
    Route::get('/npbg/{npbg}/verifications', [NpbgVerificationController::class, 'index'])
        ->middleware('permission:npbg.verification.view')->name('api.npbg.verifications.index');
    Route::post('/npbg/{npbg}/verifications', [NpbgVerificationController::class, 'store'])
        ->middleware('permission:npbg.verification.manage')->name('api.npbg.verifications.store');
    Route::get('/npbg-verifications/{verification}', [NpbgVerificationController::class, 'show'])
        ->middleware('permission:npbg.verification.view')->name('api.npbg.verifications.show');
    Route::post('/npbg-verifications/{verification}/process', [NpbgVerificationController::class, 'process'])
        ->middleware('permission:npbg.verification.manage')->name('api.npbg.verifications.process');
    Route::post('/npbg-verifications/{verification}/offer-alternative', [NpbgVerificationController::class, 'offerAlternative'])
        ->middleware('permission:npbg.verification.manage')->name('api.npbg.verifications.offer-alternative');
    Route::post('/npbg-verifications/{verification}/respond', [NpbgVerificationController::class, 'respond'])
        ->middleware('permission:npbg.verification.respond')->name('api.npbg.verifications.respond');
    Route::post('/npbg-verifications/{verification}/escalate', [NpbgVerificationController::class, 'escalate'])
        ->middleware('permission:npbg.verification.manage')->name('api.npbg.verifications.escalate');
    Route::post('/npbg-verifications/{verification}/bos-decide', [NpbgVerificationController::class, 'bosDecide'])
        ->middleware('permission:npbg.verification.bos_decide')->name('api.npbg.verifications.bos-decide');
    Route::get('/npbg-verifications/logs/{log}/attachment', [NpbgVerificationController::class, 'attachment'])
        ->middleware('permission:npbg.verification.view')->name('api.npbg.verifications.attachment');

    /*
    |--------------------------------------------------------------------------
    | PHASE 6 — Stock Opname
    |--------------------------------------------------------------------------
    */
    // Stock Opname — controlled workflow (StockOpnameWorkflowController; 503 until its migration ran)
    Route::get('/stock-opnames/dashboard', [StockOpnameWorkflowController::class, 'dashboard'])
        ->middleware('permission:opname.view')->name('api.opnames.flow.dashboard');
    Route::get('/stock-opnames/form-options', [StockOpnameWorkflowController::class, 'formOptions'])
        ->middleware('permission:opname.view|opname.schedule')->name('api.opnames.flow.form-options');
    Route::get('/stock-opnames/adjustments', [StockOpnameWorkflowController::class, 'adjustments'])
        ->middleware('permission:report.opname|opname.view_variance|opname.review')->name('api.opnames.flow.adjustments');
    Route::post('/stock-opnames/orders', [StockOpnameWorkflowController::class, 'store'])
        ->middleware('permission:opname.schedule')->name('api.opnames.flow.orders.store');
    Route::get('/stock-opnames/{stockOpname}/detail', [StockOpnameWorkflowController::class, 'detail'])
        ->middleware('permission:opname.view')->name('api.opnames.flow.detail');
    Route::get('/stock-opnames/{stockOpname}/events', [StockOpnameWorkflowController::class, 'events'])
        ->middleware('permission:opname.view')->name('api.opnames.flow.events');
    Route::get('/stock-opnames/{stockOpname}/lines/{line}/counts', [StockOpnameWorkflowController::class, 'counts'])->whereNumber('line')
        ->middleware('permission:opname.view')->name('api.opnames.flow.line-counts');
    Route::put('/stock-opnames/{stockOpname}/draft', [StockOpnameWorkflowController::class, 'updateDraft'])
        ->middleware('permission:opname.schedule')->name('api.opnames.flow.draft.update');
    Route::post('/stock-opnames/{stockOpname}/lines', [StockOpnameWorkflowController::class, 'addLines'])
        ->middleware('permission:opname.schedule')->name('api.opnames.flow.lines.add');
    Route::delete('/stock-opnames/{stockOpname}/lines/{line}', [StockOpnameWorkflowController::class, 'removeLine'])->whereNumber('line')
        ->middleware('permission:opname.schedule')->name('api.opnames.flow.lines.remove');
    Route::post('/stock-opnames/{stockOpname}/confirm', [StockOpnameWorkflowController::class, 'confirm'])
        ->middleware('permission:opname.schedule')->name('api.opnames.flow.confirm');
    Route::post('/stock-opnames/{stockOpname}/start-counting', [StockOpnameWorkflowController::class, 'startCounting'])
        ->middleware('permission:opname.count')->name('api.opnames.flow.start-counting');
    Route::post('/stock-opnames/{stockOpname}/lines/{line}/count', [StockOpnameWorkflowController::class, 'count'])->whereNumber('line')
        ->middleware('permission:opname.count')->name('api.opnames.flow.line-count');
    Route::post('/stock-opnames/{stockOpname}/finish-counting', [StockOpnameWorkflowController::class, 'finishCounting'])
        ->middleware('permission:opname.submit')->name('api.opnames.flow.finish-counting');
    Route::post('/stock-opnames/{stockOpname}/review-decisions', [StockOpnameWorkflowController::class, 'reviewDecisions'])
        ->middleware('permission:opname.review')->name('api.opnames.flow.review-decisions');
    Route::post('/stock-opnames/{stockOpname}/recount', [StockOpnameWorkflowController::class, 'recount'])
        ->middleware('permission:opname.request_recount')->name('api.opnames.flow.recount');
    Route::post('/stock-opnames/{stockOpname}/request-approval', [StockOpnameWorkflowController::class, 'requestApproval'])
        ->middleware('permission:opname.review')->name('api.opnames.flow.request-approval');
    Route::post('/stock-opnames/{stockOpname}/approve', [StockOpnameWorkflowController::class, 'approve'])
        ->middleware('permission:opname.approve')->name('api.opnames.flow.approve');
    Route::post('/stock-opnames/{stockOpname}/reject', [StockOpnameWorkflowController::class, 'reject'])
        ->middleware('permission:opname.reject')->name('api.opnames.flow.reject');
    Route::post('/stock-opnames/{stockOpname}/close', [StockOpnameWorkflowController::class, 'close'])
        ->middleware('permission:opname.review')->name('api.opnames.flow.close');
    Route::post('/stock-opnames/{stockOpname}/cancel', [StockOpnameWorkflowController::class, 'cancel'])
        ->middleware('permission:opname.schedule')->name('api.opnames.flow.cancel');
    Route::post('/stock-opnames/{stockOpname}/correction', [StockOpnameWorkflowController::class, 'correction'])
        ->middleware('permission:opname.schedule')->name('api.opnames.flow.correction');
    Route::get('/stock-opnames', [StockOpnameController::class, 'index'])
        ->middleware('permission:opname.view')->name('api.opnames.index');
    Route::get('/stock-opnames/lines', [StockOpnameController::class, 'lines'])
        ->middleware('permission:opname.view')->name('api.opnames.lines');
    Route::get('/stock-opnames/{stockOpname}', [StockOpnameController::class, 'show'])
        ->middleware('permission:opname.view')->name('api.opnames.show');
    Route::get('/stock-opnames/{stockOpname}/usage', [StockOpnameController::class, 'usage'])
        ->middleware('permission:opname.view')->name('api.opnames.usage');
    Route::get('/stock-opnames/{stockOpname}/print', [StockOpnameController::class, 'print'])
        ->middleware('permission:opname.view')->name('api.opnames.print');
    Route::post('/stock-opnames', [StockOpnameController::class, 'store'])
        ->middleware('permission:opname.schedule')->name('api.opnames.store');
    Route::post('/stock-opnames/{stockOpname}/start', [StockOpnameController::class, 'start'])
        ->middleware('permission:opname.count')->name('api.opnames.start');
    Route::put('/stock-opnames/{stockOpname}/items/{item}', [StockOpnameController::class, 'count'])
        ->middleware('permission:opname.count')->name('api.opnames.count');
    Route::post('/stock-opnames/{stockOpname}/submit', [StockOpnameController::class, 'submit'])
        ->middleware('permission:opname.submit')->name('api.opnames.submit');
    Route::post('/stock-opnames/{stockOpname}/review', [StockOpnameController::class, 'review'])
        ->middleware('permission:opname.approve')->name('api.opnames.review');

    /*
    |--------------------------------------------------------------------------
    | PHASE 7 — PPB + Purchasing (PPB/PO/RI mirrors dari Accurate)
    |--------------------------------------------------------------------------
    */
    // Important Request: work instructions from a superior, discussion, results and their review
    Route::middleware('permission:important_request.access')->prefix('important-requests')->controller(ImportantRequestController::class)->group(function (): void {
        Route::get('/', 'index')->name('api.important-requests.index');
        Route::get('/summary', 'summary')->name('api.important-requests.summary');
        Route::get('/by-document', 'byDocument')->name('api.important-requests.by-document');
        Route::get('/recipients', 'recipients')->middleware('permission:important_request.create')->name('api.important-requests.recipients');
        Route::get('/analytics', 'analytics')->middleware('permission:important_request.analytics')->name('api.important-requests.analytics');
        Route::post('/', 'store')->middleware(['permission:important_request.create', 'throttle:30,1'])->name('api.important-requests.store');
        Route::get('/{importantRequest}', 'show')->whereNumber('importantRequest')->name('api.important-requests.show');
        Route::put('/{importantRequest}', 'update')->whereNumber('importantRequest')->middleware('permission:important_request.create')->name('api.important-requests.update');
        Route::delete('/{importantRequest}', 'destroy')->whereNumber('importantRequest')->middleware('permission:important_request.create')->name('api.important-requests.destroy');
        Route::post('/{importantRequest}/send', 'send')->whereNumber('importantRequest')->middleware('permission:important_request.create')->name('api.important-requests.send');
        Route::post('/{importantRequest}/act', 'act')->whereNumber('importantRequest')->name('api.important-requests.act');
        Route::post('/{importantRequest}/submissions/{submission}/review', 'review')->whereNumber(['importantRequest', 'submission'])->middleware('permission:important_request.create')->name('api.important-requests.review');
        Route::post('/{importantRequest}/deadline', 'deadline')->whereNumber('importantRequest')->middleware('permission:important_request.create')->name('api.important-requests.deadline');
        Route::post('/{importantRequest}/cancel', 'cancel')->whereNumber('importantRequest')->middleware('permission:important_request.create')->name('api.important-requests.cancel');
        Route::post('/{importantRequest}/reopen', 'reopen')->whereNumber('importantRequest')->name('api.important-requests.reopen');
        Route::get('/{importantRequest}/comments', 'comments')->whereNumber('importantRequest')->name('api.important-requests.comments');
        Route::post('/{importantRequest}/comments', 'addComment')->whereNumber('importantRequest')->middleware('throttle:60,1')->name('api.important-requests.comments.store');
        Route::put('/{importantRequest}/comments/{comment}', 'editComment')->whereNumber(['importantRequest', 'comment'])->name('api.important-requests.comments.update');
        Route::delete('/{importantRequest}/comments/{comment}', 'deleteComment')->whereNumber(['importantRequest', 'comment'])->name('api.important-requests.comments.destroy');
        Route::get('/{importantRequest}/activities', 'activities')->whereNumber('importantRequest')->name('api.important-requests.activities');
        Route::post('/{importantRequest}/attachments', 'addAttachments')->whereNumber('importantRequest')->middleware('permission:important_request.create')->name('api.important-requests.attachments.store');
        Route::delete('/{importantRequest}/attachments/{attachment}', 'deleteAttachment')->whereNumber(['importantRequest', 'attachment'])->name('api.important-requests.attachments.destroy');
        Route::get('/{importantRequest}/attachments/{attachment}', 'download')->whereNumber(['importantRequest', 'attachment'])->name('api.important-requests.attachments.show');
    });
    // files go up in chunks (PHP's upload limit here is 2 MB a file)
    Route::middleware(['permission:important_request.access', 'throttle:600,1'])->controller(ImportantRequestController::class)->group(function (): void {
        Route::post('/important-request-uploads', 'uploadStart')->name('api.important-request-uploads.store');
        Route::post('/important-request-uploads/{token}', 'uploadChunk')->name('api.important-request-uploads.chunk');
    });
    // Master Data · Data Pekerja (roster of the company's people)
    Route::get('/employees', [EmployeeController::class, 'index'])
        ->middleware('permission:master.employee.view')->name('api.employees.index');
    Route::get('/employees/departments', [EmployeeController::class, 'departments'])
        ->middleware('permission:master.employee.view')->name('api.employees.departments');
    Route::post('/employees/departments', [EmployeeController::class, 'storeDepartment'])
        ->middleware('permission:master.employee.manage')->name('api.employees.departments.store');
    Route::get('/employees/users', [EmployeeController::class, 'users'])
        ->middleware('permission:master.employee.manage')->name('api.employees.users');
    Route::get('/employees/template', [EmployeeController::class, 'template'])
        ->middleware('permission:master.employee.manage')->name('api.employees.template');
    Route::post('/employees/import', [EmployeeController::class, 'import'])
        ->middleware('permission:master.employee.manage')->name('api.employees.import');
    Route::post('/employees', [EmployeeController::class, 'store'])
        ->middleware('permission:master.employee.manage')->name('api.employees.store');
    Route::put('/employees/{employee}', [EmployeeController::class, 'update'])
        ->middleware('permission:master.employee.manage')->name('api.employees.update');
    Route::get('/vendors', [VendorController::class, 'index'])
        ->middleware('permission:master.vendor.view')->name('api.vendors.index');
    Route::post('/vendors', [VendorController::class, 'store'])
        ->middleware('permission:master.vendor.manage')->name('api.vendors.store');
    Route::put('/vendors/{vendor}', [VendorController::class, 'update'])
        ->middleware('permission:master.vendor.manage')->name('api.vendors.update');

    // divisi-options/vendor-options sebelum {ppb}/{ri}/{purchaseOrder} — rute statis
    // harus didaftarkan lebih dulu, kalau tidak "divisi-options" akan dicoba
    // resolve sebagai id model oleh rute wildcard di bawahnya.
    Route::get('/ppb/divisi-options', [PpbController::class, 'divisiOptions'])
        ->middleware('permission:ppb.view')->name('api.ppb.divisi-options');
    Route::get('/ppb/vendor-options', [PpbController::class, 'vendorOptions'])
        ->middleware('permission:ppb.view')->name('api.ppb.vendor-options');
    Route::get('/ppb', [PpbController::class, 'index'])
        ->middleware('permission:ppb.view')->name('api.ppb.index');
    Route::post('/ppb', [PpbController::class, 'store'])
        ->middleware('permission:ppb.create')->name('api.ppb.store');
    // Draft PPB: Restock (Safety Stock) → review / edit → submit as PPB (PpbDraftService)
    Route::middleware('permission:ppb.create')->group(function () {
        // the Draft PPB list: item lines from Request Barang / Safety Stock, picked into one PPB
        Route::get('/ppb-draft-lines', [PpbDraftController::class, 'lines'])->name('api.ppb-draft-lines.index');
        Route::post('/ppb-draft-lines/submit', [PpbDraftController::class, 'submitLines'])->name('api.ppb-draft-lines.submit');
        Route::put('/ppb-draft-lines/{line}', [PpbDraftController::class, 'updateLine'])->name('api.ppb-draft-lines.update');
        Route::delete('/ppb-draft-lines/{line}', [PpbDraftController::class, 'removeLine'])->name('api.ppb-draft-lines.destroy');
        Route::get('/ppb-saved-drafts', [PpbDraftController::class, 'savedIndex'])->name('api.ppb-saved-drafts.index');
        Route::post('/ppb-saved-drafts', [PpbDraftController::class, 'savedStore'])->name('api.ppb-saved-drafts.store');
        Route::put('/ppb-saved-drafts/{saved}', [PpbDraftController::class, 'savedUpdate'])->name('api.ppb-saved-drafts.update');
        Route::post('/ppb-saved-drafts/{saved}/submit', [PpbDraftController::class, 'savedSubmit'])->name('api.ppb-saved-drafts.submit');
        Route::delete('/ppb-saved-drafts/{saved}', [PpbDraftController::class, 'savedDestroy'])->name('api.ppb-saved-drafts.destroy');
        Route::delete('/ppb-saved-drafts/{saved}/lines/{line}', [PpbDraftController::class, 'savedRelease'])->name('api.ppb-saved-drafts.release');
        Route::get('/ppb-drafts', [PpbDraftController::class, 'index'])->name('api.ppb-drafts.index');
        Route::post('/ppb-drafts', [PpbDraftController::class, 'store'])->name('api.ppb-drafts.store');
        Route::get('/ppb-drafts/{ppbDraft}', [PpbDraftController::class, 'show'])->name('api.ppb-drafts.show');
        Route::put('/ppb-drafts/{ppbDraft}', [PpbDraftController::class, 'update'])->name('api.ppb-drafts.update');
        Route::post('/ppb-drafts/{ppbDraft}/submit', [PpbDraftController::class, 'submit'])->name('api.ppb-drafts.submit');
        Route::delete('/ppb-drafts/{ppbDraft}', [PpbDraftController::class, 'destroy'])->name('api.ppb-drafts.destroy');
    });
    Route::get('/ppb/{ppb}', [PpbController::class, 'show'])
        ->middleware('permission:ppb.view')->name('api.ppb.show');
    Route::post('/ppb/{ppb}/approval', [PpbController::class, 'decide'])
        ->middleware(['permission:ppb.approve|ppb.approve_manager|ppb.approve_director', 'throttle:60,1'])->name('api.ppb.approval');
    // sent back by the Manager / Direktur: admin revises it and sends it again
    Route::post('/ppb/{ppb}/resubmit', [PpbController::class, 'resubmit'])
        ->middleware(['permission:ppb.create', 'throttle:30,1'])->name('api.ppb.resubmit');
    Route::get('/ppb/{ppb}/print', [PpbController::class, 'print'])
        ->middleware('permission:ppb.view')->name('api.ppb.print');
    Route::get('/ppb/{ppb}/print-pdf', [PpbController::class, 'printPdf'])
        ->middleware('permission:ppb.view')->name('api.ppb.print-pdf');

    // RI (mirror Accurate APINV/APITMDET) — terpisah dari /api/receivings (alur internal DRAFT->CHECKING->CONFIRMED).
    Route::get('/ri/vendor-options', [RiController::class, 'vendorOptions'])
        ->middleware('permission:ri.view')->name('api.ri.vendor-options');
    Route::get('/ri/po-lines', [RiController::class, 'poLines'])
        ->middleware('permission:ri.create')->name('api.ri.po-lines');
    Route::get('/ri/po-orders', [RiController::class, 'poOrders'])
        ->middleware('permission:ri.create')->name('api.ri.po-orders');
    Route::post('/ri/from-po', [RiController::class, 'storeFromPo'])
        ->middleware('permission:ri.create')->name('api.ri.store-from-po');
    Route::get('/ri/used-return-lines', [RiController::class, 'usedReturnLines'])
        ->middleware('permission:ri.create')->name('api.ri.used-return-lines');
    Route::post('/ri/serials/template', [RiController::class, 'serialTemplate'])
        ->middleware('permission:ri.create')->name('api.ri.serials.template');
    Route::post('/ri/serials/import', [RiController::class, 'serialImport'])
        ->middleware('permission:ri.create')->name('api.ri.serials.import');
    Route::get('/ri/{ri}/serials-export', [RiController::class, 'serialExport'])
        ->middleware('permission:ri.view')->name('api.ri.serials.export');
    Route::get('/ri', [RiController::class, 'index'])
        ->middleware('permission:ri.view')->name('api.ri.index');
    Route::post('/ri', [RiController::class, 'store'])
        ->middleware('permission:ri.create')->name('api.ri.store');
    Route::get('/ri/{ri}', [RiController::class, 'show'])
        ->middleware('permission:ri.view')->name('api.ri.show');
    Route::get('/ri/{ri}/photo/{slot}', [RiController::class, 'photo'])->whereIn('slot', ['foto1', 'foto2', 'foto3', 'doc1', 'doc2', 'doc3'])
        ->middleware('permission:ri.view')->name('api.ri.photo');
    Route::get('/ri/{ri}/print', [RiController::class, 'print'])
        ->middleware('permission:ri.view')->name('api.ri.print');
    Route::get('/ri/{ri}/print-pdf', [RiController::class, 'printPdf'])
        ->middleware('permission:ri.view')->name('api.ri.print-pdf');

    // Retur Pembelian: goods of an RI back to the vendor (PurchaseReturnService)
    Route::middleware('permission:purchase_return.view')->group(function () {
        Route::get('/purchase-returns', [PurchaseReturnController::class, 'index'])->name('api.purchase-returns.index');
        Route::get('/purchase-returns/{purchaseReturn}', [PurchaseReturnController::class, 'show'])->whereNumber('purchaseReturn')->name('api.purchase-returns.show');
        Route::get('/purchase-returns/{purchaseReturn}/photo/{slot}', [PurchaseReturnController::class, 'photo'])
            ->whereNumber('purchaseReturn')->whereIn('slot', ['barang', 'kirim'])->name('api.purchase-returns.photo');
    });
    Route::middleware('permission:purchase_return.manage')->group(function () {
        Route::get('/purchase-returns/ri-search', [PurchaseReturnController::class, 'riSearch'])->name('api.purchase-returns.ri-search');
        Route::get('/purchase-returns/ri-lines', [PurchaseReturnController::class, 'riLines'])->name('api.purchase-returns.ri-lines');
        Route::post('/purchase-returns', [PurchaseReturnController::class, 'store'])->middleware('throttle:30,1')->name('api.purchase-returns.store');
        Route::post('/purchase-returns/{purchaseReturn}/send', [PurchaseReturnController::class, 'send'])->middleware('throttle:30,1')->name('api.purchase-returns.send');
        Route::post('/purchase-returns/{purchaseReturn}/resolve', [PurchaseReturnController::class, 'resolve'])->name('api.purchase-returns.resolve');
        Route::post('/purchase-returns/{purchaseReturn}/cancel', [PurchaseReturnController::class, 'cancel'])->name('api.purchase-returns.cancel');
    });

    // Draft PO: the items of approved STOCKWISE PPBs — vendor prices compared, picked into one PO per vendor
    // PPB Siap PO → Penawaran Harga (purchasing) → the Direktur picks the vendor → Draft PO
    Route::get('/po-draft-lines', [PoDraftController::class, 'lines'])
        ->middleware('permission:po.create|po.approve_director')->name('api.po-draft-lines.index');
    Route::middleware('permission:po.approve_director')->group(function () {
        Route::post('/po-draft-lines/{item}/choose', [PoDraftController::class, 'choose'])->whereNumber('item')->name('api.po-draft-lines.choose');
        Route::post('/po-draft-lines/{item}/change-pick', [PoDraftController::class, 'changePick'])->whereNumber('item')->name('api.po-draft-lines.change-pick');
        Route::post('/po-draft-lines/{item}/return', [PoDraftController::class, 'returnQuotation'])->whereNumber('item')->name('api.po-draft-lines.return');
    });
    Route::middleware('permission:po.create')->group(function () {
        Route::put('/po-draft-lines/{item}', [PoDraftController::class, 'updateItem'])->whereNumber('item')->name('api.po-draft-lines.update');
        Route::delete('/po-draft-lines/{item}', [PoDraftController::class, 'removeItem'])->whereNumber('item')->name('api.po-draft-lines.destroy');
        Route::post('/po-draft-lines/vendors', [PoDraftController::class, 'addVendors'])->name('api.po-draft-lines.vendors');
        Route::delete('/po-draft-lines/vendors/{vendor}', [PoDraftController::class, 'dropVendor'])->whereNumber('vendor')->name('api.po-draft-lines.vendors.destroy');
        Route::post('/po-draft-lines/to-quotation', [PoDraftController::class, 'toQuotation'])->name('api.po-draft-lines.to-quotation');
        Route::post('/po-draft-lines/back-to-ready', [PoDraftController::class, 'backToReady'])->name('api.po-draft-lines.back-to-ready');
        Route::post('/po-draft-lines/submit-quotation', [PoDraftController::class, 'submitQuotation'])->name('api.po-draft-lines.submit-quotation');
        Route::post('/po-draft-lines/submit', [PoDraftController::class, 'submit'])->name('api.po-draft-lines.submit');
        Route::get('/po-draft-lines/{item}/units', [PoDraftController::class, 'orderUnits'])->whereNumber('item')->name('api.po-draft-lines.units');
        Route::put('/po-draft-lines/{item}/quotes', [PoDraftController::class, 'quote'])->name('api.po-draft-lines.quote');
        Route::delete('/po-draft-lines/{item}/quotes/{quote}', [PoDraftController::class, 'removeQuote'])->name('api.po-draft-lines.quote.destroy');
    });
    // Price List: the standing purchase prices, Item × Vendor (apart from any Purchase Request)
    Route::get('/price-list/reference', [PriceListController::class, 'reference'])
        ->middleware('permission:rfq.view|po.create|po.approve_director')->name('api.price-list.reference');
    // Draft Price List: items × vendors priced in one draft, then "Set Harga" into the Master Price List
    Route::middleware('permission:rfq.view')->group(function () {
        Route::get('/price-list/drafts', [PriceListDraftController::class, 'index'])->name('api.price-list.drafts.index');
        Route::get('/price-list/drafts/{id}', [PriceListDraftController::class, 'show'])->whereNumber('id')->name('api.price-list.drafts.show');
    });
    Route::middleware('permission:rfq.create')->group(function () {
        Route::get('/price-list/drafts/available-items', [PriceListDraftController::class, 'availableItems'])->name('api.price-list.drafts.available-items');
        Route::post('/price-list/drafts', [PriceListDraftController::class, 'store'])->name('api.price-list.drafts.store');
        Route::post('/price-list/drafts/{id}/items', [PriceListDraftController::class, 'addItems'])->whereNumber('id')->name('api.price-list.drafts.items.store');
        Route::delete('/price-list/drafts/{id}/items/{item}', [PriceListDraftController::class, 'removeItem'])->whereNumber('id')->whereNumber('item')->name('api.price-list.drafts.items.destroy');
        Route::post('/price-list/drafts/{id}/vendors', [PriceListDraftController::class, 'addVendors'])->whereNumber('id')->name('api.price-list.drafts.vendors.store');
        Route::delete('/price-list/drafts/{id}/vendors/{vendor}', [PriceListDraftController::class, 'removeVendor'])->whereNumber('id')->whereNumber('vendor')->name('api.price-list.drafts.vendors.destroy');
        Route::put('/price-list/drafts/{id}/cells', [PriceListDraftController::class, 'setCell'])->whereNumber('id')->name('api.price-list.drafts.cells');
        Route::put('/price-list/drafts/{id}/vendors/{vendor}', [PriceListDraftController::class, 'setVendorTerms'])->whereNumber('id')->whereNumber('vendor')->name('api.price-list.drafts.vendors.terms');
        Route::post('/price-list/drafts/{id}/finish', [PriceListDraftController::class, 'finish'])->whereNumber('id')->name('api.price-list.drafts.finish');
        Route::delete('/price-list/drafts/{id}', [PriceListDraftController::class, 'destroy'])->whereNumber('id')->name('api.price-list.drafts.destroy');
    });
    Route::middleware('permission:rfq.view')->group(function () {
        Route::get('/price-list/matrix', [PriceListController::class, 'matrix'])->name('api.price-list.matrix');
        Route::get('/price-list/items/{item}/units', [PriceListController::class, 'units'])->whereNumber('item')->name('api.price-list.units');
        Route::get('/price-list', [PriceListController::class, 'index'])->name('api.price-list.index');
        Route::get('/price-list/{price}', [PriceListController::class, 'show'])->whereNumber('price')->name('api.price-list.show');
        Route::get('/price-list/{price}/history', [PriceListController::class, 'history'])->whereNumber('price')->name('api.price-list.history');
    });
    Route::post('/price-list', [PriceListController::class, 'store'])
        ->middleware('permission:rfq.create')->name('api.price-list.store');
    Route::middleware('permission:rfq.update')->group(function () {
        Route::put('/price-list/{price}', [PriceListController::class, 'update'])->whereNumber('price')->name('api.price-list.update');
        Route::post('/price-list/{price}/archive', [PriceListController::class, 'archive'])->whereNumber('price')->name('api.price-list.archive');
    });
    Route::get('/purchase-orders/divisi-options', [PurchaseOrderController::class, 'divisiOptions'])
        ->middleware('permission:po.view')->name('api.po.divisi-options');
    Route::get('/purchase-orders', [PurchaseOrderController::class, 'index'])
        ->middleware('permission:po.view')->name('api.po.index');
    Route::post('/purchase-orders', [PurchaseOrderController::class, 'store'])
        ->middleware('permission:po.create')->name('api.po.store');
    Route::get('/purchase-orders/{purchaseOrder}', [PurchaseOrderController::class, 'show'])
        ->middleware('permission:po.view')->name('api.po.show');
    Route::get('/purchase-orders/{purchaseOrder}/print', [PurchaseOrderController::class, 'print'])
        ->middleware('permission:po.view')->name('api.po.print');
    Route::get('/purchase-orders/{purchaseOrder}/print-pdf', [PurchaseOrderController::class, 'printPdf'])
        ->middleware('permission:po.view')->name('api.po.print-pdf');
    Route::post('/purchase-orders/{purchaseOrder}/approve', [PurchaseOrderController::class, 'approve'])
        ->middleware('permission:po.approve|po.approve_director')->name('api.po.approve');
    // STOCKWISE PO: purchasing completes it (vendor / price), the Direktur approves or sends it back
    Route::put('/purchase-orders/{purchaseOrder}/complete', [PurchaseOrderController::class, 'complete'])
        ->middleware('permission:po.create|po.update')->name('api.po.complete');
    Route::post('/purchase-orders/{purchaseOrder}/reject', [PurchaseOrderController::class, 'reject'])
        ->middleware('permission:po.approve_director')->name('api.po.reject');
    // PO STOCKWISE approved → proof of purchase uploaded → "Sudah dibeli"
    Route::post('/purchase-orders/{purchaseOrder}/proof', [PurchaseOrderController::class, 'uploadProof'])
        ->middleware(['permission:po.send|po.create', 'throttle:30,1'])->name('api.po.proof.upload');
    Route::get('/purchase-orders/{purchaseOrder}/proof', [PurchaseOrderController::class, 'proof'])
        ->middleware('permission:po.view')->name('api.po.proof');
    Route::post('/purchase-orders/{purchaseOrder}/send', [PurchaseOrderController::class, 'send'])
        ->middleware('permission:po.send')->name('api.po.send');
    // Send to vendor: email (PDF attached) or WhatsApp (link to the PDF)
    Route::get('/purchase-orders/{purchaseOrder}/vendor-share', [PurchaseOrderController::class, 'vendorShare'])
        ->middleware('permission:po.send')->name('api.po.vendor-share');
    Route::post('/purchase-orders/{purchaseOrder}/send-to-vendor', [PurchaseOrderController::class, 'sendToVendor'])
        ->middleware(['permission:po.send', 'throttle:30,1'])->name('api.po.send-to-vendor');
    Route::post('/purchase-orders/{purchaseOrder}/cancel', [PurchaseOrderController::class, 'cancel'])
        ->middleware('permission:po.cancel')->name('api.po.cancel');

    // PHASE 8 — Tracking masters + modules.
    Route::get('/customers', [MasterDataController::class, 'customers'])
        ->middleware('permission:master.customer.view')->name('api.customers');
    Route::get('/projects', [MasterDataController::class, 'projects'])
        ->middleware('permission:master.project.view')->name('api.projects');
    Route::get('/workshops', [MasterDataController::class, 'workshops'])
        ->middleware('permission:master.workshop.view')->name('api.workshops');
    Route::get('/assets', [MasterDataController::class, 'assets'])
        ->middleware('permission:maintenance.view|tyre.view|item.view')->name('api.assets');
    Route::get('/serial-units', [MasterDataController::class, 'serialUnits'])
        ->middleware('permission:stpp.view|tyre.view|manufacturing.view')->name('api.serial-units');

    Route::get('/lend', [Tracking\LendController::class, 'index'])->middleware('permission:lend.view')->name('api.lend.index');
    Route::get('/lend/{lend}', [Tracking\LendController::class, 'show'])->middleware('permission:lend.view')->name('api.lend.show');
    Route::post('/lend', [Tracking\LendController::class, 'store'])->middleware('permission:lend.create')->name('api.lend.store');
    Route::match(['put', 'patch'], '/lend/{lend}', [Tracking\LendController::class, 'update'])->middleware('permission:lend.update')->name('api.lend.update');
    Route::delete('/lend/{lend}', [Tracking\LendController::class, 'destroy'])->middleware('permission:lend.update')->name('api.lend.destroy');
    Route::post('/lend/{lend}/return', [Tracking\LendController::class, 'return'])->middleware('permission:lend.return')->name('api.lend.return');

    Route::get('/borrow', [Tracking\BorrowController::class, 'index'])->middleware('permission:borrow.view')->name('api.borrow.index');
    Route::get('/borrow/{borrow}', [Tracking\BorrowController::class, 'show'])->middleware('permission:borrow.view')->name('api.borrow.show');
    Route::post('/borrow', [Tracking\BorrowController::class, 'store'])->middleware('permission:borrow.create')->name('api.borrow.store');
    Route::match(['put', 'patch'], '/borrow/{borrow}', [Tracking\BorrowController::class, 'update'])->middleware('permission:borrow.update')->name('api.borrow.update');
    Route::delete('/borrow/{borrow}', [Tracking\BorrowController::class, 'destroy'])->middleware('permission:borrow.update')->name('api.borrow.destroy');
    Route::post('/borrow/{borrow}/return', [Tracking\BorrowController::class, 'return'])->middleware('permission:borrow.return')->name('api.borrow.return');

    Route::get('/stpp/options', [Tracking\StppController::class, 'options'])->middleware('permission:stpp.view')->name('api.stpp.options');
    // Excel sheet "Maintenance" (Maintenance STPP)
    Route::get('/stpp-maintenance', [Tracking\StppController::class, 'maintenanceIndex'])->middleware('permission:stpp.view')->name('api.stpp.maintenance.index');
    Route::post('/stpp-maintenance', [Tracking\StppController::class, 'maintenanceStore'])->middleware('permission:stpp.update')->name('api.stpp.maintenance.store');
    Route::put('/stpp-maintenance/{log}', [Tracking\StppController::class, 'maintenanceUpdate'])->middleware('permission:stpp.update')->name('api.stpp.maintenance.update');
    Route::delete('/stpp-maintenance/{log}', [Tracking\StppController::class, 'maintenanceDestroy'])->middleware('permission:stpp.update')->name('api.stpp.maintenance.destroy');
    Route::get('/stpp', [Tracking\StppController::class, 'index'])->middleware('permission:stpp.view')->name('api.stpp.index');
    Route::get('/stpp/{stpp}', [Tracking\StppController::class, 'show'])->middleware('permission:stpp.view')->name('api.stpp.show');
    Route::post('/stpp', [Tracking\StppController::class, 'store'])->middleware('permission:stpp.create')->name('api.stpp.store');
    Route::match(['put', 'patch'], '/stpp/{stpp}', [Tracking\StppController::class, 'update'])->middleware('permission:stpp.update')->name('api.stpp.update');
    Route::delete('/stpp/{stpp}', [Tracking\StppController::class, 'destroy'])->middleware('permission:stpp.update')->name('api.stpp.destroy');
    Route::post('/stpp/{stpp}/withdraw', [Tracking\StppController::class, 'withdraw'])->middleware('permission:stpp.return')->name('api.stpp.withdraw');
    Route::post('/stpp/{stpp}/reissue', [Tracking\StppController::class, 'reissue'])->middleware('permission:stpp.create')->name('api.stpp.reissue');

    // Tracking form helpers (vehicles & NPBG/RI numbers from Accurate)
    Route::get('/tracking/vehicles', [Tracking\TrackingLookupController::class, 'vehicles'])
        ->middleware('permission:lend.view|borrow.view|tyre.view|maintenance.view|manufacturing.view')->name('api.tracking.vehicles');
    Route::get('/tracking/documents', [Tracking\TrackingLookupController::class, 'documents'])
        ->middleware('permission:lend.view|borrow.view|tyre.view|maintenance.view|manufacturing.view')->name('api.tracking.documents');
    Route::get('/tracking/document', [Tracking\TrackingLookupController::class, 'document'])
        ->middleware('permission:lend.view|borrow.view|tyre.view|maintenance.view|manufacturing.view')->name('api.tracking.document');
    // Pengembalian Bekas — Excel sheets "Spare Part" (matrix) and "Spare Part Lain" (other)
    Route::get('/used-return-sheets/{sheet}', [Tracking\UsedReturnSheetController::class, 'index'])->whereIn('sheet', ['matrix', 'other'])->middleware('permission:used_return.view')->name('api.used-return-sheets.index');
    Route::get('/used-return-sheets/{sheet}/{id}', [Tracking\UsedReturnSheetController::class, 'show'])->whereIn('sheet', ['matrix', 'other'])->middleware('permission:used_return.view')->name('api.used-return-sheets.show');
    Route::post('/used-return-sheets/{sheet}', [Tracking\UsedReturnSheetController::class, 'save'])->whereIn('sheet', ['matrix', 'other'])->middleware('permission:used_return.update')->name('api.used-return-sheets.store');
    Route::put('/used-return-sheets/{sheet}/{id}', [Tracking\UsedReturnSheetController::class, 'save'])->whereIn('sheet', ['matrix', 'other'])->middleware('permission:used_return.update')->name('api.used-return-sheets.update');
    Route::delete('/used-return-sheets/{sheet}/{id}', [Tracking\UsedReturnSheetController::class, 'destroy'])->whereIn('sheet', ['matrix', 'other'])->middleware('permission:used_return.update')->name('api.used-return-sheets.destroy');
    Route::get('/tyre-changes/options', [Tracking\TyreChangeController::class, 'options'])->middleware('permission:tyre.view')->name('api.tyre.options');
    // Excel sheets "Ban Luar BPN" (inventory) and "Deliver & Receive Ban SIG-BPN" (transfers)
    Route::get('/tyre-bpn/{sheet}', [Tracking\TyreChangeController::class, 'bpn'])->whereIn('sheet', ['inventory', 'transfers'])->middleware('permission:tyre.view')->name('api.tyre.bpn');
    Route::post('/tyre-bpn/{sheet}', [Tracking\TyreChangeController::class, 'bpnSave'])->whereIn('sheet', ['inventory', 'transfers'])->middleware('permission:tyre.update')->name('api.tyre.bpn.store');
    Route::put('/tyre-bpn/{sheet}/{id}', [Tracking\TyreChangeController::class, 'bpnSave'])->whereIn('sheet', ['inventory', 'transfers'])->middleware('permission:tyre.update')->name('api.tyre.bpn.update');
    Route::delete('/tyre-bpn/{sheet}/{id}', [Tracking\TyreChangeController::class, 'bpnDestroy'])->whereIn('sheet', ['inventory', 'transfers'])->middleware('permission:tyre.update')->name('api.tyre.bpn.destroy');
    Route::get('/tyre-changes', [Tracking\TyreChangeController::class, 'index'])->middleware('permission:tyre.view')->name('api.tyre.index');
    Route::get('/tyre-changes/{tyreChange}', [Tracking\TyreChangeController::class, 'show'])->middleware('permission:tyre.view')->name('api.tyre.show');
    Route::post('/tyre-changes', [Tracking\TyreChangeController::class, 'store'])->middleware('permission:tyre.create')->name('api.tyre.store');
    Route::match(['put', 'patch'], '/tyre-changes/{tyreChange}', [Tracking\TyreChangeController::class, 'update'])->middleware('permission:tyre.update')->name('api.tyre.update');
    Route::delete('/tyre-changes/{tyreChange}', [Tracking\TyreChangeController::class, 'destroy'])->middleware('permission:tyre.update')->name('api.tyre.destroy');
    Route::post('/tyre-changes/{tyreChange}/close', [Tracking\TyreChangeController::class, 'close'])->middleware('permission:tyre.close')->name('api.tyre.close');

    // Kartu Stock (paper "KARTU STOCK BARANG": created from Master Barang, lines by hand, print / PDF) — permissions in the controller
    Route::get('/stock-card-projects', [StockCardProjectController::class, 'index'])->name('api.stock-card-projects.index');
    Route::post('/stock-card-projects', [StockCardProjectController::class, 'store'])->name('api.stock-card-projects.store');
    Route::get('/stock-card-projects/{project}', [StockCardProjectController::class, 'show'])->name('api.stock-card-projects.show');
    Route::put('/stock-card-projects/{project}', [StockCardProjectController::class, 'update'])->name('api.stock-card-projects.update');
    Route::delete('/stock-card-projects/{project}', [StockCardProjectController::class, 'destroy'])->name('api.stock-card-projects.destroy');
    Route::get('/stock-card-projects/{project}/pdf', [StockCardProjectController::class, 'pdf'])->name('api.stock-card-projects.pdf');
    Route::get('/stock-card-projects/{project}/share-links', [StockCardShareLinkController::class, 'index'])->name('api.stock-card-projects.share-links.index');
    Route::post('/stock-card-projects/{project}/share-links', [StockCardShareLinkController::class, 'store'])->name('api.stock-card-projects.share-links.store');
    Route::put('/stock-card-share-links/{link}', [StockCardShareLinkController::class, 'update'])->name('api.stock-card-share-links.update');
    Route::delete('/stock-card-share-links/{link}', [StockCardShareLinkController::class, 'destroy'])->name('api.stock-card-share-links.destroy');
    Route::get('/stock-card/items', [StockCardController::class, 'items'])->name('api.stock-card.items');
    Route::get('/stock-cards', [StockCardController::class, 'index'])->name('api.stock-cards.index');
    Route::get('/stock-cards/next-number', [StockCardController::class, 'nextNumber'])->name('api.stock-cards.next-number');
    Route::post('/stock-cards', [StockCardController::class, 'store'])->name('api.stock-cards.store');
    Route::get('/stock-cards/{stockCard}', [StockCardController::class, 'show'])->name('api.stock-cards.show');
    Route::put('/stock-cards/{stockCard}', [StockCardController::class, 'update'])->name('api.stock-cards.update');
    Route::delete('/stock-cards/{stockCard}', [StockCardController::class, 'destroy'])->name('api.stock-cards.destroy');
    Route::get('/stock-cards/{stockCard}/pdf', [StockCardController::class, 'pdf'])->name('api.stock-cards.pdf');
    Route::post('/stock-cards/{stockCard}/entries', [StockCardController::class, 'storeEntry'])->name('api.stock-cards.entries.store');
    Route::put('/stock-cards/{stockCard}/entries/{entry}', [StockCardController::class, 'updateEntry'])->name('api.stock-cards.entries.update');
    Route::delete('/stock-cards/{stockCard}/entries/{entry}', [StockCardController::class, 'destroyEntry'])->name('api.stock-cards.entries.destroy');
    // evidence photos of every tracking module (permission checked per module in the controller)
    Route::get('/tracking-photos/{photo}', [Tracking\TrackingPhotoController::class, 'show'])->name('api.tracking-photos.show');
    Route::post('/tracking-photos', [Tracking\TrackingPhotoController::class, 'store'])->name('api.tracking-photos.store');
    Route::delete('/tracking-photos/{photo}', [Tracking\TrackingPhotoController::class, 'destroy'])->name('api.tracking-photos.destroy');
    // Excel sheet view: one row per Sub SPK
    Route::get('/maintenance-lines/options', [Tracking\MaintenanceController::class, 'options'])->middleware('permission:maintenance.view')->name('api.maintenance.options');
    Route::get('/maintenance-lines', [Tracking\MaintenanceController::class, 'lines'])->middleware('permission:maintenance.view')->name('api.maintenance.lines');
    Route::get('/maintenance-orders', [Tracking\MaintenanceController::class, 'index'])->middleware('permission:maintenance.view')->name('api.maintenance.index');
    Route::get('/maintenance-orders/{maintenanceOrder}', [Tracking\MaintenanceController::class, 'show'])->middleware('permission:maintenance.view')->name('api.maintenance.show');
    Route::post('/maintenance-orders', [Tracking\MaintenanceController::class, 'store'])->middleware('permission:maintenance.create')->name('api.maintenance.store');
    Route::match(['put', 'patch'], '/maintenance-orders/{maintenanceOrder}', [Tracking\MaintenanceController::class, 'update'])->middleware('permission:maintenance.update')->name('api.maintenance.update');
    Route::delete('/maintenance-orders/{maintenanceOrder}', [Tracking\MaintenanceController::class, 'destroy'])->middleware('permission:maintenance.update')->name('api.maintenance.destroy');
    Route::post('/maintenance-orders/{maintenanceOrder}/subs', [Tracking\MaintenanceController::class, 'addSub'])->middleware('permission:maintenance.update')->name('api.maintenance.subs');
    Route::match(['put', 'patch'], '/maintenance-subs/{sub}', [Tracking\MaintenanceController::class, 'updateSub'])->middleware('permission:maintenance.update')->name('api.maintenance.subs.update');
    Route::delete('/maintenance-subs/{sub}', [Tracking\MaintenanceController::class, 'destroySub'])->middleware('permission:maintenance.update')->name('api.maintenance.subs.destroy');
    Route::post('/maintenance-subs/{sub}/complete', [Tracking\MaintenanceController::class, 'completeSub'])->middleware('permission:maintenance.complete')->name('api.maintenance.subs.complete');

    // Excel sheet view: one row per unit (?kind=ASSEMBLY → sheet MA, ?kind=JASA → sheet MJ)
    Route::get('/manufacturing-lines/options', [Tracking\ManufacturingController::class, 'options'])->middleware('permission:manufacturing.view')->name('api.manufacturing.options');
    Route::get('/manufacturing-lines', [Tracking\ManufacturingController::class, 'lines'])->middleware('permission:manufacturing.view')->name('api.manufacturing.lines');
    Route::get('/manufacturing-orders', [Tracking\ManufacturingController::class, 'index'])->middleware('permission:manufacturing.view')->name('api.manufacturing.index');
    Route::get('/manufacturing-orders/{manufacturingOrder}', [Tracking\ManufacturingController::class, 'show'])->middleware('permission:manufacturing.view')->name('api.manufacturing.show');
    Route::post('/manufacturing-orders', [Tracking\ManufacturingController::class, 'store'])->middleware('permission:manufacturing.create')->name('api.manufacturing.store');
    Route::match(['put', 'patch'], '/manufacturing-orders/{manufacturingOrder}', [Tracking\ManufacturingController::class, 'update'])->middleware('permission:manufacturing.update')->name('api.manufacturing.update');
    Route::delete('/manufacturing-orders/{manufacturingOrder}', [Tracking\ManufacturingController::class, 'destroy'])->middleware('permission:manufacturing.update')->name('api.manufacturing.destroy');
    Route::post('/manufacturing-orders/{manufacturingOrder}/subs', [Tracking\ManufacturingController::class, 'addSub'])->middleware('permission:manufacturing.update')->name('api.manufacturing.subs');
    Route::match(['put', 'patch'], '/manufacturing-subs/{sub}', [Tracking\ManufacturingController::class, 'updateSub'])->middleware('permission:manufacturing.update')->name('api.manufacturing.subs.update');
    Route::delete('/manufacturing-subs/{sub}', [Tracking\ManufacturingController::class, 'destroySub'])->middleware('permission:manufacturing.update')->name('api.manufacturing.subs.destroy');
    Route::post('/manufacturing-subs/{sub}/photo', [Tracking\ManufacturingController::class, 'uploadPhoto'])->middleware('permission:manufacturing.update')->name('api.manufacturing.subs.photo.store');
    Route::get('/manufacturing-subs/{sub}/photo', [Tracking\ManufacturingController::class, 'photo'])->middleware('permission:manufacturing.view')->name('api.manufacturing.subs.photo');
    Route::post('/manufacturing-subs/{sub}/complete', [Tracking\ManufacturingController::class, 'completeSub'])->middleware('permission:manufacturing.complete')->name('api.manufacturing.subs.complete');

    Route::get('/used-returns', [Tracking\UsedReturnController::class, 'index'])->middleware('permission:used_return.view')->name('api.used-returns.index');
    Route::get('/used-returns/{usedReturn}', [Tracking\UsedReturnController::class, 'show'])->middleware('permission:used_return.view')->name('api.used-returns.show');
    Route::post('/used-returns', [Tracking\UsedReturnController::class, 'store'])->middleware('permission:used_return.create')->name('api.used-returns.store');
    Route::match(['put', 'patch'], '/used-returns/{usedReturn}', [Tracking\UsedReturnController::class, 'update'])->middleware('permission:used_return.update')->name('api.used-returns.update');
    Route::delete('/used-returns/{usedReturn}', [Tracking\UsedReturnController::class, 'destroy'])->middleware('permission:used_return.update')->name('api.used-returns.destroy');
    Route::post('/used-returns/{usedReturn}/close', [Tracking\UsedReturnController::class, 'close'])->middleware('permission:used_return.close')->name('api.used-returns.close');

    // Manufacturing (BoM + Manufacturing Order) — App\Services\Mrp. Separate from the Tracking sheet above.
    Route::prefix('mrp')->group(function (): void {
        $bom = BomController::class;
        $mo = ProductionController::class;
        $rep = MrpReportController::class;
        Route::middleware('permission:mrp.view')->group(function () use ($bom, $mo, $rep): void {
            Route::get('/dashboard', [$rep, 'dashboard'])->name('api.mrp.dashboard');
            Route::get('/reports', [$rep, 'report'])->name('api.mrp.reports');
            Route::get('/items', [$rep, 'items'])->name('api.mrp.items');
            Route::get('/items/{item}/units', [$rep, 'units'])->whereNumber('item')->name('api.mrp.items.units');
            Route::get('/users', [$rep, 'users'])->name('api.mrp.users');
            Route::get('/boms', [$bom, 'index'])->name('api.mrp.boms.index');
            Route::get('/boms/{bom}', [$bom, 'show'])->whereNumber('bom')->name('api.mrp.boms.show');
            Route::get('/productions', [$mo, 'index'])->name('api.mrp.productions.index');
            Route::get('/productions/{production}', [$mo, 'show'])->whereNumber('production')->name('api.mrp.productions.show');
        });
        Route::middleware('permission:mrp.bom.manage')->group(function () use ($bom): void {
            Route::post('/boms', [$bom, 'store'])->name('api.mrp.boms.store');
            Route::put('/boms/{bom}', [$bom, 'update'])->whereNumber('bom')->name('api.mrp.boms.update');
            Route::delete('/boms/{bom}', [$bom, 'destroy'])->whereNumber('bom')->name('api.mrp.boms.destroy');
            Route::post('/boms/{bom}/activate', [$bom, 'activate'])->whereNumber('bom')->name('api.mrp.boms.activate');
            Route::post('/boms/{bom}/archive', [$bom, 'archive'])->whereNumber('bom')->name('api.mrp.boms.archive');
            Route::post('/boms/{bom}/revise', [$bom, 'revise'])->whereNumber('bom')->name('api.mrp.boms.revise');
        });
        $p = '/productions/{production}';
        Route::post('/productions', [$mo, 'store'])->middleware(['permission:mrp.create', 'throttle:60,1'])->name('api.mrp.productions.store');
        Route::put($p, [$mo, 'update'])->whereNumber('production')->middleware('permission:mrp.create')->name('api.mrp.productions.update');
        Route::post("{$p}/confirm", [$mo, 'confirm'])->whereNumber('production')->middleware('permission:mrp.confirm')->name('api.mrp.productions.confirm');
        Route::post("{$p}/start", [$mo, 'start'])->whereNumber('production')->middleware('permission:mrp.record')->name('api.mrp.productions.start');
        Route::post("{$p}/entries", [$mo, 'storeEntry'])->whereNumber('production')->middleware('permission:mrp.record')->name('api.mrp.productions.entries.store');
        Route::delete("{$p}/entries/{entry}", [$mo, 'voidEntry'])->whereNumber(['production', 'entry'])->middleware('permission:mrp.record')->name('api.mrp.productions.entries.void');
        Route::post("{$p}/finish", [$mo, 'finish'])->whereNumber('production')->middleware('permission:mrp.record')->name('api.mrp.productions.finish');
        Route::post("{$p}/reopen", [$mo, 'reopen'])->whereNumber('production')->middleware('permission:mrp.record')->name('api.mrp.productions.reopen');
        Route::post("{$p}/validate", [$mo, 'validateOrder'])->whereNumber('production')->middleware('permission:mrp.validate')->name('api.mrp.productions.validate');
        Route::post("{$p}/accurate", [$mo, 'markAccurate'])->whereNumber('production')->middleware('permission:mrp.validate')->name('api.mrp.productions.accurate');
        Route::post("{$p}/cancel", [$mo, 'cancel'])->whereNumber('production')->middleware('permission:mrp.cancel')->name('api.mrp.productions.cancel');
        Route::post("{$p}/reverse", [$mo, 'reverse'])->whereNumber('production')->middleware('permission:mrp.cancel')->name('api.mrp.productions.reverse');
        Route::post("{$p}/request-components", [$mo, 'requestComponents'])->whereNumber('production')->middleware(['permission:mrp.confirm', 'throttle:30,1'])->name('api.mrp.productions.request-components');
        Route::post("{$p}/receipts", [$mo, 'linkReceipt'])->whereNumber('production')->middleware('permission:mrp.record')->name('api.mrp.productions.receipts.link');
        Route::delete("{$p}/receipts", [$mo, 'unlinkReceipt'])->whereNumber('production')->middleware('permission:mrp.record')->name('api.mrp.productions.receipts.unlink');
        Route::post("{$p}/shortage-request", [$mo, 'requestShortage'])->whereNumber('production')->middleware(['permission:mrp.view', 'permission:ppb.create'])->name('api.mrp.productions.shortage');
    });

    // Odoo-style document collaboration: Smart Buttons, Chatter, Activities, Audit — App\Support\Documents.
    // The document's own view rule is checked in the controller (DocumentRegistry::canView), so no extra permission key.
    Route::prefix('documents')->group(function (): void {
        $c = DocumentController::class;
        $types = 'item_request|delivery_order|ppb_draft|purchase_request|purchase_order|receipt|purchase_return|price_list_draft';
        Route::get('/activities/mine', [$c, 'myActivities'])->name('api.documents.activities.mine');
        Route::prefix('{type}/{id}')->where(['type' => $types, 'id' => '[0-9]+'])->group(function () use ($c): void {
            Route::get('/related', [$c, 'related'])->name('api.documents.related');
            Route::get('/feed', [$c, 'feed'])->name('api.documents.feed');
            Route::post('/messages', [$c, 'postMessage'])->middleware('throttle:60,1')->name('api.documents.messages.store');
            Route::put('/messages/{message}', [$c, 'updateMessage'])->whereNumber('message')->middleware('throttle:60,1')->name('api.documents.messages.update');
            Route::delete('/messages/{message}', [$c, 'deleteMessage'])->whereNumber('message')->middleware('throttle:60,1')->name('api.documents.messages.destroy');
            Route::get('/attachments/{attachment}', [$c, 'attachment'])->whereNumber('attachment')->name('api.documents.attachments.show');
            Route::get('/activities', [$c, 'activities'])->name('api.documents.activities');
            Route::post('/activities', [$c, 'scheduleActivity'])->middleware('throttle:60,1')->name('api.documents.activities.store');
            Route::post('/activities/{activity}/done', [$c, 'completeActivity'])->whereNumber('activity')->name('api.documents.activities.done');
            Route::post('/activities/{activity}/cancel', [$c, 'cancelActivity'])->whereNumber('activity')->name('api.documents.activities.cancel');
            Route::get('/assignees', [$c, 'assignees'])->name('api.documents.assignees');
            Route::get('/audit', [$c, 'audit'])->name('api.documents.audit');
        });
    });

    // Disassembly (unbuild): one product taken apart into its BoM components — App\Services\Disassembly.
    Route::prefix('disassembly')->group(function (): void {
        $c = DisassemblyController::class;
        Route::middleware('permission:disassembly.view')->group(function () use ($c): void {
            Route::get('/dashboard', [$c, 'dashboard'])->name('api.disassembly.dashboard');
            Route::get('/history', [$c, 'history'])->name('api.disassembly.history');
            Route::get('/items', [$c, 'items'])->name('api.disassembly.items');
            Route::get('/items/{item}/bom', [$c, 'bom'])->whereNumber('item')->name('api.disassembly.items.bom');
            Route::get('/items/{item}/stock', [$c, 'stock'])->whereNumber('item')->name('api.disassembly.items.stock');
            Route::get('/items/{item}/units', [$c, 'units'])->whereNumber('item')->name('api.disassembly.items.units');
            Route::get('/warehouses', [$c, 'warehouses'])->name('api.disassembly.warehouses');
            Route::get('/users', [$c, 'users'])->name('api.disassembly.users');
            Route::get('/orders', [$c, 'index'])->name('api.disassembly.orders.index');
            Route::get('/orders/{order}', [$c, 'show'])->whereNumber('order')->name('api.disassembly.orders.show');
        });
        $o = '/orders/{order}';
        Route::post('/orders', [$c, 'store'])->middleware(['permission:disassembly.create', 'throttle:60,1'])->name('api.disassembly.orders.store');
        Route::put($o, [$c, 'update'])->whereNumber('order')->middleware('permission:disassembly.create')->name('api.disassembly.orders.update');
        Route::post("{$o}/confirm", [$c, 'confirm'])->whereNumber('order')->middleware('permission:disassembly.confirm')->name('api.disassembly.orders.confirm');
        Route::post("{$o}/start", [$c, 'start'])->whereNumber('order')->middleware('permission:disassembly.record')->name('api.disassembly.orders.start');
        Route::post("{$o}/entries", [$c, 'storeEntry'])->whereNumber('order')->middleware('permission:disassembly.record')->name('api.disassembly.orders.entries.store');
        Route::delete("{$o}/entries/{entry}", [$c, 'voidEntry'])->whereNumber(['order', 'entry'])->middleware('permission:disassembly.record')->name('api.disassembly.orders.entries.void');
        Route::post("{$o}/finish", [$c, 'finish'])->whereNumber('order')->middleware('permission:disassembly.record')->name('api.disassembly.orders.finish');
        Route::post("{$o}/reopen", [$c, 'reopen'])->whereNumber('order')->middleware('permission:disassembly.record')->name('api.disassembly.orders.reopen');
        Route::post("{$o}/validate", [$c, 'validateOrder'])->whereNumber('order')->middleware('permission:disassembly.validate')->name('api.disassembly.orders.validate');
        Route::post("{$o}/accurate", [$c, 'markAccurate'])->whereNumber('order')->middleware('permission:disassembly.validate')->name('api.disassembly.orders.accurate');
        Route::post("{$o}/request-product", [$c, 'requestProduct'])->whereNumber('order')->middleware(['permission:disassembly.confirm', 'throttle:30,1'])->name('api.disassembly.orders.request-product');
        Route::post("{$o}/receipts", [$c, 'linkReceipt'])->whereNumber('order')->middleware('permission:disassembly.record')->name('api.disassembly.orders.receipts.link');
        Route::delete("{$o}/receipts", [$c, 'unlinkReceipt'])->whereNumber('order')->middleware('permission:disassembly.record')->name('api.disassembly.orders.receipts.unlink');
        Route::post("{$o}/cancel", [$c, 'cancel'])->whereNumber('order')->middleware('permission:disassembly.cancel')->name('api.disassembly.orders.cancel');
        Route::post("{$o}/reverse", [$c, 'reverse'])->whereNumber('order')->middleware('permission:disassembly.cancel')->name('api.disassembly.orders.reverse');
    });

    // PHASE 9 — Dashboard (ringkasan per-peran).
    Route::get('/dashboard', DashboardController::class)->name('api.dashboard');
    // Dashboard visualisasi: every logged-in role (user decision 2026-09-29).
    Route::get('/dashboard/inventory', InventoryDashboardController::class)->name('api.dashboard.inventory');
    Route::get('/dashboard/inventory/filters', [InventoryDashboardController::class, 'filters'])->name('api.dashboard.inventory.filters');
    // Tracking & Pembelian: aggregates for every role, the document lists per view permission.
    Route::get('/dashboard/operations', OperationsDashboardController::class)->name('api.dashboard.operations');
    // Kartu Stock: barang masuk / keluar per hari, minggu, bulan (who may open Kartu Stock).
    Route::get('/dashboard/stock-cards', StockCardDashboardController::class)->name('api.dashboard.stock-cards');

    // PHASE 10 — Laporan & export (xlsx / csv / pdf-print).
    Route::get('/export/{dataset}', ExportController::class)->name('api.export');

    // Replika Excel lama (docs/excel-data-mapping.md) — migrasi penuh ke web.
    Route::get('/legacy-export', [LegacyExportController::class, 'index'])->name('api.legacy-export.index');
    Route::get('/legacy-export/{key}', LegacyExportController::class)->name('api.legacy-export');
});
