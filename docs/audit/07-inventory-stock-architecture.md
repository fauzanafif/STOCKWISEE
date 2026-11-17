# 07 — Inventory & Stock Architecture

> Read-only audit 2026-11-16. No stock-changing operation was executed. **[V]** Verified · **[I]** Inferred · **[U]** Unknown.

## 1. Components

| Component | Table / class | Role |
|---|---|---|
| Stock balance | `inventory` (unique item × warehouse; `actual_qty`, `reserved_qty`, `stock_known`, `last_counted_at`, `last_movement_at`) | Source of truth for STOCKWISE stock [V] |
| Stock ledger | `stock_movements` (type, direction, qty, actual/reserved before → after, polymorphic `reference_type/id`, `batch_uuid`, `created_by`, `created_at`) | Append-only log written together with the balance [V] |
| Read model | `inventory_snapshots` (warehouse_id NULL = all-warehouse row; status, safety stock, priority) | What most pages show as "stock"; actual/reserved/available refreshed on every movement, the rest by the analysis run [V] |
| Accurate figures | `items.accurate_qty_onhand`, `accurate_qty_onorder`, `accurate_itembalance*` mirrors | Upstream quantities; in accurate-only mode STOCKWISE stock is made to follow them (`ACCURATE_SYNC`) [V] |
| Netting | `App\Services\Inventory\StockwiseNet` | Adds STOCKWISE movements not yet entered in Accurate (approved NPBG, MRP/Disassembly legacy postings since `STOCKWISE_LEDGER_SINCE`) on top of Accurate's qty [V] |
| Kartu Stock | `stock_cards`, `stock_card_entries` | Manual paper-card replica per project; **not connected to the ledger** [V] |
| Single writer | `App\Services\Inventory\StockLedgerService::record()` | See §3 |

## 2. Movement types (`StockLedgerService::ACTUAL_DIRECTION`) [V]

| Type | Direction | Used by (callers found) |
|---|---|---|
| OPENING_BALANCE | + | `ItemController::store` (qty 0 for a new item), `AccurateSyncService:774`, `AccurateDerivedAnalysis` |
| RECEIVING | + | `RiController::storeFromPo`, `RiController::store` |
| STOCK_IN / RETURN / TRANSFER_IN | + | `ReceivingService` (legacy `receivings` flow) — no current route reaches it except through `UsedReturnService` [I] |
| STOCK_OUT | − | `ItemRequestFulfillmentService::settle()` (handover), `NpbgApprovalService` (manual NPBG approved) |
| TRANSFER_OUT | − | **no caller** — warehouse transfer not implemented (`inventory.transfer` permission unused) |
| RESERVATION / RELEASE_RESERVATION | 0 (reserved ±) | Item Request fulfilment, MRP / Disassembly (legacy), `StockwisePurge` |
| STOCK_ADJUSTMENT | absolute | `StockOpnameService` on approval |
| ACCURATE_SYNC | absolute | `AccurateDerivedAnalysis::followAccurateQty`, `StockwisePurge` |
| MRP_CONSUME / MRP_SCRAP / MRP_PRODUCE / MRP_REVERSE_IN / MRP_REVERSE_OUT | ∓ | `ProductionService` (legacy MOs only; new MOs move stock through Item Request + RI) |
| DISASSEMBLY_OUT / _IN / _REVERSE_IN / _REVERSE_OUT | ∓ | `DisassemblyService` (legacy orders only) |

## 3. The ledger service [V]

`record()` runs in `DB::transaction`:
1. `Inventory::where(item, warehouse)->lockForUpdate()->firstOrCreate(...)` — row lock on the balance (create is protected by the unique key).
2. Computes after-values; absolute types set the value.
3. Rejects: unknown type, **negative actual stock**, negative reserved, reserved > actual (`RuntimeException` → rollback). For `ACCURATE_SYNC`, reserved is clipped to actual instead of failing.
4. Saves balance (rounded to 2 decimals), refreshes `inventory_snapshots`, writes the `stock_movements` row with before/after and reference.

Strengths: one code path, row-level lock, before/after audit, polymorphic document reference, negative stock blocked. Callers that span several movements wrap them in their own outer transaction (nested → savepoints), e.g. RI, fulfilment, NPBG approval.

