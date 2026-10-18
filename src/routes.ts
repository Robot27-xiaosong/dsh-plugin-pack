/**
 * HTTP routes bridging the browser settings panel to the host service.
 *
 * Uses a single `prefix` route at `/dsh-plugin-pack` and dispatches by
 * request URL + method inside the handler. This is required because the
 * DSH webServer's `exact` matcher does not support `:id` path params.
 *
 * Mutating routes (export, import, delete, rename, duplicate) accept only
 * same-origin POSTs.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { PluginPackService } from './service.js'
import type { PackMeta } from './types.js'

/** Current plugin version, read from package.json at build time. */
const PLUGIN_VERSION = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))
    return pkg.version || '0.0.0'
  } catch {
    return '0.0.0'
  }
})()

/** The subset of the DSH webServer service this plugin uses. */
export interface WebServerService {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  }): () => void
}

const ROUTE_PREFIX = '/dsh-plugin-pack'

/** Write a JSON response with no-store caching. */
function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

/** Read and parse a JSON request body (max 256 KiB). */
async function readJsonBody(request: IncomingMessage, maxBytes = 262144): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) throw new Error('request body too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

/** Read a raw binary request body (max 256 MiB) into a temp file. */
async function readBinaryBody(request: IncomingMessage, suffix: string): Promise<{ dir: string; file: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pack-up-'))
  const file = join(dir, suffix)
  const chunks: Buffer[] = []
  let size = 0
  const maxBytes = 256 * 1024 * 1024
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) throw new Error('upload too large (max 256 MiB)')
    chunks.push(buffer)
  }
  writeFileSync(file, Buffer.concat(chunks))
  return { dir, file }
}

/** True when the request's Origin matches its Host (or Origin is absent). */
function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin
  if (origin === undefined) return true
  const host = request.headers.host
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** Look up the pluginPack service at request time. */
function getService(ctx: Context): PluginPackService {
  const service = ctx.get('pluginPack') as PluginPackService | undefined
  if (!service) throw new Error('pluginPack service is not available')
  return service
}

/**
 * Write an uploaded pack body to a temp file and return its path.
 * The caller is responsible for cleaning up the temp directory.
 */
function writeTempPack(body: { pack?: unknown; content?: string }): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pack-'))
  const file = join(dir, 'pack.dshpack.json')
  const content = body.content ?? JSON.stringify(body.pack)
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content), 'utf8')
  return { dir, file }
}

function cleanupTemp(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
}

/** Parse the path after the prefix, stripping query string. */
function parsePath(request: IncomingMessage): { path: string; segments: string[] } {
  const raw = request.url ?? ''
  const withoutQuery = raw.split('?')[0]
  // Remove the prefix to get the relative path
  const path = withoutQuery.startsWith(ROUTE_PREFIX)
    ? withoutQuery.slice(ROUTE_PREFIX.length)
    : withoutQuery
  const segments = path.split('/').filter(Boolean)
  return { path, segments }
}

/**
 * Mount all pack routes on the webServer service via a single prefix route.
 * @returns a disposer that unregisters the route.
 */
