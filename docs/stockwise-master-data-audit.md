# STOCKWISE: Audit Master Data

Tanggal audit: 16 November 2026
Lingkup: database produksi `stockwise` (MySQL, dibaca saja), repository `backend/` (Laravel) dan `frontend/` (React), serta `sync-service/`.

Semua nama tabel, kolom, dan angka di dokumen ini diambil langsung dari database produksi lewat `information_schema` dan `COUNT(*)`, serta dari kode di repository. Tidak ada data yang diubah selama audit.

---

## 1. Ringkasan

| Hal | Angka |
|---|---:|
| Tabel di database produksi | **145** |
| Migration yang sudah dijalankan | 129 dari 130 file (yang belum: `2026_11_16_100000_create_vendor_prices`, modul Price List yang belum di-deploy) |
| Tabel mirror/staging Accurate (`accurate_*`) | 20 |
| Tabel master | 26 |
| Tabel transaksi | 62 (+1 data pribadi: sticky notes) |
| Tabel konfigurasi | 9 |
| Tabel log & audit | 18 |
| Tabel framework Laravel | 9 |
| Model Eloquent | 96 (termasuk 2 model Price List yang baru) |
| Controller | 69 |
| Service | 71 |
| Route API | 482 (283 di antaranya dijaga middleware `permission:`) |
| Policy, Job, Event, Listener, Repository | tidak ada |
| File halaman frontend | 68 |

Temuan utama:

1. **Kode barang dan satuan di transaksi sudah konsisten.** Semua `kode_barang` di `npbg` (8.587 baris), `ppb` (2.497), dan `ri` (4.824) cocok dengan `items.code`, dan semua `satuan` cocok dengan `units.code`. Tetapi hubungannya lewat **teks**, bukan foreign key.
2. **UOM belum terkonfigurasi.** `uom_categories` kosong, semua 27 baris `units` tidak punya kategori maupun rasio, dan `item_unit_conversions` kosong. Konversi satuan (misalnya 1 BOX = 10 PCS) belum bisa dipakai di mana pun. Ada juga kode satuan ganda untuk arti yang sama: `C M` / `CM` / `CMS` dan `ROL` / `ROLL`.
3. **Divisi, peminta, dan pelanggan disimpan sebagai teks bebas.** Di `npbg`, 72 dari 87 nilai `divisi` tidak ada di `departments`, 72 dari 203 nama `peminta` tidak ada di `employees`, dan 154 nama `pelanggan` tidak ada satu pun di `customers` (yang isinya hanya 4).
4. **Dua tabel untuk penerimaan barang.** `ri` (4.824 baris, mirror Accurate) dan `receivings` + `receiving_items` (1 baris). Modul tracking merujuk ke keduanya secara tidak konsisten (detail di bagian 6).
5. **Tiga representasi kategori barang.** `categories` (pohon 4 level, 452 baris), `item_category_options` (434 baris), dan kolom teks `items.accurate_category_*`.
6. **Tabel PPB lama tidak terpakai.** `purchase_proposals`, `purchase_proposal_items`, dan `purchase_proposal_amendments` berisi 0 baris, tapi masih dirujuk foreign key dari `purchase_orders`, `purchase_order_items`, dan `receivings`.
7. **Sync Accurate tidak menandai konversi UOM ketika satuan dasar item berubah.** Saat ini belum berdampak karena konversinya masih kosong.
8. **Tidak ada jalur tulis ke Accurate.** `sync-service` membaca backup Firebird dan menulis ke MySQL STOCKWISE, dan backend tidak pernah terhubung langsung ke Firebird.

---

## 2. Master Data yang ditemukan

Kolom **Status**: *Existing* = tabel ada dan dipakai; *Kosong* = tabel ada tetapi belum berisi data; *Tidak ada* = belum ada tabelnya.

### Product & Inventory

| Nama Data | Tabel Database | Baris | Modul Pengguna | Kategori | Status |
|---|---|---:|---|---|---|
| Master Item (Barang & Jasa) | `items` | 9.200 | Inventory, Item Request, Purchase, MRP, Disassembly, Tracking, Stock Card, Price List | Master | Existing. Sumber: Accurate (9.198) dan Excel (2) |
| Alias item | `item_aliases` | 0 | Pencarian item | Master | Kosong |
| Kategori item (pohon) | `categories` | 452 | Inventory (`items.category_id`) | Master | Existing. 243 item tanpa `category_id` |
| Opsi kategori (induk/anak) | `item_category_options` | 434 | Form Master Item, filter | Master | Existing. Tumpang tindih dengan `categories` |
| Kategori dari Accurate (teks) | kolom `items.accurate_category_induk/anak_1/2/3` | — | Filter Inventory, Price List | Master (teks) | Existing. 98 item tanpa induk |
| Satuan (UOM) | `units` | 27 | Semua transaksi bersatuan | Master | Existing. Tanpa kategori dan rasio |
| Kategori UOM | `uom_categories` | 0 | Konversi satuan | Master | **Kosong** |
| Konversi UOM per item | `item_unit_conversions` | 0 | PO, RI, Price List | Master | **Kosong** |
| Safety stock per item | `item_safety_stocks` | 5.357 | Analisis stok | Konfigurasi | Existing |
| Gudang | `warehouses` | 7 | Inventory, Opname, Receiving, MRP | Master | Existing. Semua di site SIG-SDA |
| Lokasi / rak | `warehouse_locations` | 164 | Opname, Receiving, item default | Master | Existing |
| Nomor seri | `serial_units` | 0 | Tracking (STPP, ban, manufaktur) | Master | Kosong |
| Bill of Materials | `mrp_boms`, `mrp_bom_lines` | 0 | MRP, Disassembly | Master | Kosong |
| Tipe komponen barang bekas | `used_return_component_types` | 14 | Used Items | Master | Existing |
| Harga beli per vendor | `vendor_prices` (+ `vendor_price_histories`) | — | Price List, Price Quotation | Master | Kode siap, **belum di-migrate** di produksi |
| Variants / attributes / packaging | — | — | — | — | Tidak ada (dan saat ini tidak dibutuhkan) |

