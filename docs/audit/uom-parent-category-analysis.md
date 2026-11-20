# UOM per Parent Item Category — Audit & Design (Phase 1–2)

Date: 2026-11-20 · Database: `stockwise` (MySQL, live clone) · Status: **audit only, nothing changed**.
All numbers below were read from the database on this date.

---

## 1. What exists today

### 1.1 Item categories

| Table | Rows | Role |
|---|---|---|
| `categories` | 452 | The category **tree**: `parent_id`, `level` (1–4), `path` (names joined by ` > `), `is_active`. |
| `item_category_options` | 434 | Flat dropdown lists for the Accurate-style text fields (`induk` 12, `anak_1` 101, `anak_2` 207, `anak_3` 114). Not a tree. |
| `items.accurate_category_induk` / `_anak_1..3` | — | Text copies of the category names (from Accurate / the old form). |

**Level 1 of the tree = the parent categories (Kategori Induk). There are 12:**

| Parent category | Sub-categories | Items | Units in use (items) |
|---|---:|---:|---|
| Big Spare Parts | 61 | 2,832 | PCS 2754 · MTR 60 · SET 16 · M2 1 · CMS 1 |
| Small Spare Parts | 215 | 2,768 | PCS 2747 · SET 14 · M2 1 |
| Post-Use Items | 20 | 873 | PCS 824 · SET 15 · KG 7 · MTR 1 |
| Automotive | 17 | 679 | PCS 599 · SET 35 · LTR 17 · MTR 4 · CMS 1 · SCK 1 · JRG 1 |
| Maintenance & Industry | 47 | 580 | PCS 495 · SET 60 · CMS 8 · KG 6 · MTR 3 · LTR 3 · M3 3 · M2 2 |
| Office Needs | 10 | 397 | PCS 338 · RIM 20 · BK 18 · BOX 9 · ROLL 2 · LBR 2 · MTR 2 · PCK 1 · KG 1 |
| Electronics & Electricals | 27 | 271 | PCS 198 · MTR 47 · SET 18 |
| Etalase | 12 | 246 | PCS 220 · SET 26 |
| Household Needs | 8 | 130 | PCS 116 · SET 8 · GLN 2 · BOX 2 · JRG 2 |
| Manufacture & Assembly | 12 | 93 | SET 65 · PCS 28 |
| Office Apparel & Accessories | 10 | 87 | PCS 86 · BOX 1 |
| Assets | 1 | 1 | PCS 1 |

### 1.2 Answers to the seven questions

1. **How is the parent category stored?** As the level-1 node of `categories` (`parent_id IS NULL`, `level = 1`). The same name also sits as text in `items.accurate_category_induk`, which is a copy, not a link.
2. **How does an item reach its parent?** `items.category_id` points at any level (1: 3 items, 2: 2,216, 3: 3,428, 4: 3,310). The parent is the first segment of that category's `path`, or the top of its `parent_id` chain. The Master Item form saves `category_id` (`StoreItemRequest`), so **the tree is the source of truth**.
3. **Sub-categories?** Yes. There are up to 4 levels: 12 → 107 → 214 → 119.
4. **One category per item?** Yes, one `category_id`. The text columns can disagree:

   | Situation | Items |
   |---|---:|
   | Tree and text both set | 8,862 |
   | … of which the parent differs (e.g. SSP.2601–2604: tree *Etalase*, text *Small Spare Parts*) | 4 |
   | Tree only (mostly *Manufacture & Assembly*, which the text never has) | 95 |
   | **Text only, no `category_id`** | **242** |
   | Neither | 11 |

5. **How is UOM linked to an item?** By `items.unit_id`, the item's own unit, in which stock, the ledger and opname are counted. 65 items (all from Accurate) have none. The form only accepts the 15 codes in `ItemOptions::UOM` (`PCS SET MTR PCK BK LTR RIM KG M2 BOX GLN M3 CMS JRG ROL`), hard-coded.
6. **How are conversion factors stored?**
   - **Standard:** `units` (40) holds `uom_category_id`, `is_reference` and `ratio` (= how many references one unit is), plus `rounding`. `uom_categories` holds 8 categories: Unit, Sheet, Weight, Length, Area, Volume, Time and **testing**.
   - **Varies per item:** a unit with `ratio NULL` in its category (BOX, PCK, SET, ROL, DUS, JRG, GLN …). The ratio for each item is in `item_unit_conversions` (`item_id`, `unit_id`, `ratio`, `base_unit_id`). There are 5 rows, all of them sample items. Accurate's `UNIT2/RATIO2`, `UNIT3/RATIO3` are read on top (read only).
   - **Engine:** `App\Services\UomConverter` is already central, decimal (bcmath, scale 8), never float. It uses item conversions first, then the same category with fixed ratios, and refuses anything else ("beda kategori"). A ratio set against an older base unit is flagged stale and is not used.
   - **History is safe already.** Every document line freezes its ratio at entry: `npbg`, `ppb`, `ri`, `purchase_order_items`, `item_request_lines`, `vendor_prices`, `disassembly_entries` and `mrp_production_entries` store `unit_ratio` (+ `base_satuan` / `base_unit`). The ledger and opname are in the item's own unit. **Changing a ratio never rewrites a past document.**
