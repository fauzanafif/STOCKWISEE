import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { filledSerials, RiSerialEntry, serialProblem, splitSerials } from './RiSerialEntry'

function Host({ qty, start = [] }: { qty: number; start?: string[] }) {
  const [value, setValue] = useState(start)
  return <><RiSerialEntry qty={qty} value={value} onChange={setValue} label="Item" /><output>{filledSerials(value).join('|')}</output></>
}

describe('RI serial numbers', () => {
  it('reads what Accurate stores', () => {
    expect(splitSerials('089001-089050 ; 089051-089100')).toEqual(['089001-089050', '089051-089100'])
    expect(splitSerials(null)).toEqual([])
  })

  it('takes none, or exactly one per unit without repeats', () => {
    expect(serialProblem([], 12)).toBeNull()
    expect(serialProblem(['', ' '], 12)).toBeNull()
    expect(serialProblem(['A', 'B'], 2)).toBeNull()
    expect(serialProblem(['A'], 2)).toContain('2 units')
    expect(serialProblem(['A', 'a'], 2)).toContain('twice')
    expect(serialProblem(['A'], 1.5)).toContain('whole')
  })

  it('shows one input per unit, and a pasted column fills downward', () => {
    render(<Host qty={3} />)
    const first = screen.getByLabelText('Item serial 1')
    expect(screen.getAllByRole('textbox')).toHaveLength(3)
    fireEvent.paste(first, { clipboardData: { getData: () => 'A1\r\nA2\r\nA3\r\n' } })
    expect(screen.getByRole('status')).toHaveTextContent('A1|A2|A3')
  })

  it('moves down on Enter, as a barcode scanner sends', () => {
    render(<Host qty={2} />)
    fireEvent.keyDown(screen.getByLabelText('Item serial 1'), { key: 'Enter' })
    expect(document.activeElement).toBe(screen.getByLabelText('Item serial 2'))
  })

  it('keeps serials beyond the quantity visible so they can be removed', () => {
    render(<Host qty={1} start={['A', 'B']} />)
    expect(screen.getAllByRole('textbox')).toHaveLength(2)
  })
})
