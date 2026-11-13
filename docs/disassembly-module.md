# Disassembly / Unbuild — desain & implementasi

Status: diimplementasikan dan **di-deploy 11-11-2026** (migrasi `2026_11_12_100000_create_disassembly_tables.php` via `--path`, cache rute/config diperbarui, frontend disalin). Backup: `Backup/disassembly-deploy-20261111_155013`.

Konsep dari Odoo Unbuild Order dan SAP disassembly, dengan alur status yang sama seperti Manufacturing Order STOCKWISE. Satu produk dibongkar menjadi komponen BoM aktifnya.

## 1. Batasan yang dipegang
| Batasan | Cara dipenuhi |
|---|---|
| Accurate = stok resmi, tanpa writeback | Tidak ada kode tulis ke Accurate. `StockwiseNet::disassembly()` menambahkan net dokumen ke qty Accurate sampai ditandai "entered in Accurate". |
| Tanpa ledger paralel | Semua gerakan lewat `StockLedgerService::record()`. |
| MRP tidak diubah | BoM (`mrp_boms`) hanya dibaca. Tabel, izin, rute, dan halaman terpisah: `disassembly_*`, `disassembly.*`, `/api/disassembly/*`, `/disassembly/*`. |
| Tanpa float / pembulatan diam-diam | Hitungan bcmath (`MrpQty`). Qty yang tidak muat 2 desimal stok, atau bukan kelipatan `units.rounding`, ditolak. |
| Tanpa stok fiktif | Hanya hasil **Good** yang masuk stok, dan selalu bersama `DISASSEMBLY_OUT` produk dalam satu transaksi. Hasil di atas BoM saat Finish hanya bisa oleh pemegang `disassembly.validate`. |

## 2. Alur
```
Draft ──confirm (reservasi produk di gudang sumber; stok kurang → ditolak)──▶ Confirmed ──start──▶ In Progress
In Progress: catat per komponen Good / Scrap (alasan) / Missing (alasan) — belum ada gerakan stok
In Progress ──finish (isi qty yang benar-benar dibongkar ≤ rencana; semua komponen harus tercatat)──▶ To Close
To Close ──reopen──▶ In Progress
To Close ──validate (satu transaksi: lepas reservasi → DISASSEMBLY_OUT produk → DISASSEMBLY_IN komponen Good)──▶ Done
Draft..To Close ──cancel (alasan wajib setelah Draft; reservasi dilepas; entri di-void)──▶ Cancelled
Done ──reverse (alasan; ditolak bila komponen sudah terpakai atau sudah ditandai Accurate)──▶ Cancelled (Reversed)
Done ──mark entered in Accurate (1–10 nomor dokumen)──▶ net pindah ke Accurate
```

## 3. Gerakan stok
| Kapan | `movement_type` | Arah | Gudang |
|---|---|---|---|
| Confirm | RESERVATION | reserved + | sumber |
| Validate / Cancel | RELEASE_RESERVATION | reserved − (dibatasi reserved yang ada) | sumber |
| Validate | DISASSEMBLY_OUT | −1 produk (qty dibongkar) | sumber |
| Validate | DISASSEMBLY_IN | +1 per komponen Good | tujuan (default = sumber) |
| Reverse | DISASSEMBLY_REVERSE_OUT / _IN | kebalikan | gudang gerakan asal |

Scrap dan Missing tidak menggerakkan stok karena komponen itu tidak pernah ada sebagai stok. Keduanya tercatat sebagai varians di dokumen.

## 4. Data
`disassembly_orders` (snapshot BoM, planned/done/reserved qty, gudang sumber/tujuan, langkah `*_at/_by`, `accurate_refs` JSON, `posting_batch`), `disassembly_components` (snapshot qty_per_unit, planned, is_extra), `disassembly_entries` (kind GOOD/SCRAP/MISSING, qty+unit+unit_ratio beku, base_qty, client_key unik, posted/voided), `disassembly_activities`.

Izin: `disassembly.view/create/confirm/record/validate/cancel`. Defaultnya: admin_gudang semua, lapangan_gudang view+record, bos view, super_admin semua.

## 5. Keputusan default (perlu dikonfirmasi bila berbeda)
1. Varians = **Scrap** (rusak) + **Missing** (hilang), keduanya wajib alasan dan tanpa gerakan stok.
2. Finish wajib "semua tercatat": good + scrap + missing ≥ qty_per_unit × qty dibongkar.
3. Qty dibongkar ≤ rencana; sisanya dibuat dokumen baru.
4. Gudang sumber dipilih per dokumen; gudang tujuan komponen opsional.
5. Aturan pecah memakai `units.rounding` (Master UOM). Saat ini semua satuan memakai rounding 0,01, jadi pecahan diizinkan sampai Master UOM diatur ke 1.
6. Nomor dokumen Accurate tidak diverifikasi ke Accurate (tidak ada API baca dokumen yang pasti). Yang dicek hanya format, keunikan, dan maksimum 10.
7. Panduan ditulis dalam bahasa Inggris, mengikuti aturan UI.

## 6. Rollback
`php artisan migrate:rollback --path=database/migrations/2026_11_12_100000_create_disassembly_tables.php --force`, aman hanya selama belum ada dokumen Done (gerakannya tetap di `stock_movements`). Lalu `config:cache` dan `route:cache`. `app.html` lama ada di folder backup.
