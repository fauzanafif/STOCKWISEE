import { useMemo, useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, SlidersHorizontal } from 'lucide-react'
import { useItemHistory, type ItemHistoryRow } from '@/features/inventory/api'
import { DocLink } from '@/components/DocLink'
import { Modal } from '@/components/ui/modal'
import { DataTable, type Column } from '@/components/DataTable'
import { ExportBar } from '@/components/export/ExportBar'
import { useInfiniteRows } from '@/components/InfiniteRows'
import { cn } from '@/lib/utils'

const fmtDate = (v: string | null) =>
  v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

/** Tampilan tiap jenis histori — ikon, warna badge, dan tanda +/- di angka qty. */
const TYPE_STYLE: Record<ItemHistoryRow['type'], { icon: typeof ArrowDownToLine; label: string; badge: string; amount: string; sign: string }> = {
  MASUK: { icon: ArrowDownToLine, label: 'In', badge: 'bg-emerald-100 text-emerald-700', amount: 'text-emerald-700', sign: '+' },
  KELUAR: { icon: ArrowUpFromLine, label: 'Out', badge: 'bg-amber-100 text-amber-700', amount: 'text-amber-700', sign: '−' },
  ADJUST: { icon: SlidersHorizontal, label: 'Adjustment', badge: 'bg-slate-200 text-slate-700', amount: 'text-slate-700', sign: '' },
}

const BASE_COLUMNS: Column<ItemHistoryRow>[] = [
  { key: 'date', header: 'Date', className: 'whitespace-nowrap', cell: (r) => fmtDate(r.date) },
  {
    key: 'type',
    header: 'Type',
    cell: (r) => {
      const s = TYPE_STYLE[r.type]
      const Icon = s.icon
      return (
        <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium', s.badge)}>
          <Icon className="size-3.5" /> {s.label}
        </span>
      )
    },
  },
  { key: 'doc', header: 'Document No.', cell: (r) => (r.doc_no ? <DocLink no={r.doc_no} className="text-xs" /> : <span className="text-muted-foreground">—</span>) },
  {
    key: 'counterparty',
    header: 'Vendor / Customer / Plate No.',
    className: 'max-w-[200px]',
    cell: (r) => r.counterparty ? (
      <span className="block truncate" title={r.counterparty}>
        <span className="text-xs text-muted-foreground">{r.counterparty_label}: </span>{r.counterparty}
      </span>
    ) : <span className="text-muted-foreground">—</span>,
  },
]

/** Kolom No. Seri hanya ditambahkan kalau barang ini memang punya histori bernomor seri (ban, aset, dll.) — supaya tabel tidak menampilkan kolom kosong untuk barang biasa. */
const SERI_COLUMN: Column<ItemHistoryRow> = {
  key: 'seri',
  header: 'Serial No.',
  className: 'max-w-[160px]',
  cell: (r) => r.no_seri ? <span className="block truncate text-[13px]" title={r.no_seri}>{r.no_seri}</span> : <span className="text-muted-foreground">—</span>,
}

const TAIL_COLUMNS: Column<ItemHistoryRow>[] = [
  {
    key: 'qty',
    header: 'Qty',
    className: 'text-right',
    cell: (r) => {
      if (r.qty == null) return <span className="text-muted-foreground">—</span>
      const s = TYPE_STYLE[r.type]
      return <span className={cn('whitespace-nowrap text-[13px] font-semibold tabular-nums', s.amount)}>{s.sign}{Math.abs(r.qty).toLocaleString('id-ID')} {r.satuan ?? ''}</span>
    },
  },
  {
    key: 'note',
    header: 'Notes',
    className: 'max-w-[180px]',
    cell: (r) => r.note ? <span className="block truncate" title={r.note}>{r.note}</span> : <span className="text-muted-foreground">—</span>,
  },
]

export function ItemHistoryModal({
  itemId, itemCode, itemDescription, onClose,
}: {
  itemId: number
  itemCode: string
  itemDescription: string
  onClose: () => void
}) {
  const [page, setPage] = useState(1)
  const [type, setType] = useState<ItemHistoryRow['type'] | null>(null)
  const { data, isLoading } = useItemHistory(itemId, { page, per_page: 20, type: type ?? undefined })
  const { rows, footer } = useInfiniteRows(data, page, setPage)

  function toggleType(next: ItemHistoryRow['type']) {
    setType((cur) => (cur === next ? null : next))
    setPage(1)
  }
  const hasSerial = useMemo(() => rows.some((r) => r.no_seri), [rows])
  const columns = useMemo(() => (hasSerial ? [...BASE_COLUMNS, SERI_COLUMN, ...TAIL_COLUMNS] : [...BASE_COLUMNS, ...TAIL_COLUMNS]), [hasSerial])

  return (
    <Modal
      open
      onClose={onClose}
      className="max-w-3xl"
      title={<span className=" text-sm">{itemCode}</span>}
      description={itemDescription}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {data?.summary && (
          <div className="flex flex-wrap gap-2 text-xs">
            <button
              type="button"
              onClick={() => toggleType('MASUK')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-emerald-700 transition-colors',
                type === 'MASUK' ? 'bg-emerald-600 text-white' : 'bg-emerald-100 hover:bg-emerald-200',
              )}
            >
              <ArrowDownToLine className="size-3.5" /> {data.summary.masuk} In
            </button>
            <button
              type="button"
              onClick={() => toggleType('KELUAR')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-amber-700 transition-colors',
                type === 'KELUAR' ? 'bg-amber-600 text-white' : 'bg-amber-100 hover:bg-amber-200',
              )}
            >
              <ArrowUpFromLine className="size-3.5" /> {data.summary.keluar} Out
            </button>
            <button
              type="button"
              onClick={() => toggleType('ADJUST')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-slate-700 transition-colors',
                type === 'ADJUST' ? 'bg-slate-600 text-white' : 'bg-slate-200 hover:bg-slate-300',
              )}
            >
              <SlidersHorizontal className="size-3.5" /> {data.summary.adjust} Adjustment
            </button>
          </div>
        )}
        <ExportBar
          dataset="item-history"
          filters={{ item_id: itemId }}
          filenameBase={`histori-${itemCode}`}
          viewPermission="item.view"
        />
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => `${r.type}|${r.doc_no}|${r.date}|${r.qty}|${r.counterparty}|${r.note}`}
        isLoading={isLoading}
        emptyText="No history for this item yet."
        containerClassName="max-h-[50vh]"
        stickyHeader
        footer={footer}
      />
    </Modal>
  )
}
