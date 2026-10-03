// Bundle the server for production: one ESM file for Node 22 with every
// dependency inlined (the workspace's TypeScript core included), so the
// container's runtime stage needs no node_modules. The licenses of every
// bundled package go to dist/THIRD-PARTY-NOTICES.txt, which ships alongside.
//
//   pnpm --filter @modus-bpm/server build && node apps/server/dist/server.mjs

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { build } from 'esbuild'

rmSync('dist', { recursive: true, force: true })
const result = await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/server.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  minify: true,
  keepNames: true,
  sourcemap: true,
  sourcesContent: false,
  legalComments: 'none',
  // CommonJS dependencies (Fastify, pino…) call require() for Node built-ins; give the ESM bundle one.
  banner: { js: "import { createRequire as __modusRequire } from 'node:module'; const require = __modusRequire(import.meta.url);" },
  metafile: true,
  logLevel: 'warning',
})

// Every package that ended up in the bundle, with its license text.
const roots = new Set()
for (const input of Object.keys(result.metafile.inputs)) {
  const m = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input)
  if (m) roots.add(m[1])
}
const notices = [...roots]
  .map((root) => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    const file = readdirSync(root).find((f) => /^(licen[cs]e|copying)/i.test(f))
    const text = file && existsSync(join(root, file)) ? readFileSync(join(root, file), 'utf8').trim() : `License: ${pkg.license ?? 'see the package'}`
    return { id: `${pkg.name}@${pkg.version} (${pkg.license ?? 'unknown'})`, text }
  })
  .sort((a, b) => a.id.localeCompare(b.id))
writeFileSync('dist/THIRD-PARTY-NOTICES.txt', `Modus server bundle: third-party software\n\n${notices.map((n) => `${'='.repeat(78)}\n${n.id}\n\n${n.text}\n`).join('\n')}`)

const bytes = Object.values(result.metafile.outputs).reduce((n, o) => n + o.bytes, 0)
console.log(`dist/server.mjs: ${(bytes / 1024 / 1024).toFixed(1)} MB with its source map; ${notices.length} bundled packages listed in dist/THIRD-PARTY-NOTICES.txt`)