### Contacts

| Nama Data | Tabel Database | Baris | Modul Pengguna | Kategori | Status |
|---|---|---:|---|---|---|
| Vendor / supplier | `vendors` | 315 | PO, RI, Return, Borrow, Manufacturing, Price List | Master | Existing. 310 dari Accurate, 5 demo, tidak ada yang punya `code`, 310 `needs_review` |
| Customer | `customers` | 4 | Lend, Projects | Master | Existing, hampir kosong |
| Proyek | `projects` | 3 | Lend, Stock Card | Master | Existing |
| Kontak Accurate (mentah) | `accurate_persondata` | 583 | Sumber sync vendor | Mirror | Existing. `PERSONTYPE` 0 = 197, 1 = 386 |
| Kategori kontak | — | — | — | — | Tidak ada |

### Human Resources

| Nama Data | Tabel Database | Baris | Modul Pengguna | Kategori | Status |
|---|---|---:|---|---|---|
| Karyawan | `employees` | 221 | Item Request, STPP (holder), Maintenance (reported_by) | Master | Existing. 218 tanpa departemen, 3 terhubung ke user |
| Departemen | `departments` | 19 | Employees, STPP (placement) | Master | Existing. Ada nama ganda: `MGR OPERASIONAL` / `MGR. OPERASIONAL` |
| Jabatan | kolom `employees.position`, `users.position` (teks) | — | — | Master (teks) | Tidak ada tabel |

### Administrasi & Organisasi

| Nama Data | Tabel Database | Baris | Modul Pengguna | Kategori | Status |
|---|---|---:|---|---|---|
| Pengguna | `users` | 17 | Semua | Master | Existing. 14 tanpa `employee_id` |
| Role | `roles`, `role_user` | 9 / 16 | Semua | Master | Existing |
| Permission | `permissions`, `permission_role` | 196 / 540 | Semua | Master | Existing (katalog di `App\Support\Rbac\Rbac`) |
| Cabang / site | `sites` | 2 | Gudang, PO, Opname, Tracking | Master | Existing (SIG-SDA, SIG-BPN) |
| Aset | `assets` | 4 | Maintenance, Tyre | Master | Existing |
| Bengkel | `workshops` | 4 | Maintenance | Master | Existing |
| Perusahaan (multi-company) | — | — | — | — | Tidak ada |
| Penomoran dokumen | `document_sequences` | 26 | RI, STPP, Used Return, PO | Konfigurasi | Existing |

### Referensi akuntansi

| Nama Data | Tabel Database | Status |
|---|---|---|
| Chart of Accounts, Pajak, Termin Pembayaran, Mata Uang | — | **Tidak ada.** Akuntansi tetap di Accurate. `purchase_orders.tax` adalah angka, bukan referensi ke master pajak. |

---

## 3. Transaction Data

