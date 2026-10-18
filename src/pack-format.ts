/** Create, validate, parse and serialize `.dshpack.json` documents. */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import type {
  PluginPack,
  PackPluginEntry,
  PackGenerator,
  PluginSource,
  PackMeta,
} from './types.js'
import { PackFormatError } from './types.js'

/** Tool/generator identity recorded in every pack. */
export const GENERATOR: PackGenerator = { tool: 'dsh-plugin-pack', version: '0.1.0' }

const PACK_KIND = 'dsh-plugin-pack' as const
const PACK_FORMAT = 2 as const
const SUPPORTED_FORMATS = new Set([1, 2])

/** Allowed top-level keys (strict allowlist). */
const TOP_LEVEL_KEYS = new Set([
  'kind', 'format', 'name', 'description', 'notes', 'version', 'author', 'tags',
  'promoUrl', 'createdAt', 'generator', 'dsh', 'plugins',
])

/** Allowed per-entry keys. */
const ENTRY_KEYS = new Set(['name', 'version', 'note', 'portable', 'source', 'packageFile'])

/** Allowed source keys per kind. */
const SOURCE_KEYS: Record<string, Set<string>> = {
  npm: new Set(['type', 'spec', 'registry']),
  git: new Set(['type', 'url', 'commit', 'path']),
  tarball: new Set(['type', 'url']),
  local: new Set(['type', 'fallbackSpec']),
}

const FULL_COMMIT = /^[0-9a-f]{40}$/i

/**
 * Turn a user-provided name into a safe file name (slug).
 * Keeps alphanumerics, hyphen, underscore, dot; collapses whitespace to hyphens.
 */
export function slugifyPackName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
  return slug || 'pack'
}

/** Create a pack document from a list of plugin entries. */
export function createPack(
  entries: PackPluginEntry[],
  meta: PackMeta & { format?: 1 | 2 },
): PluginPack {
  return {
    kind: PACK_KIND,
    format: meta.format ?? PACK_FORMAT,
    name: meta.name,
    ...(meta.description ? { description: meta.description } : {}),
    ...(meta.notes ? { notes: meta.notes } : {}),
    ...(meta.version ? { version: meta.version } : {}),
    ...(meta.author ? { author: meta.author } : {}),
    ...(meta.tags && meta.tags.length > 0 ? { tags: meta.tags } : {}),
    ...(meta.promoUrl ? { promoUrl: meta.promoUrl } : {}),
    createdAt: new Date().toISOString(),
    generator: { ...GENERATOR },
    ...(meta.dsh?.compatible ? { dsh: { compatible: meta.dsh.compatible } } : {}),
    plugins: entries,
  }
}

/** Validate a parsed object against the pack format. Throws PackFormatError. */
export function validatePack(obj: unknown): PluginPack {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    throw new PackFormatError('pack must be a JSON object')
  }
  const doc = obj as Record<string, unknown>

  // Strict top-level allowlist.
  for (const key of Object.keys(doc)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      throw new PackFormatError(`unknown top-level field "${key}"`)
    }
  }

  if (doc.kind !== PACK_KIND) {
    throw new PackFormatError(`kind must be "${PACK_KIND}", got ${JSON.stringify(doc.kind)}`)
  }
  if (!SUPPORTED_FORMATS.has(doc.format as number)) {
    throw new PackFormatError(`format must be one of ${[...SUPPORTED_FORMATS].join(' or ')}, got ${JSON.stringify(doc.format)}`)
  }
  if (typeof doc.name !== 'string' || doc.name.length === 0) {
    throw new PackFormatError('name must be a non-empty string')
  }
  if (doc.description !== undefined && typeof doc.description !== 'string') {
    throw new PackFormatError('description must be a string')
  }
  if (doc.notes !== undefined && typeof doc.notes !== 'string') {
    throw new PackFormatError('notes must be a string')
  }
  if (doc.version !== undefined && typeof doc.version !== 'string') {
    throw new PackFormatError('version must be a string')
  }
  if (doc.author !== undefined && typeof doc.author !== 'string') {
    throw new PackFormatError('author must be a string')
  }
  if (doc.tags !== undefined) {
    if (!Array.isArray(doc.tags) || !doc.tags.every((t) => typeof t === 'string')) {
      throw new PackFormatError('tags must be an array of strings')
    }
  }
  if (doc.promoUrl !== undefined && typeof doc.promoUrl !== 'string') {
    throw new PackFormatError('promoUrl must be a string')
  }
  if (typeof doc.createdAt !== 'string') {
    throw new PackFormatError('createdAt must be an ISO date-time string')
  }
  if (typeof doc.generator !== 'object' || doc.generator === null) {
    throw new PackFormatError('generator must be an object')
  }
  const gen = doc.generator as Record<string, unknown>
  if (typeof gen.tool !== 'string' || typeof gen.version !== 'string') {
    throw new PackFormatError('generator.tool and generator.version must be strings')
  }
  if (!Array.isArray(doc.plugins)) {
    throw new PackFormatError('plugins must be an array')
  }
  if (doc.plugins.length === 0) {
    throw new PackFormatError('plugins must contain at least one entry')
  }

  const seen = new Set<string>()
  for (let i = 0; i < doc.plugins.length; i++) {
    validateEntry(doc.plugins[i], i, seen)
  }

  return doc as unknown as PluginPack
}

