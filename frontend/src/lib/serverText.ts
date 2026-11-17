/**
 * The API's display labels are in Indonesian. They are shown in English here, only for reading:
 * codes and values sent back to the server are other fields and never pass through this.
 */
const EN: Record<string, string> = {
  'Barang Bekas Kembali': 'Used Items Returned', 'Barang Dipinjamkan': 'Items Lent', 'Barang belum dipesan': 'Items not ordered', 'Barang dipinjamkan': 'Items lent',
  'Barang paling banyak di-PPB (30 hari)': 'Most requested items in Purchase Request (30 days)', 'Barang paling banyak diterima (30 hari)': 'Most received items (30 days)', 'Barang paling sering diminta (30 hari)': 'Most requested items (30 days)',
  'Barang perlu PPB': 'Items needing Purchase Request', 'Barang siap di-PO': 'Items ready for PO', 'Baris PPB 90 hari': 'Purchase Request rows, 90 days', 'Baris RI per divisi (30 hari)': 'Receipt rows per division (30 days)', 'Baris barang diterima bulan ini': 'Item rows received this month',
  'Belum dikirim': 'Not sent', 'Belum dipesan': 'Not ordered', 'Dalam approval': 'In approval', 'Di bawah Safety Stock': 'Below Safety Stock', 'Dibatalkan': 'Cancelled', 'Dikirim': 'Sent', 'Disetujui': 'Approved', 'Disiapkan gudang': 'Prepared by warehouse',
  'Diterima': 'Received', 'Diterima sebagian': 'Partly received', 'Ditolak': 'Rejected', 'Ditolak / batal': 'Rejected / cancelled', 'Ditugaskan': 'Assigned', 'Ditutup': 'Closed', 'Divalidasi admin gudang': 'Validated by warehouse admin', 'Ganti barang': 'Item replacement',
  'Item dianalisa': 'Items analysed', 'Kurang': 'Short', 'Maintenance (Sub SPK)': 'Maintenance (Sub SPK)', 'Manufaktur & Assembly': 'Manufacturing & Assembly', 'Menunggu admin': 'Waiting for admin', 'Menunggu approval': 'Waiting for approval', 'Menunggu barang': 'Waiting for items',
  'Menunggu barang (PO)': 'Waiting for items (PO)', 'Menunggu diterima': 'Waiting to be received', 'Menunggu pengadaan (PPB)': 'Waiting for procurement (Purchase Request)', 'Menunggu verifikasi': 'Waiting for verification', 'NPBG menunggu approval Anda': 'Delivery Order waiting for your approval',
  'Nama produk / proyek': 'Product / project name', 'Nilai PO bulan ini': 'PO value this month', 'Nilai diterima bulan ini': 'Value received this month', 'Opname aktif': 'Active opname', 'PO 90 hari': 'PO, 90 days', 'PO belum diterima penuh': 'POs not fully received', 'PO berjalan': 'Running POs',
  'PO bulan ini': 'PO this month', 'PO dikembalikan Direktur, perlu diperbaiki': 'PO returned by Director, needs correction', 'PO disetujui, belum dibeli (unggah bukti pembelian)': 'PO approved, not purchased yet (upload purchase proof)', 'PO menunggu approval Anda': 'PO waiting for your approval', 'PO per hari': 'PO per day',
  'PPB bulan ini': 'Purchase Request this month', 'PPB menunggu approval Anda': 'Purchase Request waiting for your approval', 'PPB menunggu barang': 'Purchase Request waiting for items', 'PPB per hari': 'Purchase Request per day', 'Penerima dengan tugas aktif terbanyak': 'Assignees with the most active tasks', 'Penggantian Ban': 'Tyre Replacement',
  'Perlu ditinjau': 'Needs review', 'Perlu revisi': 'Needs revision', 'Permintaan ATK': 'Office Supplies Request', 'Permintaan Distribusi': 'Distribution Request', 'Persetujuan Direktur': 'Director Approval', 'Persetujuan Direktur (lewati Manajer)': 'Director Approval (skips Manager)', 'Persetujuan Manajer': 'Manager Approval',
  'Pinjam dari Luar': 'Borrowed from Outside', 'Pinjaman lewat tempo': 'Overdue loans', 'Pinjaman luar aktif': 'Active external loans', 'RI bulan ini': 'Receipt this month', 'RI bulan ini (Accurate)': 'Receipt this month (Accurate)', 'RI per hari': 'Receipt per day', 'Request Umum': 'General Request', 'Request bulan ini': 'Requests this month',
  'Request dikirim': 'Request sent', 'Request masuk per hari': 'Requests in per day', 'SPK berjalan': 'Running SPK', 'Selesai': 'Done', 'Selesai bulan ini': 'Done this month', 'Siap di-PO': 'Ready for PO', 'Siap serah terima': 'Ready for handover', 'Siapkan & serah terima gudang': 'Prepare & hand over at warehouse',
  'Status AMAN': 'Status SAFE', 'Status TIDAK AMAN': 'Status UNSAFE', 'Submitted (terlambat)': 'Submitted (late)', 'Sudah dibeli': 'Purchased', 'Terlambat': 'Late', 'Terpenuhi': 'Fulfilled', 'Tugas aktif': 'Active tasks', 'Tugas diberikan per hari': 'Tasks given per day', 'Untuk armada / tujuan': 'For fleet / destination', 'Untuk unit / mesin / lokasi': 'For unit / machine / location',
  'Vendor dengan nilai PO terbesar (30 hari)': 'Vendors with the largest PO value (30 days)', 'Verifikasi': 'Verification', 'Sedang': 'Medium', 'Rendah': 'Low', 'Tinggi': 'High', 'Draft PPB': 'Draft Purchase Request', 'Dikembalikan': 'Returned', 'Dibatalkan oleh peminta': 'Cancelled by requester',
  'barang di Penawaran Harga, belum diajukan ke Direktur': 'items in Price Quotation, not submitted to the Director yet', 'barang perlu dibuatkan PPB (Draft PPB)': 'items need a Purchase Request (Draft Purchase Request)', 'barang permintaan Anda siap diambil di gudang': 'of your requested items are ready to collect at the warehouse', 'barang sudah dibeli, menunggu diterima (buat RI)': 'items purchased, waiting to be received (create Receipt)',
  'draft Purchase Request belum diminta approval': 'Purchase Request drafts not yet sent for approval',
  'hasil tugas menunggu Anda tinjau': 'task results waiting for your review', 'item PPB disetujui, masukkan ke Penawaran Harga': 'approved Purchase Request items, move them to Price Quotation', 'penawaran harga menunggu Anda pilih vendornya': 'price quotations waiting for your vendor pick', 'request barang menunggu approval / serah terima Anda': 'item requests waiting for your approval / handover',
  'request barang perlu diverifikasi': 'item requests need verification', 'tugas belum diserahkan': 'tasks not submitted yet', 'tugas dikembalikan, perlu direvisi': 'tasks returned, need revision', 'vendor dipilih Direktur, buat Draft PO': 'vendors picked by the Director, create PO from Price Quotation',
  'menunggu barang (PO)': 'waiting for items (PO)', 'menunggu pengadaan': 'waiting for procurement',
  '0–7 hari': '0–7 days', '8–30 hari': '8–30 days', '31–60 hari': '31–60 days', '61–90 hari': '61–90 days', '> 90 hari': '> 90 days',
}

const one = (s: string) => EN[s] ?? s
/** a composite label reads part by part ("NPBG partial & menunggu barang (PO)") */
const say = (s: string) => EN[s] ?? (s.includes(' & ') ? s.split(' & ').map(one).join(' & ') : s)

const isLabel = (k: string) => k === 'label' || k === 'text' || k.endsWith('_label')

/** Rewrites the display labels of a response in place. */
export function englishLabels<T>(data: T): T {
  if (Array.isArray(data)) data.forEach(englishLabels)
  else if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>
    for (const k of Object.keys(o)) {
      const v = o[k]
      if (typeof v === 'string') { if (isLabel(k)) o[k] = say(v) } else if (v && typeof v === 'object') englishLabels(v)
    }
  }
  return data
}
