// Start the Modus server: load the design, start the engine clock, serve the API.
//
//   PORT=8787 DATA_DIR=./data TIME_SCALE=1 pnpm --filter @modus-bpm/server dev

import { memoryStorage } from './adapters/memory'
import { buildServer } from './http'
import { Runtime } from './runtime'

const port = Number(process.env.PORT ?? 8787)
const runtime = await Runtime.create({
  storage: memoryStorage(process.env.DATA_DIR || undefined),
  timeScale: Number(process.env.TIME_SCALE ?? 1),
})
runtime.start()

const server = buildServer(runtime)
await server.listen({ port, host: process.env.HOST ?? '127.0.0.1' })

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await server.close()
    await runtime.stop()
    process.exit(0)
  })
}
