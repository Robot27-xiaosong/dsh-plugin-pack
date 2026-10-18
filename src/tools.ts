/**
 * Agent tool `plugin_pack`: scan, export, preview and import community plugin
 * packs through natural language.
 *
 * Only the `import` action requires `danger-full-access` approval (it installs
 * plugins into the profile). All other actions are read-only or write only the
 * pack files inside the profile's `plugin-packs/` directory.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-user-approval'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { approveEscalation } from '@deepseek-ai/dsh-sandbox'
import type { PluginPackService } from './service.js'

/** Actions the tool supports. */
const ACTIONS = [
  'scan',
  'preview_export',
  'export',
  'preview_import',
  'import',
  'list',
  'get',
  'rename',
  'duplicate',
  'delete',
] as const

type Action = (typeof ACTIONS)[number]

/** Required services. */
export const inject = ['tools', 'pluginPack', 'sandboxPolicy']

/** Register the `plugin_pack` agent tool. */
export function apply(ctx: Context): void {
  const pack = ctx.get('pluginPack') as PluginPackService

  ctx.tools.register(
    defineTool({
      name: 'plugin_pack',
      description:
        'Manage community plugin packs in the current DSH profile: scan installed community plugins, select and export a pack, preview or import a pack file, and list/rename/duplicate/delete saved pack records. A pack (.dshpack.json) contains only plugin names, versions and reproducible sources — never keys, sessions, memory or caches. The official DSH runtime base is never selectable and never replaced. Importing installs plugins and requires danger-full-access approval; every other action is safe.',
      parameters: {
        action: {
          type: 'string',
          required: true,
          enum: [...ACTIONS],
          description: 'The pack operation to perform.',
        },
        select: {
          type: 'array',
          items: { type: 'string' },
          description: 'For preview_export/export: plugin names to include. Mutually exclusive with all.',
        },
        all: {
          type: 'boolean',
          description: 'For preview_export/export: include every installed community plugin.',
        },
        name: {
          type: 'string',
          description: 'For preview_export/export: the pack name. For rename/duplicate: the new name.',
        },
        description: {
          type: 'string',
          description: 'For preview_export/export: optional pack description.',
        },
        output: {
          type: 'string',
          description: 'For export: optional extra file path to write a shareable copy of the pack.',
        },
        file: {
          type: 'string',
          description: 'For preview_import/import: path to a .dshpack.json file.',
        },
        confirm: {
          type: 'boolean',
          description: 'For import: must be true after the user has reviewed preview_import and explicitly confirmed.',
        },
        registry: {
          type: 'string',
          description: 'For import: optional npm registry URL to ask first.',
        },
        id: {
          type: 'string',
          description: 'For get/rename/duplicate/delete: the pack record id (from list).',
        },
        newName: {
          type: 'string',
          description: 'For rename/duplicate: the new record name.',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      async execute(args, exec) {
        const action = args.action as Action

        switch (action) {
          case 'scan': {
            const plugins = await pack.scanCommunity()
            return JSON.stringify({
              count: plugins.length,
              plugins: plugins.map((p) => ({
                name: p.name,
                version: p.version,
                enabled: p.enabled,
                portable: p.portable,
                source: p.source,
              })),
            })
          }

          case 'preview_export': {
            requireName(args)
            const result = await pack.buildPack(
              { select: args.select, all: args.all },
              { name: args.name, description: args.description },
            )
            return JSON.stringify({
              pack: result.pack,
              missing: result.missing,
              warnings: result.warnings,
            })
          }

          case 'export': {
            requireName(args)
            const result = await pack.exportPack(
              { select: args.select, all: args.all },
              { name: args.name, description: args.description },
              { output: args.output },
            )
            return JSON.stringify({
              record: result.record,
              filePath: result.filePath,
              pluginCount: result.pack.plugins.length,
              warnings: result.warnings,
            })
          }

          case 'preview_import': {
            requireFile(args)
            const preview = await pack.previewImport(args.file)
            return JSON.stringify({
              packName: preview.pack.name,
              toInstall: preview.toInstall,
              alreadyInstalled: preview.alreadyInstalled,
              notPortable: preview.notPortable,
              warnings: preview.warnings,
            })
          }

          case 'import': {
            requireFile(args)
            if (args.confirm !== true) {
              throw new Error('import requires confirm: true after the user reviews preview_import')
            }
            await approveImport(ctx, exec, args)
            const result = await pack.importPack(args.file, {
              confirm: true,
              registry: args.registry,
            })
            return JSON.stringify({
              installed: result.installed,
              skipped: result.skipped,
              warnings: result.warnings,
            })
          }

          case 'list': {
            const records = pack.listRecords()
            return JSON.stringify({ count: records.length, records })
          }

          case 'get': {
            requireId(args)
            const record = pack.getRecord(args.id)
            if (!record) throw new Error(`pack record not found: ${args.id}`)
            const packDoc = pack.readRecord(args.id)
            return JSON.stringify({ record, pack: packDoc })
          }

          case 'rename': {
            requireId(args)
            if (!args.newName) throw new Error('newName is required for rename')
            const record = pack.renameRecord(args.id, args.newName)
            return JSON.stringify({ record })
          }

          case 'duplicate': {
            requireId(args)
            if (!args.newName) throw new Error('newName is required for duplicate')
            const record = pack.duplicateRecord(args.id, args.newName)
            return JSON.stringify({ record })
          }

          case 'delete': {
            requireId(args)
            pack.deleteRecord(args.id)
            return JSON.stringify({ deleted: args.id })
          }

          default:
            throw new Error(`unknown action: ${String(action)}`)
        }
      },
    }),
  )
}

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

function requireName(args: { name?: unknown }): asserts args is { name: string } {
  if (typeof args.name !== 'string' || args.name.length === 0) {
    throw new Error('name is required')
  }
}

function requireFile(args: { file?: unknown }): asserts args is { file: string } {
  if (typeof args.file !== 'string' || args.file.length === 0) {
    throw new Error('file path is required')
  }
}

function requireId(args: { id?: unknown }): asserts args is { id: string } {
  if (typeof args.id !== 'string' || args.id.length === 0) {
    throw new Error('id is required')
  }
}

async function approveImport(
  ctx: Context,
  exec: { agent?: unknown; callId: string; signal: AbortSignal },
  args: Record<string, unknown>,
): Promise<void> {
  const policy = ctx.sandboxPolicy.resolve(
    exec.agent ? { session: (exec.agent as { session?: unknown }).session as never } : undefined,
  )
  await approveEscalation(
    {
      requestedMode: 'danger-full-access',
      effectiveMode: policy.mode,
      subject: 'import community plugin pack',
      justification: `plugin_pack import ${JSON.stringify({ file: args.file, registry: args.registry })}. Installs community plugins into the profile; Host code runs outside the workspace sandbox.`,
    },
    {
      approver: ctx.get('approval') as never,
      agent: exec.agent as never,
      callId: exec.callId,
      toolName: 'plugin_pack',
      signal: exec.signal,
    },
  )
}
