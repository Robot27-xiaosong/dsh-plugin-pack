import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PluginPackService } from '../src/service.js'
import { writePack } from '../src/pack-format.js'

function makeProfile(dir: string, deps: Record<string, string>) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: deps }, null, 2))
}

function makeManager(bundles: Array<Record<string, unknown>>, installed: string[] = []) {
  return {
    async listBundles() {
      return bundles
    },
    async installBundle(spec: string) {
      installed.push(spec)
      return { success: true, spec }
    },
  }
}

function communityBundle(name: string, spec: string, version = '1.0.0') {
  return {
    name, official: false, installed: true, availability: 'profile',
    enabled: true, source: spec, version, optional: false, removable: true, rows: [], overrides: [],
  }
}

function officialBundle(name: string) {
  return {
    name, official: true, installed: true, availability: 'installation',
    enabled: true, optional: false, removable: false, rows: [], overrides: [],
  }
}

describe('PluginPackService', () => {
  let dir: string
  let svc: PluginPackService
  let manager: ReturnType<typeof makeManager>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'svc-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function setup(deps: Record<string, string>, bundles: Array<Record<string, unknown>>) {
    makeProfile(dir, deps)
    manager = makeManager(bundles)
    const ctx = {
      get(name: string) {
        if (name === 'profileContext') return { dir }
        if (name === 'pluginManager') return manager
        return undefined
      },
      reflect: { provide: () => {} },
    }
    svc = new PluginPackService(ctx as never)
  }

  it('scanCommunity returns only community plugins', async () => {
    setup(
      { 'dsh-foo': 'dsh-foo@1.0.0', 'dsh-base': '0.2.0' },
      [communityBundle('dsh-foo', 'dsh-foo@1.0.0'), officialBundle('dsh-base')],
    )
    const list = await svc.scanCommunity()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('dsh-foo')
    expect(list[0].portable).toBe(true)
  })

  it('scanCommunity marks local links as not portable', async () => {
    setup(
      { 'dsh-local': 'link:../local' },
      [communityBundle('dsh-local', 'link:../local')],
    )
    const list = await svc.scanCommunity()
    expect(list[0].portable).toBe(false)
    expect(list[0].source.type).toBe('local')
  })

  it('buildPack with select resolves and warns on non-portable', async () => {
    setup(
      { 'dsh-foo': 'dsh-foo@1.0.0', 'dsh-local': 'link:../local' },
      [communityBundle('dsh-foo', 'dsh-foo@1.0.0'), communityBundle('dsh-local', 'link:../local')],
    )
    const result = await svc.buildPack({ select: ['dsh-foo', 'dsh-local', 'missing'] }, { name: 'p' })
    expect(result.pack.plugins).toHaveLength(2)
    expect(result.missing).toEqual(['missing'])
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('buildPack with all includes everything', async () => {
    setup(
      { 'dsh-foo': 'dsh-foo@1.0.0' },
      [communityBundle('dsh-foo', 'dsh-foo@1.0.0')],
    )
    const result = await svc.buildPack({ all: true }, { name: 'all' })
    expect(result.pack.plugins).toHaveLength(1)
  })

  it('exportPack writes a file and a record', async () => {
    setup(
      { 'dsh-foo': 'dsh-foo@1.0.0' },
      [communityBundle('dsh-foo', 'dsh-foo@1.0.0')],
    )
    const result = await svc.exportPack({ select: ['dsh-foo'] }, { name: 'research' })
    expect(result.record.name).toBe('research')
    expect(result.filePath).toContain('research.dshpack.json')
    expect(svc.listRecords()).toHaveLength(1)
  })

  it('previewImport reports to-install, already-installed and not-portable', async () => {
    setup({}, [communityBundle('dsh-installed', 'dsh-installed@1.0.0')])
    const packFile = join(dir, 'in.dshpack.json')
    writePack(packFile, {
      kind: 'dsh-plugin-pack', format: 1, name: 'in',
      createdAt: new Date().toISOString(),
      generator: { tool: 'test', version: '0' },
      plugins: [
        { name: 'dsh-new', portable: true, source: { type: 'npm', spec: 'dsh-new@2.0.0' } },
        { name: 'dsh-installed', portable: true, source: { type: 'npm', spec: 'dsh-installed@1.0.0' } },
        { name: 'dsh-local', portable: false, source: { type: 'local' } },
      ],
    })
    const preview = await svc.previewImport(packFile)
    expect(preview.toInstall).toHaveLength(1)
    expect(preview.toInstall[0].name).toBe('dsh-new')
    expect(preview.alreadyInstalled).toEqual(['dsh-installed'])
    expect(preview.notPortable).toHaveLength(1)
  })

  it('importPack requires confirm', async () => {
    setup({}, [])
    const packFile = join(dir, 'in.dshpack.json')
    writePack(packFile, {
      kind: 'dsh-plugin-pack', format: 1, name: 'in',
      createdAt: new Date().toISOString(),
      generator: { tool: 'test', version: '0' },
      plugins: [{ name: 'dsh-new', portable: true, source: { type: 'npm', spec: 'dsh-new@2.0.0' } }],
    })
    await expect(svc.importPack(packFile, { confirm: false })).rejects.toThrow(/confirm/)
  })

  it('importPack installs portable plugins and records', async () => {
    setup({}, [])
    const packFile = join(dir, 'in.dshpack.json')
    writePack(packFile, {
      kind: 'dsh-plugin-pack', format: 1, name: 'in',
      createdAt: new Date().toISOString(),
      generator: { tool: 'test', version: '0' },
      plugins: [{ name: 'dsh-new', portable: true, source: { type: 'npm', spec: 'dsh-new@2.0.0' } }],
    })
    const result = await svc.importPack(packFile, { confirm: true })
    expect(result.installed).toHaveLength(1)
    expect(result.installed[0].success).toBe(true)
    expect(svc.listRecords()).toHaveLength(1)
  })

  it('record management: rename, duplicate, delete', async () => {
    setup(
      { 'dsh-foo': 'dsh-foo@1.0.0' },
      [communityBundle('dsh-foo', 'dsh-foo@1.0.0')],
    )
    const { record } = await svc.exportPack({ select: ['dsh-foo'] }, { name: 'orig' })
    const renamed = svc.renameRecord(record.id, 'renamed')
    expect(renamed.name).toBe('renamed')
    const copy = svc.duplicateRecord(record.id, 'copy')
    expect(copy.name).toBe('copy')
    expect(svc.listRecords()).toHaveLength(2)
    svc.deleteRecord(copy.id)
    expect(svc.listRecords()).toHaveLength(1)
  })
})