| Modul | Tabel | Baris | Master yang dirujuk lewat FK | Rujukan lewat teks |
|---|---|---:|---|---|
| Item Request | `item_requests`, `item_request_lines`, `item_request_approvals`, `item_request_fulfillments`, `item_request_fulfillment_lines`, `item_request_proxies` | 0 | `items`, `users`, `warehouses` | — |
| Delivery Order (NPBG) | `npbg`, `npbg_approvals`, `npbg_verifications` | 8.587 | `users` | `kode_barang`, `satuan`, `divisi`, `peminta`, `pelanggan`, `nama_proyek`, `lokasi_gudang`, `lokasi_rak` |
| Purchase Request (PPB) | `ppb`, `ppb_approvals`, `ppb_drafts`, `ppb_draft_lines`, `ppb_saved_drafts` | 2.497 | `users`, `items` (draft) | `kode_barang`, `satuan`, `divisi`, `peminta` |
| PPB lama | `purchase_proposals`, `purchase_proposal_items`, `purchase_proposal_amendments` | 0 | `departments`, `sites`, `items`, `units` | — |
| Purchase Order & Price Quotation | `purchase_orders`, `purchase_order_items`, `purchase_order_approvals`, `purchase_order_quotes`, `purchase_order_item_vendors` | 1.302 / 2.326 | `vendors`, `items`, `units`, `sites`, `ppb` | — (semua baris PO punya `item_id` dan `unit_id`) |
| Receipt (RI) | `ri` | 4.824 | `vendors`, `purchase_order_items` | `kode_barang`, `satuan`, `vendor` (teks, di samping `vendor_id`), `divisi`, `lokasi_gudang`, `lokasi_rak`, `pemeriksa` |
| Receiving (STOCKWISE) | `receivings`, `receiving_items` | 1 / 1 | `vendors`, `items`, `units`, `warehouses`, `warehouse_locations` | — |
| Purchase Return | `purchase_returns`, `purchase_return_lines` | 0 | `vendors`, `ri` | — |
| Stok & ledger | `inventory`, `stock_movements`, `stock_adjustments`, `inventory_snapshots`, `inventory_analysis_runs` | 9.200 / 7.575 / 0 / 9.200 / 9 | `items`, `warehouses` | — |
| Physical Inventory | `stock_opnames`, `stock_opname_items` | 2.547 / 2.797 | `warehouses`, `warehouse_locations`, `items`, `sites` | — |
| Kartu Stok Proyek | `stock_cards`, `stock_card_entries` | 0 | `items`, `projects` | — |
| Manufacturing (MRP) | `mrp_productions`, `mrp_production_components`, `mrp_production_entries` | 0 | `items`, `mrp_boms` | — |
| Disassembly | `disassembly_orders`, `disassembly_components`, `disassembly_entries` | 0 | `items`, `warehouses`, `mrp_boms` | — |
| Tracking | `lend_transactions`, `borrow_transactions`, `stpp_transactions`, `tyre_changes`, `tyre_bpn_inventory`, `tyre_bpn_transfers`, `maintenance_orders`, `maintenance_order_subs`, `manufacturing_orders`, `manufacturing_order_subs`, `used_returns`, `used_return_items`, `used_return_matrix_rows`, `used_return_other_rows`, `tracking_photos` | STPP 189, Used Returns 1.019, lainnya 0 | `items`, `units`, `vendors`, `customers`, `projects`, `employees`, `departments`, `assets`, `workshops`, `serial_units`, `npbg`, `ri`, `receivings` | — |
| Important Request (Tasks) | `important_requests` + 4 tabel anak | 0 | `users` | — |
| Price List | `vendor_prices` | — | `items`, `vendors`, `units` | — (belum di produksi) |
| IT Helpdesk | — | — | — | **Tidak ada.** Ikon "Helpdesk" di launcher saat ini hanya membuka halaman Panduan. |

Saldo stok resmi tetap mengikuti Accurate: `items.accurate_qty_onhand` dan `accurate_qty_onorder` diisi sync, dan `inventory` diisi saldo awal dari angka itu (`seedOpeningBalanceIfMissing` di `AccurateSyncService`). Perubahan stok di STOCKWISE dicatat lewat `StockLedgerService`.

---

## 4. Configuration Data

| Data | Tabel | Baris | Keterangan |
|---|---|---:|---|
| Pengaturan sistem | `app_settings` | 0 | Key-value (misalnya auto refresh) |
| Penomoran dokumen | `document_sequences` | 26 | Per `doc_type` + prefix + tahun + bulan |
| Preferensi pengguna | `user_preferences` | 1 | Tata letak dashboard, urutan ikon launcher |
| Pengumuman fitur | `update_alerts` | 0 | Popup "Update Alert" |
| Label IP Accurate | `accurate_ip_labels` | 0 | Untuk monitor sesi Accurate |
| Link berbagi | `item_request_links`, `stock_card_share_links`, `warehouse_gate_links` | 0 | Formulir / akses publik |
| Safety stock | `item_safety_stocks` | 5.357 | Per item |
| Alur persetujuan | kode, bukan tabel | — | Ditulis di service (`PpbApprovalService`, `ItemRequestApprovalService`, `NpbgApprovalService`). Tidak bisa diatur dari layar. |
| Pengaturan notifikasi | — | — | Tidak ada. Notifikasi dikirim oleh `NotificationDispatcher` tanpa preferensi per user. |

---

## 5. Log & Audit Data

| Data | Tabel | Baris | Keterangan |
|---|---|---:|---|
| Aktivitas pengguna (login, halaman, transaksi) | `user_activity_logs` | 223 | |
| Sync Accurate | `sync_batches`, `sync_logs` | 57 / **1.321.918** | `sync_logs` berukuran sekitar 216 MB dan tidak punya kebijakan retensi |
| Chatter dokumen | `doc_messages`, `doc_message_attachments`, `doc_activities`, `doc_audit_logs` | 0 | Dipakai di detail Item Request, NPBG, PPB, PPB Draft, PO, RI, Purchase Return |
| Catatan per baris | `record_notes` | 0 | Kolom "Notes" di tabel |
| Riwayat modul | `mrp_activities`, `disassembly_activities`, `important_request_activities`, `important_request_reads`, `npbg_verification_logs`, `stpp_maintenance_logs` | ≤ 7 | |
| Riwayat harga | `purchase_order_quote_updates`, `purchase_order_pick_logs`, `vendor_price_histories` (belum di produksi) | 0 | |
| Notifikasi | `notifications`, `update_alert_views` | 0 | |
| Riwayat login | kolom `users.last_login_at` / `last_logout_at` dan `user_activity_logs` | — | Tidak ada tabel khusus |

---

## 6. Data duplikat atau berpotensi duplikat

