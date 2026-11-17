# 02 — Database Table Inventory

> Audit date 2026-11-16 · read-only · **Method:** static replay of the `up()` methods of all 131 migrations in `backend/database/migrations` (no database connection was made, no migration was run). Column lists and FKs are therefore *Verified from migrations*; whether every migration has actually been run on production is **Unknown** (production `migrate:status` was not checked, by design).

## Summary

| Category | Tables |
|---|---|
| A. Core Master Data | 23 |
| B. Transaction Data | 48 |
| C. Configuration Data | 7 |
| D. System & Security Data | 13 |
| E. Logs & Audit Data | 15 |
| F. Supporting Data | 15 |
| G. Unclassified / Needs Investigation (legacy) | 5 |
| **Total defined by migrations** | **126** |
| H. Accurate mirror tables (`accurate_*`, created at runtime by `StagingTableWriter`) | 26 |
| **Grand total (possible)** | **152** |

Tables created then dropped by later migrations (no longer exist): `material_requests`, `material_request_items`, `stock_reservations`, `goods_issues` (old NPBG), `goods_issue_items` — removed by `2026_10_10_000000_remove_material_request_and_goods_issue.php`.

**Columns legend:** "Code refs" = number of PHP files under `backend/app` that reference the table name or its model (evidence for usage, not proof). Status values: *Existing* = defined and referenced; *Legacy – unclear* = defined, superseded, see notes.


## A. Core Master Data

| Table | Purpose | PK | Foreign keys (→ table) | Main columns | Referenced by (FK) | Model | Code refs | Status |
|---|---|---|---|---|---|---|---|---|
| `assets` | Vehicle / asset master (Maintenance, Tyre) | id | site_id→sites | code, name, asset_type, brand_model, site_id, is_active, notes | maintenance_orders, tyre_changes | Asset | 3 | Existing |
| `categories` | Hierarchical item category tree (parent_id); Accurate category text is stored separately on items | id | parent_id→categories | parent_id, name, level, path, is_active | categories, items | Category | 10 | Existing |
| `customers` | Customer master (used by Lend and Projects) | id | — | name, code, is_active | lend_transactions, projects | Customer | 2 | Existing |
| `departments` | Department / division master | id | — | name, code, is_active | employees, purchase_proposals, stpp_transactions | Department | 8 | Existing |
| `employees` | Employee (Pekerja) master, optionally linked to a user account | id | department_id→departments, site_id→sites, user_id→users | name, name_normalized, department_id, site_id, user_id, role_hint, is_active, needs_review, source, position … (+2) | maintenance_orders, stpp_transactions, users | Employee | 10 | Existing |
| `item_aliases` | Alternative / legacy descriptions mapped to an item (smart matching) | id | created_by→users, item_id→items | item_id, alias_description, alias_normalized, source, confidence, match_status, created_by | — | ItemAlias | 2 | Existing |
| `item_category_options` | Pick-lists for category levels (induk/anak) + code prefix used when creating items | id | — | level, name, code_prefix, sort, is_active | — | — | 2 | Existing |
| `item_safety_stocks` | Safety stock / MIN PR / lead time planning parameters per item | id | item_id→items | item_id, source_category, period_label, avg_usage_1m, avg_usage_3m, avg_usage_6m, avg_usage_12m, lead_time_days, sqrt_lt, safety_stock … (+5) | — | ItemSafetyStock | 8 | Existing |
| `item_unit_conversions` | Per-item unit conversion (unit -> ratio to base unit) | id | base_unit_id→units, created_by→users, item_id→items, unit_id→units | item_id, unit_id, ratio, created_by, base_unit_id | — | ItemUnitConversion | 4 | Existing |
| `items` | Master Produk (Barang & Jasa via product_kind); single item master for every module | id | category_id→categories, default_location_id→warehouse_locations, default_warehouse_id→warehouses, unit_id→units | code, description, description_normalized, category_id, unit_id, item_type, needs_blueprint, lead_time_days, default_warehouse_id, default_location_id … (+15) | borrow_transactions, disassembly_components, disassembly_entries, disassembly_orders, inventory, inventory_snapshots, item_aliases, item_request_lines, item_safety_stocks, item_unit_conversions, lend_transactions, manufacturing_order_subs, mrp_bom_lines, mrp_boms, mrp_production_components, mrp_production_entries, mrp_productions, ppb_draft_lines, purchase_order_items, purchase_proposal_items, receiving_items, serial_units, stock_adjustments, stock_cards, stock_movements, stock_opname_items, stpp_transactions, used_return_component_types, used_return_items, vendor_prices | Item | 113 | Existing |
| `mrp_bom_lines` | BoM component lines | id | item_id→items, mrp_bom_id→mrp_boms | mrp_bom_id, item_id, qty, base_unit, note, sort | — | MrpBomLine | 1 | Existing |
| `mrp_boms` | Bill of Materials header (revisioned, DRAFT/ACTIVE/ARCHIVED) | id | activated_by→users, archived_by→users, created_by→users, item_id→items | code, item_id, revision, name, status, base_unit, effective_date, notes, created_by, activated_at … (+3) | disassembly_orders, mrp_bom_lines, mrp_productions | MrpBom | 10 | Existing |
| `projects` | Project master (used by Kartu Stock and Lend) | id | customer_id→customers | name, code, customer_id, status | lend_transactions, stock_card_share_links, stock_cards | Project | 6 | Existing |
| `serial_units` | Serialised tools / tyres (STPP, Tyre) | id | item_id→items | serial_no, kind, item_id, description_raw, maker_code, status | manufacturing_order_subs, stpp_transactions, tyre_changes | SerialUnit | 4 | Existing |
| `sites` | Company site / branch (SIG Sidoarjo, SIG Balikpapan) | id | — | code, name, is_inventory_managed, address, is_active | assets, employees, maintenance_orders, manufacturing_orders, purchase_orders, purchase_proposals, receivings, stock_opnames, used_returns, users, warehouses, workshops | Site | 15 | Existing |
| `units` | Unit of measure master; grouped by uom_categories with reference unit + ratio | id | uom_category_id→uom_categories | code, name, is_active, uom_category_id, is_reference, ratio, rounding | borrow_transactions, item_unit_conversions, items, lend_transactions, purchase_order_items, purchase_proposal_items, receiving_items, stpp_transactions, used_return_items, vendor_prices | Unit | 44 | Existing |
| `uom_categories` | UOM category (e.g. weight, count) for the unit master | id | — | name | units | UomCategory | 2 | Existing |
| `used_return_component_types` | Component types for used-goods returns | id | default_item_id→items | code, name, default_item_id, is_active | used_return_items | UsedReturnComponentType | 2 | Existing |
| `vendor_prices` | Price List: item x vendor x unit price with validity and status (new, 2026-11-16) | id | base_unit_id→units, created_by→users, item_id→items, unit_id→units, updated_by→users, vendor_id→vendors | item_id, vendor_id, unit_id, unit_ratio, base_unit_id, price, min_qty, lead_time_days, valid_from, valid_until … (+4) | vendor_price_histories | VendorPrice | 3 | Existing |
| `vendors` | Vendor / supplier master | id | — | name, code, phone, email, address, is_active, needs_review, source | borrow_transactions, manufacturing_orders, purchase_order_item_vendors, purchase_order_items, purchase_order_quote_updates, purchase_order_quotes, purchase_orders, purchase_returns, receivings, ri, vendor_prices | Vendor | 29 | Existing |
| `warehouse_locations` | Rack / bin locations inside a warehouse | id | warehouse_id→warehouses | warehouse_id, code, description, is_active | items, receiving_items, stock_opname_items | WarehouseLocation | 7 | Existing |
| `warehouses` | Warehouse master (per site) | id | site_id→sites | site_id, code, name, is_active | disassembly_orders, inventory, inventory_snapshots, item_request_fulfillment_lines, items, receiving_items, receivings, stock_adjustments, stock_movements, stock_opname_items, stock_opnames, warehouse_locations | Warehouse | 26 | Existing |
| `workshops` | External / internal workshop master (Maintenance) | id | site_id→sites | name, is_internal, site_id, is_active | maintenance_order_subs | Workshop | 4 | Existing |