7. **How to link UOM to the parent category without breaking data?** Add a *rule* layer (§3). Keep the shared `units` and the conversion engine, keep every `unit_id`, and enforce the rules only on new input and on edits. Do not enforce them retroactively.

### 1.3 Where the engine is (and is not) used

| Module | Uses `UomConverter` | Note |
|---|---|---|
| NPBG / Delivery Order, PPB | `snapshot()` | ratio frozen per line |
| Receipt (RI) | `documentRatio`, `baseQty` | ledger note shows `x BOX = y PCS` |
| PO, PO Draft, Price List | `orderUnits`, `vendor_prices.unit_ratio` | |
| Item Request | `snapshot` (ItemRequestController:246) | |
| MRP, Disassembly | `units()` endpoints | |
| Stock Opname, Stock Ledger | — | counted in the item's own unit (correct, no conversion needed) |
| Tracking (Lend/Borrow/STPP/Used Return) | — | store `unit_id` only, qty taken as the item's unit |
| Exports / reports | — | print stored values (correct for history) |

### 1.4 Data problems found in Master UOM

| Problem | Facts | Risk |
|---|---|---|
| **MIN ≠ 1/60 HOUR** | `ratio = 0.016667` (`decimal(18,6)`): 1 HOUR = 59.9988 MIN | wrong only for Time; no item or document uses MIN/HOUR/DAY |
| **C M / CM / CMS** | three "Centimeter"s in Length. `C M` and `CM`: used nowhere. `CMS`: 11 items, 3 PO lines, 2 used-return lines, texts in 76 NPBG / 3 PPB / 5 RI | merging into one is safe only toward **CMS** |
| **ROL / ROLL** | both "Roll", both per item. `ROL`: 1 PO line, 1 item conversion, texts in NPBG/PPB/RI/returns, and it is the one in `ItemOptions::UOM`. `ROLL`: 2 items only | the two ROLL items cannot be given an ROL ratio from the form |
| **UNIT = PCS** | `UNIT` ratio 1 in Unit category, used nowhere | duplicate choice |
| **uom_category "testing"** | id 1, 0 units | leftover test data |
| **Fixed list in code** | `ItemOptions::UOM` (15 codes) decides what the item form accepts, not the master | new units cannot be used without a code change |
| 65 items without unit | all Accurate | listed in *UOM › Mapping* already |
| 2 pre-existing failing tests | `UomTest` expects the categories before *Time* was added | unrelated to data |

---

## 2. Design choices (and why)

**Keep one shared unit master and add a rule table per category. Do not copy units per category.**

- PCS, BOX and the rest stay single rows in `units`. All 40 are referenced by documents by id or by text. Copying them per category would split history and break `snapshot()`, which looks units up by code.
- The engine already separates *standard* (fixed ratio inside a measurement category) from *per item* (`ratio NULL` + `item_unit_conversions`). The category rule only says **which** units an item in that category may use, and **which** is suggested as its own unit. It never stores a ratio that could contradict the engine.
- **Per item stays per item.** BOX can be 12 PCS for one item and 24 for another, so a category rule never holds a BOX ratio. A rule can carry a *suggested* ratio that pre-fills the form, but every item still saves its own row.

### 2.1 Conversion types (what the UI shows)

| Type | Meaning | Stored as |
|---|---|---|
| Reference | the category's base (PCS, MTR, KG, LTR …) | `units.is_reference = 1` |
| Bigger | fixed multiple of the reference (TON = 1000 KG) | `units.uom_type = BIGGER`, `factor` |
| Smaller | fixed fraction (GR = 1/1000 KG, MIN = 1/60 HOUR) | `units.uom_type = SMALLER`, `factor` = how many in one reference (60), **exact** |
| Per Item | varies by item (BOX, SET, ROL, JRG, GLN …) | `units.ratio NULL` + `item_unit_conversions` |

`uom_type` and `factor` are new columns. `ratio` stays and is computed from them (Smaller: `1 / factor` at scale 12), so existing readers keep working. The engine will read `factor` for Smaller units, which fixes 59.9988 → 60 without touching any stored document.

### 2.2 Validity rules (engine)

