/**
 * Client-side API helpers: thin fetch wrappers around the /dsh-plugin-pack/*
 * host routes. Every path is resolved against document.baseURI so the panel
 * works behind a reverse-proxy prefix.
 */

function api(path: string): string {
  const relative = path.replace(/^\/+/, '')
  if (typeof document === 'undefined') return `/${relative}`
  // Match dsh-market: concatenate baseURI with the relative path.
  const base = document.baseURI.endsWith('/') ? document.baseURI : document.baseURI + '/'
  return base + relative
}

async function jsonFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(api(path), {
    headers: { 'content-type': 'application/json' },
    ...options,
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : {}
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`)
  }
  return data as T
}

/** Compare semver-like version strings. Returns 1 if a>b, -1 if a<b, 0 if equal. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

export interface CommunityPlugin {
  name: string
  version?: string
  description?: string
  enabled: boolean
  portable: boolean
  rawSpec: string
  source: { type: string }
}

export interface PackEntry {
  name: string
  version?: string
  source: { type: string; spec?: string; url?: string }
  portable: boolean
}

export interface PluginPack {
  kind: string
  format: number
  name: string
  description?: string
  createdAt: string
  generator: { tool: string; version: string }
  plugins: PackEntry[]
}

export interface PackRecord {
  id: string
  name: string
  createdAt: string
  source: string
  pluginCount: number
  detachedPlugins?: string[]
}

export interface PackPlugin {
  name: string
  version?: string
  detached: boolean
}

export interface BuildPreview {
  pack: PluginPack
  missing: string[]
  warnings: string[]
}

export interface ImportPreview {
  pack: PluginPack
  toInstall: Array<{ name: string; version?: string; spec: string; portable: boolean }>
  alreadyInstalled: string[]
  notPortable: Array<{ name: string; reason: string }>
  warnings: string[]
}

export interface ImportResult {
  pack: PluginPack
  installed: Array<{
    name: string
    spec: string
    success: boolean
    application?: 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled'
    error?: string
  }>
  skipped: Array<{ name: string; reason: string }>
  warnings: string[]
  restartRequired: boolean
}

export const packApi = {
  scan: () => jsonFetch<{ plugins: CommunityPlugin[] }>('/dsh-plugin-pack/scan'),

  build: (selection: { select?: string[]; all?: boolean }, meta: { name: string; description?: string }) =>
    jsonFetch<BuildPreview>('/dsh-plugin-pack/build', {
      method: 'POST',
      body: JSON.stringify({ selection, meta }),
    }),

  export: (selection: { select?: string[]; all?: boolean }, meta: { name: string; description?: string }) =>
    jsonFetch<{ record: PackRecord; pack: PluginPack; filePath: string; warnings: string[] }>('/dsh-plugin-pack/export', {
      method: 'POST',
      body: JSON.stringify({ selection, meta }),
    }),

  /** Build an offline .dshpack (contains actual plugin tgz) and return the blob. */
  exportBundle: async (
    selection: { select?: string[]; all?: boolean },
    meta: {
      name: string
      description?: string
      notes?: string
      version?: string
      author?: string
      tags?: string[]
      promoUrl?: string
      dsh?: { compatible?: string }
    },
  ): Promise<{ blob: Blob; filename: string }> => {
    const response = await fetch(api('/dsh-plugin-pack/export-bundle'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selection, meta }),
    })
    if (!response.ok) {
      const text = await response.text()
      let error = `HTTP ${response.status}`
      try { error = JSON.parse(text).error || error } catch { /* ignore */ }
      throw new Error(error)
    }
    const blob = await response.blob()
    const disposition = response.headers.get('content-disposition') || ''
    const match = /filename="?([^"]+)"?/.exec(disposition)
    const filename = match ? match[1] : 'pack.dshpack'
    return { blob, filename }
  },

  /** Upload an offline .dshpack and install the embedded plugins (no network). */
  importBundle: async (data: ArrayBuffer | Uint8Array, force = false): Promise<ImportResult> => {
    const url = api('/dsh-plugin-pack/import-bundle' + (force ? '?force=true' : ''))
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: data,
    })
    const text = await response.text()
    const result = text ? JSON.parse(text) : {}
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`)
    return result as ImportResult
  },

  /**
   * Streaming import: uploads the .dshpack and receives SSE progress events.
   * onProgress is called with (index, total, pluginName) for each plugin.
   */
  importBundleStream: async (
    data: ArrayBuffer | Uint8Array,
    force: boolean,
    onProgress: (index: number, total: number, name: string) => void,
  ): Promise<ImportResult> => {
    const url = api('/dsh-plugin-pack/import-bundle?stream=1' + (force ? '&force=true' : ''))
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: data,
    })
    if (!response.ok) {
      const text = await response.text()
      let error = `HTTP ${response.status}`
      try { error = JSON.parse(text).error || error } catch { /* ignore */ }
      throw new Error(error)
    }
    const reader = response.body?.getReader()
    if (!reader) throw new Error('streaming not supported')
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const events = buffer.split('\n\n')
      buffer = events.pop() || ''
      for (const event of events) {
        const line = event.split('\n').find((l) => l.startsWith('data: '))
        if (!line) continue
        const payload = JSON.parse(line.slice(6))
        if (payload.type === 'progress') {
          onProgress(payload.index, payload.total, payload.name)
        } else if (payload.type === 'done') {
          const { type: _type, ...result } = payload
          return result as ImportResult
        } else if (payload.type === 'error') {
          throw new Error(payload.error)
        }
      }
    }
    throw new Error('stream ended without result')
  },

  previewImport: (content: string, force = false) =>
    jsonFetch<ImportPreview>('/dsh-plugin-pack/preview-import', {
      method: 'POST',
      body: JSON.stringify({ content, force }),
    }),

  doImport: (content: string, force = false) =>
    jsonFetch<ImportResult>('/dsh-plugin-pack/import', {
      method: 'POST',
      body: JSON.stringify({ content, confirm: true, force }),
    }),

  listPacks: () => jsonFetch<{ records: PackRecord[] }>('/dsh-plugin-pack/packs'),

  getVersion: () => jsonFetch<{ version: string }>('/dsh-plugin-pack/version'),

  checkUpdate: async (): Promise<{ latest: string; current: string; hasUpdate: boolean; url: string; body?: string }> => {
    const [{ version: current }, gh] = await Promise.all([
      jsonFetch<{ version: string }>('/dsh-plugin-pack/version'),
      fetch('https://api.github.com/repos/Robot27-xiaosong/dsh-plugin-pack/releases/latest', {
        headers: { 'Accept': 'application/vnd.github+json' },
      }),
    ])
    if (gh.status === 404) {
      return { latest: current, current, hasUpdate: false, url: 'https://github.com/Robot27-xiaosong/dsh-plugin-pack/releases' }
    }
    if (!gh.ok) throw new Error(`检查更新失败（${gh.status}）`)
    const data = await gh.json()
    const latest = (data.tag_name || '').replace(/^v/, '')
    return {
      latest,
      current,
      hasUpdate: latest !== '' && compareVersions(latest, current) > 0,
      url: data.html_url || 'https://github.com/Robot27-xiaosong/dsh-plugin-pack/releases',
      body: data.body,
    }
  },

  updatePlugin: () => jsonFetch<{ ok: boolean; version?: string; restartRequired?: boolean; alreadyLatest?: boolean }>(
    '/dsh-plugin-pack/update',
    { method: 'POST' },
  ),

  getPackPlugins: (id: string) => jsonFetch<{ plugins: PackPlugin[] }>(`/dsh-plugin-pack/packs/${id}/plugins`),

  detachPlugin: (id: string, plugin: string) =>
    jsonFetch<{ record: PackRecord }>(`/dsh-plugin-pack/packs/${id}/detach`, {
      method: 'POST',
      body: JSON.stringify({ plugin }),
    }),

  getPack: (id: string) => jsonFetch<{ record: PackRecord; pack: PluginPack }>(`/dsh-plugin-pack/packs/${id}`),

  deletePack: (id: string) =>
    jsonFetch<{ ok: boolean }>(`/dsh-plugin-pack/packs/${id}/delete`, { method: 'POST' }),

  renamePack: (id: string, newName: string) =>
    jsonFetch<{ record: PackRecord }>(`/dsh-plugin-pack/packs/${id}/rename`, {
      method: 'POST',
      body: JSON.stringify({ newName }),
    }),

  duplicatePack: (id: string, newName?: string) =>
    jsonFetch<{ record: PackRecord }>(`/dsh-plugin-pack/packs/${id}/duplicate`, {
      method: 'POST',
      body: JSON.stringify({ newName }),
    }),

  /** URL for downloading a pack file (triggers browser download). */
  downloadUrl: (id: string) => api(`/dsh-plugin-pack/packs/${id}/download`),

  /** Fetch pack content as text (for copy-to-clipboard). */
  fetchPackText: async (id: string): Promise<string> => {
    const response = await fetch(api(`/dsh-plugin-pack/packs/${id}/download`))
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.text()
  },
}
