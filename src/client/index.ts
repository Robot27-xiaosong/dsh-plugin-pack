/**
 * dsh-plugin-pack client entry: registers a "Plugin Packs" settings section
 * rendering the scan/export/packs/import UI.
 *
 * Built by esbuild into the __ModuleLoader__ factory bundle at client/client.js;
 * react and react-dom are externals resolved through the host's module table.
 */

import { createElement as h } from 'react'
import { PackSection } from './PackSection.js'

export const name = 'dsh-plugin-pack'
// Required: DSH injects the slots service into the plugin context.
export const inject = ['slots']

/** Structural subset of the client cordis context this plugin touches. */
interface ClientContext {
  effect(callback: () => (() => void) | Promise<void>, label?: string): void
  get?: (name: string) => unknown
  slots: {
    inject(slotName: string, factory: () => unknown): unknown
    register(meta: Record<string, unknown>, component: unknown): unknown
    getVersion?(slotName: string): number
    entries?(slotName: string): Array<{ options: Record<string, unknown> }>
    subscribe?(slotName: string, listener: () => void): () => void
  }
}

export function apply(ctx: ClientContext): void {
  try {
    // slots.inject() declares the slot in the parent's children table before
    // registering into it. Direct slots.register() throws "slot not declared".
    ctx.slots.inject('settings.section', () =>
      ctx.slots.register(
        {
          name: 'settings.section',
          id: 'plugin-packs',
          order: 50,
          label: () => '插件包',
        },
        // DSH expects the component itself, not a render thunk.
        PackSection as unknown as React.ComponentType,
      ),
    )
  } catch (e) {
    console.error('[dsh-plugin-pack] apply failed:', e)
  }
}
