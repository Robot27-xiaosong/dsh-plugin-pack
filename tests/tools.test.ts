import { describe, expect, it } from 'vitest'
import { apply } from '../src/tools.js'

function makeCtx(pack: Record<string, unknown>) {
  const registered: unknown[] = []
  const ctx = {
    tools: {
      register: (definition: unknown): (() => void) => {
        registered.push(definition)
        return () => {}
      },
    },
    pluginPack: pack,
    sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: '/' }) },
    get(name: string) {
      if (name === 'pluginPack') return pack
      if (name === 'sandboxPolicy') return { resolve: () => ({ mode: 'workspace-write', workspaceRoot: '/' }) }
      return undefined
    },
  }
  return { ctx, registered }
}

describe('plugin_pack tool registration', () => {
  it('registers one well-formed tool through the real defineTool', () => {
    const { ctx, registered } = makeCtx({})
    expect(() => apply(ctx as never)).not.toThrow()
    expect(registered).toHaveLength(1)
    const def = registered[0] as { name: string; description: string }
    expect(def.name).toBe('plugin_pack')
    expect(def.description).toContain('community plugin packs')
  })

  it('renders a string result as a text content block', () => {
    const { ctx, registered } = makeCtx({})
    apply(ctx as never)
    const def = registered[0] as {
      output: { render: (a: unknown, v: unknown) => Array<{ type: string; text: string }> }
    }
    const blocks = def.output.render({}, '{"a":1}')
    expect(blocks).toEqual([{ type: 'text', text: '{"a":1}' }])
  })

  it('executes list against the service', async () => {
    const pack = {
      profileDir: '/profile/web',
      listRecords: () => [{ id: 'pk_1', name: 'research', kind: 'exported', pluginCount: 1 }],
    }
    const { ctx, registered } = makeCtx(pack)
    apply(ctx as never)
    const def = registered[0] as {
      execute: (args: unknown, exec: unknown) => Promise<string>
    }
    const out = await def.execute({ action: 'list' }, { callId: 'c1', signal: new AbortController().signal })
    const parsed = JSON.parse(out)
    expect(parsed.count).toBe(1)
    expect(parsed.records[0].name).toBe('research')
  })
})