| # | Temuan | Bukti | Risiko |
|---|---|---|---|
| D1 | Satuan ganda | `units`: `C M`, `CM`, `CMS` (semua "Centimeter"); `ROL` dan `ROLL` | Satu satuan tercatat dengan dua kode, sehingga laporan dan konversi bisa terpecah |
| D2 | UOM tanpa kategori | `uom_categories` = 0, semua `units.uom_category_id` NULL, `item_unit_conversions` = 0 | Konversi satuan tidak bisa dipakai. Price List hanya bisa memakai satuan dasar item. |
| D3 | Dua tabel penerimaan | `ri` (4.824) dan `receivings` (1). FK tracking: `borrow_transactions.in_ri_id`, `tyre_changes.in_ri_id`, `maintenance_order_subs.ri_id`, `manufacturing_order_subs.ri_id` merujuk ke `ri`; sedangkan `lend_transactions.return_ri_id`, `stpp_transactions.return_ri_id`, `used_returns.ri_id` merujuk ke `receivings` | Satu konsep "penerimaan" punya dua sumber, sehingga ada rujukan yang mengarah ke tabel yang hampir kosong |
| D4 | Tiga sumber kategori | `categories` (452), `item_category_options` (434), `items.accurate_category_*` (teks) | Filter dan form bisa membaca sumber yang berbeda. 243 item tanpa `category_id`. |
| D5 | PPB lama | `purchase_proposals*` (0 baris) masih dirujuk `purchase_orders.ppb_id`, `purchase_order_items.ppb_item_id`, `receivings.ppb_id` | Kebingungan antara `ppb` (yang dipakai) dan `purchase_proposals` (yang lama) |
| D6 | Divisi teks dan departemen | `npbg.divisi`: 87 nilai, 72 tidak ada di `departments`. `ppb.divisi`: 2 nilai, keduanya tidak ada. `departments` punya `MGR OPERASIONAL` / `MGR. OPERASIONAL`, `DIREKTUR` / `DIREKTUR (SIG)`, `DISTRIBUSI` / `Distribusi Tabung` | Laporan per divisi tidak bisa digabung dengan master departemen |
| D7 | Peminta teks dan karyawan | `npbg.peminta`: 72 dari 203 nama tidak ada di `employees`; `ppb.peminta`: 10 dari 58 | Riwayat permintaan per karyawan tidak bisa dihitung dari master |
| D8 | Pelanggan teks dan customer | `npbg.pelanggan`: 154 nama, 0 ada di `customers` (isi 4); `accurate_persondata` punya 197 baris `PERSONTYPE` 0 | Master customer belum diisi dari Accurate |
| D9 | Vendor tanpa kode | 315 vendor, 0 punya `code`, 310 `needs_review`; nama mirip: `CV. TEKAD JAYA MANDIRI` / `PT. TEKAD JAYA MANDIRI` | Pencocokan vendor bergantung pada nama (`vendors.name` unik), padahal Accurate punya `PERSONNO` |
| D10 | Vendor teks di RI | `ri.vendor` (teks, 295 nilai) disimpan di samping `ri.vendor_id` (semua terisi) | Teks dan ID bisa berbeda kalau nama vendor diubah. Sebagai snapshot historis ini wajar. |
| D11 | Karyawan dan user dua arah | `users.employee_id` dan `employees.user_id`. Saat ini 0 tidak cocok, tetapi hanya 3 yang terhubung. | Dua kolom untuk satu relasi bisa bertolak belakang |
| D12 | Nama item ganda | 48 grup `description_normalized` sama (96 item) | Kemungkinan item duplikat di Accurate. Perlu dicek oleh pemilik data, jangan dihapus otomatis. |
| D13 | Item tanpa satuan | 65 item `unit_id` NULL | Item ini tidak bisa diberi konversi atau harga Price List |

---

## 7. Backend

- **Model:** 96 model Eloquent, satu per tabel bisnis. Tidak ada model untuk tabel `accurate_*` (ditulis oleh `StagingTableWriter`) maupun untuk `item_category_options`.
- **Sumber data master per modul:**
  - Item: `ItemController`, `ItemSmartSearch`, `ItemRecommender`
  - Vendor: `VendorController` dan `AccurateSyncService::vendor()` (`Vendor::firstOrCreate` berdasarkan nama)
  - Karyawan dan departemen: `EmployeeController`
  - Gudang, lokasi, site, kategori, satuan, customer, proyek, bengkel, aset: `MasterDataController` (hanya baca)
  - UOM: `UomController` dan `UomConverter`
- **Validasi:** hanya 3 Form Request (`LoginRequest`, `StoreItemRequest`, `UpdateItemRequest`). Validasi lain ditulis langsung di controller (`$request->validate`).
- **Otorisasi:** lewat middleware `permission:` di route dan katalog `App\Support\Rbac\Rbac`. Tidak ada Policy.
- **Proses latar:** tidak ada Job, Event, atau Listener. Sync berjalan dari agen (`sync-service`) yang mengirim data ke `AccurateIngestController`.
- **Import/export:** `DatasetExporter`, `LegacyExcelExportService`, `DocumentPdfWriter`, importer Excel untuk tracking, dan command `stockwise:import`.
- **Integrasi Accurate:**
  - `sync-service` membaca backup Firebird dan menulis ke tabel `accurate_*` serta ke tabel STOCKWISE.
  - `AccurateSyncService` memetakan mirror tersebut ke `items`, `vendors`, `npbg`, `ppb`, `ri`, dan `purchase_orders`.
  - Tidak ditemukan kode yang menulis ke Accurate/Firebird.
  - **Gap:** saat satuan dasar item berubah (`items.unit_id`, `AccurateSyncService.php` baris 682–684), konversi di `item_unit_conversions` tidak ditandai untuk ditinjau.