export function mountPackRoutes(ctx: Context): () => void {
  const webServer = ctx.get('webServer') as WebServerService

  const handler = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const { segments } = parsePath(request)
    const method = request.method ?? 'GET'

    try {
      // ---- GET /version ----
      if (method === 'GET' && segments.length === 1 && segments[0] === 'version') {
        sendJson(response, 200, { version: PLUGIN_VERSION })
        return
      }

      // ---- POST /update (auto-download & install latest from GitHub) ----
      if (method === 'POST' && segments.length === 1 && segments[0] === 'update') {
        if (!sameOrigin(request)) { sendJson(response, 403, { error: 'cross-origin request refused' }); return }
        try {
          // 1. Fetch latest release
          const gh = await fetch('https://api.github.com/repos/Robot27-xiaosong/dsh-plugin-pack/releases/latest', {
            headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'dsh-plugin-pack' },
          })
          if (gh.status === 404) { sendJson(response, 200, { ok: true, alreadyLatest: true, version: PLUGIN_VERSION }); return }
          if (!gh.ok) throw new Error(`GitHub API ${gh.status}`)
          const release = await gh.json() as { tag_name?: string; assets?: Array<{ name: string; browser_download_url: string }>; html_url?: string }
          const latest = (release.tag_name || '').replace(/^v/, '')
          if (!latest) throw new Error('无法获取最新版本号')
          if (latest === PLUGIN_VERSION) { sendJson(response, 200, { ok: true, alreadyLatest: true, version: PLUGIN_VERSION }); return }

          // 2. Find .tgz asset
          const tgzAsset = release.assets?.find((a) => a.name.endsWith('.tgz'))
          if (!tgzAsset) throw new Error('最新 Release 中未找到 .tgz 安装包')

          // 3. Download tgz to temp
          const dl = await fetch(tgzAsset.browser_download_url, { headers: { 'User-Agent': 'dsh-plugin-pack' } })
          if (!dl.ok) throw new Error(`下载失败 ${dl.status}`)
          const buf = Buffer.from(await dl.arrayBuffer())
          const tmpDir = mkdtempSync(join(tmpdir(), 'dsh-pack-update-'))
          const tmpTgz = join(tmpDir, 'dsh-plugin-pack-latest.tgz')
          writeFileSync(tmpTgz, buf)

          // 4. Remove old + install new via pluginManager
          const manager = ctx.get('pluginManager') as {
            removeBundle: (name: string) => Promise<unknown>
            installBundle: (spec: string, opts?: { enabled?: boolean; registry?: string }) => Promise<{ changed: boolean; application: string; error?: { code?: string; message?: string; diagnostic?: string } }>
          }
          try { await manager.removeBundle('dsh-plugin-pack') } catch { /* not installed or already removed */ }
          const spec = `file:${tmpTgz.replace(/\\/g, '/')}`
          const result = await manager.installBundle(spec)
          if (result.application === 'failed') {
            const errMsg = result.error?.message || result.error?.diagnostic || result.error?.code || '安装失败'
            throw new Error(errMsg)
          }
          sendJson(response, 200, { ok: true, version: latest, restartRequired: result.application === 'restart-required' || result.application !== 'applied' })
        } catch (e) {
          sendJson(response, 500, { error: (e as Error).message })
        }
        return
      }

      // ---- GET /scan ----
      if (method === 'GET' && segments.length === 1 && segments[0] === 'scan') {
        const service = getService(ctx)
        const plugins = await service.scanCommunity()
        sendJson(response, 200, { plugins })
        return
      }

      // ---- POST /build ----
      if (method === 'POST' && segments.length === 1 && segments[0] === 'build') {
        if (!sameOrigin(request)) { sendJson(response, 403, { error: 'cross-origin request refused' }); return }
        const body = await readJsonBody(request) as { selection?: { select?: string[]; all?: boolean }; meta?: PackMeta }
        if (!body.meta?.name) { sendJson(response, 400, { error: 'meta.name is required' }); return }
        const service = getService(ctx)
        const result = await service.buildPack(body.selection ?? {}, body.meta)
        sendJson(response, 200, result)
        return
      }

      // ---- POST /export ----
      if (method === 'POST' && segments.length === 1 && segments[0] === 'export') {
        if (!sameOrigin(request)) { sendJson(response, 403, { error: 'cross-origin request refused' }); return }
        const body = await readJsonBody(request) as { selection?: { select?: string[]; all?: boolean }; meta?: PackMeta }
        if (!body.meta?.name) { sendJson(response, 400, { error: 'meta.name is required' }); return }
        const service = getService(ctx)
        const result = await service.exportPack(body.selection ?? {}, body.meta)
        sendJson(response, 200, result)
        return
      }

      // ---- POST /export-bundle (offline .dshpack binary) ----
      if (method === 'POST' && segments.length === 1 && segments[0] === 'export-bundle') {
        if (!sameOrigin(request)) { sendJson(response, 403, { error: 'cross-origin request refused' }); return }
        const body = await readJsonBody(request) as { selection?: { select?: string[]; all?: boolean }; meta?: PackMeta }
        if (!body.meta?.name) { sendJson(response, 400, { error: 'meta.name is required' }); return }
        const service = getService(ctx)
        const result = await service.exportBundle(body.selection ?? {}, body.meta)
        if (!existsSync(result.archivePath)) { sendJson(response, 500, { error: 'archive was not created' }); return }
        const data = readFileSync(result.archivePath)
        const archiveName = basename(result.archivePath)
        response.writeHead(200, {
          'cache-control': 'no-store',
          'content-type': 'application/gzip',
          'content-disposition': `attachment; filename="${archiveName}"`,
          'content-length': String(data.length),
        })
        response.end(data)
        return
      }

      // ---- POST /import-bundle (offline .dshpack binary upload) ----
      if (method === 'POST' && segments.length === 1 && segments[0] === 'import-bundle') {
        if (!sameOrigin(request)) { sendJson(response, 403, { error: 'cross-origin request refused' }); return }
        const force = (request.url ?? '').includes('force=true')
        const stream = (request.url ?? '').includes('stream=1')
        const service = getService(ctx)
        const { dir, file } = await readBinaryBody(request, 'upload.dshpack')
        try {
          if (stream) {
            // SSE: stream progress events, then the final result.
            response.writeHead(200, {
              'cache-control': 'no-store',
              'content-type': 'text/event-stream; charset=utf-8',
              'connection': 'keep-alive',
              'x-accel-buffering': 'no',
            })
            const result = await service.importBundle(file, {
              confirm: true,
              force,
              onProgress: (index, total, name) => {
                response.write(`data: ${JSON.stringify({ type: 'progress', index, total, name })}\n\n`)
              },
            })
            const { tempDir, ...payload } = result
            service.cleanupTemp(tempDir)
            response.write(`data: ${JSON.stringify({ type: 'done', ...payload })}\n\n`)
            response.end()
          } else {
            const result = await service.importBundle(file, { confirm: true, force })
            const { tempDir, ...payload } = result
            service.cleanupTemp(tempDir)
            sendJson(response, 200, payload)
          }
        } catch (e) {
          cleanupTemp(dir)
          if (stream) {
            response.write(`data: ${JSON.stringify({ type: 'error', error: (e as Error).message })}\n\n`)
            response.end()
          } else {
            sendJson(response, 400, { error: (e as Error).message })
          }
        }
        return
      }

      // ---- POST /preview-import ----
      if (method === 'POST' && segments.length === 2 && segments[0] === 'preview-import') {
        if (!sameOrigin(request)) { sendJson(response, 403, { error: 'cross-origin request refused' }); return }
        const body = await readJsonBody(request) as { content?: string; force?: boolean }
        if (!body.content) { sendJson(response, 400, { error: 'content is required' }); return }
        const service = getService(ctx)
        const { dir, file } = writeTempPack(body)
        try {
          const result = await service.previewImport(file, { force: body.force })
          sendJson(response, 200, result)
        } finally { cleanupTemp(dir) }
        return
      }

      // ---- POST /import ----
      if (method === 'POST' && segments.length === 1 && segments[0] === 'import') {
        if (!sameOrigin(request)) { sendJson(response, 403, { error: 'cross-origin request refused' }); return }
        const body = await readJsonBody(request) as { content?: string; confirm?: boolean; force?: boolean }
        if (!body.content) { sendJson(response, 400, { error: 'content is required' }); return }
        if (!body.confirm) { sendJson(response, 400, { error: 'confirm=true is required for import' }); return }
        const service = getService(ctx)
        const { dir, file } = writeTempPack(body)
        try {
          const result = await service.importPack(file, { confirm: true, force: body.force })
          sendJson(response, 200, result)
        } finally { cleanupTemp(dir) }
        return
      }

      // ---- GET /packs ----
      if (method === 'GET' && segments.length === 1 && segments[0] === 'packs') {
        const service = getService(ctx)
        const records = service.listRecords()
        sendJson(response, 200, { records })
        return
      }

      // ---- GET /packs/:id ----
      if (method === 'GET' && segments.length === 2 && segments[0] === 'packs') {
        const id = segments[1]
        const service = getService(ctx)
        const record = service.getRecord(id)
        if (!record) { sendJson(response, 404, { error: 'pack not found' }); return }
        const pack = service.readRecord(id)
        sendJson(response, 200, { record, pack })
        return
      }

      // ---- GET /packs/:id/download ----
      if (method === 'GET' && segments.length === 3 && segments[0] === 'packs' && segments[2] === 'download') {
        const id = segments[1]
        const service = getService(ctx)
        const record = service.getRecord(id)
        if (!record) { sendJson(response, 404, { error: 'pack not found' }); return }
        // Format 2: serve the offline binary .dshpack; otherwise the JSON.
        const downloadName = record.archiveName ?? record.fileName
        const filePath = join(service.store.storeDir, downloadName)
        if (!existsSync(filePath)) { sendJson(response, 404, { error: 'pack file missing on disk' }); return }
        if (record.archiveName) {
          const data = readFileSync(filePath)
          response.writeHead(200, {
            'cache-control': 'no-store',
            'content-type': 'application/gzip',
            'content-disposition': `attachment; filename="${downloadName}"`,
            'content-length': String(data.length),
          })
          response.end(data)
        } else {
          const content = readFileSync(filePath, 'utf8')
          response.writeHead(200, {
            'cache-control': 'no-store',
            'content-type': 'application/json; charset=utf-8',
            'content-disposition': `attachment; filename="${downloadName}"`,
          })
          response.end(content)
        }
        return
      }

      // ---- GET /packs/:id/plugins ----
      if (method === 'GET' && segments.length === 3 && segments[0] === 'packs' && segments[2] === 'plugins') {
        const id = segments[1]
        const service = getService(ctx)
        try {
          const plugins = service.getPackPlugins(id)
          sendJson(response, 200, { plugins })
        } catch (e) { sendJson(response, 404, { error: (e as Error).message }) }
        return
      }

      // ---- POST /packs/:id/detach ----
      if (method === 'POST' && segments.length === 3 && segments[0] === 'packs' && segments[2] === 'detach') {
        if (!sameOrigin(request)) { sendJson(response, 403, { error: 'cross-origin request refused' }); return }
        const id = segments[1]
        const body = await readJsonBody(request) as { plugin?: string }
        if (!body.plugin) { sendJson(response, 400, { error: 'plugin is required' }); return }
        const service = getService(ctx)
        const record = service.detachPlugin(id, body.plugin)
        sendJson(response, 200, { record })
        return
      }

      // ---- POST /packs/:id/delete ----
      if (method === 'POST' && segments.length === 3 && segments[0] === 'packs' && segments[2] === 'delete') {
        if (!sameOrigin(request)) { sendJson(response, 403, { error: 'cross-origin request refused' }); return }
        const id = segments[1]
        const service = getService(ctx)
        await service.deleteRecord(id)
        sendJson(response, 200, { ok: true })
        return
      }

      // ---- POST /packs/:id/rename ----
      if (method === 'POST' && segments.length === 3 && segments[0] === 'packs' && segments[2] === 'rename') {
        if (!sameOrigin(request)) { sendJson(response, 403, { error: 'cross-origin request refused' }); return }
        const id = segments[1]
        const body = await readJsonBody(request) as { newName?: string }
        if (!body.newName) { sendJson(response, 400, { error: 'newName is required' }); return }
        const service = getService(ctx)
        const record = service.renameRecord(id, body.newName)
        sendJson(response, 200, { record })
        return
      }

      // ---- POST /packs/:id/duplicate ----
      if (method === 'POST' && segments.length === 3 && segments[0] === 'packs' && segments[2] === 'duplicate') {
        if (!sameOrigin(request)) { sendJson(response, 403, { error: 'cross-origin request refused' }); return }
        const id = segments[1]
        const body = await readJsonBody(request) as { newName?: string }
        const service = getService(ctx)
        const record = service.duplicateRecord(id, body.newName ?? `${id}-copy`)
        sendJson(response, 200, { record })
        return
      }

      // ---- Not found ----
      sendJson(response, 404, { error: `no route for ${method} ${request.url}` })
    } catch (error) {
      sendJson(response, 500, { error: (error as Error).message })
    }
  }

  const dispose = webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler,
  })

  return dispose
}
