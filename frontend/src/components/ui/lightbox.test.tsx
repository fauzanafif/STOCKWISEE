import { describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { LightboxHost, openImage, showBlob } from './lightbox'

describe('LightboxHost', () => {
  it('shows a picture in the popup and closes on Escape', async () => {
    render(<LightboxHost />)
    act(() => openImage([{ src: 'data:image/png;base64,AAAA', alt: 'Foto A' }, { src: 'data:image/png;base64,BBBB', alt: 'Foto B' }]))
    expect(screen.getByRole('dialog', { name: 'Foto A' })).toBeInTheDocument()
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })) })
    expect(screen.getByRole('dialog', { name: 'Foto B' })).toBeInTheDocument()
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('a fetched picture goes to the popup', () => {
    render(<LightboxHost />)
    URL.createObjectURL = () => 'blob:test'
    act(() => showBlob(new Blob(['x'], { type: 'image/jpeg' }), { alt: 'Tanda Kembali' }))
    expect(screen.getByRole('dialog', { name: 'Tanda Kembali' })).toBeInTheDocument()
  })
})