## 8. Frontend

- **Halaman:** 68 file halaman, dibuka lewat App Launcher (`lib/launcher.ts`) dan menu per app (`lib/navigation.ts`). Menu disaring dengan permission (`visibleNav`).
- **Halaman master yang sudah ada:**
  - Barang & Jasa (`ItemsPage`), Kategori Barang (`ItemCategoriesPage`), UOM (`UomPage`): app Inventory
  - Vendor (`VendorsPage`): app Purchase
  - Pekerja + departemen (`EmployeesPage`): app Employees
  - Users, Roles (`UsersPage`, `RolesPage`): app Settings
- **Master yang punya API tapi belum punya halaman:** Gudang, Lokasi, Site, Customer, Proyek, Bengkel, Aset.
- **Pemilih master di form:** `ItemPicker` (16 file), `useVendors` (6), `useEmployees` (1), `useWarehouses` (1), `useUnits` (1), `CategoryPicker` (1), `AssetPicker` (1).
- **Field divisi dan peminta:** muncul di 24 file. Sebagian besar menampilkan teks dari Accurate, bukan pilihan dari master.
- **Pola Odoo yang sudah ada:** App Launcher, menu per app, list + filter + pagination, chatter di detail transaksi.
- **Pola Odoo yang belum ada:** Group By, form view yang seragam untuk master, chatter atau riwayat perubahan di master.

---

## Lampiran A: Seluruh tabel database (145)

Dibuat otomatis dari `information_schema` database produksi pada tanggal audit. "Baris" adalah hasil `COUNT(*)`.

### Data pribadi pengguna (sticky notes) (1 tabel)

| Tabel | Baris | Foreign key (kolom->tabel) | Unique |
|---|---:|---|---|
| `dashboard_notes` | 1 | user_id->users | - |

### Framework Laravel (9 tabel)

| Tabel | Baris | Foreign key (kolom->tabel) | Unique |
|---|---:|---|---|
| `cache` | 0 | - | - |
| `cache_locks` | 0 | - | - |
| `failed_jobs` | 0 | - | uuid |
| `job_batches` | 0 | - | - |
| `jobs` | 0 | - | - |
| `migrations` | 129 | - | - |
| `password_reset_tokens` | 0 | - | - |
| `personal_access_tokens` | 233 | - | token |
| `sessions` | 0 | - | - |

### Konfigurasi (8 tabel)

| Tabel | Baris | Foreign key (kolom->tabel) | Unique |
|---|---:|---|---|
| `accurate_ip_labels` | 0 | updated_by->users | ip |
| `app_settings` | 0 | - | - |
| `document_sequences` | 26 | - | doc_type,prefix,year,month |
| `item_request_links` | 0 | created_by->users | token |
| `stock_card_share_links` | 0 | created_by->users, project_id->projects | token |
| `update_alerts` | 0 | created_by->users | - |
| `user_preferences` | 1 | user_id->users | user_id,key |
| `warehouse_gate_links` | 0 | created_by->users, item_request_id->item_requests | no_ri |

### Konfigurasi (per item) (1 tabel)

| Tabel | Baris | Foreign key (kolom->tabel) | Unique |
|---|---:|---|---|
| `item_safety_stocks` | 5,357 | item_id->items | - |

### Log & Audit (18 tabel)

| Tabel | Baris | Foreign key (kolom->tabel) | Unique |
|---|---:|---|---|
| `disassembly_activities` | 0 | disassembly_order_id->disassembly_orders, user_id->users | - |
| `doc_activities` | 0 | assignee_id->users, cancelled_by->users, created_by->users, done_by->users | - |
| `doc_audit_logs` | 0 | - | - |
| `doc_message_attachments` | 0 | doc_message_id->doc_messages, uploaded_by->users | - |
| `doc_messages` | 0 | deleted_by->users, user_id->users | - |
| `important_request_activities` | 0 | important_request_id->important_requests, user_id->users | - |
| `important_request_reads` | 0 | important_request_id->important_requests, user_id->users | important_request_id,user_id |
| `mrp_activities` | 0 | user_id->users | - |
| `notifications` | 0 | - | - |
| `npbg_verification_logs` | 7 | actor_id->users, npbg_verification_id->npbg_verifications | - |
| `purchase_order_pick_logs` | 0 | purchase_order_item_id->purchase_order_items, user_id->users | - |
| `purchase_order_quote_updates` | 0 | purchase_order_item_id->purchase_order_items, user_id->users, vendor_id->vendors | - |
| `record_notes` | 0 | updated_by->users | entity,entity_key |
| `stpp_maintenance_logs` | 0 | created_by->users, npbg_id->npbg | - |
| `sync_batches` | 57 | created_by->users | sync_code |
| `sync_logs` | 1,321,918 | sync_batch_id->sync_batches | - |
| `update_alert_views` | 0 | update_alert_id->update_alerts, user_id->users | user_id,update_alert_id |
| `user_activity_logs` | 223 | - | - |

