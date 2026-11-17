# 04 — Master Data Inventory

> Read-only audit 2026-11-16. **[V]** Verified from code/migrations · **[I]** Inferred · **[U]** Unknown.
> "Create / edit" = the code paths that insert or update the table. "Snapshot" = whether transactions copy the
> master values they used (so later master edits do not rewrite history).

## 1. Entity-by-entity

| # | Entity | Model / table | Created in | Edited in | Consumed by | Duplicates possible? | Central? | Referential integrity | Transaction snapshot |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Item / Product** (Barang & Jasa) | `Item` / `items` (soft delete) | `POST /api/items` (`item.create`); Accurate sync (`AccurateSyncService:714`, from `accurate_item`); Excel importer (`ItemImporter` upsert) | `PUT /api/items/{id}`, UOM base-unit endpoint, Accurate sync | Every module: Item Request, NPBG, PPB, PO, RI, MRP, Disassembly, Opname, Price List, Kartu Stock, Tracking | `code` is unique [V]; same description under different codes is possible — only reported by Data Quality page [V] | Yes, one table [V] | FK `item_id` on modern tables; **NPBG/PPB/RI rows link by `kode_barang` text, no FK** [V] | Yes: `kode_barang`, `deskripsi_barang`, `satuan`, `unit_ratio`, `base_satuan` copied onto NPBG/PPB/RI/lines; MRP/Disassembly copy `product_code`, `description`, `base_unit` [V] |
| 2 | Product category | `Category` / `categories` (tree) **and** text fields `items.accurate_category_induk/anak_1..3` **and** `item_category_options` | Tree: importer (`CategoryImporter`); options: `/api/item-categories` (`master.category.manage`); Accurate text: sync | same | Item master, filters, dashboards (use the **Accurate text**, not the tree) [V `InventoryDashboardController`] | Tree unique on (parent, name) [V] | **No — three parallel representations** [V] | `items.category_id` FK only for the tree | n/a |
| 3 | UOM | `Unit` / `units` + `UomCategory` / `uom_categories` | `UomController` (`master.unit.manage`), `stockwise:seed-uom`, importers, STPP | `UomController` | Items, PO lines, Price List, tracking | `code` unique [V] | Yes [V] | FK from items, PO items, vendor_prices; **text `satuan` on NPBG/PPB/RI/item request lines** | Unit code + ratio snapshot on documents [V] |
| 4 | UOM conversion | `ItemUnitConversion` / `item_unit_conversions` (+ global `units.ratio` within a category) | `POST /api/items/{id}/unit-conversions` | confirm / delete endpoints | `UomConverter` (Item Request, NPBG, PPB, PO, RI, MRP, Price List) | unique (item, unit) [V] | Yes [V] | FK item, unit, base_unit | Ratio frozen on PO lines / RI (`unit_ratio`) [V] |
| 5 | Vendor | `Vendor` / `vendors` | `POST /api/vendors` (`master.vendor.manage`); Accurate sync `Vendor::firstOrCreate` by name | `PUT /api/vendors/{id}` | PO, quotes, Price List, RI, purchase returns, borrow, manufacturing tracking | unique **name only**; `code` nullable, not unique; "PT X" vs "X" both allowed (Data Quality flags similar names) [V] | Yes [V] | FK on PO / quotes / prices; **text `vendor` on `ri`, `purchase_returns`** | Vendor name text on RI / returns [V] |
| 6 | Customer | `Customer` / `customers` | **No API create path** — only `DemoSeeder` [V] | none | Lend (`customer_id`), Projects | unique name | Table exists but unused for NPBG | NPBG uses free-text `pelanggan` [V] | text only |
| 7 | Employee | `Employee` / `employees` | `/api/employees` (+ Excel import), `UserSeeder` | `PUT /api/employees/{id}` | Item Request requester, STPP holder, maintenance reporter, proxies | unique (name_normalized, department) [V] | Yes [V] | FK department, site, user | Requester name copied as text on item requests / NPBG `peminta` [V] |
| 8 | User | `User` / `users` | `/api/users` (`user.create`), seeders | `/api/users/{id}`, self password/avatar | All modules (created_by, approvals, assignees) | unique `username`, `email` [V] | Yes [V] | FK (mostly `nullOnDelete`) | Approval logs store `user_name` text as well as `user_id` [V] |
| 9 | Company | **None** [V] | — | — | — | — | No legal-entity table; single company (PT Surya Inti Gas) implied | — | — |
| 10 | Branch / Site | `Site` / `sites` (2 rows seeded: SIG-SDA, SIG-BPN) | `SiteSeeder`, `WarehouseImporter` | no API | Warehouses, users, employees, PO, opname, assets | unique code | Yes, read-only in UI (`GET /api/sites`) | FK | — |
| 11 | Department / Division | `Department` / `departments` | `POST /api/employees/departments`, seeders | no update endpoint found | Employees only | unique name; similar names flagged by Data Quality | **No** — documents use free-text `divisi` [V] | FK only from employees, purchase_proposals (legacy) | `divisi` text on NPBG / PPB / RI / item requests |
| 12 | Warehouse | `Warehouse` / `warehouses` | Accurate sync (`Warehouse::firstOrCreate`, from `accurate_warehs`), `WarehouseImporter` | **no API** (`master.warehouse.manage` exists but is never checked) | Inventory, ledger, opname, MRP/Disassembly | unique (site, code) | Yes, read-only [V] | FK | RI/NPBG store `lokasi_gudang` text |
| 13 | Location (rack/bin) | `WarehouseLocation` / `warehouse_locations` | importer only (I) | no API | Items default location, opname items | unique (warehouse, code) | Read-only | FK | `lokasi_rak` text on documents |
| 14 | Project | `Project` / `projects` | `POST /api/stock-card-projects` (guarded by `item.update`) | same controller | Kartu Stock, Lend | **no unique key** | Partly (owned by Kartu Stock) | FK from stock_cards, lend | — |
| 15 | Asset / Vehicle | `Asset` / `assets` | DemoSeeder only; tracking uses `nopol_raw` text | none | Maintenance, Tyre | unique code | Partly | FK nullable | `nopol_raw` text |
| 16 | Workshop | `Workshop` / `workshops` | DemoSeeder / TrackingSeeder | none | Maintenance | unique name | Partly | FK nullable | `workshop_raw` text |
| 17 | Serial unit | `SerialUnit` / `serial_units` | STPP service / importer | STPP | STPP, Tyre, Manufacturing tracking | unique (serial, kind) | Partly | FK | `serial_no_raw` text; NPBG/RI keep `no_seri` text |
| 18 | Price list | `VendorPrice` / `vendor_prices` + history | `POST /api/price-list` (`rfq.create`) | `PUT`, archive (`rfq.update`) | PO quotation reference (`/price-list/reference`) | **No unique key** on item+vendor+unit+period and no overlap check found in `PriceListService`; several ACTIVE prices can coexist and are ranked when read (`PriceListService:148-157`) [V] | Yes (new 2026-11-16, untracked in git) | FK item, vendor, unit | PO quotes keep their own price [V] |
| 19 | BoM | `MrpBom` / `mrp_boms` + lines | `/api/mrp/boms` (`mrp.bom.manage`) | revise / activate / archive | MO, Disassembly | unique (item, revision); circular BoM blocked [V `BomService`] | Yes | FK `restrict` | MO / Disassembly copy BoM lines at confirmation [V] |
| 20 | Financial reference data (chart of accounts, tax, currency, payment terms, cost centre) | **None in STOCKWISE** [V]. `accurate_termopmt` mirror exists for Accurate terms only. PO has `subtotal/tax/total` numbers without tax master | — | — | — | — | — | — | — |

