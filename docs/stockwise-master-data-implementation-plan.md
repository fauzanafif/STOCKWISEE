# STOCKWISE: Rencana Implementasi Master Data

Dasar: [audit](stockwise-master-data-audit.md), [analisis gap](stockwise-odoo-gap-analysis.md), [arsitektur](stockwise-master-data-architecture.md).

Setiap tahap menunggu persetujuan. Urutannya disusun supaya perbaikan integritas data (P0) selesai sebelum data baru diisi.

**Arahan 16 November 2026:** fitur baru tidak mengambil acuan dari data Accurate (tabel `accurate_*` maupun logika sync). Langkah yang bergantung pada data itu ditunda (1.3, 3.1). Sync Accurate tidak diubah.

### Status (16 November 2026)

| Langkah | Status |
|---|---|
| 1.1 Konversi ditandai saat satuan dasar berubah | **Kode selesai dan diuji.** Dibuat generik: berlaku untuk perubahan satuan dasar dari sumber mana pun, tanpa mengubah sync. Migration `2026_11_16_110000_item_unit_conversions_base_unit` **belum dijalankan** di produksi. Kode tetap aman sebelum migration itu jalan. |
| 1.2 Isi kategori dan rasio UOM | **Siap, menunggu persetujuan.** `php artisan stockwise:seed-uom --dry-run` menunjukkan: 27 satuan masuk 6 kategori, 5 satuan baru (GR, TON, MM, KM, ML). |
| 1.3 Kode vendor dari Accurate | **Ditunda** (bergantung pada data Accurate) |
| 1.4 Laporan kualitas data | **Selesai.** Halaman Inventory → Data Quality dan endpoint `GET /api/master-data/quality`. Hanya membaca tabel master STOCKWISE. |

Aturan untuk semua tahap:
- Tidak mengubah alur Item Request, NPBG, PPB, PO, Receipt, MRP, maupun Stock Ledger.
- Tidak mengubah API yang sudah ada. Kolom baru hanya ditambahkan di respons.
- Tidak mengubah penomoran dokumen, role, maupun permission.
- Migration hanya menambah (tabel atau kolom nullable). Setiap migration punya `down()`.
- Tidak ada deployment produksi tanpa persetujuan. Test berjalan di SQLite in-memory dan tidak menyentuh database produksi.

---

## Tahap 1: Integritas UOM dan vendor (P0)

| # | Pekerjaan | Perubahan | Risiko | Mitigasi |
|---|---|---|---|---|
| 1.1 | Konversi ditandai saat satuan dasar berubah | Migration: kolom `base_unit_id` di `item_unit_conversions` dan `vendor_prices`. Konversi atau harga yang dibuat terhadap satuan dasar lain dianggap "perlu ditinjau". `UomConverter` tidak memakainya. Di halaman UOM ada tombol "Still right", atau rasio bisa disimpan ulang. Sync tidak diubah. | Rendah: tabel masih kosong | Test: satuan dasar berubah → konversi tidak dipakai sampai dikonfirmasi. Harga Price List ditandai dan tidak dianggap termurah. |
| 1.2 | Isi kategori dan rasio UOM | Jalankan `php artisan stockwise:seed-uom` (command yang sudah ada) | Sedang: mengubah data produksi (`units` dan `uom_categories`) dan menambah 5 satuan | Review daftar rasio bersama tim gudang dulu (misalnya RIM = 500 LBR, PSG = 2 PCS). Command aman dijalankan ulang dan tidak menimpa satuan yang sudah dikategorikan. Backup tabel `units` sebelumnya. |
| 1.3 | Kode vendor dari Accurate | Isi `vendors.code` dari `accurate_persondata.PERSONNO` (pencocokan lewat nama). Sync mencari dengan kode lebih dulu, lalu nama. Index unik nullable pada `code`. | Sedang: mengubah logika sync vendor | Dry-run lebih dulu: laporan berapa vendor yang cocok, tidak cocok, atau ganda. Vendor yang tidak cocok dibiarkan tanpa kode. |
| 1.4 | Laporan data yang perlu dibereskan | Halaman atau ekspor hanya-baca: item tanpa satuan (65), item dengan nama ganda (48 grup), vendor dengan nama mirip, departemen ganda | Tidak ada | Hanya membaca |

**Selesai bila:** konversi bisa dibuat dan aman dari perubahan Accurate, kategori UOM terisi, dan vendor punya kode stabil.

