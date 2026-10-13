// Writes the load-test design into the stack's Postgres before the servers start,
// so every server boots with the generated clerks. Run on the host: `tsx src/setup.ts [clerks]`.
import { postgresStorage } from '@modus-bpm/server/src/adapters/postgres'
import { loadDesign } from './design'

const url = process.env.LOAD_DATABASE_URL ?? 'postgres://modus:modus-load@127.0.0.1:5546/modus'
const clerks = Number(process.argv[2] ?? process.env.LOAD_CLERKS ?? 20)

const storage = postgresStorage(url, { max: 1 })
try {
  await storage.migrate()
  await storage.designs.save(loadDesign(clerks))
  console.log(`design saved with ${clerks} load clerks`)
} finally {
  await storage.close()
}