## B. Transaction Data

| Table | Purpose | PK | Foreign keys (→ table) | Main columns | Referenced by (FK) | Model | Code refs | Status |
|---|---|---|---|---|---|---|---|---|
| `borrow_transactions` | Tracking: goods borrowed from external parties | id | created_by→users, in_ri_id→ri, item_id→items, lender_vendor_id→vendors, return_npbg_id→npbg, unit_id→units | number, item_id, description_raw, qty, unit_id, lender_vendor_id, lender_name, receipt_ref, return_npbg_id, borrowed_at … (+13) | — | BorrowTransaction | 10 | Existing |
| `disassembly_components` | Disassembly component plan (copied from BoM) | id | disassembly_order_id→disassembly_orders, item_id→items | disassembly_order_id, item_id, product_code, description, base_unit, qty_per_unit, planned_qty, is_extra, sort | disassembly_entries | DisassemblyComponent | 3 | Existing |
| `disassembly_entries` | Disassembly result entries GOOD / SCRAP / MISSING (client_key idempotent) | id | component_id→disassembly_components, disassembly_order_id→disassembly_orders, item_id→items, recorded_by→users, voided_by→users | disassembly_order_id, component_id, item_id, kind, qty, unit, unit_ratio, base_qty, base_unit, entry_date … (+8) | — | DisassemblyEntry | 3 | Existing |
| `disassembly_orders` | Disassembly (unbuild) order header | id | created_by→users, dest_warehouse_id→warehouses, item_id→items, mrp_bom_id→mrp_boms, responsible_id→users, source_warehouse_id→warehouses | number, mrp_bom_id, bom_code, bom_revision, item_id, product_code, product_name, base_unit, planned_qty, done_qty … (+10) | disassembly_activities, disassembly_components, disassembly_entries | DisassemblyOrder | 7 | Existing |
| `important_request_assignees` | Important Request recipients with own status | id | important_request_id→important_requests, user_id→users | important_request_id, user_id, status, progress, blocker_note, confirmed_at, started_at, submitted_at, completed_at | important_request_submissions | ImportantRequestAssignee | 6 | Existing |
| `important_request_submissions` | Important Request submissions and review | id | assignee_id→important_request_assignees, important_request_id→important_requests, reviewed_by→users, user_id→users | important_request_id, assignee_id, user_id, round, note, status, reviewed_by, reviewed_at, review_note | important_request_attachments | ImportantRequestSubmission | 6 | Existing |
| `important_requests` | Important Request (task / instruction) header | id | created_by→users | number, title, description, category, priority, deadline, requires_approval, assignment_mode, note, status … (+7) | important_request_activities, important_request_assignees, important_request_attachments, important_request_comments, important_request_reads, important_request_submissions | ImportantRequest | 10 | Existing |
| `inventory` | Stock balance per item x warehouse (actual / reserved); written only via StockLedgerService (+ bulk importer) | id | item_id→items, warehouse_id→warehouses | item_id, warehouse_id, actual_qty, reserved_qty, available_qty, stock_known, last_counted_at, last_movement_at | — | Inventory | 44 | Existing |
| `item_request_fulfillment_lines` | Lines of a fulfilment (qty prepared / handed, warehouse, NPBG row) | id | item_request_fulfillment_id→item_request_fulfillments, item_request_line_id→item_request_lines, npbg_id→npbg, warehouse_id→warehouses | item_request_fulfillment_id, item_request_line_id, qty, handed_qty, npbg_id, warehouse_id | — | ItemRequestFulfillmentLine | 3 | Existing |
| `item_request_fulfillments` | Fulfilment / handover batches of an Item Request (each = one NPBG) | id | handed_by→users, item_request_id→item_requests, prepared_by→users | item_request_id, seq, status, no_npbg, prepared_by, prepared_at, handed_by, handed_at, received_by_name, note | item_request_fulfillment_lines, item_request_proxies | ItemRequestFulfillment | 8 | Existing |
| `item_request_lines` | Item Request lines (requested vs approved vs fulfilled qty, link to NPBG / PPB / draft) | id | closed_by→users, decided_by→users, item_id→items, item_request_id→item_requests, npbg_id→npbg, ppb_draft_id→ppb_drafts, ppb_id→ppb | item_request_id, item_id, kode_barang, deskripsi_barang, qty, satuan, note, decision, reject_reason, npbg_id … (+15) | item_request_fulfillment_lines, ppb_draft_lines | ItemRequestLine | 16 | Existing |
| `item_requests` | Item Request header (Request Barang) incl. public-link requests | id | entered_by→users, handed_over_by→users, link_id→item_request_links, processed_by→users, requester_id→users | number, source, link_id, requester_id, requester_name, requester_contact, requester_ip, requester_location, divisi, needed_date … (+16) | item_request_approvals, item_request_fulfillments, item_request_lines, item_request_proxies, ppb_drafts, warehouse_gate_links | ItemRequest | 27 | Existing |
| `lend_transactions` | Tracking: goods lent out (from NPBG) | id | created_by→users, customer_id→customers, item_id→items, out_npbg_id→npbg, project_id→projects, return_ri_id→receivings, unit_id→units | number, item_id, description_raw, qty, unit_id, purpose, borrower_name, customer_id, project_id, est_days … (+18) | — | LendTransaction | 11 | Existing |
| `maintenance_order_subs` | Tracking: maintenance sub-jobs | id | maintenance_order_id→maintenance_orders, npbg_id→npbg, ri_id→ri, workshop_id→workshops | maintenance_order_id, sub_no, workshop_id, workshop_raw, problem_detail, npbg_id, ri_id, status, finish_date, result_note … (+8) | — | MaintenanceOrderSub | 10 | Existing |
| `maintenance_orders` | Tracking: maintenance work order (SPK) header | id | asset_id→assets, created_by→users, reported_by→employees, site_id→sites | number, report_date, asset_id, site_id, reported_by, problem_summary, status, completed_at, created_by, nopol_raw | maintenance_order_subs | MaintenanceOrder | 5 | Existing |
| `manufacturing_order_subs` | Tracking (legacy Excel-based): Manufaktur sub rows | id | item_id→items, manufacturing_order_id→manufacturing_orders, npbg_id→npbg, ri_id→ri, serial_unit_id→serial_units | manufacturing_order_id, sub_no, item_no, serial_unit_id, serial_no_raw, process, npbg_id, ri_id, status, finish_date … (+12) | — | ManufacturingOrderSub | 7 | Existing |
| `manufacturing_orders` | Tracking (legacy Excel-based): Manufaktur MA/MJ header - separate from MRP | id | created_by→users, site_id→sites, vendor_id→vendors | number, kind, date, product_name, site_id, vendor_id, status, completed_at, created_by, location | manufacturing_order_subs | ManufacturingOrder | 5 | Existing |
| `mrp_production_components` | MO component plan (copied from BoM) | id | item_id→items, mrp_production_id→mrp_productions | mrp_production_id, item_id, product_code, description, base_unit, qty_per_unit, required_qty, reserved_qty, is_extra, sort | mrp_production_entries | MrpProductionComponent | 2 | Existing |
| `mrp_production_entries` | MO consumption / output / scrap entries (client_key idempotent) | id | component_id→mrp_production_components, item_id→items, mrp_production_id→mrp_productions, recorded_by→users, voided_by→users | mrp_production_id, kind, item_id, component_id, qty, unit, unit_ratio, base_qty, base_unit, entry_date … (+8) | — | MrpProductionEntry | 4 | Existing |
| `mrp_productions` | Manufacturing Order header | id | created_by→users, item_id→items, mrp_bom_id→mrp_boms, responsible_id→users | number, mrp_bom_id, bom_code, bom_revision, item_id, product_code, product_name, base_unit, planned_qty, planned_start … (+9) | mrp_production_components, mrp_production_entries | MrpProduction | 11 | Existing |
| `npbg` | Delivery Order (NPBG) - one row per document LINE (Accurate ARINV/ARINVDET mirror + manual rows) | id | created_by→users | accurate_arinvoice_id, accurate_seq, no_npbg, tgl_npbg, shipdate, taxdate, divisi, pelanggan, keterangan, tipe_npbg … (+17) | borrow_transactions, item_request_fulfillment_lines, item_request_lines, lend_transactions, maintenance_order_subs, manufacturing_order_subs, npbg_verifications, stpp_maintenance_logs, stpp_transactions, tyre_bpn_transfers, tyre_changes, used_return_matrix_rows, used_return_other_rows, used_returns | Npbg | 60 | Existing |
| `npbg_verifications` | NPBG item clarification cases (alternatives, BOS decision) | id | decided_by→users, npbg_id→npbg, opened_by→users, responded_by→users | npbg_id, status, alasan_pengajuan, deskripsi_alternatif, respon_maintenance, alasan_penolakan, keputusan_bos, catatan_bos, opened_by, responded_by … (+5) | npbg_verification_logs | NpbgVerification | 6 | Existing |
| `ppb` | Purchase Request (PPB) - one row per document LINE (Accurate REQUISITION mirror + manual rows) | id | created_by→users | accurate_reqid, accurate_seq, no_ppb, tgl_ppb, status, divisi, keterangan, kode_barang, deskripsi_barang, kuantitas … (+13) | item_request_lines, ppb_draft_lines, purchase_order_items | Ppb | 36 | Existing |
| `ppb_draft_lines` | Draft PPB lines | id | item_id→items, item_request_line_id→item_request_lines, ppb_draft_id→ppb_drafts, ppb_id→ppb, saved_draft_id→ppb_saved_drafts | ppb_draft_id, item_id, kode_barang, deskripsi_barang, qty, satuan, catatan, basis, item_request_line_id, ppb_id … (+2) | — | PpbDraftLine | 14 | Existing |
| `ppb_drafts` | Draft PPB header (restock / from Item Request) | id | created_by→users, item_request_id→item_requests, submitted_by→users | number, status, source, divisi, tgl_diperlukan, peminta, keterangan, no_ppb, submitted_at, submitted_by … (+2) | item_request_lines, ppb_draft_lines | PpbDraft | 15 | Existing |
| `ppb_saved_drafts` | Named saved PPB drafts | id | created_by→users | name, no_ppb, tgl_ppb, tgl_diperlukan, divisi, keterangan, created_by | ppb_draft_lines | PpbSavedDraft | 4 | Existing |
| `purchase_order_item_vendors` | Vendors invited to quote on a PO line | id | created_by→users, purchase_order_item_id→purchase_order_items, vendor_id→vendors | purchase_order_item_id, vendor_id, created_by | — | — | 3 | Existing |
| `purchase_order_items` | PO lines incl. quotation stage and frozen unit ratio | id | accurate_ppb_id→ppb, approved_ppb_id→ppb, item_id→items, ppb_item_id→purchase_proposal_items, purchase_order_id→purchase_orders, unit_id→units, vendor_id→vendors | purchase_order_id, ppb_item_id, item_id, description_raw, qty, unit_id, unit_price, line_total, qty_received, line_status … (+9) | purchase_order_item_vendors, purchase_order_pick_logs, purchase_order_quote_updates, purchase_order_quotes, receiving_items, ri | PurchaseOrderItem | 22 | Existing |
| `purchase_order_quotes` | Vendor quotations per PO line (price, availability, ETA, chosen) | id | chosen_by→users, created_by→users, purchase_order_item_id→purchase_order_items, vendor_id→vendors | purchase_order_item_id, vendor_id, unit_price, note, created_by, availability, eta, chosen_at, chosen_by | — | PurchaseOrderQuote | 5 | Existing |
| `purchase_orders` | Purchase Order header (Accurate mirror + STOCKWISE POs + "Menunggu PO" entries) | id | approved_by→users, created_by→users, ppb_id→purchase_proposals, site_id→sites, vendor_id→vendors | number, prefix, year, month, sequence, date, vendor_id, ppb_id, site_id, expected_date … (+11) | purchase_order_approvals, purchase_order_items, receivings | PurchaseOrder | 25 | Existing |
| `purchase_return_lines` | Purchase return lines (link to RI row) | id | purchase_return_id→purchase_returns, ri_id→ri | purchase_return_id, ri_id, kode_barang, deskripsi_barang, qty, satuan, harga_satuan, ri_qty | — | PurchaseReturnLine | 6 | Existing |
| `purchase_returns` | Purchase return header (to vendor) | id | created_by→users, resolved_by→users, sent_by→users, vendor_id→vendors | number, tgl_retur, no_ri, no_po, vendor, vendor_id, resolution, reason, note, status … (+9) | purchase_return_lines | PurchaseReturn | 9 | Existing |
| `ri` | Receipt (RI) - one row per document LINE (Accurate APINV mirror + manual / from-PO rows) | id | accurate_po_item_id→purchase_order_items, created_by→users, vendor_id→vendors | accurate_apinvoice_id, accurate_seq, no_ri, tgl_ri, divisi, vendor, no_po, shipdate, keterangan, kode_barang … (+20) | borrow_transactions, maintenance_order_subs, manufacturing_order_subs, purchase_return_lines, tyre_changes | Ri | 43 | Existing |
| `stock_adjustments` | Adjustment created when an opname is approved (links to the STOCK_ADJUSTMENT movement) | id | approved_by→users, created_by→users, item_id→items, stock_movement_id→stock_movements, stock_opname_item_id→stock_opname_items, warehouse_id→warehouses | stock_opname_item_id, item_id, warehouse_id, qty_before, qty_after, difference, reason, stock_movement_id, approved_by, approved_at … (+1) | — | StockAdjustment | 1 | Existing |
| `stock_card_entries` | Kartu Stock manual in/out lines | id | created_by→users, share_link_id→stock_card_share_links, stock_card_id→stock_cards | stock_card_id, entry_date, doc_no, description, qty_in, qty_out, created_by, share_link_id | — | StockCardEntry | 4 | Existing |
| `stock_cards` | Kartu Stock header per project x item (manual paper-card replica, NOT the ledger) | id | created_by→users, item_id→items, project_id→projects, updated_by→users | item_id, card_number, location_warehouse, location_rack, person_in_charge, director_name, updated_by, created_by, project_id | stock_card_entries | StockCard | 7 | Existing |
| `stock_movements` | Stock ledger: every stock change with before/after and polymorphic reference | id | created_by→users, item_id→items, warehouse_id→warehouses | item_id, warehouse_id, movement_type, direction, qty, actual_before, actual_after, reserved_before, reserved_after, reference_type … (+4) | stock_adjustments | StockMovement | 13 | Existing |
| `stock_opname_items` | Counted lines (system vs physical qty) | id | item_id→items, stock_opname_id→stock_opnames, warehouse_id→warehouses, warehouse_location_id→warehouse_locations | stock_opname_id, item_id, warehouse_id, warehouse_location_id, system_qty, physical_qty, difference, note, count_status, review_status | stock_adjustments | StockOpnameItem | 8 | Existing |
| `stock_opnames` | Physical inventory (stock opname) header | id | counted_by→users, created_by→users, reviewed_by→users, site_id→sites, warehouse_id→warehouses | number, warehouse_id, site_id, scheduled_date, type, status, counted_by, started_at, submitted_at, reviewed_by … (+5) | stock_opname_items | StockOpname | 8 | Existing |
| `stpp_maintenance_logs` | Tracking: STPP maintenance sheet rows | id | created_by→users, npbg_id→npbg | sheet_no, serial_no_raw, requester, npbg_date, npbg_no, npbg_id, note, source, created_by | — | — | 4 | Existing |
| `stpp_transactions` | Tracking: STPP tool issue / withdrawal | id | created_by→users, holder_id→employees, item_id→items, out_npbg_id→npbg, placement_department_id→departments, return_ri_id→receivings, serial_unit_id→serial_units, unit_id→units | number, serial_unit_id, serial_no_raw, item_id, description_raw, qty, unit_id, holder_id, holder_name_raw, placement_department_id … (+18) | — | StppTransaction | 9 | Existing |
| `tyre_bpn_inventory` | Tracking: Balikpapan tyre inventory sheet (Excel replica) | id | — | sheet_no, cutoff_date, nopol_raw, tyre_desc, serial_raw, note, source | — | — | 3 | Existing |
| `tyre_bpn_transfers` | Tracking: Balikpapan tyre transfer sheet (Excel replica) | id | npbg_id→npbg | sheet_no, nopol_raw, npbg_date, npbg_no, npbg_id, new_tyre_desc, new_serial_raw, out_note, ri_date, ri_no … (+4) | — | — | 4 | Existing |
| `tyre_changes` | Tracking: outer tyre replacements | id | asset_id→assets, created_by→users, in_ri_id→ri, new_serial_unit_id→serial_units, old_serial_unit_id→serial_units, out_npbg_id→npbg | asset_id, change_date, position, change_seq, out_npbg_id, new_serial_unit_id, new_tyre_desc, new_serial_raw, status, in_ri_id … (+18) | — | TyreChange | 11 | Existing |
| `used_return_items` | Tracking: used-goods return lines | id | component_type_id→used_return_component_types, item_id→items, unit_id→units, used_return_id→used_returns | used_return_id, item_id, component_type_id, description_raw, qty, unit_id, condition, into_stock, item_no, note | — | UsedReturnItem | 3 | Existing |
| `used_return_matrix_rows` | Tracking: used-goods matrix sheet rows (Excel replica) | id | created_by→users, npbg_id→npbg | sheet_no, npbg_date, npbg_no, npbg_id, status, ri_date, ri_no, components, note, source … (+1) | — | — | 3 | Existing |
| `used_return_other_rows` | Tracking: used-goods "other parts" sheet rows (Excel replica) | id | created_by→users, npbg_id→npbg | sheet_no, npbg_date, npbg_no, npbg_id, description, qty, unit, item_no, out_file_name, status … (+6) | — | — | 3 | Existing |
| `used_returns` | Tracking: used-goods return header | id | created_by→users, npbg_id→npbg, ri_id→receivings, site_id→sites | number, npbg_id, npbg_ref_raw, ri_id, return_date, status, format, site_id, note, created_by … (+1) | used_return_items | UsedReturn | 9 | Existing |

