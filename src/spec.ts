/** Classify a plugin's install spec into a reproducible source kind. */
import type { PluginSource } from './types.js'

/** A 40-character hex commit SHA. */
const FULL_COMMIT = /^[0-9a-f]{40}$/i

/**
 * Parse a `owner/repo#ref` shorthand (bare GitHub-style) into a full git URL.
 * Returns null when the input is not this shorthand.
 */
export function parseGitAddress(spec: string): { url: string; ref?: string } | null {
  // Match owner/repo with an optional #ref fragment.
  const m = /^([\w.-]+\/[\w.-]+)(?:#(.+))?$/.exec(spec.trim())
  if (!m) return null
  const [, slug, ref] = m
  // Reject things that look like paths or URLs.
  if (slug.includes('/') && slug.split('/').length !== 2) return null
  if (/^[a-z]+:\/\//i.test(spec)) return null
  return { url: `https://github.com/${slug}.git`, ref: ref || undefined }
}

/**
 * Strip userinfo (credentials) from an http(s) or git URL.
 * Returns the cleaned URL and whether credentials were removed.
 */
export function stripUrlCredentials(url: string): { url: string; stripped: boolean } {
  try {
    const u = new URL(url)
    if (u.username || u.password) {
      u.username = ''
      u.password = ''
      return { url: u.toString(), stripped: true }
    }
    return { url, stripped: false }
  } catch {
    return { url, stripped: false }
  }
}

/** Whether a spec string carries embedded credentials (userinfo). */
export function specHasCredentials(spec: string): boolean {
  if (/^https?:\/\//i.test(spec) || /^git\+/i.test(spec)) {
    try {
      const u = new URL(spec.replace(/^git\+/, ''))
      return Boolean(u.username || u.password)
    } catch {
      return false
    }
  }
  return false
}

/**
 * Classify a raw dependency spec (as recorded in a profile's package.json)
 * into a reproducible source.
 *
 * Supported forms:
 *  - `name@1.2.3`, `@scope/name@1.2.3`, plain `name` → npm
 *  - `git+https://...`, `https://...git`, `git@github.com:...`, `owner/repo#ref` → git
 *  - `https://....tgz`, `https://....tar.gz` → tarball
 *  - `link:...`, `file:...`, absolute/relative paths → local
 */
export function classifySource(spec: string, name: string): PluginSource {
  const trimmed = spec.trim()

  // Local links and file references.
  if (/^(link|file):/i.test(trimmed) || /^[.\/~]/.test(trimmed) || /^[a-zA-Z]:[\\/]/.test(trimmed)) {
    return { type: 'local', fallbackSpec: name ? `${name}@unknown` : undefined }
  }

  // Tarball URLs.
  if (/^https?:\/\/.+\.(tgz|tar\.gz)(\?|$)/i.test(trimmed)) {
    return { type: 'tarball', url: trimmed }
  }

  // Git URLs (git+https, https with .git, ssh git@).
  if (/^git\+/i.test(trimmed) || /\.git(?:#|$)/i.test(trimmed) || /^git@/i.test(trimmed)) {
    return classifyGit(trimmed)
  }

  // Bare owner/repo#ref shorthand.
  const gitAddr = parseGitAddress(trimmed)
  if (gitAddr) {
    return classifyGitWithRef(gitAddr.url, gitAddr.ref)
  }

  // Default: npm spec. If the spec is a bare version/range (no package name),
  // prepend the plugin name so installBundle receives "name@version" rather
  // than just "0.73.0".
  const isBareVersion = /^[\d^~>=<]|^(latest|\*)$/.test(trimmed)
  return { type: 'npm', spec: isBareVersion && name ? `${name}@${trimmed}` : trimmed }
}

function classifyGit(spec: string): PluginSource {
  // git+https://host/path.git#ref  or  https://host/path.git#ref
  const cleaned = spec.replace(/^git\+/, '')
  const hashIdx = cleaned.indexOf('#')
  const url = hashIdx >= 0 ? cleaned.slice(0, hashIdx) : cleaned
  const ref = hashIdx >= 0 ? cleaned.slice(hashIdx + 1) : undefined
  return classifyGitWithRef(url, ref)
}

function classifyGitWithRef(url: string, ref?: string): PluginSource {
  const { url: cleanUrl, stripped } = stripUrlCredentials(url)
  if (ref && FULL_COMMIT.test(ref)) {
    return { type: 'git', url: cleanUrl, commit: ref }
  }
  // Floating ref (branch/tag) — still git but not pinned.
  return { type: 'git', url: cleanUrl, ...(ref ? { commit: undefined } : {}) }
}

/**
 * Convert a pack source back into an install spec string suitable for
 * `pluginManager.installBundle(spec, ...)`.
 *
 * Throws for local sources (not portable) and for git sources without a
 * pinned commit (caller should warn first).
 */
export function sourceToInstallSpec(source: PluginSource): string {
  switch (source.type) {
    case 'npm':
      return source.spec
    case 'tarball':
      return source.url
    case 'git': {
      if (!source.commit) {
        throw new Error(`git source for ${source.url} is not pinned to a commit; refusing to install`)
      }
      const pathPart = source.path ? `:${source.path}` : ''
      return `${source.url}${pathPart}#${source.commit}`
    }
    case 'local':
      throw new Error('local sources are not portable and cannot be installed')
  }
}
