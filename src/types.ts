/** Public types for dsh-plugin-pack. */

/** The four reproducible source kinds a pack entry may carry. */
export type SourceKind = 'npm' | 'git' | 'tarball' | 'local'

/** An npm install spec, optionally pinned to a registry. */
export interface NpmSource {
  type: 'npm'
  /** Exact install spec, e.g. `name@1.2.3`. */
  spec: string
  registry?: string
}

/** A git repository, preferably pinned to a full commit SHA. */
export interface GitSource {
  type: 'git'
  /** Repository URL without userinfo credentials. */
  url: string
  /** 40-character full commit SHA for reproducibility. */
  commit?: string
  /** Subdirectory inside the repository containing the plugin. */
  path?: string
}

/** A downloadable tarball URL. */
export interface TarballSource {
  type: 'tarball'
  url: string
}

/**
 * A machine-local link. Not portable: only a best-effort name@version hint is
 * kept, and the entry is never auto-installed on another machine.
 */
export interface LocalSource {
  type: 'local'
  fallbackSpec?: string
}

export type PluginSource = NpmSource | GitSource | TarballSource | LocalSource

/** One plugin entry inside a pack file. */
export interface PackPluginEntry {
  name: string
  version?: string
  note?: string
  /** Whether this entry can be reproduced on another machine. */
  portable: boolean
  source: PluginSource
  /**
   * For offline bundles (format 2), the embedded tgz filename under
   * `packages/`. Absent in legacy JSON-only packs (format 1).
   */
  packageFile?: string
}

/** Generator metadata recorded in every pack. */
export interface PackGenerator {
  tool: string
  version: string
}

/** Metadata for a plugin pack (name, description, version, author, etc.). */
export interface PackMeta {
  name: string
  description?: string
  notes?: string
  version?: string
  author?: string
  tags?: string[]
  promoUrl?: string
  dsh?: { compatible?: string }
}

/** The on-disk `.dshpack.json` document. */
export interface PluginPack {
  kind: 'dsh-plugin-pack'
  format: 1 | 2
  name: string
  description?: string
  notes?: string
  version?: string
  author?: string
  tags?: string[]
  promoUrl?: string
  createdAt: string
  generator: PackGenerator
  dsh?: {
    compatible?: string
  }
  plugins: PackPluginEntry[]
}

/** A community plugin as observed in the current profile. */
export interface CommunityPlugin {
  name: string
  version?: string
  /** Short description from the plugin's package manifest, if available. */
  description?: string
  enabled: boolean
  source: PluginSource
  portable: boolean
  /** The raw dependency spec recorded in the profile's package.json, if any. */
  rawSpec?: string
}

/** Result of resolving a selection against the current community plugins. */
export interface ResolvedSelection {
  chosen: CommunityPlugin[]
  missing: string[]
  warnings: string[]
}

/** Preview returned before writing a pack. */
export interface BuildPreview {
  pack: PluginPack
  missing: string[]
  warnings: string[]
}

/** Result of exporting a pack. */
export interface ExportResult {
  record: PackRecord
  pack: PluginPack
  filePath: string
  warnings: string[]
}

/** One entry an import will attempt to install. */
export interface ImportInstallItem {
  name: string
  version?: string
  spec: string
  registry?: string
  portable: boolean
}

/** Preview returned before installing from a pack. */
export interface ImportPreview {
  pack: PluginPack
  toInstall: ImportInstallItem[]
  alreadyInstalled: string[]
  notPortable: Array<{ name: string; reason: string }>
  warnings: string[]
}

/** Result of an import run. */
export interface ImportResult {
  pack: PluginPack
  installed: Array<{
    name: string
    spec: string
    success: boolean
    /** DSH application outcome: applied immediately or requires restart. */
    application?: 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled'
    error?: string
  }>
  skipped: Array<{ name: string; reason: string }>
  warnings: string[]
  /** True when at least one plugin reported restart-required. */
  restartRequired: boolean
}

/** A saved pack record (metadata only; the pack file lives beside it). */
export interface PackRecord {
  id: string
  name: string
  description?: string
  notes?: string
  version?: string
  author?: string
  tags?: string[]
  promoUrl?: string
  compatible?: string
  kind: 'exported' | 'imported'
  pluginCount: number
  /** How many plugins in this pack are portable (remote source). Undefined for legacy records. */
  portableCount?: number
  /** Pack format: 1 = JSON-only, 2 = offline .dshpack with embedded tgz. */
  format?: number
  createdAt: string
  updatedAt: string
  fileName: string
  /** For format 2, the binary .dshpack archive filename. */
  archiveName?: string
  /** Plugins that have been detached from this pack (stay installed, no longer managed by the pack). */
  detachedPlugins?: string[]
}

/** Error thrown for pack-format problems. */
export class PackFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PackFormatError'
  }
}