function validateEntry(raw: unknown, index: number, seen: Set<string>): void {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new PackFormatError(`plugins[${index}] must be an object`)
  }
  const entry = raw as Record<string, unknown>
  for (const key of Object.keys(entry)) {
    if (!ENTRY_KEYS.has(key)) {
      throw new PackFormatError(`plugins[${index}]: unknown field "${key}"`)
    }
  }
  if (typeof entry.name !== 'string' || entry.name.length === 0) {
    throw new PackFormatError(`plugins[${index}].name must be a non-empty string`)
  }
  if (seen.has(entry.name)) {
    throw new PackFormatError(`duplicate plugin name "${entry.name}" at plugins[${index}]`)
  }
  seen.add(entry.name)
  if (entry.version !== undefined && typeof entry.version !== 'string') {
    throw new PackFormatError(`plugins[${index}].version must be a string`)
  }
  if (entry.note !== undefined && typeof entry.note !== 'string') {
    throw new PackFormatError(`plugins[${index}].note must be a string`)
  }
  if (typeof entry.portable !== 'boolean') {
    throw new PackFormatError(`plugins[${index}].portable must be a boolean`)
  }
  validateSource(entry.source, index)
}

function validateSource(raw: unknown, index: number): void {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new PackFormatError(`plugins[${index}].source must be an object`)
  }
  const src = raw as Record<string, unknown>
  if (typeof src.type !== 'string') {
    throw new PackFormatError(`plugins[${index}].source.type must be a string`)
  }
  const allowed = SOURCE_KEYS[src.type]
  if (!allowed) {
    throw new PackFormatError(`plugins[${index}].source.type "${src.type}" is not supported`)
  }
  for (const key of Object.keys(src)) {
    if (!allowed.has(key)) {
      throw new PackFormatError(`plugins[${index}].source.${src.type}: unknown field "${key}"`)
    }
  }
  switch (src.type) {
    case 'npm':
      if (typeof src.spec !== 'string' || src.spec.length === 0) {
        throw new PackFormatError(`plugins[${index}].source.npm.spec is required`)
      }
      if (src.registry !== undefined && typeof src.registry !== 'string') {
        throw new PackFormatError(`plugins[${index}].source.npm.registry must be a string`)
      }
      break
    case 'git':
      if (typeof src.url !== 'string' || src.url.length === 0) {
        throw new PackFormatError(`plugins[${index}].source.git.url is required`)
      }
      if (src.commit !== undefined) {
        if (typeof src.commit !== 'string' || !FULL_COMMIT.test(src.commit)) {
          throw new PackFormatError(`plugins[${index}].source.git.commit must be a 40-character hex SHA`)
        }
      }
      if (src.path !== undefined && typeof src.path !== 'string') {
        throw new PackFormatError(`plugins[${index}].source.git.path must be a string`)
      }
      break
    case 'tarball':
      if (typeof src.url !== 'string' || src.url.length === 0) {
        throw new PackFormatError(`plugins[${index}].source.tarball.url is required`)
      }
      break
    case 'local':
      if (src.fallbackSpec !== undefined && typeof src.fallbackSpec !== 'string') {
        throw new PackFormatError(`plugins[${index}].source.local.fallbackSpec must be a string`)
      }
      break
  }
}

/** Parse a JSON string into a validated pack. */
export function parsePack(text: string): PluginPack {
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch (e) {
    throw new PackFormatError(`pack is not valid JSON: ${(e as Error).message}`)
  }
  return validatePack(obj)
}

/** Read and validate a pack file from disk. */
export function readPack(filePath: string): PluginPack {
  const text = readFileSync(filePath, 'utf8')
  return parsePack(text)
}

/** Serialize a pack to a pretty-printed JSON string. */
export function serializePack(pack: PluginPack): string {
  return JSON.stringify(pack, null, 2) + '\n'
}

/** Write a pack to disk (creating parent directories). */
export function writePack(filePath: string, pack: PluginPack): void {
  const dir = dirname(filePath)
  mkdirSync(dir, { recursive: true })
  writeFileSync(filePath, serializePack(pack), 'utf8')
}

/** Re-export types for convenience. */
export type { PluginPack, PackPluginEntry, PluginSource, PackGenerator }
