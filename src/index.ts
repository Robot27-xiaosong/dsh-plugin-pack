/**
 * dsh-plugin-pack — community plugin packs for DeepSeek Harness.
 *
 * Host entry: registers the `pluginPack` service and the HTTP routes that
 * the browser settings panel talks to. The agent tool is exported from
 * `dsh-plugin-pack/tools`; pure format helpers from `dsh-plugin-pack/format`.
 */
import type { Context } from '@deepseek-ai/cordis'
import { PluginPackService } from './service.js'
import { mountPackRoutes } from './routes.js'

export { PluginPackService }
export { GENERATOR } from './service.js'
export { mountPackRoutes } from './routes.js'
export type * from './types.js'

export const name = 'dsh-plugin-pack'

export function apply(ctx: Context): void {
  // Register the host service (constructor calls ctx.reflect.provide).
  new PluginPackService(ctx)

  // Mount HTTP routes once the web server is available.
  ctx.inject(['webServer'], (hostCtx: Context) => {
    hostCtx.effect(() => {
      const dispose = mountPackRoutes(hostCtx)
      return dispose
    }, 'dsh-plugin-pack: http routes')
  })
}
