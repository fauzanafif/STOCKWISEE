# 06 — Business Workflows (as implemented)

> Read-only audit 2026-11-16, derived from services/controllers, not from design docs. **[V]** Verified · **[I]** Inferred · **[U]** Unknown.
> Important context **[V]**: `config('stockwise.accurate_only')` defaults to `true` and is not overridden in the working-copy `.env`.
> In that mode Accurate is the system of record: the nightly scheduled sync runs `StockwisePurge`, which **deletes documents
> created in STOCKWISE** (Item Requests and their NPBG/handover, manual NPBG/PPB/RI, STOCKWISE POs and "Menunggu PO" entries,
> Draft PPB, PPB/PO approval logs, purchase returns, manual opname) **and the stock movements they produced**, then resets stock
> to Accurate's quantity. Every workflow below therefore behaves as a "working layer" that is reset nightly while this flag is on.

## 1. Purchasing — Price List → Purchase Request → Purchase Order → Receipt

### 1.1 Price List [V]
- Table `vendor_prices` (+ `vendor_price_histories`). Statuses: `DRAFT`, `ACTIVE`, `ARCHIVED`; `EXPIRED` is derived from `valid_until`.
- Endpoints: `POST /api/price-list` (`rfq.create`), `PUT /price-list/{id}`, `POST …/archive` (`rfq.update`), read `rfq.view`; `GET /price-list/reference` used by PO quotation.
- Not an approval flow; no stock impact. Several active prices for the same item/vendor/unit can coexist (ranked at read time).

### 1.2 Purchase Request (PPB) [V]
| Step | Actor (permission) | Record | Status |
|---|---|---|---|
| Draft PPB created (restock, Item Request shortage, MO/Disassembly shortage, saved drafts) | admin_gudang (`ppb.create`) | `ppb_drafts`, `ppb_draft_lines` | DRAFT |
| Submit draft / lines | `ppb.create` | `ppb` rows (one per line, `created_by` set, `accurate_reqid` null) | — |
| Manager approval | manager (`ppb.approve_manager`) | `ppb_approvals` row `APPROVE_MANAGER` | MENUNGGU → MENUNGGU_DIREKTUR |
| Director approval | direktur (`ppb.approve_director`) | `ppb_approvals` `APPROVE` + a "Menunggu PO" entry in `purchase_orders` (`from_ppb_approval`, status `MENUNGGU_PO`) | DISETUJUI |
| Reject / Return / Resubmit | approvers / creator | `REJECT` (reason), `RETURN` (note) → DIKEMBALIKAN, `DIAJUKAN_ULANG` | DITOLAK / DIKEMBALIKAN |

- **Status is not a column**: `PpbApprovalService::statusFor()` derives it from the latest log row keyed by `no_ppb` (string).
- Director may approve while it still waits for the Manager (bypass, logged). Accurate PPBs use the one-step `ppb.approve`; PPBs dated before `GO_LIVE = 2026-10-20` need no approval (`TIDAK_PERLU`).
- If Accurate creates a PO for an unapproved PPB, the sync logs `PO_TANPA_APPROVAL` and notifies approvers.
- Stock impact: none. Duplicate guard: `DuplicateGuard` on manual PPB.

### 1.3 Purchase Order [V]
`PurchaseOrderService` header: DRAFT → APPROVED → SENT → PARTIAL_RECEIVED → RECEIVED → CLOSED. Actual STOCKWISE path:

