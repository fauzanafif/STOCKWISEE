# 08 — Security, Permissions & Governance

> Read-only audit 2026-11-16. Nothing was exploited, called or changed. No secret values are reproduced here.
> **[V]** Verified from code · **[I]** Inferred · **[U]** Unknown.

## 1. Authentication [V]

| Control | Implementation |
|---|---|
| Login | `POST /api/login` (username + password), throttle 20/min per IP; inactive users refused (`AuthController:70`) |
| Tokens | Sanctum personal access tokens, expiry per token = `stockwise.login_token_ttl_hours` (README: 12 h); global `sanctum.expiration` is null |
| Token storage (client) | `localStorage` (`frontend/src/lib/api.ts`) — readable by any script on the origin (XSS exposure) |
| Passwords | `hashed` cast (bcrypt by default); change own password (throttled); admin reset ends the user's sessions (README). Seeded default passwords are written in `UserSeeder`; README instructs changing them — whether done on production **[U]** |
| Proxy trust | Only loopback (`cloudflared`) may set `X-Forwarded-For`, so LAN clients cannot spoof IP for rate limits (`bootstrap/app.php`) |
| Public exposure | Cloudflare Tunnel; `BlockPublicTunnel` returns 503 to tunnel traffic while `storage/framework/public-access-off` exists (`stockwise:public on|off`). Current state **[U]** |
| Agent | Separate token with ability `agent:sync`; `EnsureAgentToken` refuses `['*']` human tokens on agent routes |

## 2. Authorization model [V]

- 9 seeded roles: `super_admin`, `admin_gudang`, `anak_gudang`, `lapangan_gudang`, `purchasing`, `bos`, `karyawan`, `manager`, `direktur`. Role ↔ permission assignments are stored in DB and editable (`/settings/roles`); `RbacSeeder` resets them to the code matrix.
- ~150 permission slugs grouped in `Rbac::PERMISSIONS`; `super_admin` short-circuits every `hasPermission()`.
- Enforcement points: `permission:` route middleware (unknown slug → 500, which prevents typos silently opening a route); `hasPermission()/hasRole()` inside controllers/services; frontend guards (`RequirePermission`, `RequireRole`) and menu filtering are UX only.
- **No Laravel Policies or Gates**; record-level rules are hand-written in services (e.g. own requests only with `item_request.create`, staff-only chatter notes).

### 2.1 Defined but never enforced permissions [V]
Found by searching every slug in `backend/routes` + `backend/app` (excluding `Rbac.php`):

`dashboard.gudang`, `dashboard.karyawan`, `dashboard.lapangan`, `dashboard.opname`, `dashboard.purchasing`, `inventory.transfer`, `item.alias.match`, `item.alias.view`, `item.import`, `item.lead_time.update`, `master.customer.manage`, `master.department.manage`, `master.department.view`, `master.location.manage`, `master.project.manage`, `master.site.manage`, `master.site.view`, `master.warehouse.manage`, `master.workshop.manage`, `opname.reject`, `opname.request_recount`, `permission.manage`, `profile.update_own`, `profile.view_own`, `report.procurement`, `rfq.select`, `rfq.send`, `settings.update`, `settings.view`, `stock_movement.view`. (`export.csv` / `export.pdf` are used dynamically as `export.{format}`.) `po.approve` is checked by the route but superseded by the service (needs `po.approve_director`).

Effect: the Roles page shows rights that do nothing, and some real capabilities are gated by unrelated permissions (e.g. projects are created/edited with `item.update`; departments are created with `master.employee.manage`; settings by hard-coded role `super_admin`).

## 3. API protection gaps [V unless marked]

