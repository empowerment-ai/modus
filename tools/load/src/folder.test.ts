import { describe, expect, it } from 'vitest'
import { endingNote, folderName } from './folder'

describe('folderName', () => {
  it('includes seconds, so runs in the same minute get their own folders', () => {
    const a = folderName(new Date(2026, 9, 13, 14, 5, 7), 'smoke', 1)
    const b = folderName(new Date(2026, 9, 13, 14, 5, 38), 'smoke', 1)
    expect(a).toBe('20261013-140507-smoke-1srv')
    expect(b).toBe('20261013-140538-smoke-1srv')
  })
})

describe('endingNote', () => {
  it('says how and when the run ended, and why', () => {
    const at = new Date('2026-10-13T14:05:07.000Z')
    expect(endingNote('INTERRUPTED', 'SIGINT', at)).toMatch(/^This run was interrupted at 2026-10-13T14:05:07.000Z: SIGINT\n/)
    expect(endingNote('FAILED', 'docker exited 1', at)).toContain('failed at 2026-10-13T14:05:07.000Z: docker exited 1')
  })
})
