# Manufacturing / Assembly (MRP) — desain & implementasi

Status: diimplementasikan dan **di-deploy 11-11-2026** (migrasi MRP saja via `--path`, cache rute/config diperbarui, frontend disalin). Backup: `Backup/mrp-deploy-20261111_135110`.

Konsep diambil dari Odoo Manufacturing (BoM, MO, reservasi, konsumsi, hasil, scrap, traceability) tetapi disederhanakan: tanpa work center, routing, jadwal mesin, atau BoM tipe kit.

## 1. Batasan yang dipegang

| Batasan | Cara dipenuhi |
|---|---|
| Accurate = stok resmi, STOCKWISE tidak menulis ke Accurate | Tidak ada kode tulis ke Accurate. Tabel manufaktur Accurate (BOM, WORKORDER, PRODUCTRESULT) kosong, tidak dipakai. |
| Tidak ada ledger paralel | Semua gerakan lewat `StockLedgerService::record()` (tabel `stock_movements` + `inventory`). |
| Sinkron tidak menghapus / tidak dobel | `StockwiseNet::manufacturing()` menambahkan net MO ke qty Accurate sampai MO ditandai "entered in Accurate". |
| Base UOM, rasio beku, tanpa float | Semua hitungan `bcmath` (`App\Services\Mrp\MrpQty`). Entri menyimpan qty ketik, satuan, `unit_ratio`, `base_qty`, `base_unit`. |
| Tidak membulatkan diam-diam | Qty yang setelah konversi punya >2 desimal (kolom stok 2 desimal) **ditolak**. |
| Tidak mengubah modul lama | Tracking "Manufaktur & Assembly" (MA/MJ, `manufacturing_*`, izin `manufacturing.*`) tidak disentuh. Modul baru memakai `mrp_*`, izin `mrp.*`, rute `/api/mrp/*`, halaman `/mrp/*`. |

## 2. Alur bisnis

```
BoM: Draft ──activate──▶ Active ──archive / revisi baru diaktifkan──▶ Archived
                           │
                           ▼  (MO menyalin komponen BoM saat dibuat)
MO:  Draft ──confirm──▶ Confirmed ──start──▶ In Progress ──finish──▶ To Close ──validate──▶ Done
       │   (reservasi)      │        (catat konsumsi/hasil/scrap)  │ ◀──reopen──┘   (posting stok)   │
       └──────cancel────────┴──────────────cancel──────────────────┴────cancel                      │
                                                                                     reverse ◀──────┘
                                                        Done ──mark entered in Accurate──▶ (net pindah ke Accurate)
Kekurangan komponen ──▶ Draft Purchase Request (PpbDraftService::restock) ──▶ PR → PO → Receipt (alur biasa)
```

## 3. Matriks status MO (divalidasi di backend, di bawah row lock)

| Dari \ Ke | Confirmed | In Progress | To Close | Done | Cancelled |
|---|---|---|---|---|---|
| Draft | confirm (`mrp.confirm`) | – | – | – | cancel (`mrp.cancel`, alasan opsional) |
| Confirmed | – | start (`mrp.record`) | – | – | cancel (alasan wajib) |
| In Progress | – | – | finish (`mrp.record`, wajib ada hasil/scrap produk) | – | cancel (alasan wajib) |
| To Close | – | reopen (`mrp.record`) | – | validate (`mrp.validate`) | cancel (alasan wajib) |
| Done | – | – | – | – | reverse (`mrp.cancel`, alasan wajib, belum ditandai Accurate) |

Edit MO hanya saat Draft (pembuat, penanggung jawab, atau pemegang `mrp.confirm`). Entri hanya saat In Progress.

## 4. Gerakan stok

