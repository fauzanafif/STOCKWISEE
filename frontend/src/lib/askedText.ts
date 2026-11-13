const fmtQty = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 2 })

/** The fields of a request line that say what was asked. */
export interface AskedLine {
  deskripsi_peminta?: string | null
  deskripsi_barang?: string | null
  qty: number | string
  satuan?: string | null
  requested_qty?: number | null
  requested_unit?: string | null
  decision?: string | null
  asked_unit?: string | null
}

/** What was asked, in the unit asked: 1 DUS (also after the verification turned it into 5 RIM). */
export function askedQty(l: AskedLine): { qty: number; unit: string } {
  if (l.requested_qty != null && l.requested_unit) return { qty: Number(l.requested_qty), unit: l.requested_unit }
  if (l.decision == null && l.asked_unit) return { qty: Number(l.qty), unit: l.asked_unit }
  return { qty: Number(l.qty), unit: l.satuan ?? '' }
}

/** "HVS A4 1 DUS": the requester's words, then how many and in which unit they asked. */
export function askedText(l: AskedLine): string {
  const name = (l.deskripsi_peminta ?? l.deskripsi_barang ?? '').trim()
  const { qty, unit } = askedQty(l)
  return `${name} ${fmtQty(qty)}${unit ? ` ${unit}` : ''}`.trim()
}
