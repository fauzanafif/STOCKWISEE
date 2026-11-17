# 09 — Odoo + SAP Gap Analysis

> Read-only audit 2026-11-16. Each "Current STOCKWISE" cell is based on reports 01–08. **[V]** Verified · **[I]** Inferred.
> A feature is called missing only where the code was searched and nothing was found.

## 1. Odoo reference

| Area | Current STOCKWISE | Odoo reference | Gap |
|---|---|---|---|
| Centralised master data | One `items`, `vendors`, `units`, `users` table used by many modules [V]; but NPBG/PPB/RI reference masters by text, divisi/customer/category are free text or duplicated [V] | `product.product`, `res.partner`, `uom.uom` referenced by many2one everywhere | **High** — move document lines to id references (item_id, unit_id, partner_id, department_id) and keep text only as snapshot |
| Partner model | Vendors, customers, employees, users are separate; customers have no create path [V] | single `res.partner` (company/contact, supplier/customer ranks) | Medium — consider a partner abstraction or at least one customer master that NPBG uses |
| Modular architecture | Laravel monolith; modules are folders of controllers/services, one 921-line `routes/api.php`; no module boundaries or enable/disable [V] | addons with manifest, dependencies, install/uninstall | Medium — split routes/services per module, define module dependencies |
| Reusable models / mixins | Shared helpers exist (`UomConverter`, `DocumentNumberService`, `DuplicateGuard`, `DocumentRegistry`) [V]; each document has its own approval table/format [V] | `mail.thread`, `mail.activity.mixin`, sequence, approval mixins | Medium — one generic approval / status-history mechanism |
| Document structure | NPBG, PPB, RI stored **one row per line** without header; status derived from logs [V] | header + lines (`stock.picking` / `stock.move`, `purchase.order` / `.line`) with a `state` field | **High** |
| Related records / smart buttons | `DocumentGraph` + `/documents/{type}/{id}/related` for 7 types [V] | smart buttons on every form | Low–Medium — extend to MO, Disassembly, opname, tracking |
| List and form views | Hand-built React pages per module with shared `DataTable`, `FilterBar`, column visibility, saved list memory [V] | generic list/form/kanban views from metadata | Low (acceptable custom UI); consider shared form framework |
| Configurable workflows | Hard-coded status machines and two-step approvals in services [V] | configurable stages, approval rules, studio | Medium |
| App Launcher | Implemented, permission-filtered, with "coming soon" apps [V] | home menu | Done |
| Activities & Chatter | Messages, internal notes, attachments, scheduled activities, audit tab on 7 document types [V] | chatter on every record incl. masters | Medium — coverage |
| Inventory model | Balance per item×warehouse + ledger; reservation; no locations, no transfers, no lots/serial stock, no routes [V] | `stock.quant` per location/lot, `stock.move`, putaway, multi-step routes | **High** for an ERP inventory |
| Manufacturing | BoM with revisions, MO with confirm/record/validate/reverse, disassembly (unbuild) [V] | MRP with work centres, routings, unbuild | Medium (work centres / routing / costing absent) |
| Purchase | PPB → quotation on PO lines → director pick → PO → RI; price list [V] | RFQ → PO → receipt → vendor bill; vendor pricelists | Medium (no vendor bill / 3-way match) |
| Accounting / Sales | "Coming soon" placeholders only [V] | full apps | Out of scope today |

## 2. SAP reference

| Area | Current STOCKWISE | SAP reference | Gap |
|---|---|---|---|
| Organisational structure | `sites` (2) and `warehouses`; no company code, plant/storage-location hierarchy is implicit; transactions use the lowest-id warehouse [V] | Company code → plant → storage location; purchasing org | **High** |
| Master data governance | Data Quality report (read-only) flags duplicates [V]; no approval/workflow for master changes; masters editable by many roles; no field-level audit on masters [V] | MDG: change requests, validation, ownership | **High** |
| Transactional integrity | Single ledger writer with row lock + transaction; negative stock blocked [V]. But: ledger rows are deleted by the nightly purge, Excel importer bypasses ledger, over-receipt not capped, files not rolled back [V] | Immutable material documents; reversal by counter-document only | **High** — ledger must be append-only, corrections by reversal |
| Document numbering | `document_sequences` per type/prefix/year/month with lock [V] | number ranges | Low |
| Authorization & SoD | Permission RBAC, backend-enforced [V]; ~30 dead permissions; no site/warehouse scoping; no creator ≠ approver rule; admin_gudang can schedule+count+approve opname and run MRP end-to-end [V] | authorization objects with org-level fields; SoD rule sets | **High** |
| Auditability | Field-level audit for 12 document models, request-level user log, many per-module logs [V]; Query Builder writes and masters not captured; purge removes history [V] | change documents for masters and transactions, retained | **High** |
| Inventory controls | Opname with review and adjustment, reservation, safety stock analytics [V]; no transfer, no quality inspection stock, no blocked stock, no cycle-count classes [V] | movement types, stock types (unrestricted / QI / blocked), physical inventory docs | Medium–High |
| Procurement controls | Two-step PPB approval, director vendor choice, PO approval by director, duplicate guard [V]; no budget/commitment, no tolerance on receipt, no 3-way match [V] | release strategies, tolerances, GR/IR | Medium–High |
| Financial integration readiness | No valuation, cost, GL accounts, tax master, currency; Accurate holds finance [V] | material ledger, automatic postings | **High** (if independence from Accurate is the goal) |
| Reporting consistency | Many dashboards; stock shown from `inventory_snapshots`, Accurate quantities and `StockwiseNet` netting — three notions of stock [V]; Kartu Stock separate from ledger [V] | single source for stock reports | Medium |
| Integration | Robust read-only Accurate sync with staging, whitelist, checksum [V]; but Accurate is system of record and STOCKWISE data is purged nightly (accurate-only flag) [V] | ERP is system of record; integrations via IDoc/API | **Strategic** — decide when STOCKWISE becomes system of record |

## 3. Summary of the largest gaps

1. Accurate-only mode: STOCKWISE is still a working layer whose own transactions and ledger rows are purged nightly.
2. Line-level, text-referenced document tables (NPBG/PPB/RI) instead of header/line documents with master FKs and a stored state.
3. No organisational model (company / plant / storage location) and no data scoping by site or warehouse.
4. Inventory lacks transfers, bin locations, lot/serial stock and valuation.
5. Governance: no master-data change control, partial audit coverage, deletable logs, no SoD rules, many dead permissions.
