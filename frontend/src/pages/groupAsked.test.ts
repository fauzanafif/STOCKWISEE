import { describe, expect, it } from 'vitest'
import type { ItemRequestLine } from '@/features/itemRequests/api'
import { groupAsked } from './ItemRequestDetailPage'

const line = (id: number, over: Partial<ItemRequestLine>) => ({ id, deskripsi_barang: 'x', deskripsi_peminta: null, note: null, decision: 'NPBG', qty: 1, satuan: 'PCS', ...over }) as ItemRequestLine

describe('groupAsked', () => {
  it('groups the verified items of one requested item, keeping the order of the request', () => {
    const g = groupAsked([
      line(1, { deskripsi_peminta: 'bukuu', note: 'eeeee' }),
      line(2, { deskripsi_peminta: 'spidol', note: 'rrr' }),
      line(3, { deskripsi_peminta: 'bukuu', note: 'eeeee' }),
      line(4, { deskripsi_peminta: 'Bukuu ', note: 'eeeee' }),
      line(5, { deskripsi_peminta: 'spidol', note: 'rrr' }),
    ])
    expect(g.map((x) => x.lines.map((l) => l.id))).toEqual([[1, 3, 4], [2, 5]])
  })

  it('keeps two asks still to verify apart, even with the same words', () => {
    const g = groupAsked([line(1, { deskripsi_barang: 'buku', decision: null }), line(2, { deskripsi_barang: 'buku', decision: null })])
    expect(g).toHaveLength(2)
  })
})
