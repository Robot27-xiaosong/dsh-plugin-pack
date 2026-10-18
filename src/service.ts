/**
 * Host service `pluginPack`: the engine behind community plugin packs.
 *
 * It only adds a "pack" capability to DSH. It never ships business logic, never
 * touches the official runtime base, and never reads or writes keys, sessions,
 * memory or caches. Selection and installation go through the existing
 * `pluginManager` service, so packs stay compatible with DSH's own layering.
 */
import { Service } from '@deepseek-ai/cordis'
import { readFileSync, existsSync, lstatSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { classifySource, sourceToInstallSpec } from './spec.js'
import { createPack, readPack, slugifyPackName } from './pack-format.js'
import { PackStore } from './store.js'
import { createBundleArchive, extractBundleArchive, type PackageEntry } from './archive.js'
import type {
  BuildPreview,
  CommunityPlugin,
  ExportResult,
  ImportPreview,
  ImportResult,
  PackMeta,
  PackRecord,
  PluginPack,
  ResolvedSelection,
} from './types.js'

/** Tool/generator identity recorded in every pack. */
export const GENERATOR = { tool: 'dsh-plugin-pack', version: '0.1.0' }

/** Read the dependency spec recorded in a profile's package.json. */
function readProfileSpecs(profileDir: string): Record<string, string> {
  try {
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
    return { ...manifest.devDependencies, ...manifest.dependencies }
  } catch {
    return {}
  }
}

/** A community plugin pack service bound to one profile. */
export class PluginPackService extends Service {
  static inject = ['pluginManager', 'profileContext']

  /** Lazily-created record store, rooted in the profile directory. */
  private _store?: PackStore

  constructor(ctx: { get: (name: string) => unknown }) {
    super(ctx as never, 'pluginPack')
  }

  /** Absolute path of the profile this service is bound to. */
  get profileDir(): string {
    const profileContext = this.ctx.get('profileContext') as { dir: string }
    return profileContext.dir
  }

  /** The record store for this profile. */
  get store(): PackStore {
    if (!this._store) {
      this._store = new PackStore(this.profileDir)
    }
    return this._store
  }

  // ------------------------------------------------------------------
  // Scan
  // ------------------------------------------------------------------

  /**
   * List community plugins installed in the current profile.
   *
   * A plugin is "community" when it is not official, is installed, and its
   * availability is `profile` (i.e. the profile itself declares it).
   */
  async scanCommunity(): Promise<CommunityPlugin[]> {
    const manager = this.ctx.get('pluginManager') as {
      listBundles: () => Promise<Array<Record<string, unknown>>>
    }
    const bundles = await manager.listBundles()
    const specs = readProfileSpecs(this.profileDir)

    const community: CommunityPlugin[] = []
    for (const b of bundles) {
      if (!isCommunityBundle(b)) continue
      const name = String(b.name)
      const version = b.version ? String(b.version) : undefined
      const description = b.description ? String(b.description) : undefined
      const rawSpec = specs[name] ?? (b.source ? String(b.source) : name)
      const source = classifySource(rawSpec, name)
      const portable = isPortable(source)
      community.push({
        name,
        version,
        description,
        enabled: Boolean(b.enabled),
        source,
        portable,
        rawSpec,
      })
    }
    return community
  }

  // ------------------------------------------------------------------
  // Build / export
  // ------------------------------------------------------------------

  /**
   * Resolve a selection (names or `all`) against the current community plugins.
   */
  async resolveSelection(selection: {
    select?: string[]
    all?: boolean
  }): Promise<ResolvedSelection> {
    const community = await this.scanCommunity()
    if (selection.all) {
      return { chosen: community, missing: [], warnings: [] }
    }
    const names = selection.select ?? []
    if (names.length === 0) {
      throw new Error('Select at least one community plugin (use "all" or list names), or run scan first.')
    }
    const byName = new Map(community.map((c) => [c.name, c]))
    const chosen: CommunityPlugin[] = []
    const missing: string[] = []
    for (const n of names) {
      const c = byName.get(n)
      if (c) chosen.push(c)
      else missing.push(n)
    }
    const warnings: string[] = []
    for (const c of chosen) {
      if (!c.portable) {
        warnings.push(`"${c.name}" is not portable (local link or unpinned git); it will be marked and skipped on import.`)
      }
    }
    return { chosen, missing, warnings }
  }

  /** Build a pack preview without writing anything. */
  async buildPack(
    selection: { select?: string[]; all?: boolean },
    meta: PackMeta,
  ): Promise<BuildPreview> {
    const { chosen, missing, warnings } = await this.resolveSelection(selection)
    const entries = chosen.map((c) => ({
      name: c.name,
      version: c.version,
      source: c.source,
      portable: c.portable,
    }))
    const pack = createPack(entries, meta)
    return { pack, missing, warnings }
  }

  /** Write a pack and record it. Returns the record, pack and file path. */
  async exportPack(
    selection: { select?: string[]; all?: boolean },
    meta: PackMeta,
    options: { output?: string } = {},
  ): Promise<ExportResult> {
    const { pack, warnings } = await this.buildPack(selection, meta)
    const { record, filePath } = this.store.savePack(pack, 'exported')
    if (options.output) {
      const { writeFileSync } = await import('node:fs')
      const { serializePack } = await import('./pack-format.js')
      writeFileSync(options.output, serializePack(pack), 'utf8')
    }
    return { record, pack, filePath, warnings }
  }

  /**
   * Resolve the on-disk directory of an installed package inside this profile's
   * node_modules. Follows symlinks so linked/local plugins are captured.
   */
  private packageDir(name: string): string | undefined {
    const direct = join(this.profileDir, 'node_modules', name)
    if (existsSync(join(direct, 'package.json'))) {
      try {
        const st = lstatSync(direct)
        if (st.isSymbolicLink()) {
          const real = realpathSync(direct)
          return existsSync(join(real, 'package.json')) ? real : undefined
        }
      } catch { /* fall through */ }
      return direct
    }
    return undefined
  }

  /**
   * Build an offline .dshpack archive containing the actual plugin tarballs.
   * The resulting file installs without network access. Returns the record and
   * archive path.
   */
  async exportBundle(
    selection: { select?: string[]; all?: boolean },
    meta: PackMeta,
  ): Promise<{ record: PackRecord; archivePath: string; manifestPath: string; missing: string[]; warnings: string[] }> {
    const existing = this.store.listRecords().find((r) => r.kind === 'exported' && r.name === meta.name.trim())
    if (existing) throw new Error(`已存在同名插件包「${meta.name}」，请换个名称或先删除旧包`)
    const { chosen, missing, warnings } = await this.resolveSelection(selection)
    const entries = chosen.map((c) => ({
      name: c.name,
      version: c.version,
      source: c.source,
      portable: c.portable,
    }))
    // Hybrid pack: portable plugins keep their original install source (npm/git/tarball),
    // only non-portable (local/linked) plugins are bundled as tgz inside the archive.
    const manifest = createPack(entries, { ...meta, format: 2 })

    const packageEntries: PackageEntry[] = []
    for (const c of chosen) {
      // Only bundle plugins that cannot be reproduced from a public source.
      if (c.portable) continue
      const dir = this.packageDir(c.name)
      if (dir) {
        packageEntries.push({ name: c.name, version: c.version, dir })
      } else {
        warnings.push(`"${c.name}": local plugin files not found on disk, cannot bundle offline.`)
      }
    }

    const slug = slugifyPackName(manifest.name)
    const archivePath = join(this.store.storeDir, `${slug}.dshpack`)
    createBundleArchive(manifest, packageEntries, archivePath)

    // Persist the manifest sidecar alongside the archive for record/listing.
    const { record, filePath: manifestPath } = this.store.savePack(manifest, 'exported', {
      archiveName: `${slug}.dshpack`,
    })
    return { record, archivePath, manifestPath, missing, warnings }
  }

  /**
   * Preview an offline .dshpack: list what it contains and what would install.
   */
  async previewBundle(archivePath: string, _options: { force?: boolean } = {}): Promise<{
    manifest: PluginPack
    packages: Array<{ name: string; version?: string; tgzPath: string }>
    alreadyInstalled: string[]
    force: boolean
  }> {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-pack-in-'))
    const extracted = extractBundleArchive(archivePath, dir)
    const manager = this.ctx.get('pluginManager') as {
      listBundles: () => Promise<Array<Record<string, unknown>>>
    }
    const bundles = await manager.listBundles()
    const installedNames = new Set(
      bundles.filter((b) => Boolean(b.installed)).map((b) => String(b.name)),
    )
    const packages = extracted.packages.map((p) => ({
      name: p.name,
      version: p.version,
      tgzPath: p.tgzPath,
    }))
    const alreadyInstalled = packages
      .map((p) => p.name)
      .filter((n) => installedNames.has(n))
    return {
      manifest: extracted.manifest,
      packages,
      alreadyInstalled,
      force: _options.force ?? false,
    }
  }

  /**
   * Install every embedded tarball from an offline .dshpack via file: specs.
   * No network access required.
   */
  async importBundle(
    archivePath: string,
    options: { confirm: boolean; force?: boolean; onProgress?: (index: number, total: number, name: string) => void } = { confirm: true },
  ): Promise<ImportResult & { tempDir: string }> {
    if (!options.confirm) {
      throw new Error('importBundle requires confirm: true')
    }
    const dir = mkdtempSync(join(tmpdir(), 'dsh-pack-in-'))
    const extracted = extractBundleArchive(archivePath, dir)
    const dup = this.store.listRecords().find((r) => r.kind === 'imported' && r.name === extracted.manifest.name)
    if (dup) throw new Error(`已存在同名插件包「${extracted.manifest.name}」，请先删除旧包或换个名称`)
    const manager = this.ctx.get('pluginManager') as {
      listBundles: () => Promise<Array<Record<string, unknown>>>
      installBundle: (
        spec: string,
        opts?: { enabled?: boolean; registry?: string },
      ) => Promise<{
        changed: boolean
        application: 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled'
        error?: { code?: string; message?: string; diagnostic?: string }
        warnings?: string[]
      }>
      removeBundle: (name: string) => Promise<{ application: string }>
    }
    const bundles = await manager.listBundles()
    const installedNames = new Set(
      bundles.filter((b) => Boolean(b.installed)).map((b) => String(b.name)),
    )

    const installed: ImportResult['installed'] = []
    let restartRequired = false
    const warnings: string[] = []

    // Build a lookup of bundled tgz paths keyed by plugin name.
    const tgzByName = new Map(extracted.packages.map((p) => [p.name, p.tgzPath]))

    const toInstall = extracted.manifest.plugins.filter((p) => options.force || !installedNames.has(p.name))
    let progressIndex = 0

    for (const entry of toInstall) {
      options.onProgress?.(progressIndex++, toInstall.length, entry.name)
      const isLocal = entry.source?.type === 'local' || !entry.portable
      let spec: string
      let installMethod: 'official' | 'bundled'
      if (isLocal) {
        // Non-portable plugin: must use the tgz bundled inside the pack.
        const tgzPath = tgzByName.get(entry.name)
        if (!tgzPath) {
          installed.push({
            name: entry.name,
            spec: '(local)',
            success: false,
            error: 'pack does not contain a bundled tgz for this local plugin',
          })
          continue
        }
        spec = `file:${tgzPath.replace(/\\/g, '/')}`
        installMethod = 'bundled'
      } else {
        // Portable plugin: install from its original public source (npm/git/tarball),
        // so it stays portable after import.
        try {
          spec = sourceToInstallSpec(entry.source)
          // Old packs may record a bare version ("0.73.0") without the package
          // name; prepend the entry name so installBundle gets "name@version".
          if (/^[\d^~>=<]|^(latest|\*)$/.test(spec) && entry.name) {
            spec = `${entry.name}@${spec}`
          }
          installMethod = 'official'
        } catch (e) {
          installed.push({
            name: entry.name,
            spec: '(unresolved)',
            success: false,
            error: (e as Error).message,
          })
          continue
        }
      }
      try {
        let result = await manager.installBundle(spec, { enabled: true })
        // HMR rejects reinstalling an already-installed bundle. When force is
        // requested, remove it first and retry the install.
        if (options.force && result.application === 'failed' && result.error?.code === 'already-installed') {
          await manager.removeBundle(entry.name)
          result = await manager.installBundle(spec, { enabled: true })
        }
        // A failed activation (e.g. "waiting for service: webRuntime") still
        // leaves the bundle installed on disk when changed=true. Treat it as
        // "installed, restart required" rather than a hard install failure.
        const activationOnly = result.application === 'failed' && result.changed === true
        const effectiveApp = activationOnly ? 'restart-required' : result.application
        const ok = effectiveApp !== 'failed' && effectiveApp !== 'cancelled'
        if (effectiveApp === 'restart-required') restartRequired = true
        installed.push({
          name: entry.name,
          spec,
          success: ok,
          application: effectiveApp,
          error: activationOnly ? undefined : result.error?.message || result.error?.diagnostic || result.error?.code,
        })
        if (result.warnings) warnings.push(...result.warnings.map((w) => `"${entry.name}": ${w}`))
      } catch (e) {
        installed.push({ name: entry.name, spec, success: false, error: (e as Error).message })
      }
    }

    const skipped = extracted.manifest.plugins
      .map((p) => p.name)
      .filter((n) => !options.force && installedNames.has(n))
      .map((n) => ({ name: n, reason: 'already installed (use force to reinstall)' }))

    this.store.savePack(extracted.manifest, 'imported')
    return {
      pack: extracted.manifest,
      installed,
      skipped,
      warnings,
      restartRequired,
      tempDir: dir,
    }
  }

  /** Clean up a temporary extraction directory after responding. */
  cleanupTemp(dir: string): void {
    rmSync(dir, { recursive: true, force: true })
  }

  // ------------------------------------------------------------------
  // Import
  // ------------------------------------------------------------------

  /** Read a pack file and preview what would be installed. */
  async previewImport(
    filePath: string,
    options: { force?: boolean } = {},
  ): Promise<ImportPreview> {
    const pack = readPack(filePath)
    const manager = this.ctx.get('pluginManager') as {
      listBundles: () => Promise<Array<Record<string, unknown>>>
    }
    const bundles = await manager.listBundles()
    const installedNames = new Set(
      bundles.filter((b) => Boolean(b.installed)).map((b) => String(b.name)),
    )

    const toInstall: ImportPreview['toInstall'] = []
    const alreadyInstalled: string[] = []
    const notPortable: ImportPreview['notPortable'] = []
    const warnings: string[] = []

    for (const entry of pack.plugins) {
      if (!entry.portable) {
        notPortable.push({ name: entry.name, reason: 'source is not portable (local link or unpinned git)' })
        continue
      }
      if (!options.force && installedNames.has(entry.name)) {
        alreadyInstalled.push(entry.name)
        continue
      }
      try {
        const spec = sourceToInstallSpec(entry.source)
        toInstall.push({
          name: entry.name,
          version: entry.version,
          spec,
          registry: entry.source.type === 'npm' ? entry.source.registry : undefined,
          portable: true,
        })
      } catch (e) {
        warnings.push(`"${entry.name}": ${(e as Error).message}`)
      }
    }
    return { pack, toInstall, alreadyInstalled, notPortable, warnings }
  }

  /**
   * Install every portable plugin from a pack.
   * Requires `confirm: true`; the caller (tool or CLI) is responsible for
   * human approval before calling this.
   * Set `force: true` to reinstall plugins that are already installed.
   */
  async importPack(
    filePath: string,
    options: { confirm: boolean; registry?: string; force?: boolean },
  ): Promise<ImportResult> {
    if (!options.confirm) {
      throw new Error('importPack requires confirm: true; call previewImport first and obtain user confirmation')
    }
    const preview = await this.previewImport(filePath, { force: options.force })
    const manager = this.ctx.get('pluginManager') as {
      installBundle: (
        spec: string,
        opts?: { enabled?: boolean; registry?: string },
      ) => Promise<{
        changed: boolean
        application: 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled'
        error?: { code?: string; message?: string; diagnostic?: string }
        warnings?: string[]
      }>
      removeBundle: (name: string) => Promise<{ application: string }>
    }

    const installed: ImportResult['installed'] = []
    let restartRequired = false
    for (const item of preview.toInstall) {
      try {
        let result = await manager.installBundle(item.spec, {
          enabled: true,
          ...(item.registry ?? options.registry ? { registry: item.registry ?? options.registry } : {}),
        })
        if (options.force && result.application === 'failed' && result.error?.code === 'already-installed') {
          await manager.removeBundle(item.name)
          result = await manager.installBundle(item.spec, {
            enabled: true,
            ...(item.registry ?? options.registry ? { registry: item.registry ?? options.registry } : {}),
          })
        }
        const activationOnly = result.application === 'failed' && result.changed === true
        const effectiveApp = activationOnly ? 'restart-required' : result.application
        const success = effectiveApp !== 'failed' && effectiveApp !== 'cancelled'
        if (effectiveApp === 'restart-required') restartRequired = true
        installed.push({
          name: item.name,
          spec: item.spec,
          success,
          application: effectiveApp,
          error: activationOnly ? undefined : result.error?.message || result.error?.diagnostic || result.error?.code,
        })
        if (result.warnings) {
          for (const w of result.warnings) {
            preview.warnings.push(`"${item.name}": ${w}`)
          }
        }
      } catch (e) {
        installed.push({ name: item.name, spec: item.spec, success: false, error: (e as Error).message })
      }
    }
    const skipped: ImportResult['skipped'] = [
      ...preview.alreadyInstalled.map((name) => ({ name, reason: 'already installed (use force to reinstall)' })),
      ...preview.notPortable.map(({ name, reason }) => ({ name, reason })),
    ]
    // Record the imported pack.
    this.store.savePack(preview.pack, 'imported')
    return { pack: preview.pack, installed, skipped, warnings: preview.warnings, restartRequired }
  }

  // ------------------------------------------------------------------
  // Record management
  // ------------------------------------------------------------------

  listRecords(): PackRecord[] {
    return this.store.listRecords()
  }

  getRecord(id: string): PackRecord | undefined {
    return this.store.getRecord(id)
  }

  readRecord(id: string): PluginPack {
    return this.store.readRecordPack(id)
  }

  renameRecord(id: string, newName: string): PackRecord {
    return this.store.renameRecord(id, newName)
  }

  duplicateRecord(id: string, newName: string): PackRecord {
    return this.store.duplicateRecord(id, newName)
  }

  /** Detach a plugin from a pack: it stays installed but is no longer managed by the pack. */
  detachPlugin(id: string, pluginName: string): PackRecord {
    return this.store.detachPlugin(id, pluginName)
  }

  /** Get plugins in a pack with their detached status. */
  getPackPlugins(id: string): Array<{ name: string; version?: string; detached: boolean }> {
    const record = this.store.getRecord(id)
    if (!record) throw new Error(`pack record not found: ${id}`)
    const pack = this.store.readRecordPack(id)
    const detached = new Set(record.detachedPlugins ?? [])
    return pack.plugins.map((p) => ({
      name: p.name,
      version: p.version,
      detached: detached.has(p.name),
    }))
  }

  /**
   * Delete a pack and uninstall all plugins still associated with it.
   * Detached plugins are left installed.
   */
  async deleteRecord(id: string): Promise<void> {
    const record = this.store.getRecord(id)
    if (!record) return
    const pack = this.store.readRecordPack(id)
    const detached = new Set(record.detachedPlugins ?? [])
    const toUninstall = pack.plugins.filter((p) => !detached.has(p.name)).map((p) => p.name)
    if (toUninstall.length > 0) {
      const manager = this.ctx.get('pluginManager') as {
        removeBundle: (name: string) => Promise<{ application: string }>
      }
      for (const name of toUninstall) {
        try { await manager.removeBundle(name) } catch { /* ignore individual failures */ }
      }
    }
    this.store.deleteRecord(id)
  }
}

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

function isCommunityBundle(b: Record<string, unknown>): boolean {
  // Community = not official (false or undefined) and installed in the profile.
  // We do NOT require availability === 'profile' because some valid installs
  // report 'installation' or 'missing' while still being profile deps.
  return b.official !== true && b.installed === true
}

function isPortable(source: { type: string; commit?: string }): boolean {
  if (source.type === 'local') return false
  if (source.type === 'git' && !source.commit) return false
  return true
}

export default PluginPackService