## 2. Does STOCKWISE follow "ONE MASTER ENTITY → MULTIPLE MODULES"?

**Partly. [V]**

- **Yes for:** items (one `items` table, `product_kind` BARANG/JASA instead of two tables), units + conversions (`UomConverter` used everywhere), vendors for purchasing, users/RBAC, BoMs shared by MRP and Disassembly, warehouses for the ledger.
- **No / broken for:**
  1. **Accurate-mirrored documents** (`npbg`, `ppb`, `ri`) reference masters by **text** (`kode_barang`, `satuan`, `vendor`, `divisi`, `pelanggan`, `peminta`) rather than by id. A renamed item code or vendor breaks the link silently.
  2. **Divisi / department** — the `departments` master is used by employees only; all documents carry free text.
  3. **Customer** — the master exists but has no create path; NPBG uses text `pelanggan`.
  4. **Category** — tree, option list and Accurate text co-exist; dashboards use the Accurate text.
  5. **Person** — `employees` and `users` overlap; requester names are typed text on public requests.
  6. **Site/Company** — no company entity; site is used inconsistently (PO, opname yes; NPBG/PPB/RI no).
- Master data for warehouses, sites, locations, customers, workshops and assets has **no maintenance UI/API** even though `master.*.manage` permissions are defined (see report 08). They are filled by seeders, importers or the Accurate sync.

## 3. Master data creation sources (summary)

| Source | Entities it writes |
|---|---|
| Accurate sync (`AccurateSyncService`) | items, vendors, warehouses, and document mirrors (npbg, ppb, ri, purchase_orders, stock_opnames) |
| Excel import (`stockwise:import`, `app/Support/Import/Importers`) | categories, units, warehouses/sites, departments, employees, items (+ opening inventory directly), safety stock |
| STOCKWISE UI/API | items, units/UOM, conversions, vendors, employees, departments (create only), users/roles, projects, price list, BoMs, item category options |
| Seeders only | customers, assets, workshops, sites |

## 4. Data duplication risks (master level)

| Risk | Evidence | Level |
|---|---|---|
| Vendor entered twice under name variants (PT/CV/spaces) — unique only on exact name; sync `firstOrCreate` by name adds a new row for any spelling change | `vendors` unique(name); `AccurateSyncService:1851`; Data Quality "similar vendors" check | High [V] |
| Item with the same description under several codes | `items.description` not unique; Data Quality "duplicate item names" | Medium [V] |
| Department name variants ("MGR OPERASIONAL" vs "MGR. OPERASIONAL") | Data Quality "similar departments" | Medium [V] |
| Same person as employee + user with diverging name/phone | two tables both store phone/position | Medium [I] |
| Projects without unique key | `projects` has no unique index | Low–Medium [V] |
| Price list overlaps (same item+vendor+unit, overlapping validity) | no DB unique key, no overlap validation; resolved by ranking at read time | Medium [V] |
