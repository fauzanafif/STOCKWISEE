# STOCKWISE: Arsitektur Master Data Terpusat

Dasar: [audit](stockwise-master-data-audit.md) dan [analisis gap](stockwise-odoo-gap-analysis.md).

Prinsip: **satu master, banyak modul.** Setiap konsep punya satu tabel master dan satu sumber kebenaran. Transaksi merujuk lewat ID dan tetap menyimpan snapshot teks untuk keperluan histori.

Rancangan ini **memakai tabel yang sudah ada**. Hanya satu tabel baru yang diusulkan (alias divisi), dan semua kolom baru bersifat tambahan dan nullable. Tidak ada tabel yang diganti nama atau dihapus.

---

## 1. Master dan sumber kebenarannya

| Master | Tabel (sudah ada) | Sumber kebenaran | Kunci pencocokan dengan Accurate | Dipakai modul |
|---|---|---|---|---|
| Item / Produk | `items` | Accurate (`accurate_item`) | `items.code` = `ITEMNO` | Inventory, Item Request, NPBG, PPB, PO, RI, Opname, MRP, Disassembly, Tracking, Stock Card, Price List |
| Satuan (UOM) | `units` | Kode dari Accurate (`UNIT1`), kategori dan rasio dari STOCKWISE | `units.code` | Semua transaksi bersatuan |
| Kategori UOM | `uom_categories` | STOCKWISE | — | Konversi |
| Konversi satuan per item | `item_unit_conversions` | STOCKWISE (lokal, tidak pernah ditimpa sync) | — | PO, RI, Price List |
| Kategori item | `items.accurate_category_*` (diusulkan resmi, **perlu keputusan**) | Accurate | `PARENTITEM` | Filter, laporan |
| Gudang | `warehouses` | Accurate (`accurate_warehs`) dan STOCKWISE | `WAREHOUSEID` | Inventory, Opname, Receiving, MRP, Disassembly |
| Lokasi / rak | `warehouse_locations` | STOCKWISE | — | Opname, Receiving |
| Cabang | `sites` | STOCKWISE | — | Gudang, PO, Opname, Tracking |
| Vendor | `vendors` | Accurate (`accurate_persondata`) | **Diusulkan:** `vendors.code` = `PERSONNO` (sekarang lewat nama) | PO, Price Quotation, Price List, RI, Return, Borrow, Manufacturing |
| Customer | `customers` | Accurate (`accurate_persondata`) | `customers.code` = `PERSONNO` | NPBG, Lend, Proyek |
| Proyek | `projects` | STOCKWISE | — | Lend, Stock Card |
| Karyawan | `employees` | STOCKWISE | — | Item Request, NPBG, PPB, STPP, Maintenance |
| Departemen | `departments` | STOCKWISE | **Diusulkan:** alias divisi Accurate → departemen | NPBG, PPB, RI, Employees, STPP |
| Pengguna | `users` | STOCKWISE | — | Semua |
| Role & permission | `roles`, `permissions` (katalog `Rbac`) | STOCKWISE (kode) | — | Semua |
| Aset, bengkel | `assets`, `workshops` | STOCKWISE | — | Maintenance, Tyre |
| Harga beli vendor | `vendor_prices` | STOCKWISE | — | Price List, Price Quotation |

Diagram ringkas:

```
                 Accurate (Firebird, hanya dibaca)
                          │  sync-service → tabel accurate_* → AccurateSyncService
        ┌─────────────────┼──────────────────┬───────────────────────┐
        ▼                 ▼                  ▼                       ▼
     items ──unit_id──► units ◄── uom_categories            vendors / customers
       │  ▲                ▲                                        ▲
       │  └ item_unit_conversions (lokal STOCKWISE)                 │ vendor_id / customer_id
       │ item_id                                                    │
       ▼                                                            │
  transaksi: item_requests · npbg · ppb · purchase_order_items · ri · stock_opname_items ·
             mrp_* · disassembly_* · tracking · vendor_prices ──────┘
       │ department_id / employee_id (diusulkan, nullable)
       ▼
  departments ◄── employees ◄── users
```

---

## 2. Aturan

1. **Rujukan internal lewat ID.** Transaksi baru menyimpan `item_id`, `unit_id`, `vendor_id`, dan seterusnya.
2. **Snapshot teks tetap disimpan.** Transaksi tetap menyimpan teks dan rasio saat dokumen dibuat (`kode_barang`, `deskripsi_barang`, `satuan`, `unit_ratio`, `base_satuan`, `ri.vendor`). Mengubah master tidak mengubah histori transaksi. Pola ini sudah dipakai PO (`unit_ratio`, `base_unit`) dan Price List (`unit_ratio`).
3. **Mirror Accurate: ID ditambahkan, teks tidak diganti.** Untuk `npbg`, `ppb`, dan `ri`, ditambahkan kolom ID nullable yang diisi sync dari teksnya. Kalau teks tidak cocok dengan master, ID dibiarkan NULL dan barisnya muncul di daftar "perlu dipetakan". Sistem tidak menebak.
4. **Tidak ada penghapusan master yang sudah dipakai.** Master dinonaktifkan (`is_active = false`). `items` sudah punya `deleted_at`. Tabel master lain memakai `is_active`.
5. **Accurate tidak pernah ditulis.** Sync hanya membaca. Konfigurasi lokal (`item_unit_conversions`, `uom_categories`, rasio di `units`, `item_safety_stocks`, `vendor_prices`) tidak pernah dihapus atau ditimpa sync. Ini sudah berlaku sekarang.
6. **Perubahan satuan dasar dari Accurate memicu peninjauan.** Kalau `items.unit_id` berubah saat sync, semua `item_unit_conversions` item itu ditandai `needs_review` dan tidak dipakai `UomConverter` sampai ditinjau. Harga Price List item itu juga ditandai.
7. **Stok tetap lewat ledger.** Semua perubahan stok lewat `StockLedgerService::record()`. Saldo resmi tetap mengikuti Accurate. Rancangan master data ini tidak menyentuh stok.
8. **Penerimaan barang:** `ri` adalah sumber resmi. `receivings` dibiarkan (legacy). Fitur baru merujuk ke `ri`.