## C. Configuration Data

| Table | Purpose | PK | Foreign keys (→ table) | Main columns | Referenced by (FK) | Model | Code refs | Status |
|---|---|---|---|---|---|---|---|---|
| `accurate_ip_labels` | Labels for PCs connected to Accurate (Accurate Online page) | id | updated_by→users | ip, user_name, division, note, updated_by | — | AccurateIpLabel | 1 | Existing |
| `app_settings` | Key/value system settings (e.g. auto-refresh) | key (Laravel default) | — | key, value | — | — | 1 | Existing |
| `document_sequences` | Document numbering counters per type/prefix/year/month | id | — | doc_type, prefix, year, month, last_sequence | — | — | 4 | Existing |
| `item_request_links` | Public Item Request share links (token, form type, on/off) | id | created_by→users | token, label, is_active, created_by, last_used_at, form_type | item_requests | ItemRequestLink | 3 | Existing |
| `stock_card_share_links` | Public Kartu Stock share links (token, VIEW/EDIT/FULL) | id | created_by→users, project_id→projects | project_id, token, access, label, created_by, last_used_at | stock_card_entries | StockCardShareLink | 2 | Existing |
| `update_alerts` | Announcement / update pop-ups (Super Admin) | id | created_by→users | title, message, type, display_mode, interval_minutes, starts_at, ends_at, is_active, created_by | update_alert_views | UpdateAlert | 3 | Existing |
| `user_preferences` | Per-user UI preferences (JSON) | id | user_id→users | user_id, key, value | — | — | 1 | Existing |

