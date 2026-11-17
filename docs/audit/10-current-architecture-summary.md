# 10 — Current Architecture Summary

> STOCKWISE read-only structure audit, 2026-11-16. Prepared for review by the project owner before development starts.
> **[V]** Verified from source / migrations · **[I]** Inferred from evidence · **[U]** Unknown (needs DB or production access).
>
> **Audit limits.** No database connection was made (production DB is live and was deliberately not touched), so the schema
> was reconstructed by statically replaying the `up()` of all 131 migrations. Whether every migration has run on production,
> row counts, actual role assignments and the live `.env` are **[U]**. No tests, migrations, seeders or builds were run.
> The working tree has uncommitted changes (UOM, Price List, Rbac, several pages); the audit describes the working tree.

## Architecture at a glance

```text
Accurate 5 (Firebird, system of record) ──file copy──► staging GDB ──Python Sync Agent──► /api/agent/sync
                                                                                         │
                         ┌───────────────────────────────────────────────────────────────┘
                         ▼
 Laravel 13 API (php artisan serve :8001, single Windows server) ── MySQL 8: 126 tables + 26 accurate_* mirrors
   • RBAC middleware + in-controller checks      • StockLedgerService = single runtime stock writer
   • Services per domain (Item Request, PPB, PO, RI, MRP, Disassembly, Tracking, Opname, Price List)
   • Nightly StockwisePurge in accurate-only mode (default ON)
                         ▲
 React 19 SPA (served from backend/public/app.html) — App Launcher, permission-filtered menus, React Query, polling /api/live
```

## A. Technology stack
Laravel 13.30 / PHP 8.4, Sanctum tokens, custom RBAC, PhpSpreadsheet; React 19 + TypeScript 6 + Vite 8, React Router 7, TanStack Query 5, Tailwind + shadcn-style UI; MySQL 8 (8.4 per service name [I]); Python Sync Agent for Accurate 5 / Firebird 2.5. No queue workers, events or policies. [V] — report 01.

## B. Total database tables
**126** defined by migrations [V] + **26** runtime `accurate_*` mirrors [V code, columns U] = **152** possible. 5 further tables were created and later dropped. — report 02.

## C. Master data entities
**23** master tables [V] covering ~17 business entities: item, category (3 representations), UOM, UOM category, item conversion, item alias, safety-stock parameters, vendor, customer, employee, department, site, warehouse, location, project, asset, workshop, serial unit, used-return component type, price list, BoM (+ users/roles as security masters). No company and no financial masters. — report 04.

## D. Transaction tables
**48** [V] (requests, NPBG, PPB + drafts, PO + quotes, RI, returns, opname, inventory balance + ledger, MRP, disassembly, tracking registers, Kartu Stock, Important Request).

## E. Configuration tables
**7** [V] (`app_settings`, `document_sequences`, `item_request_links`, `stock_card_share_links`, `update_alerts`, `accurate_ip_labels`, `user_preferences`).

## F. System & security tables
**13** [V] (users, roles, permissions, 2 pivots, tokens, password resets, sessions, cache ×2, jobs ×3). Plus **15** log/audit tables and **15** supporting tables; **5** legacy tables need a decision (`purchase_proposals*`, `receivings*`).

## G. Total modules
**27** functional modules (implemented or partial), **1** requested module absent (IT Helpdesk — the "Helpdesk" app is a static guide), **5** "coming soon" placeholders (Sales, Accounting, Assets, Documents, Projects). — report 05.

## H. Existing module status
- **Implemented [V]:** App Launcher, Dashboards, Master Items, Item Categories, UOM, Item Request (incl. public links), Delivery Order, NPBG Verification, Purchase Request + drafts, Purchase Order + quotation, Receipt, Price List (new, untracked), Purchase Return, Inventory analysis / safety stock, Physical Inventory, Kartu Stock, MRP, Disassembly, 7 Tracking registers, Important Request, Approvals inbox, Chatter (7 doc types), Notifications (in-app), Users & Roles, Reporting/Export, Accurate integration, User Log, Data Quality, Employees, Vendors.
- **Partial:** Settings (super-admin hard-coded), Stock Ledger (no page, unused permission), Chatter coverage.
- **Backend only / read only:** Warehouses, sites, locations (no maintenance UI/API).
- **Absent:** IT Helpdesk, warehouse transfer, inventory valuation, accounting, sales.

## I. Master data relationships
"One master → many modules" holds for items, units, vendors (purchasing), users, BoMs and warehouses [V]. It breaks where Accurate-shaped documents (`npbg`, `ppb`, `ri`) reference masters by **text** (`kode_barang`, `satuan`, `vendor`, `divisi`, `pelanggan`, `peminta`) with no FK; `departments` and `customers` are not used by documents; categories exist three ways; employees and users overlap [V]. Several FKs still target legacy tables (`receivings`, `purchase_proposal*`) instead of `ri` / `ppb` [V]. Transactions do snapshot item code/description/unit/ratio [V]. — reports 03, 04.

