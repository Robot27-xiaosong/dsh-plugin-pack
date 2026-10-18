/**
 * Offline bundle archive (.dshpack) creation and extraction.
 *
 * A .dshpack is a gzip-compressed tar archive with the layout npm/pnpm
 * tooling and the DSH plugin manager can consume:
 *
 *   manifest.json
 *   packages/
 *     <slug>-<version>.tgz      (each an npm tarball with a package/ root)
 *
 * Importing installs each embedded tarball via `file:` spec — no network
 * access required, mirroring how Minecraft modpacks ship actual mods.
 */
import {
  mkdirSync, mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync,
  existsSync, readdirSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname, basename, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'
import type { PluginPack } from './types.js'

/** Sanitise a package name into a flat filename component. */
export function nameToSlug(name: string): string {
  return name.replace(/^@/, '').replace(/[\\/]/g, '-')
}

/**
 * Create an npm-compatible tarball (with a `package/` root) from a package
 * directory. Symlinks are dereferenced so linked/local plugins are captured.
 */
export function packToTgz(srcDir: string, tgzPath: string): void {
  const staging = mkdtempSync(join(tmpdir(), 'dsh-tgz-'))
  const pkgRoot = join(staging, 'package')
  try {
    cpSync(srcDir, pkgRoot, {
      recursive: true,
      dereference: true,
      // Never bundle a package's own nested node_modules; pnpm resolves deps.
      filter: (src) => {
        const rel = relative(srcDir, src)
        if (rel === '') return true
        return !rel.split(sep).includes('node_modules')
      },
    })
    mkdirSync(dirname(tgzPath), { recursive: true })
    execFileSync('tar', ['-czf', tgzPath, '-C', staging, 'package'], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

export interface PackageEntry {
  name: string
  version?: string
  /** Directory containing the package source on disk. */
  dir: string
}

/**
 * Build a .dshpack archive containing manifest.json plus one tgz per plugin.
 * Returns the absolute path of the created archive.
 */
export function createBundleArchive(
  manifest: PluginPack,
  entries: PackageEntry[],
  outputPath: string,
): { archivePath: string; files: Array<{ name: string; file: string; version?: string }> } {
  const staging = mkdtempSync(join(tmpdir(), 'dsh-pack-out-'))
  const bundled: Array<{ name: string; file: string; version?: string }> = []
  try {
    const packagesDir = join(staging, 'packages')
    mkdirSync(packagesDir, { recursive: true })

    for (const entry of entries) {
      const slug = nameToSlug(entry.name)
      const version = entry.version || 'unknown'
      const file = `${slug}-${version}.tgz`
      packToTgz(entry.dir, join(packagesDir, file))
      bundled.push({ name: entry.name, file, version: entry.version })
    }

    // Enrich the manifest with the embedded file names.
    const enriched: PluginPack = {
      ...manifest,
      plugins: manifest.plugins.map((p) => {
        const found = bundled.find((b) => b.name === p.name)
        return found ? { ...p, packageFile: found.file } : p
      }),
    }
    writeFileSync(join(staging, 'manifest.json'), JSON.stringify(enriched, null, 2), 'utf8')

    mkdirSync(dirname(outputPath), { recursive: true })
    if (existsSync(outputPath)) rmSync(outputPath, { force: true })
    execFileSync('tar', ['-czf', outputPath, '-C', staging, 'manifest.json', 'packages'], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    return { archivePath: outputPath, files: bundled }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

export interface ExtractedBundle {
  manifest: PluginPack
  /** Absolute path of each embedded tgz, keyed by plugin name. */
  packages: Array<{ name: string; file: string; tgzPath: string; version?: string }>
}

/** Extract a .dshpack archive and return its manifest plus tgz paths. */
export function extractBundleArchive(archivePath: string, destDir: string): ExtractedBundle {
  mkdirSync(destDir, { recursive: true })
  execFileSync('tar', ['-xzf', archivePath, '-C', destDir], {
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  const manifestRaw = readFileSync(join(destDir, 'manifest.json'), 'utf8')
  const manifest = JSON.parse(manifestRaw) as PluginPack
  const packagesDir = join(destDir, 'packages')
  const packages: ExtractedBundle['packages'] = []
  if (existsSync(packagesDir)) {
    for (const file of readdirSync(packagesDir)) {
      if (!file.endsWith('.tgz')) continue
      // Match via manifest packageFile when possible.
      const entry = manifest.plugins.find((p) => p.packageFile === file)
      packages.push({
        name: entry?.name ?? file.replace(/\.tgz$/, ''),
        file,
        tgzPath: join(packagesDir, file),
        version: entry?.version,
      })
    }
  }
  return { manifest, packages }
}
