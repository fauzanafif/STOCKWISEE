# Dummy / Test Data — Identification (Phase 4, step 1–3)

Date: 2026-11-20 · Database: `stockwise` (MySQL, live clone) · Status: **identified only, nothing deleted.**

## How it was identified

- `php artisan stockwise:sample-data` (app/Console/Commands/SampleDataCommand.php) writes "seven of each" feature with its **own items** and numbers ending in **`/901`–`/907`**. It records what it made in `storage/app/sample-data.json` so `--remove` can delete exactly that. **That file no longer exists**, so `--remove` cannot be used and the set was rebuilt from its markers:
  - items `ELK.9001 … GAS.9008` (ids 54413–54420, created 2026-11-18 01:47:24, `source` NULL)
  - document numbers `…/26/XI/901–907` in every module (all created 2026-11-18)
- `DemoSeeder` marks its vendors `source = 'demo'`.
- Every row below was checked for links to non-sample data (PO lines, ledger notes, PPB references).

## A. Confirmed sample data (recommended to delete)

| Area | What | Rows |
|---|---|---|
| Items | ELK.9001, MKN.9002, OLI.9003, SPR.9004, ATK.9005, SPR.9006, APD.9007, GAS.9008 | 8 |
| Item Request | REQ/26/XI/901–907 (+ lines) | 7 |
| NPBG / Delivery Order | NPBG/MANUAL/26/XI/901–907 (+ approvals) | 7 |
| Purchase Request | PPB/NA/26/XI/901–907 (13 lines) + RST/26/XI/901 draft (+ draft lines) | 13 + 1 |
| Price List | PL/26/XI/901–907 (+ items, vendors, cells), vendor prices/histories of the sample items | 7 |
| Purchase Order | PO/PPB/26/XI/901–908 (+ items, vendors, quotes) | 8 |
| Receipt | RI/MANUAL/26/XI/901–907 | 7 |
| Return | RTR/26/XI/901–907 (+ lines) | 7 |
| Stock Opname | SO/26/XI/901–907 (+ items) | 7 |
| Important Request | IMP/26/XI/901–907 (+ assignees, activities) | 7 |
| Update Alerts | the 7 inactive alerts (+ views) | 7 |
| Per-item conversions | of the sample items | 5 |
| Stock ledger | `stock_movements` of the sample items only (opening balances, their RI/NPBG) | ~22 |
| Stock | `inventory` / `inventory_snapshots` rows of the sample items | 8 + 8 |
| Vendors | 5 vendors with `source = 'demo'` (CV Amarta Teknik, PT Sinar Baja Electric, UD Karya Logam, CV Mitra Gas Sejahtera, PT Indo Bearing): only referenced by sample POs, price lists, returns | 5 |
| UOM category | "testing" (0 units) | 1 |

Checks done: sample POs contain **no** real item, and sample items appear in **one** non-sample PO (below). The ledger rows only belong to sample items, so **no real item's stock changes**.

## B. Derived from sample data (recommended to delete, needs approval)

| What | Why |
|---|---|
| **PO/PPB/26/XI/001** (id 1312, status MENUNGGU_PO, 1 line: OLI.9003 × 3) | made on 2026-11-18 01:53 by superadmin **from sample PPB/NA/26/XI/907**. It is the only non-9xx document using a sample item. |

## C. Ambiguous (keep unless the owner says otherwise)

| What | Why it is not obviously dummy |
|---|---|
| Items **test1** "BAJA RINGAN" (54421) and **roda motor** "RODA MOTOR" (54422) | created 2026-11-19 by fauzan for **REQ/26/XI/003**, a request by **Misse** (a real user). The request may be real; only the item code looks like a test. Each has a 0-quantity opening balance. Suggest: give them proper codes/categories instead of deleting. |
| 8 deactivated demo users (admingudang, anakgudang1/2, lapangan1/2, adminlapangan, bos, purchasing) | still referenced by documents. Some references may only be sample documents; after A is removed they can be checked again and deleted if nothing remains. |
| Notifications / activity logs mentioning sample numbers | not yet counted; would be removed with their documents in the same run. |

## D. Not dummy (kept)

- 9,198 Accurate items, 310 Accurate vendors, 452 categories, all 40 units except the fixes in the UOM report.
- Items matching "test" by name but from Accurate: ETA.0219 *Pneumatic hand test pump*, MAI.0793 *Obeng test pen*, MNA.0072 *Test injector kendaraan*. These are real products.

## Procedure when approved

1. Full `mysqldump` of `stockwise` to `backend/storage/backups/` (checked: file size + table count).
2. A new artisan command `stockwise:cleanup-dummy` with **`--dry-run` as the default**. It lists every row id per table, deleting children first, by **explicit ids** (no TRUNCATE, no cascade, no pattern delete), in one transaction. It refuses to run if any listed row gained a link to non-listed data since this audit.
3. Run the dry run and compare it with this report.
4. Run for real, then verify: the counts per table drop by exactly the listed amounts, real items' stock is unchanged (inventory sum of non-sample items before/after) and the ledger of non-sample items is unchanged.
5. Append the result to this file.

---

## Result (executed 2026-11-20, approved: A + B)

1. **Backup:** `backend/storage/backups/stockwise-full-before-dummy-cleanup-20261120-090842.sql` (full dump, 155 tables, 198 MB).
2. **Command:** `php artisan stockwise:cleanup-dummy` (dry run) → `--execute`. It follows every foreign key from the seeds and refuses if a guarded document outside the set, a SET NULL link from a real row, or a ledger row of a real item would be touched. Dry run: **309 rows in 33 tables, 0 blockers**.
3. **Deleted:** exactly the 309 rows, by id, children first, in one transaction.
4. **Verified (before → after):**

| Check | Before | After |
|---|---:|---:|
| Stock of real items (Σ actual_qty) | 32,406.75 | 32,406.75 |
| Ledger rows of real items | 7,598 | 7,598 |
| Ledger qty of real items (Σ) | 30,881.75 | 30,881.75 |
| Inventory rows of real items | 9,202 | 9,202 |
| items / PO / NPBG / PPB / RI / SO / vendors | 9,210 / 1,311 / 8,601 / 2,510 / 4,831 / 2,556 / 315 | 9,202 / 1,302 / 8,594 / 2,497 / 4,824 / 2,549 / 310 |

Each table dropped by exactly the listed amount. Item Requests went 10 → 4: 7 sample requests removed, and **REQ/26/XI/004 (Aan) was created by a real user during the run** and is untouched. A second dry run afterwards finds 0 rows.

**Kept (C, ambiguous):** test1 / roda motor and REQ/26/XI/003 (Misse); the 8 deactivated demo users (still referenced by real history).
