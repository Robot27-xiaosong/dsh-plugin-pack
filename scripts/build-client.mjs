/**
 * Build the client bundle: esbuild bundles src/client/index.ts with react
 * externals, then we wrap the CJS output in the __ModuleLoader__ factory
 * format that DSH's web client expects.
 *
 * Output: client/client.js
 */
import { build } from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const entry = resolve(root, 'src/client/index.ts')
const outfile = resolve(root, 'client/client.js')

mkdirSync(dirname(outfile), { recursive: true })

await build({
  entryPoints: [entry],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  outfile: outfile + '.tmp',
  external: ['react', 'react-dom', 'react/jsx-runtime', '@deepseek-ai/*'],
  jsx: 'automatic',
  jsxImportSource: 'react',
  logLevel: 'warning',
})

const bundled = readFileSync(outfile + '.tmp', 'utf8')

// Wrap the CJS bundle in the ModuleLoader factory. The factory receives
// `require` (for externals) and we provide a fresh module/exports object.
// The CJS output assigns to module.exports at the end.
const wrapped = `window.__ModuleLoader__.load({ id: "dsh-plugin-pack", factory: (require) => {
var module = { exports: {} };
var exports = module.exports;
${bundled}
return module.exports;
}});
`

writeFileSync(outfile, wrapped, 'utf8')
try { unlinkSync(outfile + '.tmp') } catch { /* ignore */ }

console.log(`client bundle written: ${outfile} (${(wrapped.length / 1024).toFixed(1)} KB)`)