## J. Inventory architecture
Balance (`inventory`, item × warehouse) + ledger (`stock_movements`) written by one service with transaction + row lock + negative-stock guard [V]. Reservation exists; transfers, bin-level stock, lot/serial stock and valuation do not [V]. Exceptions to the single writer: Excel bulk import (insert) and the nightly purge (deletes movements) [V]. Receipts always post to the lowest-id warehouse [V]. In accurate-only mode stock is realigned to Accurate's quantity — Accurate, not STOCKWISE, is the stock system of record today [V]. — report 07.

## K. Business workflow status
- Purchasing: PPB (Manager → Director, status from log) → approved line → quotation (vendors, prices) → director vendor pick → PO (director approval) → send/proof → RI (stock in immediately). Over-receipt not capped [V]. Price List is a reference only.
- Warehouse: Item Request → admin verification → Manager → Director → prepare (**reservation** + NPBG row) → confirm → handover with photo/signature (**stock out**) → close. Manual NPBG: two-step approval then stock out [V].
- Manufacturing / Disassembly: explicit state machines; stock moves only through Item Request + Receipt via `WarehouseGate` (legacy orders posted directly) [V].
- Opname: schedule → count → submit → review → adjustment [V].
- Differences from the proposed flows are listed in report 06.

## L. Security and governance findings
1. **Accurate-only purge** (default `true`, not overridden in `.env`) deletes STOCKWISE-created documents, approval logs and stock movements nightly [V].
2. `APP_DEBUG=true`, `APP_ENV=local` in the working-copy `.env`, and production served by `php artisan serve` [V/I].
3. `/api/dashboard/inventory` (+ `/filters`) has no permission check [V].
4. 30 defined permissions are never enforced; some capabilities ride on unrelated permissions (projects via `item.update`) [V].
5. No site/warehouse data scoping; no creator ≠ approver rule; Director bypass of Manager; admin_gudang can run opname and MRP end-to-end [V].
6. Audit trail covers 12 document models only; Query Builder writes and master data are not audited; logs are deletable [V].
7. Public bearer links (request form, Kartu Stock EDIT/FULL) never expire; avatars are public [V].
8. Token in `localStorage` [V]. No Policies — authorization is spread across middleware and controllers [V].
— report 08.

## M. Data duplication risks
Vendors (unique only by exact name; sync `firstOrCreate` by name) — High; item descriptions under several codes — Medium; department name variants — Medium; employee vs user person data — Medium; price list overlaps (no unique key or overlap check) — Medium; projects (no unique key) — Low–Medium; duplicated document header data on every NPBG/PPB/RI line — structural. [V]

## N. Odoo architectural gaps
Header/line documents with stored state; id-based master references; partner model; module boundaries; generic approval/status mixin; chatter on all records; location/lot-aware inventory; configurable workflows. — report 09 §1.

## O. SAP architectural gaps
Organisational hierarchy (company/plant/storage location) and scoping; master-data governance; append-only material documents with reversal; SoD rules; complete change documents; stock types & quality inspection; receipt tolerances and 3-way match; valuation & financial integration; single stock truth for reporting. — report 09 §2.

## P. Recommended development priorities (not implemented — for owner decision)

| # | Priority | Why | Evidence |
|---|---|---|---|
| 1 | **Decide the system-of-record strategy** (keep Accurate-only + purge, or move STOCKWISE to record and switch purge off) before building more transactional features | Everything created in STOCKWISE is currently erased nightly | `StockwisePurge`, `config/stockwise.php:93` |
| 2 | Production hardening: `APP_DEBUG=false`/`APP_ENV=production`, a real web server/PHP-FPM instead of `artisan serve`, verify `migrate:status` (two new migrations untracked) | Live exposure and stability | `.env`, README |
| 3 | Close authorization gaps: permission on `/dashboard/inventory`, remove or wire the 30 dead permissions, introduce Policies for record-level rules, add creator ≠ approver checks | Least privilege, SoD | report 08 |
| 4 | Make the ledger append-only: corrections by reversal movements, no deletes; route importer through the ledger | Auditability | report 07 §4 |
| 5 | Organisational model + warehouse selection on RI/NPBG (stop using the lowest-id warehouse), then warehouse transfer | Multi-warehouse correctness | report 07 §5 |
| 6 | Introduce header tables (or views) for NPBG/PPB/RI with stored state and id FKs to item/unit/vendor/department/customer; keep text as snapshot | Master-data integrity, Odoo-style documents | reports 03, 04 |
| 7 | Retire or repoint legacy tables (`receivings`, `purchase_proposal*`) and FKs that still target them | Referential correctness | report 03 §5 |
| 8 | Master-data governance: unique business keys (vendor code, customer code, price-list key), merge tools, change approval, audit for masters | Duplication risks | report 04 §4 |
| 9 | Receipt controls: cap/tolerance vs PO remaining, optional QC step; purchase return stock movement | Procurement integrity | report 06 §1.4 |
| 10 | Extend chatter/audit/related-documents to MRP, Disassembly, opname, masters; then valuation and finance readiness | Odoo/SAP parity | report 09 |
