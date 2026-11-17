# STOCKWISE: Analisis Gap dengan Konsep Odoo

Dasar: [stockwise-master-data-audit.md](stockwise-master-data-audit.md) (audit 16 November 2026). Angka di sini merujuk ke temuan D1–D13 di dokumen itu.

Catatan penting: STOCKWISE **bukan** Odoo dan tidak perlu menyamainya. Accurate tetap menjadi sistem akuntansi dan sumber resmi Master Item, satuan dasar, dan saldo stok. Yang diambil dari Odoo adalah polanya: satu master dipakai banyak modul, relasi lewat ID, dan tampilan list/form yang seragam. Tampilan yang mirip Odoo tidak berarti fiturnya setara.

---

## 1. Perbandingan per area

| Area | Kondisi STOCKWISE sekarang | Konsep Odoo | Gap | Rekomendasi |
|---|---|---|---|---|
| Master Item | `items` (9.200) dari Accurate, dipakai lewat FK oleh PO, Receiving, Opname, MRP, Disassembly, Tracking, Price List. NPBG/PPB/RI merujuk lewat teks `kode_barang`, tetapi 100% cocok. | `product.product` sebagai satu sumber, semua dokumen merujuk dengan ID | Tiga tabel transaksi terbesar tidak punya `item_id`. 48 grup nama ganda, 65 item tanpa satuan. | Tambah kolom `item_id` nullable di `npbg`, `ppb`, `ri`, diisi sync dari `kode_barang` (teks tetap disimpan sebagai snapshot). Laporan item ganda untuk dicek pemilik data. |
| Kategori produk | Tiga representasi: `categories`, `item_category_options`, `items.accurate_category_*` (D4) | `product.category` satu pohon | Belum jelas mana yang resmi. 243 item tanpa `category_id`. | Putuskan satu sumber resmi (kemungkinan kategori Accurate yang sudah diisi sync). Sumber lain diselaraskan atau dijadikan tampilan saja. Perlu keputusan bisnis. |
| UOM | `units` (27) tanpa kategori atau rasio, `uom_categories` dan `item_unit_conversions` kosong. Ada kode ganda (D1, D2). | `uom.category` + `uom.uom` dengan rasio, konversi otomatis | Fondasi konversi sudah ada di kode (`UomConverter`, `stockwise:seed-uom`), tetapi datanya belum diisi | Isi kategori UOM lewat command yang sudah ada (setelah ditinjau), gabungkan kode ganda, dan tambahkan penanda "perlu ditinjau" pada konversi saat satuan dasar Accurate berubah |
| Gudang & lokasi | `warehouses` (7) dan `warehouse_locations` (164), dipakai lewat FK oleh inventory, opname, receiving | `stock.warehouse` + `stock.location` (pohon) dengan halaman pengelolaan | Tidak ada halaman untuk melihat atau mengelola gudang dan lokasi. `npbg.lokasi_gudang`/`lokasi_rak` berupa teks (saat ini kosong). | Halaman Gudang & Lokasi baca saja dulu, memakai API yang sudah ada |
| Vendor | `vendors` (315) dari Accurate, cocok lewat **nama**, tanpa `code`, 310 `needs_review` (D9) | `res.partner` dengan referensi unik | Pencocokan lewat nama rapuh: kalau nama berganti di Accurate, vendor baru dibuat | Isi `vendors.code` dari `accurate_persondata.PERSONNO` dan cocokkan lewat kode. Satukan vendor yang mirip setelah ditinjau. |
| Customer | `customers` hanya 4. `npbg.pelanggan` berisi 154 nama teks (D8). | `res.partner` (customer) | Master customer praktis kosong | Isi `customers` dari `accurate_persondata`, setelah arti `PERSONTYPE` 0/1 dikonfirmasi `[NEEDS CONFIRMATION]` |
| Kontak terpusat | `vendors` dan `customers` terpisah, `accurate_persondata` mentah | Satu `res.partner` untuk semua jenis kontak | Tabel terpisah per jenis | **Tidak** disarankan dilebur ke satu tabel: terlalu banyak FK dan API yang bergantung. Cukup samakan sumber (Accurate) dan kunci (`PERSONNO`). |
| Karyawan | `employees` (221), 218 tanpa departemen. Dipakai STPP dan Maintenance. `npbg.peminta`/`ppb.peminta` teks, 72 dan 10 nama tidak cocok (D7). | `hr.employee` dengan departemen, terhubung ke user | Peminta di transaksi tidak terhubung ke karyawan. Relasi user–karyawan dua arah (D11). | Kolom `employee_id` nullable di NPBG/PPB yang diisi dari pemetaan nama. Pilih satu arah relasi user–karyawan. |
| Departemen | `departments` (19) dengan nama ganda. `divisi` teks di NPBG (87 nilai, 72 tidak cocok) (D6). | `hr.department` | Divisi transaksi tidak terhubung ke departemen | Tabel alias divisi → departemen (baru, kecil) dan kolom `department_id` nullable di transaksi, diisi sync |
| Penerimaan barang | `ri` (Accurate, 4.824) dan `receivings` (1), dirujuk tidak konsisten (D3) | Satu `stock.picking` (incoming) | Dua sumber untuk satu konsep | Tetapkan `ri` sebagai sumber penerimaan resmi. Jangan hapus `receivings`. Rujukan baru ke `ri`; rujukan lama dibiarkan, dicatat sebagai legacy. |
| PPB lama | `purchase_proposals*` kosong tetapi masih dirujuk FK (D5) | — | Kode dan tabel mati | Tandai legacy di dokumentasi. Jangan dihapus sampai FK dan kode pemakainya dikaji. |
| Users / Roles / Permissions | `users`, `roles`, `permissions`, katalog `Rbac`; halaman Users dan Roles ada | `res.users`, groups, access rights | Mendekati konsep Odoo. Belum ada Policy per record. | Tidak perlu perubahan untuk master data |
| Perusahaan / cabang | `sites` (2) | `res.company` (multi-company) | Multi-company tidak diperlukan (satu perusahaan, dua cabang) | Tetap pakai `sites` sebagai cabang |
| Akuntansi | Tidak ada COA, pajak, termin, mata uang | `account.*` | Disengaja: akuntansi ada di Accurate | Jangan dibangun (P3) |
| Price List | `vendor_prices` + histori (kode siap, belum di-migrate) | `product.supplierinfo` | Sudah memakai `items`, `vendors`, `units` lewat FK | Deploy setelah UOM terkonfigurasi agar satuan beli selain satuan dasar bisa dipakai |
| List view | Search, filter, sort, pagination, pilih kolom, export | List + Search + Filter + **Group By** + Favorit | Group By dan filter tersimpan belum ada | Tambahkan Group By di komponen tabel bersama (P2) |
| Form view | Form popup/halaman per modul. Chatter hanya di detail transaksi. | Form seragam: judul, status bar, tombol, tab, chatter | Form master (Item, Vendor, Karyawan) belum punya riwayat atau chatter | Pasang chatter yang sudah ada (`doc_messages`/`doc_audit_logs`) di detail master (P2) |
| App Launcher & menu | Launcher ikon dengan menu per app, disaring permission | Home + menu per app | Sudah mendekati Odoo. Master data tersebar di app Inventory, Purchase, Employees, Settings. | Satukan halaman master yang sudah ada ke app "Master Data" (P2) |
| Log & audit | `user_activity_logs`, chatter, riwayat per modul. `sync_logs` 1,3 juta baris tanpa retensi. | `mail.message`, tracking field | Belum ada pelacakan perubahan field master | Retensi `sync_logs` (P2). Riwayat perubahan master lewat `doc_audit_logs` (P2). |
| IT Helpdesk | Tidak ada (ikon Helpdesk membuka Panduan) | `helpdesk.ticket` | Belum ada | Di luar lingkup master data (P3) |