## D. System & Security Data

| Table | Purpose | PK | Foreign keys (→ table) | Main columns | Referenced by (FK) | Model | Code refs | Status |
|---|---|---|---|---|---|---|---|---|
| `cache` | Laravel database cache store table | key (Laravel default) | — | key, value, expiration | — | — | 0 | Existing (no app ref found) |
| `cache_locks` | Laravel database cache locks | key (Laravel default) | — | key, owner, expiration | — | — | 0 | Existing (no app ref found) |
| `failed_jobs` | Laravel failed jobs | id | — | uuid, connection, queue, payload, exception, failed_at | — | — | 0 | Existing (no app ref found) |
| `job_batches` | Laravel job batches | id | — | name, total_jobs, pending_jobs, failed_jobs, failed_job_ids, options, cancelled_at, finished_at | — | — | 0 | Existing (no app ref found) |
| `jobs` | Laravel queue table (QUEUE_CONNECTION=sync in .env.example) | id | — | queue, payload, attempts, reserved_at, available_at | — | — | 0 | Existing (no app ref found) |
| `password_reset_tokens` | Laravel default password reset tokens | email (Laravel default) | — | email, token | — | — | 1 | Existing |
| `permission_role` | Role <-> permission pivot | (permission_id,role_id) | permission_id→permissions, role_id→roles | permission_id, role_id | — | — | 0 | Existing (no app ref found) |
| `permissions` | Permission catalogue (seeded from App\Support\Rbac\Rbac) | id | — | slug, name, group | permission_role | Permission | 4 | Existing |
| `personal_access_tokens` | Sanctum API tokens (users + Sync Agent) | id | — | tokenable_type, tokenable_id, name, token, abilities, last_used_at, expires_at | — | — | 1 | Existing |
| `role_user` | User <-> role pivot | (role_id,user_id) | role_id→roles, user_id→users | role_id, user_id | — | — | 1 | Existing |
| `roles` | Roles (RBAC) | id | — | slug, name, description, is_system | permission_role, role_user | Role | 7 | Existing |
| `sessions` | Laravel default sessions table (SESSION_DRIVER=file in .env.example) | id | — | user_id, ip_address, user_agent, payload, last_activity | — | — | 1 | Existing |
| `users` | Login accounts | id | employee_id→employees, site_id→sites | name, email, email_verified_at, password, remember_token, username, site_id, employee_id, is_active, last_login_at … (+5) | accurate_ip_labels, borrow_transactions, dashboard_notes, disassembly_activities, disassembly_entries, disassembly_orders, doc_activities, doc_message_attachments, doc_messages, employees, important_request_activities, important_request_assignees, important_request_attachments, important_request_comments, important_request_reads, important_request_submissions, important_requests, inventory_analysis_runs, item_aliases, item_request_approvals, item_request_fulfillments, item_request_lines, item_request_links, item_request_proxies, item_requests, item_unit_conversions, lend_transactions, maintenance_orders, manufacturing_orders, mrp_activities, mrp_boms, mrp_production_entries, mrp_productions, npbg, npbg_approvals, npbg_verification_logs, npbg_verifications, ppb, ppb_approvals, ppb_drafts, ppb_saved_drafts, purchase_order_approvals, purchase_order_item_vendors, purchase_order_pick_logs, purchase_order_quote_updates, purchase_order_quotes, purchase_orders, purchase_proposal_amendments, purchase_proposals, purchase_returns, receivings, record_notes, ri, role_user, stock_adjustments, stock_card_entries, stock_card_share_links, stock_cards, stock_movements, stock_opnames, stpp_maintenance_logs, stpp_transactions, sync_batches, tracking_photos, tyre_changes, update_alert_views, update_alerts, used_return_matrix_rows, used_return_other_rows, used_returns, user_preferences, vendor_price_histories, vendor_prices, warehouse_gate_links | User | 92 | Existing |