| Kapan | Jenis (`movement_type`) | Arah | Gudang |
|---|---|---|---|
| Confirm | `RESERVATION` | reserved +, actual tetap | gudang dengan stok bebas terbanyak dulu (sama dengan Item Request) |
| Validate | `RELEASE_RESERVATION` lalu `MRP_CONSUME` | −1 | gudang yang memegang reservasi dulu |
| Validate | `MRP_SCRAP` (scrap komponen) | −1 | sama |
| Validate | `MRP_PRODUCE` (hasil baik) | +1 | `items.default_warehouse_id`, kalau kosong gudang pertama |
| Cancel | `RELEASE_RESERVATION` | reserved − | gudang reservasi |
| Reverse | `MRP_REVERSE_OUT` (hasil), `MRP_REVERSE_IN` (konsumsi/scrap) | kebalikan | gudang gerakan asal |

- Semua gerakan `reference_type = App\Models\MrpProduction`, `reference_id = MO`, `batch_uuid` per posting, `note` berisi nomor MO, `created_by` = user.
- Posting validate = satu transaksi DB, MO di-`lockForUpdate`, status harus `TO_CLOSE`: validate kedua ditolak (tidak ada posting ganda). Kalau satu komponen kurang, **tidak ada** yang diposting.
- Scrap komponen = gerakan sendiri, tidak ikut dihitung di konsumsi (tidak potong dua kali). Scrap produk jadi = hasil ditolak, tidak pernah masuk stok, jadi tidak ada gerakan.
- Stok negatif tetap ditolak oleh ledger. Reverse ditolak bila hasil produksi sudah terpakai.

### Hubungan dengan Accurate (hibrida)
`AccurateDerivedAnalysis::followAccurateQty` menyamakan stok = qty Accurate + `StockwiseNet`. Net MO = Σ(direction × qty) gerakan `MRP_*` milik MO yang `accurate_recorded_at` masih kosong. Setelah produksi juga diinput di Accurate (mis. NPBG untuk komponen dan RI / item adjustment untuk produk), user menandai MO "entered in Accurate" beserta nomor dokumennya. Sejak itu qty Accurate yang membawanya.
**Risiko:** menandai sebelum dokumen Accurate benar-benar ada akan menurunkan stok STOCKWISE di sinkron berikutnya; tidak menandai setelah diinput di Accurate membuat stok terhitung dua kali. Dashboard menampilkan jumlah "Done, not yet entered in Accurate".

## 5. UOM

- Komponen BoM: qty per 1 produk dalam Base UOM komponen, maksimal 6 desimal.
- Rencana MO: Base UOM produk, maksimal 2 desimal. Kebutuhan = qty_per_unit × rencana (6 desimal). Reservasi dibulatkan ke atas ke 0,01.
- Entri boleh memakai satuan lain bila `UomConverter::documentRatio()` mengenalnya (per item `item_unit_conversions`, UNIT2/RATIO2 Accurate, atau satu kategori). Tanpa rasio → ditolak. Rasio dibekukan di entri; perubahan Master UOM tidak mengubah entri lama.
- Contoh: kabel Base MTR, 1 ROL = 100 MTR. 0,5 ROL → 50 MTR. 0,12345 ROL → 12,345 MTR → ditolak (stok 2 desimal).

## 6. Data (migrasi `2026_11_11_100000_create_mrp_tables.php`, aditif)

```
items ─┬─< mrp_boms (item_id = produk, revision, status) ─< mrp_bom_lines (item_id, qty 18,6)
       │        │
       │        └──< mrp_productions (snapshot bom_code/revision, planned_qty 14,2, status, langkah *_at/*_by,
       │                 │            accurate_recorded_at, accurate_refs, posting_batch)
       │                 ├──< mrp_production_components (snapshot qty_per_unit, required_qty, reserved_qty, is_extra)
       │                 └──< mrp_production_entries (kind, qty, unit, unit_ratio, base_qty, base_unit, over_plan,
       │                                              client_key unik, posted_at, voided_at)
       └─ stock_movements (reference = mrp_productions)
mrp_activities (subject BOM/MO, action, from/to status, note, user) — riwayat dokumen
```
Kolom produk/komponen sengaja bernama `item_id` supaya `StockwisePurge` tidak menghapus Master Produk yang dipakai MRP. Data MRP tidak ikut di-purge.