---

## 3. Perubahan skema yang diusulkan

Semua perubahan bersifat tambahan, nullable, dan bisa di-rollback.

| Tahap | Perubahan | Tabel | Jenis | Catatan |
|---|---|---|---|---|
| 1 | `needs_review` (bool), `reviewed_at`, `base_unit_id_at_set` | `item_unit_conversions` | Kolom baru | Untuk P0-1. Tabel masih kosong, jadi tanpa risiko data. |
| 1 | Isi kategori dan rasio UOM | `uom_categories`, `units` | Data (command `stockwise:seed-uom` yang sudah ada) | Menambah satuan GR, TON, MM, KM, ML. Kode ganda `C M`/`CM`/`CMS` diberi rasio yang sama, tidak dihapus. |
| 1 | Isi `vendors.code` dari `PERSONNO`, sync mencocokkan lewat kode lalu nama | `vendors` | Data + logika sync | Kolom sudah ada (kosong). Perlu index unik pada `code`, nullable. |
| 2 | `item_id` | `npbg`, `ppb`, `ri` | Kolom baru + index | Diisi dari `kode_barang` (100% cocok saat audit) |
| 2 | `department_aliases` (`alias`, `department_id`) | **Tabel baru** | Master kecil | Memetakan 87 nilai `divisi` ke 19 departemen |
| 2 | `department_id` | `npbg`, `ppb`, `ri` | Kolom baru | Diisi lewat alias |
| 2 | `employee_id` | `npbg`, `ppb` | Kolom baru | Diisi dari nama `peminta` yang cocok |
| 3 | `customer_id` | `npbg` | Kolom baru | Setelah `customers` diisi dari Accurate |

Yang **tidak** diusulkan:
- Mengganti nama tabel (misalnya `npbg` → `delivery_orders`).
- Melebur `vendors` dan `customers` menjadi satu tabel partner.
- Menghapus `receivings` atau `purchase_proposals*`.
- Membuat tabel akuntansi.

---

## 4. Menu Master Data

Hanya halaman yang sudah ada atau yang API-nya sudah tersedia. Tidak ada menu kosong.

```
MASTER DATA (app baru di launcher)
├─ Products
│   ├─ Barang                 → /items?kind=BARANG     (ada)
│   ├─ Jasa                   → /items?kind=JASA       (ada)
│   ├─ Kategori Barang        → /item-categories       (ada)
│   └─ Units of Measure       → /uom                    (ada; termasuk konversi per item)
├─ Contacts
│   ├─ Vendors                → /vendors                (ada)
│   └─ Customers & Projects   → baru, baca saja         (API /api/customers, /api/projects ada)
├─ Warehouse
│   └─ Gudang & Lokasi        → baru, baca saja         (API /api/warehouses, /api/warehouse-locations ada)
└─ Employees
    └─ Pekerja & Departemen   → /employees              (ada)
```

Users dan Roles & Permissions tetap di app **Settings**, karena itu administrasi, bukan master operasional. App Inventory, Purchase, dan Employees tetap menampilkan menunya seperti sekarang. App Master Data hanya pintu masuk tambahan yang mengumpulkan semua master di satu tempat. Menu disaring dengan permission yang sudah ada (`item.view`, `master.vendor.view`, `master.employee.view`, `master.warehouse.view`, `master.customer.view`, `master.project.view`), jadi tidak ada permission baru.

---

## 5. Pola tampilan (mengikuti Odoo)

| Pola | Komponen yang dipakai ulang | Status |
|---|---|---|
| List: search, filter, sort, pagination, pilih kolom, export | `DataTable`, `FilterBar`, `Pager`, `ColumnVisibility`, `DatasetExporter` | Ada |
| Group By | `DataTable` (tambahan) | Belum ada |
| Form: judul, status aktif/nonaktif, tombol aksi, tab | `Modal`/halaman form per modul | Ada, belum seragam |
| Riwayat perubahan dan chatter | `Chatter` + `doc_messages` / `doc_audit_logs` (sudah dipakai transaksi) | Belum di master |
| Panel relasi (misalnya di Item: satuan, konversi, gudang, transaksi terakhir) | `ItemHistoryModal`, `ItemUsageCount`, `UomEquivalent` sudah ada | Sebagian |