## E. Logs & Audit Data

| Table | Purpose | PK | Foreign keys (→ table) | Main columns | Referenced by (FK) | Model | Code refs | Status |
|---|---|---|---|---|---|---|---|---|
| `disassembly_activities` | Disassembly order status history | id | disassembly_order_id→disassembly_orders, user_id→users | disassembly_order_id, action, from_status, to_status, note, user_id | — | DisassemblyActivity | 1 | Existing |
| `doc_audit_logs` | Audit trail (before -> after) of transaction documents, via Eloquent observer | id | — | res_type, res_key, model, model_id, event, changes, reason, user_id, user_name, route … (+1) | — | DocAuditLog | 2 | Existing |
| `important_request_activities` | Important Request activity log | id | important_request_id→important_requests, user_id→users | important_request_id, user_id, action, meta | — | ImportantRequestActivity | 4 | Existing |
| `item_request_approvals` | Item Request approval log (stage/action/user) | id | item_request_id→item_requests, user_id→users | item_request_id, stage, action, note, user_id, user_name | — | ItemRequestApproval | 4 | Existing |
| `mrp_activities` | MO / BoM status history (polymorphic subject) | id | user_id→users | subject_type, subject_id, action, from_status, to_status, note, user_id | — | MrpActivity | 2 | Existing |
| `npbg_approvals` | Manual NPBG approval log keyed by no_npbg string - status is derived from it | id | user_id→users | no_npbg, action, note, user_id, user_name | — | — | 2 | Existing |
| `npbg_verification_logs` | NPBG verification case log | id | actor_id→users, npbg_verification_id→npbg_verifications | npbg_verification_id, actor_id, action, from_status, to_status, note, attachment_path | — | NpbgVerificationLog | 4 | Existing |
| `ppb_approvals` | PPB approval log keyed by no_ppb string - status is derived from it | id | user_id→users | no_ppb, action, note, user_id, user_name | — | — | 4 | Existing |
| `purchase_order_approvals` | STOCKWISE PO approval log | id | purchase_order_id→purchase_orders, user_id→users | purchase_order_id, action, note, user_id, user_name | — | — | 2 | Existing |
| `purchase_order_pick_logs` | Director vendor-pick / change / return log on PO lines | id | purchase_order_item_id→purchase_order_items, user_id→users | purchase_order_item_id, action, from_vendor, from_price, to_vendor, to_price, reason, user_id, user_name | — | PurchaseOrderPickLog | 1 | Existing |
| `purchase_order_quote_updates` | History of quote price updates | id | purchase_order_item_id→purchase_order_items, user_id→users, vendor_id→vendors | purchase_order_item_id, item_id, vendor_id, unit_price, user_id | — | — | 1 | Existing |
| `sync_batches` | Accurate sync runs | id | created_by→users | sync_code, source, started_at, finished_at, status, total_records, inserted_records, updated_records, skipped_records, error_records … (+4) | sync_logs | SyncBatch | 6 | Existing |
| `sync_logs` | Per-record Accurate sync results | id | sync_batch_id→sync_batches | sync_batch_id, entity, source_id, action, status, message, old_data, new_data | — | SyncLog | 2 | Existing |
| `user_activity_logs` | User Log: every write request + page views (middleware) | id | — | user_id, user_name, event, module, description, subject, method, path, route, status … (+3) | — | UserActivityLog | 2 | Existing |
| `vendor_price_histories` | Price List change history | id | user_id→users, vendor_price_id→vendor_prices | vendor_price_id, item_id, vendor_id, action, old_price, new_price, old_status, new_status, changes, note … (+2) | — | VendorPriceHistory | 2 | Existing |