## 4. Writers that bypass the ledger [V]

| Location | What it does | Risk |
|---|---|---|
| `app/Support/Import/Importers/ItemImporter.php:209-212` | Bulk `DB::table('inventory')->insert()` and `DB::table('stock_movements')->insert()` during Excel import | Bypasses locks and validation; acceptable for initial load only |
| `app/Services/Accurate/StockwisePurge.php:120` | `$movements->delete()` — deletes stock movements of purged STOCKWISE documents, then re-aligns balances with `ACCURATE_SYNC` | **Ledger is not append-only**; history of purged transactions disappears |
| `StockLedgerService::refreshSnapshot` | direct update/insert of `inventory_snapshots` | By design (read model) |
| Seeders / `SampleDataCommand` | sample data | dev only |

No other `update/insert/delete` on `inventory` or `stock_movements` was found in `app/`.

## 5. Mechanisms checklist

| Mechanism | Implemented? | Notes |
|---|---|---|
| Stock In | Yes — RI (RECEIVING) | Always into the **lowest-id warehouse** (`Warehouse::orderBy('id')->value('id')`) [V] |
| Stock Out | Yes — Delivery Order handover / manual NPBG approval | Taken from warehouses with most free stock [V] |
| Reservation | Yes — Item Request prepare (and legacy MO/Disassembly) | Real `reserved_qty`; released on confirm/close/cancel [V] |
| Opening balance | Yes | From Accurate qty or 0 on item create [V] |
| Adjustment | Yes — opname approval; Accurate follow-up | `stock_adjustments` links to movement [V] |
| Warehouse transfer | **No** | type defined, no service / endpoint / UI [V] |
| Stock card | Ledger history via `/api/items/{id}/history`; separate manual Kartu Stock | No per-warehouse running-balance report page found [I] |
| Stock moves history | Item history modal + export dataset `stock_movements` | `stock_movement.view` permission never enforced [V] |
| Inventory valuation | **No** — no cost, FIFO/average or value columns on inventory/movements; prices exist only on PO/RI/price list [V] |
| Lot / serial tracking | Partial — `items.manage_sn`; serials stored as text on RI/NPBG/lines (`no_seri`, `serials`); no serial-level stock table [V] |
| Locations (bin level) | **No** — balance is per warehouse; `warehouse_locations` used only as text/default [V] |

## 6. Integrity & concurrency

| Control | Status | Evidence |
|---|---|---|
| DB transactions | Yes, around every stock change and document posting | `DB::transaction` in ledger and callers [V] |
| Row locking | Yes on `inventory` (ledger) and on PO/PO line in `receive()`; services lock documents before transitions (`lockForUpdate` in 20 files) | [V] |
| Duplicate submission | `DuplicateGuard` (cache lock per item + look-alike check, 3 days) for manual NPBG/PPB/PO/RI; `client_key` unique for MRP/Disassembly entries; throttles on mutating routes | [V]. Cache store = `file` (works on one server only) [I] |
| Stock validation | Negative actual / reserved blocked in ledger; fulfilment checks free stock under lock | [V] |
| Negative stock handling | Exception → whole transaction rolled back | [V] |
| Rollback | Laravel transaction rollback; but files (photos, signatures) written inside the transaction are **not** removed on rollback | [I from `RiController` order of operations] |
| Audit references | `reference_type/id`, `note`, `created_by`, `batch_uuid` on each movement | [V] |
| Precision | Ledger rounds to 2 decimals while Accurate quantities are `NUMERIC(18,4)` (`2026_10_04_090000_accurate_decimal_precision`) | possible rounding drift [I] |
| Over-receipt | Not capped (see report 06 §1.4) | [V] |

## 7. Is all stock movement centralised?

**Yes for runtime business flows** — every runtime change goes through `StockLedgerService::record()` [V].
**Exceptions:** the Excel bulk importer (insert) and the nightly accurate-only purge (delete of movements). In addition, in accurate-only mode stock is periodically **overwritten** to Accurate's quantity (`ACCURATE_SYNC`), so STOCKWISE is not the stock system of record today; Accurate is.