## Tahap 2: Relasi ID dari transaksi mirror (P1)

| # | Pekerjaan | Perubahan | Risiko | Mitigasi |
|---|---|---|---|---|
| 2.1 | `item_id` di `npbg`, `ppb`, `ri` | Migration kolom nullable + index. Backfill dari `kode_barang` (sekitar 16 ribu baris). Sync mengisi untuk baris baru. | Sedang: backfill menulis ke 3 tabel besar | Backfill per batch, hanya mengisi kolom baru, dan bisa diulang. Teks `kode_barang` tidak diubah. |
| 2.2 | Pemetaan divisi → departemen | Tabel baru `department_aliases` dan kolom `department_id` nullable. Halaman untuk memetakan 87 nilai divisi. | Rendah | Sebelum dipetakan, `department_id` tetap NULL. Laporan lama tetap memakai teks. |
| 2.3 | Pemetaan peminta → karyawan | Kolom `employee_id` nullable di `npbg` dan `ppb`, diisi bila nama cocok persis | Rendah | Nama yang tidak cocok dibiarkan NULL dan muncul di daftar "perlu dipetakan" |
| 2.4 | Sumber resmi kategori | **Perlu keputusan:** `items.accurate_category_*` (dari Accurate), `categories`, atau `item_category_options` | — | Tidak dikerjakan sebelum diputuskan |
| 2.5 | Relasi user ↔ karyawan | **Perlu keputusan:** `users.employee_id` atau `employees.user_id` | — | Tidak dikerjakan sebelum diputuskan |

## Tahap 3: Customer dari Accurate (P1)

| # | Pekerjaan | Syarat |
|---|---|---|
| 3.1 | Isi `customers` dari `accurate_persondata` | Konfirmasi arti `PERSONTYPE` 0 dan 1 `[NEEDS CONFIRMATION]` |
| 3.2 | `customer_id` di `npbg` dari `pelanggan` | Setelah 3.1 |

## Tahap 4: Navigasi dan tampilan (P2)

| # | Pekerjaan | Perubahan |
|---|---|---|
| 4.1 | App "Master Data" di launcher | Mengumpulkan halaman master yang sudah ada. Hanya frontend (`launcher.ts`, `navigation.ts`). |
| 4.2 | Halaman Gudang & Lokasi, Customer & Proyek (baca saja) | Halaman baru di atas API yang sudah ada |
| 4.3 | Group By di tabel | Komponen bersama, dipakai bertahap |
| 4.4 | Riwayat perubahan dan chatter di detail Item, Vendor, Karyawan | Mendaftarkan master ke `DocumentRegistry` yang sudah dipakai transaksi |
| 4.5 | Retensi `sync_logs` (1,3 juta baris, sekitar 216 MB) | Command arsip/hapus log lebih tua dari N hari. **Destruktif, perlu persetujuan terpisah.** |

## Tahap 5: Deploy Price List

Migration `vendor_prices` sudah siap dan sudah diuji. Disarankan setelah Tahap 1.2, supaya satuan beli selain satuan dasar (BOX, PCK, dan seterusnya) bisa dipakai.

---

## Keputusan yang dibutuhkan dari pemilik bisnis

1. Sumber resmi kategori item (2.4).
2. Arah relasi user ↔ karyawan (2.5).
3. Arti `PERSONTYPE` 0 dan 1 di Accurate (3.1).
4. Daftar rasio UOM sebelum `stockwise:seed-uom` dijalankan (1.2).
5. Masa simpan `sync_logs` (4.5).

## Yang sengaja tidak dikerjakan

Mengganti nama tabel agar mirip Odoo, melebur vendor dan customer menjadi satu tabel, menghapus `receivings` atau `purchase_proposals*`, modul akuntansi, multi-company, variants/attributes, dan IT Helpdesk.

## Test per tahap

- Backend: test fitur per perubahan (SQLite in-memory), ditambah regresi modul terkait. Filter yang relevan: `PoVendorMatrix`, `PriceList`, `Uom`, `PpbDraft`, `VendorMaster`, `Rbac`, dan test sync.
- Frontend: `vitest` penuh dan typecheck.
- Catatan baseline: 19 test lama (sync Accurate, export, login) sudah gagal sebelum pekerjaan ini, dan `RiSourceTest` macet sampai batas waktu. Keduanya perlu dibereskan terpisah agar regresi sync bisa diukur dengan benar.