- Standard conversion: same `uom_category` and both fixed, as today.
- Per item: allowed from a per-item (pack) unit to the item's own unit (ROLL → MTR for a cable is fine). **Refused between two measured categories** (KG ↔ LTR, MTR ↔ KG) unless a future, explicit "density" rule exists. Today the engine would accept a KG ↔ LTR item conversion if one were saved, and that will be closed.
- A conversion changed later only affects new lines; old lines keep their frozen `unit_ratio` (already true).

---

## 3. Proposed schema (Phase 3, not applied)

```
category_uom_rules
  id
  category_id      FK categories   -- a parent (level 1) or, as an override, a sub-category
  unit_id          FK units
  is_default       bool            -- suggested own unit of a new item (one per category)
  suggested_ratio  decimal(18,6) null  -- per-item units only: pre-fills the item's conversion, never used to convert
  sort             int
  is_active        bool
  timestamps
  unique (category_id, unit_id)

units  + uom_type  enum(REFERENCE, BIGGER, SMALLER, PER_ITEM)   (backfilled from is_reference/ratio)
       + factor    decimal(24,12) null
```

**Inheritance:** an item uses the rules of the **nearest** category up its `parent_id` chain that has any. A sub-category with rules overrides its parent; one without inherits. A category with no rules at all falls back to today's behaviour (any active unit of `ItemOptions::UOM`), so nothing stops working on day one.

**Items with text-only category (242):** the rule is looked up by `accurate_category_induk` name → level-1 node when `category_id` is empty. Reported in *Item Usage* so they can be given a real category.

**Existing items are never blocked.** An item whose current unit is not in its category's rules is shown as *"outside the rule"* in Item Usage. Saving it is refused only when the user **changes** its unit or category to a combination outside the rules.

### 3.1 API (additive, no contract change)

| Endpoint | Purpose |
|---|---|
| `GET /api/uom/category-rules` | the 12 parents (+ overriding sub-categories): item count, reference, allowed units with type, factor, items per unit, status (*Not set / Partial / Complete*) |
| `PUT /api/uom/category-rules/{category}` | replace a category's rule set (validated: one default, the default's unit must be a Reference or Per-item unit, units active) |
| `GET /api/items/options?category_id=` | already exists; gains `allowed_units` for the chosen category |
| existing `/api/uom/*`, `/api/items/{item}/unit-conversions` | unchanged |

### 3.2 UI (Master UOM, same STOCKWISE look, tabs)

1. **UOM Categories**, 2. **Units** (existing tabs; Units gains the *Type* column: Reference / Bigger / Smaller / Per Item).
3. **Parent Category**: a list of the 12 parents (search, status filter, item count, reference, allowed units as chips). Choosing one opens its editor: reference/default unit, alternative units with their type and factor (fixed ones read only, from the unit master), suggested ratio for per-item ones, and items per unit.
4. **Conversion Rules**: read-only matrix of the fixed conversions per measurement category, plus a converter.
5. **Item Usage**: the existing *Per item* and *Mapping* tabs merged: per-item conversions, items outside their category rule, items without unit or category.

**Master Item form:** after choosing a category, the unit dropdown lists that category's allowed units (default pre-selected for a new item). Choosing a per-item alternative asks for its ratio ("1 BOX = __ PCS"), saved through the existing `unit-conversions` endpoint.

---

## 4. Proposed data fixes (need approval; none are deletions of used data)

| # | Fix | Effect on stock/history |
|---|---|---|
| D1 | MIN/HOUR/DAY: set `uom_type`/`factor` (MIN Smaller 60, DAY Bigger 24) | none (unused) |
| D2 | Deactivate `C M` and `CM` (keep rows); `CMS` stays the centimetre | none (unused) |
| D3 | Deactivate `UNIT` (duplicate of PCS) | none (unused) |
| D4 | ROL / ROLL: keep **ROL** (in the form, used by documents). The 2 ROLL items: **ask** whether to move them to ROL (same physical unit, quantities unchanged), or keep ROLL and add it to the allowed list | none either way |
| D5 | Delete uom_category **testing** (0 units) | none |
| D6 | Replace the hard-coded `ItemOptions::UOM` with "active units allowed by the category rule" | form only |

Initial category rules: **none are invented.** The editor starts with every parent as *Not set*, and the "units in use" column above can be applied as a one-click suggestion that an admin confirms per category.

---

## 5. Open questions for the owner

1. D4: move the 2 ROLL items to ROL? (recommended)
2. Should a sub-category be allowed to override its parent's rules, or parents only? (the design supports both; parents only is simpler to explain)
3. Apply "units in use" as the starting rule for each parent, or start empty?
4. The 4 items whose tree parent ≠ text parent (SSP.2601–2604) and the 242 text-only items: fix the category data now or only report them?