## F. Supporting Data

| Table | Purpose | PK | Foreign keys (→ table) | Main columns | Referenced by (FK) | Model | Code refs | Status |
|---|---|---|---|---|---|---|---|---|
| `dashboard_notes` | Personal dashboard sticky notes / checklists | id | user_id→users | user_id, title, body, checklist, color, pinned, done_at, remind_at | — | DashboardNote | 1 | Existing |
| `doc_activities` | Scheduled activities (to-do) on documents | id | assignee_id→users, cancelled_by→users, created_by→users, done_by→users | res_type, res_key, res_id, res_number, activity_type, summary, note, assignee_id, due_date, created_by … (+5) | — | DocActivity | 3 | Existing |
| `doc_message_attachments` | Chatter attachments | id | doc_message_id→doc_messages, uploaded_by→users | doc_message_id, original_name, path, mime, size, uploaded_by | — | DocMessageAttachment | 2 | Existing |
| `doc_messages` | Chatter messages / internal notes per document (res_type + res_key) | id | deleted_by→users, user_id→users | res_type, res_key, kind, body, user_id, edited_at, deleted_at, deleted_by | doc_message_attachments | DocMessage | 2 | Existing |
| `important_request_attachments` | Important Request files | id | comment_id→important_request_comments, deleted_by→users, important_request_id→important_requests, submission_id→important_request_submissions, uploaded_by→users | important_request_id, comment_id, submission_id, kind, original_name, path, size, mime, extension, uploaded_by … (+2) | — | ImportantRequestAttachment | 6 | Existing |
| `important_request_comments` | Important Request discussion | id | important_request_id→important_requests, parent_id→important_request_comments, user_id→users | important_request_id, parent_id, user_id, kind, body, edited_at, deleted_at | important_request_attachments, important_request_comments | ImportantRequestComment | 4 | Existing |
| `important_request_reads` | Important Request read markers | id | important_request_id→important_requests, user_id→users | important_request_id, user_id, last_read_at | — | — | 1 | Existing |
| `inventory_analysis_runs` | Analysis run header | id | triggered_by→users | scope, lead_time_threshold, median_deficit, item_count, tidak_aman_count, triggered_by, computed_at | inventory_snapshots | InventoryAnalysisRun | 4 | Existing |
| `inventory_snapshots` | Computed stock analysis per item (status, safety stock, priority) - read by most pages | id | analysis_run_id→inventory_analysis_runs, item_id→items, warehouse_id→warehouses | item_id, warehouse_id, analysis_run_id, actual, reserved, available, stock_known, safety_stock, lead_time_days, selisih … (+7) | — | InventorySnapshot | 6 | Existing |
| `item_request_proxies` | Pick-up proxy codes for an Item Request handover | id | item_request_fulfillment_id→item_request_fulfillments, item_request_id→item_requests, used_by→users | item_request_id, name, code, expires_at, used_at, used_by, item_request_fulfillment_id, cancelled_at | — | ItemRequestProxy | 1 | Existing |
| `notifications` | Laravel database notifications (in-app bell) | id | — | type, notifiable_type, notifiable_id, data, read_at | — | — | 2 | Existing |
| `record_notes` | Free notes on any entity row (entity + entity_key) | id | updated_by→users | entity, entity_key, note, updated_by | — | RecordNote | 1 | Existing |
| `tracking_photos` | Photo / file evidence for many modules (entity + entity_id + slot) | id | uploaded_by→users | entity, entity_id, slot, file_name, path, mime, source, uploaded_by | — | TrackingPhoto | 20 | Existing |
| `update_alert_views` | Who saw / thumbed-up an update alert | id | update_alert_id→update_alerts, user_id→users | update_alert_id, user_id, last_seen_at, thumbed_up_at | — | UpdateAlertView | 3 | Existing |
| `warehouse_gate_links` | Links MO / Disassembly orders to the Item Request / RI that moved their stock | id | created_by→users, item_request_id→item_requests | owner_type, owner_id, item_request_id, no_ri, created_by | — | — | 2 | Existing |