### Master - Administrasi / Organisasi (8 tabel)

| Tabel | Baris | Foreign key (kolom->tabel) | Unique |
|---|---:|---|---|
| `assets` | 4 | site_id->sites | code |
| `permission_role` | 540 | permission_id->permissions, role_id->roles | - |
| `permissions` | 196 | - | slug |
| `role_user` | 16 | role_id->roles, user_id->users | - |
| `roles` | 9 | - | slug |
| `sites` | 2 | - | code |
| `users` | 17 | employee_id->employees, site_id->sites | email; username |
| `workshops` | 4 | site_id->sites | name |

### Master - Contacts (3 tabel)

| Tabel | Baris | Foreign key (kolom->tabel) | Unique |
|---|---:|---|---|
| `customers` | 4 | - | name |
| `projects` | 3 | customer_id->customers | - |
| `vendors` | 315 | - | name |

### Master - HR (2 tabel)

| Tabel | Baris | Foreign key (kolom->tabel) | Unique |
|---|---:|---|---|
| `departments` | 19 | - | name |
| `employees` | 221 | department_id->departments, site_id->sites, user_id->users | name_normalized,department_id |

### Master - Product & Inventory (13 tabel)

| Tabel | Baris | Foreign key (kolom->tabel) | Unique |
|---|---:|---|---|
| `categories` | 452 | parent_id->categories | parent_id,name |
| `item_aliases` | 0 | created_by->users, item_id->items | alias_normalized |
| `item_category_options` | 434 | - | level,name |
| `item_unit_conversions` | 0 | created_by->users, item_id->items, unit_id->units | item_id,unit_id |
| `items` | 9,200 | category_id->categories, default_location_id->warehouse_locations, default_warehouse_id->warehouses, unit_id->units | code |
| `mrp_bom_lines` | 0 | item_id->items, mrp_bom_id->mrp_boms | mrp_bom_id,item_id |
| `mrp_boms` | 0 | activated_by->users, archived_by->users, created_by->users, item_id->items | code; item_id,revision |
| `serial_units` | 0 | item_id->items | serial_no,kind |
| `units` | 27 | uom_category_id->uom_categories | code |
| `uom_categories` | 0 | - | name |
| `used_return_component_types` | 14 | default_item_id->items | code |
| `warehouse_locations` | 164 | warehouse_id->warehouses | warehouse_id,code |
| `warehouses` | 7 | site_id->sites | site_id,code |

### Mirror / staging Accurate (20 tabel)

| Tabel | Baris | Foreign key (kolom->tabel) | Unique |
|---|---:|---|---|
| `accurate_apinv` | 2,299 | - | - |
| `accurate_apitmdet` | 4,824 | - | - |
| `accurate_arinv` | 3,465 | - | - |
| `accurate_arinvdet` | 8,587 | - | - |
| `accurate_custtype` | 1 | - | - |
| `accurate_itadjdet` | 2,798 | - | - |
| `accurate_item` | 9,619 | - | - |
| `accurate_itemadj` | 2,547 | - | - |
| `accurate_itembalance` | 5,656 | - | - |
| `accurate_itembalancewarehouse` | 0 | - | - |
| `accurate_itemcategory` | 0 | - | - |
| `accurate_itemhist` | 16,209 | - | - |
| `accurate_persondata` | 583 | - | - |
| `accurate_po` | 1,302 | - | - |
| `accurate_podet` | 2,325 | - | - |
| `accurate_requisition` | 430 | - | - |
| `accurate_requisitiondet` | 2,497 | - | - |
| `accurate_so` | 69 | - | - |
| `accurate_sodet` | 667 | - | - |
| `accurate_warehs` | 1 | - | - |

### Transaksi - Delivery Order (NPBG) (3 tabel)

| Tabel | Baris | Foreign key (kolom->tabel) | Unique |
|---|---:|---|---|
| `npbg` | 8,587 | created_by->users | accurate_arinvoice_id,accurate_seq |
| `npbg_approvals` | 0 | user_id->users | - |
| `npbg_verifications` | 1 | decided_by->users, npbg_id->npbg, opened_by->users, responded_by->users | - |

### Transaksi - Disassembly (3 tabel)

| Tabel | Baris | Foreign key (kolom->tabel) | Unique |
|---|---:|---|---|
| `disassembly_components` | 0 | disassembly_order_id->disassembly_orders, item_id->items | disassembly_order_id,item_id |
| `disassembly_entries` | 0 | component_id->disassembly_components, disassembly_order_id->disassembly_orders, item_id->items, recorded_by->users, voided_by->users | client_key |
| `disassembly_orders` | 0 | accurate_recorded_by->users, cancelled_by->users, confirmed_by->users, created_by->users, dest_warehouse_id->warehouses, done_by->users, finished_by->users, item_id->items, mrp_bom_id->mrp_boms, responsible_id->users, reversed_by->users, source_warehouse_id->warehouses, started_by->users | number |

### Transaksi - Important Request (Tasks) (5 tabel)

