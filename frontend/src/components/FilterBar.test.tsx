import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FilterBar } from './FilterBar'

const box = (el: HTMLElement) => el.closest('[data-fb-kid]') as HTMLElement

describe('FilterBar', () => {
  it('folds only the filters past the fourth on a wide screen, never a button or a badge', async () => {
    render(
      <FilterBar>
        <input aria-label="f1" />
        <select aria-label="f2"><option value="">All</option></select>
        <input aria-label="f3" />
        <span>Done, not yet entered in Accurate</span>
        <input aria-label="f4" />
        <input aria-label="f5" />
        <button type="button">Export</button>
        <button type="button">Reset</button>
      </FilterBar>,
    )
    // after the effect has read which children are filters
    const more = await screen.findByRole('button', { name: /Filter lainnya \(1\)/ })
    expect(more).toBeInTheDocument()
    expect(box(screen.getByLabelText('f4')).className).not.toMatch(/(^| )md:hidden/)
    expect(box(screen.getByLabelText('f5')).className).toMatch(/(^| )md:hidden/)
    for (const name of ['Export', 'Reset']) expect(box(screen.getByRole('button', { name })).className).not.toMatch(/(^| )md:hidden/)
    expect(box(screen.getByText('Done, not yet entered in Accurate')).className).not.toMatch(/(^| )md:hidden/)
  })

  it('shows no "more filters" button when there are four filters and a Reset', () => {
    render(
      <FilterBar>
        <input aria-label="a" /><input aria-label="b" /><input aria-label="c" /><input aria-label="d" />
        <button type="button">Reset</button>
      </FilterBar>,
    )
    expect(screen.queryByRole('button', { name: /Filter lainnya/ })).not.toBeInTheDocument()
  })
})
