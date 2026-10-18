import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PackStore } from '../src/store.js'
import { createPack } from '../src/pack-format.js'

function makePack(name: string) {
  return createPack(
    [{ name: 'dsh-foo', version: '1.0.0', portable: true, source: { type: 'npm', spec: 'dsh-foo@1.0.0' } }],
    { name },
  )
}

describe('PackStore', () => {
  let dir: string
  let store: PackStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pack-store-'))
    store = new PackStore(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates the plugin-packs directory', () => {
    expect(existsSync(join(dir, 'plugin-packs'))).toBe(true)
  })

  it('saves and lists a pack record', () => {
    const { record } = store.savePack(makePack('research'), 'exported')
    expect(record.name).toBe('research')
    expect(record.kind).toBe('exported')
    expect(record.pluginCount).toBe(1)
    const list = store.listRecords()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(record.id)
  })

  it('reads a saved pack', () => {
    const { record } = store.savePack(makePack('research'), 'exported')
    const pack = store.readRecordPack(record.id)
    expect(pack.name).toBe('research')
    expect(pack.plugins).toHaveLength(1)
  })

  it('renames a record', () => {
    const { record } = store.savePack(makePack('old'), 'exported')
    const renamed = store.renameRecord(record.id, 'new')
    expect(renamed.name).toBe('new')
    expect(store.getRecord(record.id)?.name).toBe('new')
  })

  it('duplicates a record with a new name', () => {
    const { record } = store.savePack(makePack('orig'), 'exported')
    const copy = store.duplicateRecord(record.id, 'copy')
    expect(copy.name).toBe('copy')
    expect(copy.id).not.toBe(record.id)
    expect(store.listRecords()).toHaveLength(2)
  })

  it('deletes a record and its pack file', () => {
    const { record } = store.savePack(makePack('gone'), 'exported')
    const filePath = join(dir, 'plugin-packs', record.fileName)
    expect(existsSync(filePath)).toBe(true)
    store.deleteRecord(record.id)
    expect(store.listRecords()).toHaveLength(0)
    expect(existsSync(filePath)).toBe(false)
  })

  it('throws on missing record', () => {
    expect(store.getRecord('nonexistent')).toBeUndefined()
    expect(() => store.deleteRecord('nonexistent')).toThrow(/not found/)
  })
})
