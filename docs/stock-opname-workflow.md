# Stock Opname — controlled workflow

Backend: `App\Services\StockOpname\OpnameWorkflowService`, `Api\StockOpnameWorkflowController` (routes `api.opnames.flow.*`).
Frontend: `/stock-opnames/dashboard`, `/stock-opnames/:id` (`pages/opname/*`). Needs migration
`2026_11_18_140000_stock_opname_controlled_workflow`; before it runs, every new endpoint answers 503 and the earlier
endpoints (`start` / `items/{id}` / `submit` / `review`) keep working unchanged.

## Status flow

```
DRAFT ─confirm─► CONFIRMED ─start-counting─► COUNTING ─finish-counting─► REVIEW
REVIEW ─recount─► RECOUNT ─finish-counting─► REVIEW
REVIEW ─request-approval─► WAITING_APPROVAL ─approve (posts)─► POSTED ─close─► DONE
WAITING_APPROVAL ─reject─► REVIEW          any status before POSTED ─cancel─► CANCELLED
POSTED / DONE ─correction─► new DRAFT (correction_of_id)
```

Documents saved by the earlier flow are read as: SCHEDULED=CONFIRMED, IN_PROGRESS=COUNTING, PENDING_REVIEW=REVIEW,
RECOUNT_REQUIRED=RECOUNT, COMPLETED=DONE (`StockOpname::LEGACY`; rows are not rewritten). Accurate ITEMADJ mirrors
(`accurate_itemadj_id` set) never enter the workflow.

## Rules

| Rule | Where |
|---|---|
| Book qty frozen when counting starts (`snapshot_at`, `system_qty` refreshed) | `startCounting()` |
| Blind count: system qty / variance / live stock / adjustments only for `opname.review` or `opname.view_variance` | controller `canSeeSystem()`, export |
| Every count is a `stock_opname_counts` row (append only); recount adds a round, never overwrites | `count()`, `StockOpnameCount` |
| With a counting team set, only the team, the person in charge or a reviewer may count | `assertMayCount()` |
| Every accepted variance needs a reason before approval | `requestApproval()` |
| Posting = variance (counted − frozen book) applied to the stock **at posting time**, via `StockLedgerService` (`STOCK_ADJUSTMENT`, reference = opname line, one `batch_uuid`) | `approveAndPost()` / `postLine()` |
| Atomic: one DB transaction; any failing line (negative stock, reserved > actual) rolls back everything | `approveAndPost()` |
| Idempotent: document row locked, an already-posted document is returned unchanged (`meta.already_posted`); `stock_adjustments.stock_opname_item_id` unique | `approveAndPost()`, migration |
| Audit trail: every step is a `stock_opname_events` row (who, when, from → to, note, meta); append only | `event()`, `StockOpnameEvent` |
| POSTED / DONE / CANCELLED are locked; a correction is a new opname of the same items | `createCorrection()` |

## Permissions (existing RBAC)

| Step | Permission | Roles (default matrix) |
|---|---|---|
| Create / edit draft / confirm / cancel / correction | `opname.schedule` | Admin Gudang |
| Start counting, count | `opname.count` | Anak Gudang, Lapangan Gudang, Admin Gudang |
| Finish counting | `opname.submit` | same |
| Review decisions, send for approval, close | `opname.review` | Admin Gudang |
| Request recount | `opname.request_recount` | Admin Gudang |
| Approve & post / reject | `opname.approve` / `opname.reject` | Admin Gudang (no separate Supervisor role exists; grant to whichever role supervises) |
| See system qty & variance without acting (auditor) | `opname.view_variance` (new) | Admin Gudang, BOS |
