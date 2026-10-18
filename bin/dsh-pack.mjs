#!/usr/bin/env node
/**
 * dsh-pack — standalone CLI for DSH community plugin packs.
 *
 * Zero DSH runtime dependency: it reads the profile directory directly and
 * shells out to `dsh plugin add` only when importing with --yes.
 */
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { PluginPackService } from '../lib/index.js'
import { readPack, validatePack, serializePack } from '../lib/pack-format.js'
import { PackStore } from '../lib/store.js'

// ---------------------------------------------------------------------------
// Argument parsing (minimal, no external deps)
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        args[key] = true
      } else {
        args[key] = next
        i++
      }
    } else {
      args._.push(a)
    }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const command = args._[0]

function usage() {
  console.log(`dsh-pack — DSH community plugin packs

Usage:
  dsh-pack scan     --profile <name> [--dsh-home <dir>] [--json]
  dsh-pack preview  --profile <name> --name <pack> [--select a,b | --all] [--description "..."]
  dsh-pack export   --profile <name> --name <pack> [--select a,b | --all] [--description "..."] [--output <file>]
  dsh-pack validate --file <file>
  dsh-pack import   --profile <name> --file <file> [--yes] [--registry <url>] [--dsh-bin <path>]
  dsh-pack list     --profile <name> [--dsh-home <dir>]
  dsh-pack get      --profile <name> --id <id>
  dsh-pack rename   --profile <name> --id <id> --new-name <name>
  dsh-pack duplicate --profile <name> --id <id> --new-name <name>
  dsh-pack delete   --profile <name> --id <id>

Options:
  --profile <name>   DSH profile name (default: web)
  --dsh-home <dir>   DSH home directory (default: $DSH_HOME or ~/.dsh)
  --json             Output raw JSON instead of human-readable text
  -h, --help         Show this help
`)
}

if (!command || args.help || args.h) {
  usage()
  process.exit(command ? 0 : 1)
}

// ---------------------------------------------------------------------------
// Profile resolution
// ---------------------------------------------------------------------------

