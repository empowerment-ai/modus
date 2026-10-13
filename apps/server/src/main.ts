// Start the Modus server: read the configuration, load the design, start the
// engine clock, serve the API (and the studio, when STATIC_DIR is set).
//
//   PORT=8787 DATA_DIR=./data TIME_SCALE=1 pnpm --filter @modus-bpm/server dev
//   DB_DIALECT=postgres DATABASE_URL=postgres://modus:modus-dev-only@127.0.0.1:5432/modus pnpm --filter @modus-bpm/server dev
//
// Every setting is described in src/config.ts and docs/DEPLOYMENT.md.

import { memoryStorage } from './adapters/memory'
import { postgresStorage } from './adapters/postgres'
import { anthropicModel } from './assistant'
import { ConfigError, describeConfig, loadConfig } from './config'
import { buildServer } from './http'
import type { Storage } from './ports'
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

let storage: Storage
if (config.db.dialect === 'postgres') {
  const pg = postgresStorage(config.db.url)
  try {
    await pg.migrate()
  } catch (err) {
    // Driver errors can quote the connection string; print only the message.
    console.error(`Cannot prepare the database: ${err instanceof Error ? err.message : String(err)}`)
    await pg.close()
    process.exit(1)
  }
  storage = pg
} else {
  storage = memoryStorage(config.dataDir)
}

const runtime = await Runtime.create({
  storage,
  timeScale: config.timeScale,
  onError: (err, during) => server.log.error({ err }, during === 'subscriber' ? 'A change subscriber failed' : `${during} failed; retrying`),
})
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
    await storage.close?.()
    process.exit(0)
  })
}
