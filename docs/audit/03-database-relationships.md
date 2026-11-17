# 03 — Database Relationships

> Read-only audit 2026-11-16. FK edges are reconstructed statically from migrations (Verified from source; live DB not inspected). On-delete rule shown when declared (`cascade`, `null`, `restrict`); blank = database default (restrict / no action).

## 1. Hub tables (most referenced)

| Table | Incoming FKs | From tables |
|---|---|---|
| `users` | 107 | accurate_ip_labels, borrow_transactions, dashboard_notes, disassembly_activities, disassembly_entries, disassembly_orders, doc_activities, doc_message_attachments, doc_messages, employees, important_request_activities, important_request_assignees, important_request_attachments, important_request_comments, important_request_reads, important_request_submissions, important_requests, inventory_analysis_runs, item_aliases, item_request_approvals, item_request_fulfillments, item_request_lines, item_request_links, item_request_proxies, item_requests, item_unit_conversions, lend_transactions, maintenance_orders, manufacturing_orders, mrp_activities, mrp_boms, mrp_production_entries, mrp_productions, npbg, npbg_approvals, npbg_verification_logs, npbg_verifications, ppb, ppb_approvals, ppb_drafts, ppb_saved_drafts, purchase_order_approvals, purchase_order_item_vendors, purchase_order_pick_logs, purchase_order_quote_updates, purchase_order_quotes, purchase_orders, purchase_proposal_amendments, purchase_proposals, purchase_returns, receivings, record_notes, ri, role_user, stock_adjustments, stock_card_entries, stock_card_share_links, stock_cards, stock_movements, stock_opnames, stpp_maintenance_logs, stpp_transactions, sync_batches, tracking_photos, tyre_changes, update_alert_views, update_alerts, used_return_matrix_rows, used_return_other_rows, used_returns, user_preferences, vendor_price_histories, vendor_prices, warehouse_gate_links |
| `items` | 30 | borrow_transactions, disassembly_components, disassembly_entries, disassembly_orders, inventory, inventory_snapshots, item_aliases, item_request_lines, item_safety_stocks, item_unit_conversions, lend_transactions, manufacturing_order_subs, mrp_bom_lines, mrp_boms, mrp_production_components, mrp_production_entries, mrp_productions, ppb_draft_lines, purchase_order_items, purchase_proposal_items, receiving_items, serial_units, stock_adjustments, stock_cards, stock_movements, stock_opname_items, stpp_transactions, used_return_component_types, used_return_items, vendor_prices |
| `npbg` | 14 | borrow_transactions, item_request_fulfillment_lines, item_request_lines, lend_transactions, maintenance_order_subs, manufacturing_order_subs, npbg_verifications, stpp_maintenance_logs, stpp_transactions, tyre_bpn_transfers, tyre_changes, used_return_matrix_rows, used_return_other_rows, used_returns |
| `warehouses` | 13 | disassembly_orders, inventory, inventory_snapshots, item_request_fulfillment_lines, items, receiving_items, receivings, stock_adjustments, stock_movements, stock_opname_items, stock_opnames, warehouse_locations |
| `sites` | 12 | assets, employees, maintenance_orders, manufacturing_orders, purchase_orders, purchase_proposals, receivings, stock_opnames, used_returns, users, warehouses, workshops |
| `units` | 12 | borrow_transactions, item_unit_conversions, items, lend_transactions, purchase_order_items, purchase_proposal_items, receiving_items, stpp_transactions, used_return_items, vendor_prices |
| `vendors` | 11 | borrow_transactions, manufacturing_orders, purchase_order_item_vendors, purchase_order_items, purchase_order_quote_updates, purchase_order_quotes, purchase_orders, purchase_returns, receivings, ri, vendor_prices |
| `purchase_order_items` | 6 | purchase_order_item_vendors, purchase_order_pick_logs, purchase_order_quote_updates, purchase_order_quotes, receiving_items, ri |
| `item_requests` | 6 | item_request_approvals, item_request_fulfillments, item_request_lines, item_request_proxies, ppb_drafts, warehouse_gate_links |
| `important_requests` | 6 | important_request_activities, important_request_assignees, important_request_attachments, important_request_comments, important_request_reads, important_request_submissions |
| `ri` | 5 | borrow_transactions, maintenance_order_subs, manufacturing_order_subs, purchase_return_lines, tyre_changes |
| `purchase_proposals` | 4 | purchase_orders, purchase_proposal_amendments, purchase_proposal_items, receivings |
| `ppb` | 4 | item_request_lines, ppb_draft_lines, purchase_order_items |
| `receivings` | 4 | lend_transactions, receiving_items, stpp_transactions, used_returns |
| `serial_units` | 4 | manufacturing_order_subs, stpp_transactions, tyre_changes |