| # | Endpoint(s) | Observation | Severity |
|---|---|---|---|
| 1 | `GET /api/dashboard/inventory`, `GET /api/dashboard/inventory/filters` | **No permission check** in route or controller — any authenticated user (incl. `karyawan`, `manager`) receives the full inventory analytics (stock, status, lead times) | Medium |
| 2 | `GET /api/live` | No permission; returns hashes only (low data value) | Low |
| 3 | `GET /api/user` | Returns the raw `User` model of the caller (fields depend on `$hidden`) | Low [I] |
| 4 | Stock card / project / share-link routes, tracking photos, documents (chatter), exports, legacy export, update alerts, auto-refresh, module stats, reminders | No route middleware, but checked inside controllers (`StockCardController::canView/canEdit`, `TrackingPhotoController::authorizeFor`, `DocumentRegistry` view permissions, `ExportController` dataset map, `hasRole('super_admin')`) | OK, but inconsistent pattern — easy to forget on new endpoints |
| 5 | Public tokens: `/public/item-request/{token}`, `/public/kartu-stock/{token}` (VIEW/EDIT/FULL incl. create/delete cards & files), `/public/request-status*` | 40-char random tokens, throttled, switchable per link; no expiry date on links | Medium (bearer-link model; EDIT/FULL links allow anonymous writes) |
| 6 | Large base64 uploads in JSON (`photos.* max:12,000,000`, `documents.* max:15,000,000` chars) | Memory pressure on a single `artisan serve` process | Low–Medium [I] |
| 7 | Live server configuration | Working-copy `.env` has `APP_ENV=local`, `APP_DEBUG=true`; production runs `php artisan serve` (development server, single-threaded) from this folder | High if this `.env` is production's [I] |

## 4. Company / site / warehouse restriction [V]

- **None.** Users have `site_id`, but no query scopes data by the user's site or warehouse; every permitted user sees all sites/warehouses. `site_id` is only used as a default when creating PO / PPB-PO / maintenance records.
- Warehouse-level authorization (e.g. a storekeeper limited to one warehouse) does not exist.

## 5. Approval authorization & segregation of duties

| Flow | Approver check | SoD |
|---|---|---|
| Item Request | stage permission per status; Director bypass of Manager | No creator ≠ approver check [V] |
| PPB (STOCKWISE) | `ppb.approve_manager` → `ppb.approve_director`, bypass | No creator check [V] |
| Manual NPBG | `npbg.approve_manager` → `npbg.approve_director`, bypass | No creator check [V] |
| STOCKWISE PO | `po.approve_director` only (service) | Purchasing cannot approve (role separation) [V] |
| Opname | `opname.approve` (admin_gudang also schedules and counts by default) | Same role can schedule, count and approve [V matrix] |
| MRP / Disassembly | `mrp.validate` / `disassembly.validate`; admin_gudang holds create+confirm+record+validate+cancel | No SoD [V matrix] |
| Important Request | creator cannot approve own submission; cannot assign to self | Yes [V] |
| Super Admin | has everything incl. all approvals | By design; no break-glass logging distinct from normal logs [I] |

## 6. Audit trail, chatter, activity tracking [V]

| Mechanism | Scope | Limits |
|---|---|---|
| `doc_audit_logs` (`DocumentAudit` observer) | Before → after for ItemRequest(+lines, fulfilments), Npbg, PpbDraft(+lines), Ppb, PurchaseOrder(+items), Ri, PurchaseReturn(+lines), with user, route, IP | Only Eloquent saves by a signed-in user; **Query Builder writes (`DB::table`) are not captured** (many approval/log/purge writes use it); sync/agent writes skipped; master data (items, vendors, prices, users, roles) not covered |
| `user_activity_logs` (`LogUserActivity` middleware on the `api` group) | Every write request with outcome + page views | Request-level, not field-level |
| Approval logs | `item_request_approvals`, `ppb_approvals`, `npbg_approvals`, `purchase_order_approvals`, `purchase_order_pick_logs` | NPBG/PPB keyed by document-number string |
| Module histories | `mrp_activities`, `disassembly_activities`, `vendor_price_histories`, `npbg_verification_logs`, `important_request_activities`, `sync_logs` | Separate formats per module |
| Chatter | `doc_messages` (MESSAGE / NOTE), attachments, `doc_activities` for 7 document types | Not available on master data, MRP, Disassembly, opname, tracking |
| Immutability | Logs are ordinary tables; `StockwisePurge` deletes documents, approval logs and stock movements nightly in accurate-only mode | Audit history of STOCKWISE-created transactions is lost after purge [V] |

## 7. File access [V]

- Files on the local disk; served only through authenticated controller methods that check the module permission (RI photos `ri.view`, request images, fulfilment signatures, chatter attachments with staff check for notes, tracking photos per entity).
- Public Kartu Stock links can upload/delete files when access is EDIT/FULL.
- No antivirus / content-type re-validation beyond Laravel validation was observed **[I]**.

## 8. Sensitive information handling

- `.env` files are git-ignored (README) — not opened beyond reading four non-secret flags.
- Requester IP and location stored on public requests (`item_requests.requester_ip/location`); user agent and IP in `user_activity_logs` — personal data retention policy not found **[I]**.
- Avatars served by `/api/avatars/{user}` **without authentication** (throttled) [V route].