function dshHome() {
  return args['dsh-home'] ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

function profileDir() {
  const name = args.profile ?? 'web'
  return resolve(dshHome(), 'profiles', name)
}

function makeService() {
  const dir = profileDir()
  if (!existsSync(dir)) {
    console.error(`Profile directory not found: ${dir}`)
    console.error('Create it first with: dsh profile create <name>')
    process.exit(1)
  }
  // Minimal mock context for the service (it only needs pluginManager for
  // scan/import; CLI import shells out to dsh instead).
  const ctx = {
    get(name) {
      if (name === 'profileContext') return { dir }
      if (name === 'pluginManager') return cliPluginManager(dir)
      return undefined
    },
    reflect: { provide: () => {} },
  }
  return new PluginPackService(ctx)
}

/**
 * A pluginManager shim for the CLI. listBundles reads the profile's
 * package.json to reconstruct installed community bundles; installBundle
 * shells out to `dsh plugin add`.
 */
function cliPluginManager(dir) {
  function readBundles() {
    const manifestPath = join(dir, 'package.json')
    if (!existsSync(manifestPath)) return []
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const deps = { ...manifest.devDependencies, ...manifest.dependencies }
    return Object.entries(deps).map(([name, spec]) => ({
      name,
      official: false,
      installed: true,
      availability: 'profile',
      enabled: true,
      source: String(spec),
      version: extractVersion(String(spec)),
    }))
  }
  return {
    async listBundles() {
      return readBundles()
    },
    async installBundle(spec, opts) {
      const profile = args.profile ?? 'web'
      const ok = runDshAdd(profile, spec, opts?.registry, args)
      if (!ok) throw new Error(`dsh plugin add failed for ${spec}`)
      return { success: true, spec }
    },
  }
}

function extractVersion(spec) {
  const m = /@([\d][\w.\-+]*)$/.exec(spec)
  return m ? m[1] : undefined
}

function runDshAdd(profile, spec, registry, args) {
  const bin = typeof args['dsh-bin'] === 'string' ? args['dsh-bin'] : process.env.DSH_BIN ?? 'dsh'
  const argv = ['plugin', '--profile', profile, 'add', spec]
  if (typeof registry === 'string' && registry) argv.push('--registry', registry)
  const onWindows = process.platform === 'win32'
  if (onWindows) {
    const command = `"${bin}" ${argv.map(quoteArg).join(' ')}`
    const result = spawnSync(command, { stdio: 'inherit', shell: true })
    return result.status === 0
  }
  const result = spawnSync(bin, argv, { stdio: 'inherit', shell: false })
  return result.status === 0
}

function quoteArg(a) {
  if (/[\s"]/.test(a)) return `"${a.replace(/"/g, '\\"')}"`
  return a
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function print(obj) {
  if (args.json) {
    console.log(JSON.stringify(obj, null, 2))
  } else {
    console.log(JSON.stringify(obj, null, 2))
  }
}

function fail(message) {
  console.error(`error: ${message}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function main() {
  switch (command) {
    case 'scan': {
      const svc = makeService()
      const plugins = await svc.scanCommunity()
      print({ count: plugins.length, plugins })
      return
    }

    case 'preview': {
      if (!args.name) fail('--name is required')
      const svc = makeService()
      const select = args.select ? String(args.select).split(',').map((s) => s.trim()).filter(Boolean) : undefined
      const result = await svc.buildPack(
        { select, all: args.all === true },
        { name: String(args.name), description: args.description ? String(args.description) : undefined },
      )
      print({ pack: result.pack, missing: result.missing, warnings: result.warnings })
      return
    }

    case 'export': {
      if (!args.name) fail('--name is required')
      const svc = makeService()
      const select = args.select ? String(args.select).split(',').map((s) => s.trim()).filter(Boolean) : undefined
      const result = await svc.exportPack(
        { select, all: args.all === true },
        { name: String(args.name), description: args.description ? String(args.description) : undefined },
        { output: args.output ? String(args.output) : undefined },
      )
      print({ record: result.record, filePath: result.filePath, warnings: result.warnings })
      return
    }

    case 'validate': {
      if (!args.file) fail('--file is required')
      const text = readFileSync(String(args.file), 'utf8')
      const pack = validatePack(JSON.parse(text))
      print({ valid: true, name: pack.name, pluginCount: pack.plugins.length })
      return
    }

    case 'import': {
      if (!args.file) fail('--file is required')
      const svc = makeService()
      const file = String(args.file)
      const preview = await svc.previewImport(file)
      if (args.yes !== true) {
        print({
          mode: 'preview (use --yes to install)',
          packName: preview.pack.name,
          toInstall: preview.toInstall,
          alreadyInstalled: preview.alreadyInstalled,
          notPortable: preview.notPortable,
          warnings: preview.warnings,
        })
        return
      }
      const result = await svc.importPack(file, { confirm: true, registry: args.registry ? String(args.registry) : undefined })
      print({ installed: result.installed, skipped: result.skipped, warnings: result.warnings })
      return
    }

    case 'list': {
      const store = new PackStore(profileDir())
      const records = store.listRecords()
      print({ count: records.length, records })
      return
    }

    case 'get': {
      if (!args.id) fail('--id is required')
      const store = new PackStore(profileDir())
      const record = store.getRecord(String(args.id))
      if (!record) fail(`record not found: ${args.id}`)
      const pack = store.readRecordPack(String(args.id))
      print({ record, pack })
      return
    }

    case 'rename': {
      if (!args.id) fail('--id is required')
      if (!args['new-name']) fail('--new-name is required')
      const store = new PackStore(profileDir())
      const record = store.renameRecord(String(args.id), String(args['new-name']))
      print({ record })
      return
    }

    case 'duplicate': {
      if (!args.id) fail('--id is required')
      if (!args['new-name']) fail('--new-name is required')
      const store = new PackStore(profileDir())
      const record = store.duplicateRecord(String(args.id), String(args['new-name']))
      print({ record })
      return
    }

    case 'delete': {
      if (!args.id) fail('--id is required')
      const store = new PackStore(profileDir())
      store.deleteRecord(String(args.id))
      print({ deleted: args.id })
      return
    }

    default:
      console.error(`unknown command: ${command}`)
      usage()
      process.exit(1)
  }
}

main().catch((e) => {
  console.error(e?.stack ?? String(e))
  process.exit(1)
})