## 2. Core relationship map

```text
sites ─┬─< warehouses ─< warehouse_locations
       ├─< employees >── departments          users >──< roles >──< permissions
       └─< users ── employee_id ─> employees     (role_user, permission_role)

uom_categories ─< units ─< item_unit_conversions >─ items
categories (tree) ─< items ─┬─< inventory  >── warehouses
                            ├─< stock_movements (reference_type/id → any document, no FK)
                            ├─< inventory_snapshots, item_safety_stocks, item_aliases
                            ├─< vendor_prices >── vendors / units
                            ├─< mrp_boms ─< mrp_bom_lines >── items
                            └─ referenced by item_request_lines, ppb_draft_lines, purchase_order_items,
                               mrp_*, disassembly_*, stock_cards, tracking tables (all nullable / by item_id)

item_requests ─< item_request_lines ──> npbg (row), ppb (row), ppb_drafts
      └─< item_request_fulfillments ─< item_request_fulfillment_lines ──> npbg (row), warehouses
ppb_drafts ─< ppb_draft_lines ──> ppb (row)
ppb (row) <── purchase_order_items.approved_ppb_id / accurate_ppb_id
purchase_orders ─< purchase_order_items ─< purchase_order_quotes >── vendors
purchase_order_items <── ri.accurate_po_item_id   (RI row per PO line)
ri <── purchase_return_lines ─> purchase_returns
npbg_approvals.no_npbg  ··string··> npbg.no_npbg        (no FK)
ppb_approvals.no_ppb    ··string··> ppb.no_ppb          (no FK)
mrp_productions / disassembly_orders ··warehouse_gate_links··> item_requests, ri (no FK to ri)
```

## 3. Full FK edge list

