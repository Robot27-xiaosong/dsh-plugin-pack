/** Persist pack records and pack files inside a DSH profile directory. */
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, renameSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { PackRecord, PluginPack } from './types.js'
import { readPack, writePack, slugifyPackName } from './pack-format.js'

/** Directory name (under the profile dir) where packs and records live. */
export const STORE_DIRNAME = 'plugin-packs'

const RECORDS_FILE = 'records.json'

/** In-memory + on-disk store of pack records for one profile. */
export class PackStore {
  private readonly dir: string
  private readonly recordsPath: string

  constructor(profileDir: string) {
    this.dir = join(profileDir, STORE_DIRNAME)
    this.recordsPath = join(this.dir, RECORDS_FILE)
    mkdirSync(this.dir, { recursive: true })
  }

  /** Absolute path to the store directory. */
  get storeDir(): string {
    return this.dir
  }

  /** Path for a pack file with the given slug. */
  packPath(slug: string): string {
    return join(this.dir, `${slug}.dshpack.json`)
  }

  listRecords(): PackRecord[] {
    return this.loadRecords()
  }

  getRecord(id: string): PackRecord | undefined {
    return this.loadRecords().find((r) => r.id === id)
  }

  /** Read the pack file referenced by a record. */
  readRecordPack(id: string): PluginPack {
    const record = this.getRecord(id)
    if (!record) throw new Error(`pack record not found: ${id}`)
    // Try the recorded fileName first, then the alternative extension.
    // Imported and exported records may share the same slug but use
    // .dshpack.json vs .manifest.json respectively.
    const candidates = [
      record.fileName,
      record.fileName.replace(/\.dshpack\.json$/, '.manifest.json'),
      record.fileName.replace(/\.manifest\.json$/, '.dshpack.json'),
    ].filter((v, i, a) => a.indexOf(v) === i)
    for (const candidate of candidates) {
      const path = join(this.dir, candidate)
      if (existsSync(path)) return readPack(path)
    }
    throw new Error(`pack manifest not found for record "${record.name}" (tried: ${candidates.join(', ')})`)
  }

  /** Save a pack manifest and create a record. Returns the record. */
  savePack(
    pack: PluginPack,
    kind: 'exported' | 'imported',
    options: { archiveName?: string } = {},
  ): { record: PackRecord; filePath: string } {
    const slug = slugifyPackName(pack.name)
    // For offline bundles the binary is created by archive.ts; store the
    // manifest as a sidecar for record listing.
    const fileName = options.archiveName ? `${slug}.manifest.json` : `${slug}.dshpack.json`
    const filePath = join(this.dir, fileName)
    writePack(filePath, pack)

    const now = new Date().toISOString()
    const record: PackRecord = {
      id: randomUUID(),
      name: pack.name,
      description: pack.description,
      notes: pack.notes,
      version: pack.version,
      author: pack.author,
      tags: pack.tags,
      promoUrl: pack.promoUrl,
      compatible: pack.dsh?.compatible,
      kind,
      pluginCount: pack.plugins.length,
      portableCount: pack.plugins.filter((p) => p.portable).length,
      format: pack.format,
      createdAt: now,
      updatedAt: now,
      fileName,
      ...(options.archiveName ? { archiveName: options.archiveName } : {}),
    }
    const records = this.loadRecords()
    records.push(record)
    this.saveRecords(records)
    return { record, filePath }
  }

  renameRecord(id: string, newName: string): PackRecord {
    const records = this.loadRecords()
    const idx = records.findIndex((r) => r.id === id)
    if (idx < 0) throw new Error(`pack record not found: ${id}`)
    records[idx] = { ...records[idx], name: newName, updatedAt: new Date().toISOString() }
    this.saveRecords(records)
    return records[idx]
  }

  /** Detach a plugin from a pack: it stays installed but is no longer managed by the pack. */
  detachPlugin(id: string, pluginName: string): PackRecord {
    const records = this.loadRecords()
    const idx = records.findIndex((r) => r.id === id)
    if (idx < 0) throw new Error(`pack record not found: ${id}`)
    const detached = new Set(records[idx].detachedPlugins ?? [])
    detached.add(pluginName)
    records[idx] = {
      ...records[idx],
      detachedPlugins: Array.from(detached),
      updatedAt: new Date().toISOString(),
    }
    this.saveRecords(records)
    return records[idx]
  }

  duplicateRecord(id: string, newName: string): PackRecord {
    const records = this.loadRecords()
    const src = records.find((r) => r.id === id)
    if (!src) throw new Error(`pack record not found: ${id}`)
    const pack = readPack(join(this.dir, src.fileName))
    const renamed = { ...pack, name: newName }
    const { record } = this.savePack(renamed, src.kind)
    return record
  }

  deleteRecord(id: string): void {
    const records = this.loadRecords()
    const idx = records.findIndex((r) => r.id === id)
    if (idx < 0) throw new Error(`pack record not found: ${id}`)
    const [removed] = records.splice(idx, 1)
    this.saveRecords(records)
    const packFile = join(this.dir, removed.fileName)
    if (existsSync(packFile)) rmSync(packFile, { force: true })
    if (removed.archiveName) {
      const archiveFile = join(this.dir, removed.archiveName)
      if (existsSync(archiveFile)) rmSync(archiveFile, { force: true })
    }
  }

  private loadRecords(): PackRecord[] {
    if (!existsSync(this.recordsPath)) return []
    try {
      const raw = JSON.parse(readFileSync(this.recordsPath, 'utf8'))
      if (!Array.isArray(raw)) return []
      return raw as PackRecord[]
    } catch {
      return []
    }
  }

  private saveRecords(records: PackRecord[]): void {
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(this.recordsPath, JSON.stringify(records, null, 2) + '\n', 'utf8')
  }
}
