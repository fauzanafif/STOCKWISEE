# Pendekatan Odoo: Smart Buttons, Chatter, Activities, Audit Trail

Status: **di-deploy 12-11-2026** (migrasi `2026_11_12_120000_create_document_chatter_tables.php` via `--path`, cache rute/config diperbarui, frontend disalin). Backup: `Backup/odoo-docs-deploy-20261112_091402`.

Cakupan: Item Request, Delivery Order (NPBG), Draft Purchase Request, Purchase Request, Purchase Order, Receipt, Return. Semua aditif: tidak ada workflow, status, penomoran, URL/API lama, permission key, Stock Ledger, atau integrasi Accurate yang diubah. Tidak ada Berita Acara.

## Arsitektur (`app/Support/Documents`)
| Bagian | Isi |
|---|---|
| `DocumentRegistry` | Daftar tipe dokumen, cara membuka, dan aturan lihat (sama dengan halaman dokumennya). Dokumen per-baris memakai nomor sebagai kunci: Delivery Order = `no_npbg`, Purchase Request = `no_ppb`, Receipt = `no_ri`. |
| `DocumentGraph` | Dokumen terkait, **hanya membaca** relasi yang ada: `item_request_lines.npbg_id/ppb_id/ppb_draft_id`, `item_request_fulfillments(.lines)`, `ppb_drafts.item_request_id/no_ppb`, `ppb_draft_lines.ppb_id`, `purchase_order_items.approved_ppb_id`, `purchase_orders.ppb_id`, `ri.no_po/no_ppb`, `purchase_returns.no_ri/no_po`, `purchase_return_lines.ri_id`. |
| `DocumentActivities` | Aktivitas **sistem** (dihitung dari status nyata dengan aturan yang sama dengan To-Do, hilang sendiri saat dokumen bergerak) dan **manual** (`doc_activities`, notifikasi lonceng ke penanggung jawab, tampil di To-Do sebagai `doc_activity`). |
| `DocumentAudit` | Observer Eloquent pada ItemRequest(Line/Fulfillment), Npbg, PpbDraft(Line), Ppb, PurchaseOrder(Item), Ri, PurchaseReturn(Line). Mencatat before → after ke `doc_audit_logs` hanya bila ada user login, dan **tidak** dari rute `api.agent.*` / `api.sync.*`, console, atau queue. Kolom token/foto/tanda tangan/`accurate_*` dilewati. Kegagalan log tidak menghentikan proses bisnis. `DocAuditLog` menolak update/delete. |

## Tabel baru
`doc_messages` (MESSAGE / NOTE, soft delete), `doc_message_attachments` (disk `local`, maks 5 file × 10 MB), `doc_activities`, `doc_audit_logs`.

## API (`/api/documents/{type}/{id}/…`, auth:sanctum; izin = izin halaman dokumen)
`related`, `feed`, `messages` (POST; PUT/DELETE `messages/{id}` hanya penulis), `attachments/{id}`, `activities` (GET/POST; `{id}/done`, `{id}/cancel`), `assignees`, `audit`. Ditambah `GET /api/documents/activities/mine`.

## Visibilitas
- **Message:** semua yang bisa membuka dokumen, termasuk peminta Item Request.
- **Internal Note dan Activity:** hanya "staf" dokumen. Untuk Item Request artinya pemegang `item_request.view/process/approve_*/handover`; untuk dokumen lain, pemegang izin lihatnya. Peminta tidak bisa melihatnya.
- **Smart Buttons:** hanya menampilkan tipe dokumen yang boleh dibuka user.

## Frontend
`components/documents/SmartButtons.tsx` (di bawah judul dokumen), `Chatter.tsx` (di bawah isi dokumen: Send message, Log note, Activity, Audit trail, filter All/Messages/Notes/Changes). Label lama yang masih tampil sudah diganti: "Shortage to Draft Purchase Request", grup izin "Delivery Order", judul cadangan "Delivery Order", "from Purchase Request". Label "NPBG No." di Tracking dibiarkan karena merujuk ke nomor dokumen resmi.

## Belum dicakup
Statusbar seragam (Item Request sudah punya StepsBar), Group By di list, Chatter untuk Physical Inventory / RFQ, dan audit locking per modul workflow lama. Audit hanya menangkap perubahan lewat Eloquent; update massal via query builder tidak tercatat.

## Rollback
`php artisan migrate:rollback --path=database/migrations/2026_11_12_120000_create_document_chatter_tables.php --force`, lalu kembalikan `app.html` dari backup dan jalankan `config:cache` + `route:cache`. Observer terdaftar di `AppServiceProvider` dan aman bila tabel tidak ada (error-nya hanya di-report).
