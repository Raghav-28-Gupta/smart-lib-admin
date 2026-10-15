import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('design system', () => {
  it('ships the Organic tokens without the Google Fonts import', () => {
    const css = readFileSync('styles/ds.css', 'utf8')
    expect(css).toContain('--color-bg: #f5ead8')
    expect(css).not.toContain('fonts.googleapis.com')
  })
})