## G. Unclassified / Needs Investigation (legacy)

| Table | Purpose | PK | Foreign keys (→ table) | Main columns | Referenced by (FK) | Model | Code refs | Status |
|---|---|---|---|---|---|---|---|---|
| `purchase_proposal_amendments` | Original PPB amendments (renamed). No app code reference found | id | created_by→users, ppb_id→purchase_proposals, ppb_item_id→purchase_proposal_items | ppb_id, ppb_item_id, date, type, qty_before, qty_after, reason, created_by | — | — | 0 | Legacy - unclear |
| `purchase_proposal_items` | Original PPB lines (renamed). Still FK target of purchase_order_items.ppb_item_id | id | item_id→items, ppb_id→purchase_proposals, unit_id→units | ppb_id, item_id, material_request_item_id, description_raw, qty, unit_id, shortage_qty, safety_stock_snapshot, deficit_snapshot, priority_score_snapshot … (+5) | purchase_order_items, purchase_proposal_amendments | — | 0 | Legacy - unclear |
| `purchase_proposals` | Original Phase-7 PPB table (renamed from ppb on 2026-09-16); replaced by `ppb`. No app code reference found | id | approved_by→users, created_by→users, department_id→departments, requester_id→users, site_id→sites | number, prefix, year, month, sequence, date, requester_id, department_id, site_id, source_request_id … (+5) | purchase_orders, purchase_proposal_amendments, purchase_proposal_items, receivings | — | 0 | Legacy - unclear |
| `receiving_items` | Original receiving lines (see receivings) | id | item_id→items, purchase_order_item_id→purchase_order_items, receiving_id→receivings, unit_id→units, warehouse_id→warehouses, warehouse_location_id→warehouse_locations | receiving_id, purchase_order_item_id, item_id, description_raw, qty_expected, qty_received, qty_accepted, qty_rejected, unit_id, condition_note … (+4) | — | ReceivingItem | 1 | Legacy - unclear |
| `receivings` | Original Phase-7 receiving header; replaced by `ri`. Still FK target of lend/stpp/used_returns; ReceivingService has no route caller except via UsedReturnService | id | checked_by→users, confirmed_by→users, created_by→users, ppb_id→purchase_proposals, purchase_order_id→purchase_orders, site_id→sites, vendor_id→vendors, warehouse_id→warehouses | number, prefix, year, month, sequence, date, source_type, purchase_order_id, ppb_id, vendor_id … (+9) | lend_transactions, receiving_items, stpp_transactions, used_returns | Receiving | 7 | Legacy - unclear |

