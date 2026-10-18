import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CLI = join(process.cwd(), 'bin', 'dsh-pack.mjs')

function runCli(args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  })
}

function makeProfile(home: string, profile: string, deps: Record<string, string>) {
  const dir = join(home, 'profiles', profile)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: deps }, null, 2))
  return dir
}

describe('dsh-pack CLI', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'dsh-cli-'))
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('exports, validates and lists a pack', () => {
    makeProfile(home, 'web', { 'dsh-foo': 'dsh-foo@1.0.0' })
    const env = { DSH_HOME: home }

    const scan = runCli(['scan', '--profile', 'web'], env)
    expect(scan.status).toBe(0)
    expect(scan.stdout).toContain('dsh-foo')

    const out = runCli(
      ['export', '--profile', 'web', '--name', 'research', '--select', 'dsh-foo'],
      env,
    )
    expect(out.status).toBe(0)
    expect(out.stdout).toContain('research')

    // The pack file should exist in the profile.
    const packFile = join(home, 'profiles', 'web', 'plugin-packs', 'research.dshpack.json')
    expect(existsSync(packFile)).toBe(true)

    const validate = runCli(['validate', '--file', packFile], env)
    expect(validate.status).toBe(0)
    expect(validate.stdout).toContain('"valid": true')

    const list = runCli(['list', '--profile', 'web'], env)
    expect(list.status).toBe(0)
    expect(list.stdout).toContain('research')
  })

  it('installs with --yes through the dsh binary and skips non-portable entries', () => {
    makeProfile(home, 'web', {})
    const env = { DSH_HOME: home }

    // A fake dsh executable that records its argv.
    const fakeCjs = join(home, 'fake-dsh.cjs')
    writeFileSync(
      fakeCjs,
      `require('node:fs').appendFileSync(process.env.DSH_FAKE_LOG, JSON.stringify(process.argv.slice(2)) + '\\n')`,
    )
    const fakeCmd = join(home, 'fake-dsh.cmd')
    writeFileSync(fakeCmd, `@echo off\r\nnode "%~dp0fake-dsh.cjs" %*\r\n`)

    const logFile = join(home, 'dsh-calls.log')
    const packFile = join(home, 'test.dshpack.json')
    writeFileSync(
      packFile,
      JSON.stringify(
        {
          kind: 'dsh-plugin-pack',
          format: 1,
          name: 'test',
          createdAt: new Date().toISOString(),
          generator: { tool: 'test', version: '0' },
          plugins: [
            { name: 'dsh-new', portable: true, source: { type: 'npm', spec: 'dsh-new@2.0.0' } },
            { name: 'dsh-local', portable: false, source: { type: 'local' } },
          ],
        },
        null,
        2,
      ),
    )

    // Preview (no --yes) should not install.
    const preview = runCli(
      ['import', '--profile', 'web', '--file', packFile, '--dsh-bin', fakeCmd],
      { ...env, DSH_FAKE_LOG: logFile },
    )
    expect(preview.status).toBe(0)
    expect(preview.stdout).toContain('preview')
    expect(existsSync(logFile)).toBe(false)

    // With --yes it should call dsh plugin add for the portable entry only.
    const imp = runCli(
      ['import', '--profile', 'web', '--file', packFile, '--yes', '--dsh-bin', fakeCmd],
      { ...env, DSH_FAKE_LOG: logFile },
    )
    expect(imp.status).toBe(0)
    expect(existsSync(logFile)).toBe(true)
    const calls = readLog(logFile)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('add')
    expect(calls[0]).toContain('dsh-new@2.0.0')
  })

  it('renames and deletes records', () => {
    makeProfile(home, 'web', { 'dsh-foo': 'dsh-foo@1.0.0' })
    const env = { DSH_HOME: home }

    const exp = runCli(['export', '--profile', 'web', '--name', 'orig', '--select', 'dsh-foo'], env)
    expect(exp.status).toBe(0)
    const id = JSON.parse(exp.stdout).record.id

    const ren = runCli(['rename', '--profile', 'web', '--id', id, '--new-name', 'renamed'], env)
    expect(ren.status).toBe(0)
    expect(JSON.parse(ren.stdout).record.name).toBe('renamed')

    const dup = runCli(['duplicate', '--profile', 'web', '--id', id, '--new-name', 'copy'], env)
    expect(dup.status).toBe(0)

    const list = runCli(['list', '--profile', 'web'], env)
    expect(JSON.parse(list.stdout).count).toBe(2)

    const del = runCli(['delete', '--profile', 'web', '--id', id], env)
    expect(del.status).toBe(0)
    const list2 = runCli(['list', '--profile', 'web'], env)
    expect(JSON.parse(list2.stdout).count).toBe(1)
  })
})

function readLog(file: string): string[][] {
  const text = readFileSyncSafe(file)
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function readFileSyncSafe(file: string): string {
  // Local import to keep the top of the file clean.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require('node:fs')
  return readFileSync(file, 'utf8')
}