---

## 2. Prioritas

### P0: integritas data dan duplikasi berisiko

| ID | Masalah | Kenapa P0 |
|---|---|---|
| P0-1 | Konversi UOM tidak ditandai saat satuan dasar Accurate berubah | Begitu konversi mulai diisi, rasio lama akan dipakai diam-diam terhadap satuan baru. Hitungan stok dan harga jadi salah tanpa terlihat. Harus beres **sebelum** konversi diisi. |
| P0-2 | UOM kosong dan kode satuan ganda (`C M`/`CM`/`CMS`, `ROL`/`ROLL`) | Konversi tidak bisa jalan, dan satu satuan tercatat dengan beberapa kode |
| P0-3 | Vendor dicocokkan lewat nama, tanpa kode | Perubahan nama di Accurate membuat vendor baru, sehingga histori PO dan harga terpecah |
| P0-4 | Rujukan penerimaan barang ke dua tabel (`ri` / `receivings`) | Rujukan tracking bisa mengarah ke tabel yang hampir kosong |

### P1: master data inti

| ID | Pekerjaan |
|---|---|
| P1-1 | `item_id` nullable di `npbg`, `ppb`, `ri` (diisi dari `kode_barang`) |
| P1-2 | Pemetaan divisi → departemen, plus `department_id` nullable di transaksi |
| P1-3 | Pemetaan peminta → karyawan, plus `employee_id` nullable di transaksi |
| P1-4 | Master customer dari `accurate_persondata` |
| P1-5 | Satu sumber resmi kategori item (perlu keputusan bisnis) |
| P1-6 | Satu arah relasi user ↔ karyawan |

### P2: UI/UX dan navigasi

| ID | Pekerjaan |
|---|---|
| P2-1 | App "Master Data" di launcher yang menyatukan halaman master yang sudah ada |
| P2-2 | Halaman Gudang & Lokasi, Customer & Proyek (baca saja, API sudah ada) |
| P2-3 | Group By di tabel bersama |
| P2-4 | Riwayat perubahan dan chatter di detail master |
| P2-5 | Retensi `sync_logs` |

### P3: belum diperlukan

Product variants/attributes, packaging, multi-company, Chart of Accounts / pajak / termin / mata uang, kategori kontak, IT Helpdesk.

---

## 3. Yang sudah setara dan yang belum

**Sudah ada dan bekerja:**
- Satu Master Item dipakai lewat FK oleh PO, Receiving, Opname, MRP, Disassembly, Tracking, dan Price List.
- Master gudang dan lokasi.
- Users, roles, dan permission dengan menu sesuai hak akses.
- App Launcher dengan menu per app.
- Chatter di dokumen transaksi.
- Snapshot satuan di transaksi (`unit_ratio`, `base_satuan`).

**Belum ada:**
- Relasi ID dari NPBG/PPB/RI ke master item, karyawan, departemen, dan customer.
- Konfigurasi UOM yang terisi.
- Kunci vendor yang stabil.
- Form master dengan riwayat perubahan.
- Group By.
- Halaman pengelolaan gudang, lokasi, dan customer.