| Step | Actor | Endpoint | Data |
|---|---|---|---|
| Approved PPB lines appear in "Approved Purchase Request Items" | purchasing (`po.create`) | `GET /po-draft-lines` | `purchase_order_items` (quote_stage null = SIAP) |
| Invite vendors, enter quotes (price, availability, ETA) | purchasing | `/po-draft-lines/vendors`, `/{item}/quotes`, `/to-quotation`, `/submit-quotation` | `purchase_order_item_vendors`, `purchase_order_quotes`, `purchase_order_quote_updates` — stage PENAWARAN → MENUNGGU_DIREKTUR |
| Director chooses vendor / changes pick / returns | direktur (`po.approve_director`) | `/po-draft-lines/{item}/choose|change-pick|return` | `purchase_order_pick_logs` — stage DIPILIH |
| Create PO from chosen lines | purchasing | `/po-draft-lines/submit` | `purchase_orders` (number `PO/MANUAL/…`), log `DIAJUKAN` |
| Director approval / reject | direktur | `/purchase-orders/{id}/approve|reject` | `purchase_order_approvals` APPROVE / REJECT (back to purchasing) |
| Send to vendor, upload proof ("Sudah dibeli") | purchasing (`po.send`) | `/send`, `/proof` | status SENT / DIBELI |
| Cancel | `po.cancel` | `/cancel` | CANCELLED |
| Receipt | admin_gudang via RI | `PurchaseOrderService::receive()` | line `qty_received`, PO PARTIAL_RECEIVED / RECEIVED |

- Accurate POs (`accurate_po_id` set) are read-only mirrors and never go through this flow.
- **[V]** The route accepts `po.approve|po.approve_director`, but `PurchaseOrderService::approve()` refuses Accurate POs and requires `po.approve_director`, so purchasing (who holds `po.approve`) cannot approve its own PO. The `po.approve` permission is effectively dead. No explicit creator ≠ approver check exists; separation relies on role assignment only (a super_admin can do both).

### 1.4 Receipt (RI) [V]
- `POST /api/ri/from-po` (`ri.create`): under a cache lock + DB transaction → for each line `PurchaseOrderService::receive()` (locks PO + line), insert `ri` row, store photos, `StockLedgerService::record('RECEIVING')` into **the warehouse with the lowest id**.
- `POST /api/ri` manual RI (sources: PO line, used-goods return, other) — same ledger call.
- Validation: ≥1 photo per line, serials unique per unit, `DuplicateGuard` (same delivery note / look-alike in 3 days).
- **Gap [V]:** quantity per line is only `min:0`; `receive()` refuses a line already fully received but **does not cap** a partial line to its remaining qty → over-receipt possible.
- No inspection / quality-hold step; stock rises at once (README rule "increase on RECEIVING CONFIRMED" is implemented as immediate posting).
- Purchase Return (`purchase_returns`): DIBUAT → DIKIRIM → SELESAI / DIBATALKAN; **no stock movement** is recorded for returned goods [V — no ledger call in `PurchaseReturnService`].

**Difference from proposed flow:** Price List is only a reference for quotations (no "RFQ" document); the PO is preceded by a quotation stage on PO lines and a director vendor pick; Accurate remains the system of record for POs and RIs.

## 2. Warehouse operations — Item Request → Verification → Reservation → Delivery Order → Handover [V]

Statuses (`ItemRequest::STATUSES`): MENUNGGU, DIPROSES, PERLU_PERBAIKAN, APPROVAL_MANAGER, APPROVAL_DIREKTUR, DISIAPKAN, SIAP_DISERAHKAN, DIPENUHI_SEBAGIAN, MENUNGGU_PENGADAAN, MENUNGGU_BARANG, SELESAI, DITOLAK, DIBATALKAN (line-level DITUTUP).

| Step | Actor (permission) | Records | Stock impact |
|---|---|---|---|
| Request created (app, public link with token, or entered on behalf) | karyawan (`item_request.create`) / anonymous via `item_request_links` | `item_requests`, `item_request_lines` | none |
| Verification: match each line to the item master, set decision (NPBG / PPB / reject), urgency, notes | admin_gudang (`item_request.process`) | lines `item_id`, `decision`, `approved_qty`; status DIPROSES or PERLU_PERBAIKAN | none |
| Manager approval | manager (`item_request.approve_manager`) | `item_request_approvals` | → APPROVAL_DIREKTUR |
| Director approval (may bypass manager) | direktur | `item_request_approvals` | → DISIAPKAN; shortage lines may go to Draft PPB |
| Prepare (allocate) | lapangan_gudang (`item_request.handover`) | `item_request_fulfillments` + lines + an **NPBG row** per line | **RESERVATION** (reserved_qty ↑) |
| Confirm quantities | `item_request.handover` | fulfilment → SIAP | release of what is not given |
| Handover (photo + signature + receiver name, or proxy code) | `item_request.handover` | fulfilment handed; `item_requests.handed_over_*` | **STOCK_OUT** + release reservation |
| Close remainder / cancel | handover or process | `closed_reason` | release |
| Recompute | system | status from lines: SELESAI only when nothing is left; MENUNGGU_BARANG when waiting for stock — `refreshWaiting()` after each RI / analysis | — |

