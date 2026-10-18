import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createPack,
  parsePack,
  readPack,
  serializePack,
  validatePack,
  writePack,
  slugifyPackName,
  PackFormatError,
} from '../src/pack-format.js'
import type { PluginPack } from '../src/types.js'

function samplePack(): PluginPack {
  return {
    kind: 'dsh-plugin-pack',
    format: 1,
    name: 'research',
    createdAt: '2026-10-17T00:00:00.000Z',
    generator: { tool: 'dsh-plugin-pack', version: '0.1.0' },
    plugins: [
      { name: 'dsh-foo', version: '1.2.3', portable: true, source: { type: 'npm', spec: 'dsh-foo@1.2.3' } },
    ],
  }
}

describe('createPack', () => {
  it('creates a valid pack with required fields', () => {
    const p = createPack(samplePack().plugins, { name: 'research' })
    expect(p.kind).toBe('dsh-plugin-pack')
    expect(p.format).toBe(2)
    expect(p.name).toBe('research')
    expect(p.generator.tool).toBe('dsh-plugin-pack')
    expect(p.plugins).toHaveLength(1)
  })

  it('includes optional description and dsh compatible', () => {
    const p = createPack([], { name: 'x', description: 'd', dsh: { compatible: '0.2.0' } })
    expect(p.description).toBe('d')
    expect(p.dsh?.compatible).toBe('0.2.0')
  })
})

describe('validatePack', () => {
  it('accepts a valid pack', () => {
    expect(() => validatePack(samplePack())).not.toThrow()
  })

  it('rejects wrong kind', () => {
    const p = { ...samplePack(), kind: 'other' }
    expect(() => validatePack(p)).toThrow(PackFormatError)
  })

  it('rejects unknown top-level field', () => {
    const p = { ...samplePack(), apiKey: 'secret' }
    expect(() => validatePack(p)).toThrow(/apiKey/)
  })

  it('rejects unknown entry field', () => {
    const p = samplePack()
    p.plugins[0] = { ...p.plugins[0], token: 'x' } as never
    expect(() => validatePack(p)).toThrow(/token/)
  })

  it('rejects empty plugins array', () => {
    const p = { ...samplePack(), plugins: [] }
    expect(() => validatePack(p)).toThrow(/at least one/)
  })

  it('rejects duplicate plugin names', () => {
    const p = samplePack()
    p.plugins.push({ ...p.plugins[0] })
    expect(() => validatePack(p)).toThrow(/duplicate/)
  })

  it('rejects git commit that is not 40 hex chars', () => {
    const p = samplePack()
    p.plugins[0] = {
      name: 'dsh-bar', portable: true,
      source: { type: 'git', url: 'https://github.com/u/r.git', commit: 'short' },
    }
    expect(() => validatePack(p)).toThrow(/40-character/)
  })

  it('rejects unknown source type', () => {
    const p = samplePack()
    p.plugins[0] = { name: 'x', portable: true, source: { type: 'ftp' } as never }
    expect(() => validatePack(p)).toThrow(/not supported/)
  })
})

describe('parsePack', () => {
  it('parses valid JSON', () => {
    const p = parsePack(JSON.stringify(samplePack()))
    expect(p.name).toBe('research')
  })

  it('throws on invalid JSON', () => {
    expect(() => parsePack('{not json')).toThrow(PackFormatError)
  })
})

describe('writePack / readPack round-trip', () => {
  it('writes and reads back', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pack-fmt-'))
    try {
      const file = join(dir, 'test.dshpack.json')
      const pack = samplePack()
      writePack(file, pack)
      const read = readPack(file)
      expect(read.name).toBe(pack.name)
      expect(read.plugins).toHaveLength(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('serializePack', () => {
  it('produces pretty JSON with trailing newline', () => {
    const s = serializePack(samplePack())
    expect(s.endsWith('\n')).toBe(true)
    expect(JSON.parse(s).name).toBe('research')
  })
})

describe('slugifyPackName', () => {
  it('lowercases and replaces spaces', () => {
    expect(slugifyPackName('My Research Pack')).toBe('my-research-pack')
  })
  it('removes special chars', () => {
    expect(slugifyPackName('a@b#c!')).toBe('abc')
  })
  it('falls back to "pack" for empty', () => {
    expect(slugifyPackName('!!!')).toBe('pack')
  })
})
