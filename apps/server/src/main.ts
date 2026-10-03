// Start the Modus server: read the configuration, load the design, start the
// engine clock, serve the API (and the studio, when STATIC_DIR is set).
//
//   PORT=8787 DATA_DIR=./data TIME_SCALE=1 pnpm --filter @modus-bpm/server dev
//
// Every setting is described in src/config.ts and docs/DEPLOYMENT.md.

import { memoryStorage } from './adapters/memory'
import { anthropicModel } from './assistant'
import { ConfigError, describeConfig, loadConfig } from './config'
import { buildServer } from './http'
import { Runtime } from './runtime'

let loaded: ReturnType<typeof loadConfig>
try {
  loaded = loadConfig()
} catch (err) {
  if (!(err instanceof ConfigError)) throw err
  console.error(err.message)
  process.exit(1)
}
const { config, warnings } = loaded

const runtime = await Runtime.create({ storage: memoryStorage(config.dataDir), timeScale: config.timeScale })
runtime.start()

const server = buildServer(runtime, { logger: { level: config.logLevel }, staticDir: config.staticDir, assistant: anthropicModel(config.assistant) })
for (const w of warnings) server.log.warn(w)
server.log.info(describeConfig(config))
await server.listen({ port: config.port, host: config.host })

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    server.log.info(`${signal}: shutting down`)
    await server.close()
    await runtime.stop()
    process.exit(0)
  })
}