Izin baru (grup `mrp`) dan default role. Migrasi menambahkan izin tanpa menjalankan `RbacSeeder`:

| Izin | super_admin | admin_gudang | lapangan_gudang | bos |
|---|---|---|---|---|
| `mrp.view` | ✓ | ✓ | ✓ | ✓ |
| `mrp.bom.manage`, `mrp.create`, `mrp.confirm`, `mrp.validate`, `mrp.cancel` | ✓ | ✓ | – | – |
| `mrp.record` | ✓ | ✓ | ✓ | – |

`shortage-request` juga butuh `ppb.create`.

## 7. API (`/api/mrp`, semua `auth:sanctum` + izin)

| Metode & path | Izin |
|---|---|
| GET `dashboard`, `reports?type=summary\|consumption\|output\|scrap\|trace`, `items`, `items/{id}/units`, `users`, `boms`, `boms/{id}`, `productions`, `productions/{id}` | mrp.view |
| POST `boms`, PUT/DELETE `boms/{id}`, POST `boms/{id}/activate\|archive\|revise` | mrp.bom.manage |
| POST `productions`, PUT `productions/{id}` | mrp.create |
| POST `productions/{id}/confirm` | mrp.confirm |
| POST `productions/{id}/start\|finish\|reopen\|entries`, DELETE `productions/{id}/entries/{entry}` | mrp.record |
| POST `productions/{id}/validate\|accurate` | mrp.validate |
| POST `productions/{id}/cancel\|reverse` | mrp.cancel |
| POST `productions/{id}/shortage-request` | mrp.view + ppb.create |

Perubahan pada kode lama hanya aditif: jenis gerakan baru di `StockLedgerService`, `StockwiseNet::manufacturing()` (aman bila tabel belum ada), baris MO di Moves History (`ItemController::history`), izin di `Rbac.php`. Kontrak API lama tidak berubah.

## 8. Halaman

Sidebar grup **Manufacturing**: Manufacturing Orders (Dashboard, List MO, Production History) dan Bills of Materials. Detail MO berisi tab Overview, Components & availability, Consumption, Finished output, Scrap, Inventory movements, dan Activity. Penjelasan ada di Panduan › Manufacturing.

## 9. Edge case yang ditangani
BoM melingkar (langsung / tidak langsung), komponen ganda, qty 0, jasa sebagai komponen/produk, item tanpa Base UOM, BoM diarsipkan setelah MO dibuat (MO memakai salinannya, ada peringatan), konfirmasi ganda, posting ganda, form terkirim dua kali (`client_key`), konsumsi melebihi rencana / barang di luar BoM (wajib `mrp.validate` + alasan), hasil melebihi rencana (sama), stok kurang saat validate (tidak ada posting), sinkron menurunkan reserved (rilis dibatasi reserved yang ada), reverse setelah barang jadi terpakai (ditolak), reverse setelah ditandai Accurate (ditolak).

## 10. Belum dicakup (sengaja)
Biaya produksi (tidak ada data biaya yang andal), work center/routing/jadwal, BoM multi-level otomatis (sub-assembly dibuat sebagai MO sendiri), nomor seri pada hasil produksi, pemilihan gudang per MO, approval Manager/Direktur untuk MO.

## 11. Deploy (butuh persetujuan; jangan `migrate` biasa karena ada 2 migrasi lama yang masih pending)
1. Backup DB (`mysqldump`) ke `D:\01.STOCKWISE\Backup\`.
2. `php artisan migrate --path=database/migrations/2026_11_11_100000_create_mrp_tables.php --force`
3. `php artisan route:cache` (rute di-cache) dan `php artisan config:cache`.
4. Frontend: `npm run build`, backup `backend/public/app.html`, salin `dist/assets/*` dan `dist/index.html` → `app.html`.
5. Rollback: `migrate:rollback --path=…` (hanya menghapus tabel `mrp_*` + izin `mrp.*`; lakukan hanya selama belum ada MO Done, karena gerakannya tetap di `stock_movements`).
