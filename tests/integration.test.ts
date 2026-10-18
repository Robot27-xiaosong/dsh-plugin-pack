import { Context, Service } from '@deepseek-ai/cordis'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apply as packApply, PluginPackService } from '../src/index.js'
import { apply as toolsApply, inject as toolsInject } from '../src/tools.js'

class MockProfileContext extends Service {
  constructor(ctx: never, config: { dir: string }) {
    super(ctx, 'profileContext')
    this.dir = config.dir
  }
  dir: string
}

class MockPluginManager extends Service {
  constructor(ctx: never) {
    super(ctx, 'pluginManager')
  }
  installed: string[] = []
  async listBundles(): Promise<unknown[]> {
    return [
      {
        id: 'dsh-market',
        name: 'dsh-market',
        official: false,
        installed: true,
        availability: 'profile',
        spec: 'dsh-market@1.0.0',
        package: { name: 'dsh-market', version: '1.0.0' },
        enabled: true,
      },
    ]
  }
  async installBundle(spec: string): Promise<{ success: boolean; spec: string }> {
    this.installed.push(spec)
    return { success: true, spec }
  }
}

class MockTools extends Service {
  constructor(ctx: never) {
    super(ctx, 'tools')
  }
  registered: unknown[] = []
  register(definition: unknown): () => void {
    this.registered.push(definition)
    return () => {}
  }
}

class MockSandboxPolicy extends Service {
  constructor(ctx: never) {
    super(ctx, 'sandboxPolicy')
  }
  resolve() {
    return { mode: 'workspace-write', workspaceRoot: '/' }
  }
}

describe('real Cordis mount', () => {
  let ctx: Context
  let profileDir: string

  beforeEach(() => {
    profileDir = mkdtempSync(join(tmpdir(), 'dsh-pack-int-'))
    ctx = new Context()
    ctx.plugin(MockProfileContext, { dir: profileDir })
    ctx.plugin(MockPluginManager)
    ctx.plugin(MockTools)
    ctx.plugin(MockSandboxPolicy)
    ctx.plugin({ apply: packApply } as never)
    ctx.plugin({ inject: toolsInject, apply: toolsApply } as never)
  })

  afterEach(() => {
    rmSync(profileDir, { recursive: true, force: true })
  })

  const tick = () => new Promise((resolve) => setTimeout(resolve, 10))

  it('provides the pluginPack service and registers the agent tool', async () => {
    await tick()
    const pack = ctx.get('pluginPack') as unknown as PluginPackService
    expect(pack).toBeDefined()
    expect(pack.profileDir).toBe(profileDir)
    const tools = ctx.get('tools') as unknown as MockTools
    expect(tools.registered).toHaveLength(1)
    const def = tools.registered[0] as { name: string }
    expect(def.name).toBe('plugin_pack')
  })

  it('scans and exports a pack through the mounted service', async () => {
    await tick()
    const pack = ctx.get('pluginPack') as unknown as PluginPackService
    const community = await pack.scanCommunity()
    expect(community).toHaveLength(1)
    expect(community[0].name).toBe('dsh-market')
    const result = await pack.exportPack({ select: ['dsh-market'] }, { name: 'web' })
    expect(result.pack.kind).toBe('dsh-plugin-pack')
    expect(result.pack.plugins).toHaveLength(1)
    expect(result.pack.plugins[0].name).toBe('dsh-market')
    const records = await pack.listRecords()
    expect(records).toHaveLength(1)
    expect(records[0].name).toBe('web')
  })
})