| Table | Column | → References | On delete |
|---|---|---|---|
| `accurate_ip_labels` | updated_by | `users` | set null |
| `assets` | site_id | `sites` | set null |
| `borrow_transactions` | created_by | `users` | set null |
| `borrow_transactions` | in_ri_id | `ri` | set null |
| `borrow_transactions` | item_id | `items` | set null |
| `borrow_transactions` | lender_vendor_id | `vendors` | set null |
| `borrow_transactions` | return_npbg_id | `npbg` | set null |
| `borrow_transactions` | unit_id | `units` | set null |
| `categories` | parent_id | `categories` | set null |
| `dashboard_notes` | user_id | `users` | cascade |
| `disassembly_activities` | disassembly_order_id | `disassembly_orders` | cascade |
| `disassembly_activities` | user_id | `users` | set null |
| `disassembly_components` | disassembly_order_id | `disassembly_orders` | cascade |
| `disassembly_components` | item_id | `items` | restrict |
| `disassembly_entries` | component_id | `disassembly_components` | restrict |
| `disassembly_entries` | disassembly_order_id | `disassembly_orders` | cascade |
| `disassembly_entries` | item_id | `items` | restrict |
| `disassembly_entries` | recorded_by | `users` | set null |
| `disassembly_entries` | voided_by | `users` | set null |
| `disassembly_orders` | created_by | `users` | set null |
| `disassembly_orders` | dest_warehouse_id | `warehouses` | restrict |
| `disassembly_orders` | item_id | `items` | restrict |
| `disassembly_orders` | mrp_bom_id | `mrp_boms` | restrict |
| `disassembly_orders` | responsible_id | `users` | set null |
| `disassembly_orders` | source_warehouse_id | `warehouses` | restrict |
| `doc_activities` | assignee_id | `users` |  |
| `doc_activities` | cancelled_by | `users` | set null |
| `doc_activities` | created_by | `users` | set null |
| `doc_activities` | done_by | `users` | set null |
| `doc_message_attachments` | doc_message_id | `doc_messages` | cascade |
| `doc_message_attachments` | uploaded_by | `users` | set null |
| `doc_messages` | deleted_by | `users` | set null |
| `doc_messages` | user_id | `users` | set null |
| `employees` | department_id | `departments` | set null |
| `employees` | site_id | `sites` | set null |
| `employees` | user_id | `users` | set null |
| `important_request_activities` | important_request_id | `important_requests` | cascade |
| `important_request_activities` | user_id | `users` |  |
| `important_request_assignees` | important_request_id | `important_requests` | cascade |
| `important_request_assignees` | user_id | `users` |  |
| `important_request_attachments` | comment_id | `important_request_comments` | set null |
| `important_request_attachments` | deleted_by | `users` |  |
| `important_request_attachments` | important_request_id | `important_requests` | cascade |
| `important_request_attachments` | submission_id | `important_request_submissions` | set null |
| `important_request_attachments` | uploaded_by | `users` |  |
| `important_request_comments` | important_request_id | `important_requests` | cascade |
| `important_request_comments` | parent_id | `important_request_comments` | cascade |
| `important_request_comments` | user_id | `users` |  |
| `important_request_reads` | important_request_id | `important_requests` | cascade |
| `important_request_reads` | user_id | `users` | cascade |
| `important_request_submissions` | assignee_id | `important_request_assignees` | cascade |
| `important_request_submissions` | important_request_id | `important_requests` | cascade |
| `important_request_submissions` | reviewed_by | `users` |  |
| `important_request_submissions` | user_id | `users` |  |
| `important_requests` | created_by | `users` |  |
| `inventory` | item_id | `items` | cascade |
| `inventory` | warehouse_id | `warehouses` | cascade |
| `inventory_analysis_runs` | triggered_by | `users` | set null |
| `inventory_snapshots` | analysis_run_id | `inventory_analysis_runs` | set null |
| `inventory_snapshots` | item_id | `items` | cascade |
| `inventory_snapshots` | warehouse_id | `warehouses` | cascade |
| `item_aliases` | created_by | `users` | set null |
| `item_aliases` | item_id | `items` | cascade |
| `item_request_approvals` | item_request_id | `item_requests` | cascade |
| `item_request_approvals` | user_id | `users` | set null |
| `item_request_fulfillment_lines` | item_request_fulfillment_id | `item_request_fulfillments` | cascade |
| `item_request_fulfillment_lines` | item_request_line_id | `item_request_lines` | cascade |
| `item_request_fulfillment_lines` | npbg_id | `npbg` | set null |
| `item_request_fulfillment_lines` | warehouse_id | `warehouses` | set null |
| `item_request_fulfillments` | handed_by | `users` | set null |
| `item_request_fulfillments` | item_request_id | `item_requests` | cascade |
| `item_request_fulfillments` | prepared_by | `users` | set null |
| `item_request_lines` | closed_by | `users` | set null |
| `item_request_lines` | decided_by | `users` | set null |
| `item_request_lines` | item_id | `items` | set null |
| `item_request_lines` | item_request_id | `item_requests` | cascade |
| `item_request_lines` | npbg_id | `npbg` | set null |
| `item_request_lines` | ppb_draft_id | `ppb_drafts` | set null |
| `item_request_lines` | ppb_id | `ppb` | set null |
| `item_request_links` | created_by | `users` | set null |
| `item_request_proxies` | item_request_fulfillment_id | `item_request_fulfillments` | set null |
| `item_request_proxies` | item_request_id | `item_requests` | cascade |
| `item_request_proxies` | used_by | `users` | set null |
| `item_requests` | entered_by | `users` | set null |
| `item_requests` | handed_over_by | `users` | set null |
| `item_requests` | link_id | `item_request_links` | set null |
| `item_requests` | processed_by | `users` | set null |
| `item_requests` | requester_id | `users` | set null |
| `item_safety_stocks` | item_id | `items` | cascade |
| `item_unit_conversions` | base_unit_id | `units` | set null |
| `item_unit_conversions` | created_by | `users` | set null |
| `item_unit_conversions` | item_id | `items` | cascade |
| `item_unit_conversions` | unit_id | `units` | cascade |
| `items` | category_id | `categories` | set null |
| `items` | default_location_id | `warehouse_locations` | set null |
| `items` | default_warehouse_id | `warehouses` | set null |
| `items` | unit_id | `units` | set null |
| `lend_transactions` | created_by | `users` | set null |
| `lend_transactions` | customer_id | `customers` | set null |
| `lend_transactions` | item_id | `items` | set null |
| `lend_transactions` | out_npbg_id | `npbg` | set null |
| `lend_transactions` | project_id | `projects` | set null |
| `lend_transactions` | return_ri_id | `receivings` | set null |
| `lend_transactions` | unit_id | `units` | set null |
| `maintenance_order_subs` | maintenance_order_id | `maintenance_orders` | cascade |
| `maintenance_order_subs` | npbg_id | `npbg` | set null |
| `maintenance_order_subs` | ri_id | `ri` | set null |
| `maintenance_order_subs` | workshop_id | `workshops` | set null |
| `maintenance_orders` | asset_id | `assets` | cascade |
| `maintenance_orders` | created_by | `users` | set null |
| `maintenance_orders` | reported_by | `employees` | set null |
| `maintenance_orders` | site_id | `sites` | cascade |
| `manufacturing_order_subs` | item_id | `items` | set null |
| `manufacturing_order_subs` | manufacturing_order_id | `manufacturing_orders` | cascade |
| `manufacturing_order_subs` | npbg_id | `npbg` | set null |
| `manufacturing_order_subs` | ri_id | `ri` | set null |
| `manufacturing_order_subs` | serial_unit_id | `serial_units` | set null |
| `manufacturing_orders` | created_by | `users` | set null |
| `manufacturing_orders` | site_id | `sites` | cascade |
| `manufacturing_orders` | vendor_id | `vendors` | set null |
| `mrp_activities` | user_id | `users` | set null |
| `mrp_bom_lines` | item_id | `items` | restrict |
| `mrp_bom_lines` | mrp_bom_id | `mrp_boms` | cascade |
| `mrp_boms` | activated_by | `users` | set null |
| `mrp_boms` | archived_by | `users` | set null |
| `mrp_boms` | created_by | `users` | set null |
| `mrp_boms` | item_id | `items` | restrict |
| `mrp_production_components` | item_id | `items` | restrict |
| `mrp_production_components` | mrp_production_id | `mrp_productions` | cascade |
| `mrp_production_entries` | component_id | `mrp_production_components` | set null |
| `mrp_production_entries` | item_id | `items` | restrict |
| `mrp_production_entries` | mrp_production_id | `mrp_productions` | cascade |
| `mrp_production_entries` | recorded_by | `users` | set null |
| `mrp_production_entries` | voided_by | `users` | set null |
| `mrp_productions` | created_by | `users` | set null |
| `mrp_productions` | item_id | `items` | restrict |
| `mrp_productions` | mrp_bom_id | `mrp_boms` | restrict |
| `mrp_productions` | responsible_id | `users` | set null |
| `npbg` | created_by | `users` | set null |
| `npbg_approvals` | user_id | `users` | set null |
| `npbg_verification_logs` | actor_id | `users` | set null |
| `npbg_verification_logs` | npbg_verification_id | `npbg_verifications` | cascade |
| `npbg_verifications` | decided_by | `users` | set null |
| `npbg_verifications` | npbg_id | `npbg` | cascade |
| `npbg_verifications` | opened_by | `users` | set null |
| `npbg_verifications` | responded_by | `users` | set null |
| `permission_role` | permission_id | `permissions` | cascade |
| `permission_role` | role_id | `roles` | cascade |
| `ppb` | created_by | `users` | set null |
| `ppb_approvals` | user_id | `users` | set null |
| `ppb_draft_lines` | item_id | `items` | set null |
| `ppb_draft_lines` | item_request_line_id | `item_request_lines` | set null |
| `ppb_draft_lines` | ppb_draft_id | `ppb_drafts` | cascade |
| `ppb_draft_lines` | ppb_id | `ppb` | set null |
| `ppb_draft_lines` | saved_draft_id | `ppb_saved_drafts` | set null |
| `ppb_drafts` | created_by | `users` | set null |
| `ppb_drafts` | item_request_id | `item_requests` | set null |
| `ppb_drafts` | submitted_by | `users` | set null |
| `ppb_saved_drafts` | created_by | `users` | set null |
| `projects` | customer_id | `customers` | set null |
| `purchase_order_approvals` | purchase_order_id | `purchase_orders` | cascade |
| `purchase_order_approvals` | user_id | `users` | set null |
| `purchase_order_item_vendors` | created_by | `users` | set null |
| `purchase_order_item_vendors` | purchase_order_item_id | `purchase_order_items` | cascade |
| `purchase_order_item_vendors` | vendor_id | `vendors` | cascade |
| `purchase_order_items` | accurate_ppb_id | `ppb` | set null |
| `purchase_order_items` | approved_ppb_id | `ppb` | set null |
| `purchase_order_items` | item_id | `items` | set null |
| `purchase_order_items` | ppb_item_id | `purchase_proposal_items` | set null |
| `purchase_order_items` | purchase_order_id | `purchase_orders` | cascade |
| `purchase_order_items` | unit_id | `units` | set null |
| `purchase_order_items` | vendor_id | `vendors` | set null |
| `purchase_order_pick_logs` | purchase_order_item_id | `purchase_order_items` | cascade |
| `purchase_order_pick_logs` | user_id | `users` | set null |
| `purchase_order_quote_updates` | purchase_order_item_id | `purchase_order_items` | cascade |
| `purchase_order_quote_updates` | user_id | `users` | set null |
| `purchase_order_quote_updates` | vendor_id | `vendors` | cascade |
| `purchase_order_quotes` | chosen_by | `users` | set null |
| `purchase_order_quotes` | created_by | `users` | set null |
| `purchase_order_quotes` | purchase_order_item_id | `purchase_order_items` | cascade |
| `purchase_order_quotes` | vendor_id | `vendors` |  |
| `purchase_orders` | approved_by | `users` | set null |
| `purchase_orders` | created_by | `users` | set null |
| `purchase_orders` | ppb_id | `purchase_proposals` | set null |
| `purchase_orders` | site_id | `sites` | cascade |
| `purchase_orders` | vendor_id | `vendors` | cascade |
| `purchase_proposal_amendments` | created_by | `users` | set null |
| `purchase_proposal_amendments` | ppb_id | `purchase_proposals` | cascade |
| `purchase_proposal_amendments` | ppb_item_id | `purchase_proposal_items` | set null |
| `purchase_proposal_items` | item_id | `items` | set null |
| `purchase_proposal_items` | ppb_id | `purchase_proposals` | cascade |
| `purchase_proposal_items` | unit_id | `units` | set null |
| `purchase_proposals` | approved_by | `users` | set null |
| `purchase_proposals` | created_by | `users` | set null |
| `purchase_proposals` | department_id | `departments` | set null |
| `purchase_proposals` | requester_id | `users` | set null |
| `purchase_proposals` | site_id | `sites` | cascade |
| `purchase_return_lines` | purchase_return_id | `purchase_returns` | cascade |
| `purchase_return_lines` | ri_id | `ri` | set null |
| `purchase_returns` | created_by | `users` | set null |
| `purchase_returns` | resolved_by | `users` | set null |
| `purchase_returns` | sent_by | `users` | set null |
| `purchase_returns` | vendor_id | `vendors` | set null |
| `receiving_items` | item_id | `items` | set null |
| `receiving_items` | purchase_order_item_id | `purchase_order_items` | set null |
| `receiving_items` | receiving_id | `receivings` | cascade |
| `receiving_items` | unit_id | `units` | set null |
| `receiving_items` | warehouse_id | `warehouses` | cascade |
| `receiving_items` | warehouse_location_id | `warehouse_locations` | set null |
| `receivings` | checked_by | `users` | set null |
| `receivings` | confirmed_by | `users` | set null |
| `receivings` | created_by | `users` | set null |
| `receivings` | ppb_id | `purchase_proposals` | set null |
| `receivings` | purchase_order_id | `purchase_orders` | set null |
| `receivings` | site_id | `sites` | cascade |
| `receivings` | vendor_id | `vendors` | set null |
| `receivings` | warehouse_id | `warehouses` | cascade |
| `record_notes` | updated_by | `users` | set null |
| `ri` | accurate_po_item_id | `purchase_order_items` | set null |
| `ri` | created_by | `users` | set null |
| `ri` | vendor_id | `vendors` | set null |
| `role_user` | role_id | `roles` | cascade |
| `role_user` | user_id | `users` | cascade |
| `serial_units` | item_id | `items` | set null |
| `stock_adjustments` | approved_by | `users` | set null |
| `stock_adjustments` | created_by | `users` | set null |
| `stock_adjustments` | item_id | `items` | cascade |
| `stock_adjustments` | stock_movement_id | `stock_movements` | set null |
| `stock_adjustments` | stock_opname_item_id | `stock_opname_items` | set null |
| `stock_adjustments` | warehouse_id | `warehouses` | cascade |
| `stock_card_entries` | created_by | `users` | set null |
| `stock_card_entries` | share_link_id | `stock_card_share_links` | set null |
| `stock_card_entries` | stock_card_id | `stock_cards` | cascade |
| `stock_card_share_links` | created_by | `users` | set null |
| `stock_card_share_links` | project_id | `projects` | cascade |
| `stock_cards` | created_by | `users` | set null |
| `stock_cards` | item_id | `items` | cascade |
| `stock_cards` | project_id | `projects` | restrict |
| `stock_cards` | updated_by | `users` | set null |
| `stock_movements` | created_by | `users` | set null |
| `stock_movements` | item_id | `items` | cascade |
| `stock_movements` | warehouse_id | `warehouses` | cascade |
| `stock_opname_items` | item_id | `items` | cascade |
| `stock_opname_items` | stock_opname_id | `stock_opnames` | cascade |
| `stock_opname_items` | warehouse_id | `warehouses` | cascade |
| `stock_opname_items` | warehouse_location_id | `warehouse_locations` | set null |
| `stock_opnames` | counted_by | `users` | set null |
| `stock_opnames` | created_by | `users` | set null |
| `stock_opnames` | reviewed_by | `users` | set null |
| `stock_opnames` | site_id | `sites` | cascade |
| `stock_opnames` | warehouse_id | `warehouses` | cascade |
| `stpp_maintenance_logs` | created_by | `users` | set null |
| `stpp_maintenance_logs` | npbg_id | `npbg` | set null |
| `stpp_transactions` | created_by | `users` | set null |
| `stpp_transactions` | holder_id | `employees` | set null |
| `stpp_transactions` | item_id | `items` | set null |
| `stpp_transactions` | out_npbg_id | `npbg` | set null |
| `stpp_transactions` | placement_department_id | `departments` | set null |
| `stpp_transactions` | return_ri_id | `receivings` | set null |
| `stpp_transactions` | serial_unit_id | `serial_units` | set null |
| `stpp_transactions` | unit_id | `units` | set null |
| `sync_batches` | created_by | `users` | set null |
| `sync_logs` | sync_batch_id | `sync_batches` | cascade |
| `tracking_photos` | uploaded_by | `users` | set null |
| `tyre_bpn_transfers` | npbg_id | `npbg` | set null |
| `tyre_changes` | asset_id | `assets` | cascade |
| `tyre_changes` | created_by | `users` | set null |
| `tyre_changes` | in_ri_id | `ri` | set null |
| `tyre_changes` | new_serial_unit_id | `serial_units` | set null |
| `tyre_changes` | old_serial_unit_id | `serial_units` | set null |
| `tyre_changes` | out_npbg_id | `npbg` | set null |
| `units` | uom_category_id | `uom_categories` | set null |
| `update_alert_views` | update_alert_id | `update_alerts` | cascade |
| `update_alert_views` | user_id | `users` | cascade |
| `update_alerts` | created_by | `users` | set null |
| `used_return_component_types` | default_item_id | `items` | set null |
| `used_return_items` | component_type_id | `used_return_component_types` | set null |
| `used_return_items` | item_id | `items` | set null |
| `used_return_items` | unit_id | `units` | set null |
| `used_return_items` | used_return_id | `used_returns` | cascade |
| `used_return_matrix_rows` | created_by | `users` | set null |
| `used_return_matrix_rows` | npbg_id | `npbg` | set null |
| `used_return_other_rows` | created_by | `users` | set null |
| `used_return_other_rows` | npbg_id | `npbg` | set null |
| `used_returns` | created_by | `users` | set null |
| `used_returns` | npbg_id | `npbg` | set null |
| `used_returns` | ri_id | `receivings` | set null |
| `used_returns` | site_id | `sites` | set null |
| `user_preferences` | user_id | `users` | cascade |
| `users` | employee_id | `employees` | set null |
| `users` | site_id | `sites` | set null |
| `vendor_price_histories` | user_id | `users` | set null |
| `vendor_price_histories` | vendor_price_id | `vendor_prices` | cascade |
| `vendor_prices` | base_unit_id | `units` | set null |
| `vendor_prices` | created_by | `users` | set null |
| `vendor_prices` | item_id | `items` |  |
| `vendor_prices` | unit_id | `units` |  |
| `vendor_prices` | updated_by | `users` | set null |
| `vendor_prices` | vendor_id | `vendors` |  |
| `warehouse_gate_links` | created_by | `users` | set null |
| `warehouse_gate_links` | item_request_id | `item_requests` | set null |
| `warehouse_locations` | warehouse_id | `warehouses` | cascade |
| `warehouses` | site_id | `sites` | cascade |
| `workshops` | site_id | `sites` | set null |

