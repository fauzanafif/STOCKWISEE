# Smart Search Master Barang

Status: **live 12-11-2026**. Tanpa migrasi; frontend lama disimpan di `Backup/smart-search-deploy-20261112_133518`.

- **Layanan:** `App\Services\Search\ItemSmartSearch`. Dipakai `Item::filtered()` (list Master Barang, ekspor, `items/ids`, dashboard) saat `search` diisi. `?search_mode=exact` mengembalikan perilaku lama.
- **Indeks** (token terbalik + kunci ukuran + brand) dibangun dari tabel `items` dan disimpan di cache file sekitar 2,2 MB. Kuncinya jumlah item + `MAX(updated_at)` + `MAX(id)`, jadi indeks ikut diperbarui sendiri setelah sinkron Accurate. Data item tidak pernah ditulis.
- **Ukuran ban:**
  - `7.50-16` / `7.50 R16` / `7.50-R16` / `750-16` / `750/16` / `750 R16` → `SZ750-16`;
  - `(7.50/8.25)-16` → `SZ750-16` + `SZ825-16`;
  - `225/60-R18` → `SZ225/60-18`;
  - lebar tanpa titik (750-16) hanya dikenali bila ada kata BAN/TYRE/TIRE/VULKANISIR/VELG/RIM.
- **Kecocokan:** semua kata wajib cocok, persis / sinonim (`TYRE`, `TIRE` → `BAN`; `KOTAK` ↔ `BOX`) / awalan kata / salah ketik (1 huruf untuk 4–7 huruf, 2 untuk ≥ 8). Angka dan ukuran wajib cocok persis. Fallback "Partly matching" hanya boleh melepas satu kata biasa.
- **Ranking:** kode persis > awalan atau isi kode > nama persis > ukuran sama > semua kata > awalan > mirip. Urutan relevansi hanya berlaku bila tidak ada parameter `sort`.
- **Brand:** segmen `NAMA - BRAND /` tanpa angka atau simbol, dipakai minimal 2 item. Filter `?brand=`.
- **Respons** (tambahan saja): `data[].search_relevance`, `data[].search_brand`, `meta.search.brands`.
- **Kinerja:** satu request 60–80 ms di produksi; pembangunan indeks sekitar 200–300 ms sekali.

## Popup Smart Search per merek (12-11-2026)
- Tombol **Smart Search** di header Master Barang membuka popup yang memanggil `GET /api/items/smart-search?q=&exclude_used=` (izin `item.view`).
- Hasil dikelompokkan per merek: jumlah jenis item, jumlah item yang ada stoknya, dan total stok (QTY Master Barang, **dijumlah per satuan**). Grup "Brand not clear" selalu di urutan terakhir. Setiap item diberi tanda kondisi dari awal namanya: (BEKAS) used, (RUSAK) damaged, (VULKANISIR) retreaded.
- `exclude_used=1` membuang item (BEKAS) dan (RUSAK). Contoh `Ban 7.50 R16`: total 231 PCS → 116 PCS tanpa bekas/rusak.
