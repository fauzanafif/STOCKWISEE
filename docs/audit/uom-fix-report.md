# UOM per Parent Category — Fix Report (Phase 3–6)

Date: 2026-11-20 · Design: [uom-parent-category-analysis.md](uom-parent-category-analysis.md) · Cleanup: [dummy-data-cleanup.md](dummy-data-cleanup.md)

## What changed

### Database (migration `2026_11_20_130000_uom_category_rules`, ran on `stockwise` 2026-11-20)

| Change | Detail |
|---|---|
| `category_uom_rules` (new) | `category_id`, `unit_id`, `is_default`, `suggested_ratio` (per-item units only, pre-fill), `sort`; unique (category, unit) |
| `units.factor` (new) | the number typed for a Bigger/Smaller unit, exact (`decimal(24,12)`); backfilled from `ratio` |
| MIN / DAY / … | factor 60 / 24 / 1000 …: **1 HOUR = 60 MIN** (was 59.9988) |
| ROLL → ROL | the 2 items on ROLL moved to ROL (same roll, stock unchanged) |
| Deactivated (kept) | ROLL, C M, CM, UNIT — used by nothing |
| Deleted | UOM category "testing" (0 units) |
| Starting rules | each of the 12 parents got the units its items use today; default = the most used (PCS, SET for Manufacture & Assembly). All 12 show **Complete**. |

**Deviation from the design:** no `uom_type` column. The type is derived from what already exists
(`is_reference`, `ratio` NULL = per item, `ratio` < 1 = smaller) — one source of truth, no backfill to keep in sync. Only `factor` was needed for precision.

### Conversion engine (`App\Services\UomConverter`)

- Fixed units convert as exact fractions (`fraction()` / `ratioBetween()`), using `factor` for Smaller units.
- `perItemAllowed()`: a per-item ratio between two *measures* (KG↔LTR, MTR↔KG) is refused; a pack or a count against anything is allowed (1 ROL = 100 MTR of a cable).
- A per-item ratio for two fixed units of the same category is refused (it would contradict the master).
- Unchanged: per-item first, same-category fixed second, everything else refused; document lines keep the ratio frozen at entry, so **no historical quantity changes**.

### Rules (`App\Services\Uom\CategoryUomRules`)

- An item's units = the rules of the nearest category up its tree that has any (a sub-category can override), else by its Main Category text (`accurate_category_induk`), else the old fixed list `ItemOptions::UOM`.
- Item create/update (`StoreItemRequest` / `UpdateItemRequest`): the unit must be allowed. An **existing** item is checked only when its unit or category changes.

### API (additive)

| Endpoint | |
|---|---|
| `GET /api/uom/category-rules` | parents (+ overriding sub-categories): items, units with type/factor/reference/items, units used but not listed, status |
| `PUT /api/uom/category-rules/{category}` | replace the set; one default (a Reference or Per-item unit), active units, suggested ratio only for per-item |
| `GET /api/items/options` | + `uom_rules` (Main Category → unit ids, default), `uom_fixed`; `uom` now also lists units a category allows (LBR, SCK) and each unit's `kind` |
| `GET /api/uom` | each unit + `kind`, `factor` |
| `POST /api/items/{item}/unit-conversions` | now also for `item.update` / `item.create` (the item form), still validated by the engine |

### UI

- **Master UOM** tabs: Units & categories · **Parent Category** (new: list with search, status filter, item counts; editor with default, type, conversion, suggested per-item ratio, items per unit, order, "units used but not listed" quick-add) · Per item · **Conversion rules** (fixed conversions per category + converter) · Needs mapping.
- **Master Item form**: the UOM list follows the chosen Main Category (default pre-selected for a new item); an item outside its rule keeps its unit with a note; optional **alternative unit** (1 BOX = __ PCS) saved as the item's own conversion.

## Modules

All document modules already used the central engine and freeze `unit_ratio` per line (NPBG, PPB, RI, PO, PO draft, Price List, Item Request, MRP, Disassembly). Stock Opname and the Stock Ledger count in the item's own unit (no conversion). Reports/exports print stored values. **No module needed a change;** they pick up the exact factors automatically.

## Tests

- New `tests/Feature/UomCategoryRulesTest.php` (6 tests): exact standard conversions incl. HOUR/MIN, SMALLER factor kept; parent rules + validation + permission; inheritance and override by sub-category, by Main Category text, fallback; existing item outside rules stays editable; per-item ratios differ per item, KG↔LTR refused, frozen document ratio unchanged after a ratio change; form options.
- `tests/Feature/UomTest.php`: the 2 pre-existing failures fixed (they predated the *Time* category).
- `tests/Feature/CleanupDummyTest.php`: dry run / execute / refusal — MySQL only (skipped on SQLite). `composer test:mysql` cannot build `stockwise_test` today because of an older migration (`purchase_proposal_items` foreign key), unrelated; the command was verified on the live data instead (see cleanup report).
- Full suite: **542 passed, 27 failed** — the 27 are the same failures as before this work (Accurate sync, login tunnel, legacy export, share link, tracking, dataset export); none new.

## Backups

- `backend/storage/backups/stockwise-full-before-dummy-cleanup-20261120-090842.sql` (full, 198 MB, taken before the cleanup and the UOM migration).