| Tabel | Baris | Foreign key (kolom->tabel) | Unique |
|---|---:|---|---|
| `important_request_assignees` | 0 | important_request_id->important_requests, user_id->users | important_request_id,user_id |
| `important_request_attachments` | 0 | comment_id->important_request_comments, deleted_by->users, important_request_id->important_requests, submission_id->important_request_submissions, uploaded_by->users | - |
| `important_request_comments` | 0 | important_request_id->important_requests, parent_id->important_request_comments, user_id->users | - |
| `important_request_submissions` | 0 | assignee_id->important_request_assignees, important_request_id->important_requests, reviewed_by->users, user_id->users | - |
| `important_requests` | 0 | created_by->users | number |

### Transaksi - Item Request (6 tabel)

| Tabel | Baris | Foreign key (kolom->tabel) | Unique |
|---|---:|---|---|
| `item_request_approvals` | 0 | item_request_id->item_requests, user_id->users | - |
| `item_request_fulfillment_lines` | 0 | item_request_fulfillment_id->item_request_fulfillments, item_request_line_id->item_request_lines, npbg_id->npbg, warehouse_id->warehouses | - |
| `item_request_fulfillments` | 0 | handed_by->users, item_request_id->item_requests, prepared_by->users | item_request_id,seq |
| `item_request_lines` | 0 | closed_by->users, decided_by->users, item_id->items, item_request_id->item_requests, npbg_id->npbg, ppb_draft_id->ppb_drafts, ppb_id->ppb | - |
| `item_request_proxies` | 0 | item_request_fulfillment_id->item_request_fulfillments, item_request_id->item_requests, used_by->users | - |
| `item_requests` | 0 | entered_by->users, handed_over_by->users, link_id->item_request_links, processed_by->users, requester_id->users | number; track_token |

### Transaksi - Kartu Stok Proyek (2 tabel)

| Tabel | Baris | Foreign key (kolom->tabel) | Unique |
|---|---:|---|---|
| `stock_card_entries` | 0 | created_by->users, share_link_id->stock_card_share_links, stock_card_id->stock_cards | - |
| `stock_cards` | 0 | created_by->users, item_id->items, project_id->projects, updated_by->users | project_id,card_number; project_id,item_id |

### Transaksi - Manufacturing (MRP) (3 tabel)

| Tabel | Baris | Foreign key (kolom->tabel) | Unique |
|---|---:|---|---|
| `mrp_production_components` | 0 | item_id->items, mrp_production_id->mrp_productions | mrp_production_id,item_id |
| `mrp_production_entries` | 0 | component_id->mrp_production_components, item_id->items, mrp_production_id->mrp_productions, recorded_by->users, voided_by->users | client_key |
| `mrp_productions` | 0 | accurate_recorded_by->users, cancelled_by->users, confirmed_by->users, created_by->users, done_by->users, finished_by->users, item_id->items, mrp_bom_id->mrp_boms, responsible_id->users, reversed_by->users, started_by->users | number |

### Transaksi - Physical Inventory (2 tabel)

| Tabel | Baris | Foreign key (kolom->tabel) | Unique |
|---|---:|---|---|
| `stock_opname_items` | 2,797 | item_id->items, stock_opname_id->stock_opnames, warehouse_id->warehouses, warehouse_location_id->warehouse_locations | stock_opname_id,item_id |
| `stock_opnames` | 2,547 | counted_by->users, created_by->users, reviewed_by->users, site_id->sites, warehouse_id->warehouses | accurate_itemadj_id; number |

### Transaksi - PPB lama (legacy, 0 baris) (3 tabel)

| Tabel | Baris | Foreign key (kolom->tabel) | Unique |
|---|---:|---|---|
| `purchase_proposal_amendments` | 0 | created_by->users, ppb_id->purchase_proposals, ppb_item_id->purchase_proposal_items | - |
| `purchase_proposal_items` | 0 | item_id->items, ppb_id->purchase_proposals, unit_id->units | - |
| `purchase_proposals` | 0 | approved_by->users, created_by->users, department_id->departments, requester_id->users, site_id->sites | number; prefix,year,month,sequence |

### Transaksi - Purchase Order / Price Quotation (5 tabel)

| Tabel | Baris | Foreign key (kolom->tabel) | Unique |
|---|---:|---|---|
| `purchase_order_approvals` | 0 | purchase_order_id->purchase_orders, user_id->users | - |
| `purchase_order_item_vendors` | 0 | created_by->users, purchase_order_item_id->purchase_order_items, vendor_id->vendors | purchase_order_item_id,vendor_id |
| `purchase_order_items` | 2,326 | accurate_ppb_id->ppb, approved_ppb_id->ppb, item_id->items, ppb_item_id->purchase_proposal_items, purchase_order_id->purchase_orders, unit_id->units, vendor_id->vendors | - |
| `purchase_order_quotes` | 0 | chosen_by->users, created_by->users, purchase_order_item_id->purchase_order_items, vendor_id->vendors | purchase_order_item_id,vendor_id |
| `purchase_orders` | 1,302 | approved_by->users, created_by->users, ppb_id->purchase_proposals, site_id->sites, vendor_id->vendors | accurate_po_id; number; prefix,year,month,sequence |