## H. Accurate mirror tables (runtime, not in migrations)

Created / replaced by `App\Services\Accurate\StagingTableWriter::createTable()` for each whitelisted table in `config/accurate.php → mirror_tables`. Columns come from the Firebird staging copy (types whitelisted). Read by `AccurateSyncService`, which projects them into STOCKWISE tables (items, npbg, ppb, ri, purchase_orders, stock_opnames, vendors, warehouses …). Schema is **Unknown** without DB access. Per project memory, new features must not read these tables.

| Table | Accurate source | Category |
|---|---|---|
| `accurate_item` | Item master | Integration mirror (Supporting) |
| `accurate_warehs` | Warehouses | Integration mirror (Supporting) |
| `accurate_itemcategory` | Item categories | Integration mirror (Supporting) |
| `accurate_persondata` | Vendors/customers/persons | Integration mirror (Supporting) |
| `accurate_custtype` | Customer types | Integration mirror (Supporting) |
| `accurate_itembalance` | Item balance | Integration mirror (Supporting) |
| `accurate_itembalancewarehouse` | Item balance per warehouse | Integration mirror (Supporting) |
| `accurate_itemadj` | Inventory adjustment header | Integration mirror (Supporting) |
| `accurate_itadjdet` | Inventory adjustment lines | Integration mirror (Supporting) |
| `accurate_itemhist` | Item history (stock card source) | Integration mirror (Supporting) |
| `accurate_po` | Purchase orders | Integration mirror (Supporting) |
| `accurate_podet` | PO lines | Integration mirror (Supporting) |
| `accurate_requisition` | Purchase requisitions (PPB) | Integration mirror (Supporting) |
| `accurate_requisitiondet` | Requisition lines | Integration mirror (Supporting) |
| `accurate_apinv` | Purchase invoices / receipts (RI) | Integration mirror (Supporting) |
| `accurate_apitmdet` | Purchase invoice lines | Integration mirror (Supporting) |
| `accurate_so` | Sales orders | Integration mirror (Supporting) |
| `accurate_sodet` | SO lines | Integration mirror (Supporting) |
| `accurate_arinv` | Sales invoices (NPBG source) | Integration mirror (Supporting) |
| `accurate_arinvdet` | Sales invoice lines | Integration mirror (Supporting) |
| `accurate_department` | Departments (optional) | Integration mirror (Supporting) |
| `accurate_shipment` | Shipment (optional) | Integration mirror (Supporting) |
| `accurate_termopmt` | Payment terms (optional) | Integration mirror (Supporting) |
| `accurate_snhistory` | Serial number history (optional) | Integration mirror (Supporting) |
| `accurate_serialnumbers` | Serial numbers (optional) | Integration mirror (Supporting) |
| `accurate_snline_byitemhist` | Derived serial lines (computed on staging) | Integration mirror (Supporting) |

## Findings

- **Verified — overlapping / duplicate structures**
  - `purchase_proposals*` (old PPB) vs `ppb` (current); `receivings/receiving_items` (old receipt) vs `ri` (current). Old tables are still FK targets: `lend_transactions.return_ri_id`, `stpp_transactions.return_ri_id`, `used_returns.ri_id` → `receivings`; `purchase_order_items.ppb_item_id` and `purchase_orders.ppb_id` → `purchase_proposal*`. The real receipt is `ri`, so these FKs point at the wrong table (validation `exists:receivings,id` in `LendController`/`StppController`).
  - Two "manufacturing" models: `manufacturing_orders/_subs` (Excel-replica tracking) and `mrp_productions/*` (MRP). Two "stock card" concepts: `stock_cards/_entries` (manual paper card per project) and `stock_movements` (real ledger).
  - `employees` and `users` both hold person data (name, phone, position) — linked both ways (`users.employee_id`, `employees.user_id`).
  - Categories exist twice: `categories` tree (FK on items) and the free-text `items.accurate_category_induk/anak_1..3` plus `item_category_options`.
- **Verified — line-level document tables:** `npbg`, `ppb`, `ri` store **one row per line** with header data (number, date, divisi, vendor, customer) repeated on every row; there is no header table. Documents are identified by string numbers (`no_npbg`, `no_ppb`, `no_ri`).
- **Verified — string references instead of FKs:** `npbg_approvals.no_npbg`, `ppb_approvals.no_ppb`, `purchase_returns.no_ri / no_po / vendor`, `ri.vendor / no_po / no_ppb`, `npbg.pelanggan / divisi / peminta`, `ppb.divisi / peminta`, `item_requests.divisi`, `npbg.satuan`, `ri.satuan`, `ppb.satuan` (unit as text). Divisi never references `departments`; customer never references `customers`.
- **Verified — polymorphic links without FK:** `stock_movements.reference_type/id`, `doc_*` (`res_type`, `res_key`), `tracking_photos (entity, entity_id)`, `record_notes (entity, entity_key)`, `mrp_activities (subject_type, subject_id)`, `warehouse_gate_links (owner_type, owner_id)`.
- **Verified — weak constraints:** `vendors.code`, `customers.code`, `departments.code`, `projects.code` are nullable and not unique; `vendors` unique only on `name`; `vendor_prices` has no unique key on (item, vendor, unit, validity); `items.description` not unique (duplicates detected only by `MasterDataQualityService`); `item_safety_stocks` allows several rows per item (flag `is_effective`).
- **Verified — cascade risks:** many master FKs use `cascadeOnDelete` (e.g. `stock_movements.item_id`, `inventory.item_id`, `stock_movements.warehouse_id`, `stock_opnames.site_id`, `purchase_orders.vendor_id`, `maintenance_orders.asset_id`). Items are soft-deleted (`deleted_at`) so the cascade does not fire in normal use, but a hard delete of a warehouse/site/vendor would remove ledger or document rows.
- **Verified — redundant derived column:** `inventory.available_qty` is defined but `StockLedgerService` only writes `actual_qty`/`reserved_qty` (available is computed in queries / `inventory_snapshots.available`). Whether `available_qty` is a generated column is **Unknown** without DB access.