- NPBG created this way is **not** subject to the manual-NPBG approval (already approved through the request).
- **Manual NPBG** (`POST /npbg`, admin_gudang): MENUNGGU → manager → MENUNGGU_DIREKTUR → direktur → DISETUJUI → **STOCK_OUT immediately**, taking from warehouses with most free stock (`NpbgApprovalService:201-219`); REJECT / RETURN / resubmit. Status derived from `npbg_approvals` keyed by `no_npbg`.
- Note: the class comment of `ItemRequestFulfillmentService` still says stock leaves at `prepare()`; migration `2026_10_26_100000_request_stock_held_until_handover` changed it to hold-then-issue. Code follows the migration (reserve in `reserve()`, issue in `settle()`).

## 3. Manufacturing — BoM → MO → Component consumption → Finished goods [V]

- BoM: DRAFT → ACTIVE → ARCHIVED, revisioned (`revise`), circular/self references rejected (`BomService`).
- MO transitions (`ProductionService::TRANSITIONS`): DRAFT → CONFIRMED → IN_PROGRESS → TO_CLOSE → DONE; CANCELLED from any open state; DONE → CANCELLED only via `reverse()`.
- **Current rule ("the warehouse is the only door", `WarehouseGate`):** an MO never moves stock itself. On confirm, components are requested through an **Item Request** (`request-components`) and leave stock at that request's Delivery Order handover; finished goods enter via a **Receipt** linked to the MO (`/receipts`, `warehouse_gate_links`). Validation (DONE) checks those links.
- Entries (consume / output / scrap) are recorded with `client_key` idempotency; over-plan entries need `mrp.validate` + reason.
- Legacy MOs (posting_batch set) posted `MRP_CONSUME/SCRAP/PRODUCE` movements themselves and keep reverse + "entered in Accurate" steps.
- Roles: admin_gudang all steps; lapangan_gudang view + record; bos view. Shortage → Draft PPB (`shortage-request`).
- Separate legacy **Tracking → Manufaktur** (`manufacturing_orders`, Excel replica, REQUESTED/ON_GOING…) is unrelated to MRP.

## 4. Disassembly — Order → source item consumption → component items [V]

- Same transition table as MO. CONFIRMED is refused when the source warehouse lacks free stock; the product is requested through an Item Request (`request-product`); GOOD components come back through Receipt(s); SCRAP / MISSING never enter stock and remain as variance.
- Legacy orders posted `DISASSEMBLY_OUT/IN` movements themselves (posting_batch).

## 5. Physical inventory (stock opname) [V]

SCHEDULED (`opname.schedule`) → IN_PROGRESS (`opname.count`, start) → counting per line → PENDING_REVIEW (`opname.submit`) → review (`opname.approve`) → COMPLETED, or RECOUNT_REQUIRED if any line asks for a recount. On approval: `stock_adjustments` row + `STOCK_ADJUSTMENT` movement (absolute set, `last_counted_at`). Accurate ITEMADJ documents are also mirrored into `stock_opnames`. `opname.reject` / `opname.request_recount` permissions exist but are not checked separately (review uses `opname.approve`).

## 6. Cross-workflow observations

| Observation | Evidence | Type |
|---|---|---|
| Two-step approvals (Manager → Director) everywhere, with Director bypass | Item Request, PPB, manual NPBG services | V |
| No creator ≠ approver check (except Important Request) | grep of approval services | V |
| Approval state for NPBG/PPB lives only in logs keyed by document number strings | `statusFor()` | V |
| Stock never moves on PO, MO, Disassembly; only on Delivery-Order handover/approval, Receipt, opname approval, Accurate follow-up | ledger callers (report 07) | V |
| Much STOCKWISE-created data is purged nightly in accurate-only mode | `StockwisePurge` | V (flag default) / U (whether the scheduled sync window actually fires on prod) |