## 4. Logical links without a foreign key (Verified from code/migrations)

| From | Column(s) | Logical target | Risk |
|---|---|---|---|
| `npbg_approvals` | `no_npbg` | `npbg.no_npbg` (string, many rows per number) | Renumbering / duplicate numbers break the status; status is derived from the latest log row |
| `ppb_approvals` | `no_ppb` | `ppb.no_ppb` | Same as above; also used for Accurate PPBs |
| `purchase_returns` | `no_ri`, `no_po`, `vendor` | `ri`, `purchase_orders`, `vendors` | Text snapshot only (`vendor_id` FK exists, optional) |
| `ri` | `no_po`, `no_ppb`, `vendor`, `divisi`, `satuan` | `purchase_orders`, `ppb`, `vendors`, `departments`, `units` | Text; FK only for `accurate_po_item_id`, `vendor_id` |
| `npbg` | `pelanggan`, `divisi`, `peminta`, `satuan`, `kode_barang` | `customers`, `departments`, `employees/users`, `units`, `items` | **No item_id FK** — NPBG rows link to items by `kode_barang` text |
| `ppb` | `kode_barang`, `divisi`, `peminta`, `satuan` | `items`, `departments`, `employees`, `units` | **No item_id FK** |
| `item_requests` | `divisi`, `requester_name` | `departments`, `employees` | Text |
| `stock_movements` | `reference_type`, `reference_id` | Npbg, Ri, StockOpname, MrpProduction, DisassemblyOrder … | Polymorphic, no FK |
| `doc_messages`, `doc_activities`, `doc_audit_logs` | `res_type`, `res_key` | 7 document types of `DocumentRegistry` | Polymorphic, string key (doc number for NPBG/PPB/RI) |
| `tracking_photos` | `entity`, `entity_id` | ri, item_request, fulfillment, tracking rows … | Polymorphic |
| `record_notes` | `entity`, `entity_key` | any row | Polymorphic |
| `warehouse_gate_links` | `owner_type/owner_id`, `no_ri` | MO / Disassembly, `ri.no_ri` | Polymorphic + string |
| `vendor_price_histories` | `item_id`, `vendor_id` | items, vendors | Declared as plain unsignedBigInteger |
| `purchase_order_quote_updates` | `item_id` | items | Plain integer |
| `user_activity_logs`, `doc_audit_logs` | `user_id` | users | Intentional (log survives user deletion) |
| `maintenance_orders.asset_id`, `tyre_changes.asset_id` | changed to nullable by `2026_09_29_130000` | assets | FK state after `->change()` should be confirmed on the live DB (**Unknown**) |


## 5. FKs that point at legacy tables (Verified)

- `lend_transactions.return_ri_id` → `receivings` (current equivalent: `ri`)
- `purchase_order_items.ppb_item_id` → `purchase_proposal_items` (current equivalent: `ppb`)
- `purchase_orders.ppb_id` → `purchase_proposals` (current equivalent: `ppb`)
- `stpp_transactions.return_ri_id` → `receivings` (current equivalent: `ri`)
- `used_returns.ri_id` → `receivings` (current equivalent: `ri`)