### Transaksi - Purchase Request (PPB) (5 tabel)

| Tabel | Baris | Foreign key (kolom->tabel) | Unique |
|---|---:|---|---|
| `ppb` | 2,497 | created_by->users | accurate_reqid,accurate_seq |
| `ppb_approvals` | 0 | user_id->users | - |
| `ppb_draft_lines` | 0 | item_id->items, item_request_line_id->item_request_lines, ppb_draft_id->ppb_drafts, ppb_id->ppb, saved_draft_id->ppb_saved_drafts | - |
| `ppb_drafts` | 0 | created_by->users, item_request_id->item_requests, submitted_by->users | number |
| `ppb_saved_drafts` | 0 | created_by->users | - |

### Transaksi - Purchase Return (2 tabel)

| Tabel | Baris | Foreign key (kolom->tabel) | Unique |
|---|---:|---|---|
| `purchase_return_lines` | 0 | purchase_return_id->purchase_returns, ri_id->ri | - |
| `purchase_returns` | 0 | created_by->users, resolved_by->users, sent_by->users, vendor_id->vendors | number |

### Transaksi - Receipt (RI, mirror Accurate) (1 tabel)

| Tabel | Baris | Foreign key (kolom->tabel) | Unique |
|---|---:|---|---|
| `ri` | 4,824 | accurate_po_item_id->purchase_order_items, created_by->users, vendor_id->vendors | accurate_apinvoice_id,accurate_seq |

### Transaksi - Receiving (versi STOCKWISE) (2 tabel)

| Tabel | Baris | Foreign key (kolom->tabel) | Unique |
|---|---:|---|---|
| `receiving_items` | 1 | item_id->items, purchase_order_item_id->purchase_order_items, receiving_id->receivings, unit_id->units, warehouse_id->warehouses, warehouse_location_id->warehouse_locations | - |
| `receivings` | 1 | checked_by->users, confirmed_by->users, created_by->users, ppb_id->purchase_proposals, purchase_order_id->purchase_orders, site_id->sites, vendor_id->vendors, warehouse_id->warehouses | number; prefix,year,month,sequence |

### Transaksi - Stok / Ledger (5 tabel)

| Tabel | Baris | Foreign key (kolom->tabel) | Unique |
|---|---:|---|---|
| `inventory` | 9,200 | item_id->items, warehouse_id->warehouses | item_id,warehouse_id |
| `inventory_analysis_runs` | 9 | triggered_by->users | - |
| `inventory_snapshots` | 9,200 | analysis_run_id->inventory_analysis_runs, item_id->items, warehouse_id->warehouses | item_id,warehouse_id |
| `stock_adjustments` | 0 | approved_by->users, created_by->users, item_id->items, stock_movement_id->stock_movements, stock_opname_item_id->stock_opname_items, warehouse_id->warehouses | - |
| `stock_movements` | 7,575 | created_by->users, item_id->items, warehouse_id->warehouses | - |

### Transaksi - Tracking (15 tabel)

| Tabel | Baris | Foreign key (kolom->tabel) | Unique |
|---|---:|---|---|
| `borrow_transactions` | 0 | created_by->users, in_ri_id->ri, item_id->items, lender_vendor_id->vendors, return_npbg_id->npbg, unit_id->units | in_ri_id; number |
| `lend_transactions` | 0 | created_by->users, customer_id->customers, item_id->items, out_npbg_id->npbg, project_id->projects, return_ri_id->receivings, unit_id->units | number; out_npbg_id |
| `maintenance_order_subs` | 0 | maintenance_order_id->maintenance_orders, npbg_id->npbg, ri_id->ri, workshop_id->workshops | - |
| `maintenance_orders` | 0 | asset_id->assets, created_by->users, reported_by->employees, site_id->sites | number |
| `manufacturing_order_subs` | 0 | item_id->items, manufacturing_order_id->manufacturing_orders, npbg_id->npbg, ri_id->ri, serial_unit_id->serial_units | - |
| `manufacturing_orders` | 0 | created_by->users, site_id->sites, vendor_id->vendors | number |
| `stpp_transactions` | 189 | created_by->users, holder_id->employees, item_id->items, out_npbg_id->npbg, placement_department_id->departments, return_ri_id->receivings, serial_unit_id->serial_units, unit_id->units | number |
| `tracking_photos` | 0 | uploaded_by->users | entity,entity_id,slot |
| `tyre_bpn_inventory` | 0 | - | - |
| `tyre_bpn_transfers` | 0 | npbg_id->npbg | - |
| `tyre_changes` | 0 | asset_id->assets, created_by->users, in_ri_id->ri, new_serial_unit_id->serial_units, old_serial_unit_id->serial_units, out_npbg_id->npbg | out_npbg_id,change_seq |
| `used_return_items` | 2,536 | component_type_id->used_return_component_types, item_id->items, unit_id->units, used_return_id->used_returns | - |
| `used_return_matrix_rows` | 0 | created_by->users, npbg_id->npbg | - |
| `used_return_other_rows` | 0 | created_by->users, npbg_id->npbg | - |
| `used_returns` | 1,019 | created_by->users, npbg_id->npbg, ri_id->receivings, site_id->sites | accurate_apinvoice_id; number |
