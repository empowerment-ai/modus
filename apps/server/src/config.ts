// Configuration: every setting is an environment variable, read and checked
// once at startup. This file is the reference; docs/DEPLOYMENT.md lists the
// same variables for operators. Secrets (ANTHROPIC_API_KEY, DATABASE_URL, webhook
// secrets) come only from the environment (or WEBHOOKS_FILE) and are never logged.

import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { type Endpoint, loadEndpoints } from './webhooks'

export const ROLES = ['api', 'engine', 'automation', 'scheduler', 'ingest', 'realtime'] as const
export type Role = (typeof ROLES)[number]

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
const DIALECTS = ['memory', 'postgres', 'mssql', 'oracle'] as const

/** Connection-string schemes accepted for each SQL dialect. */
const URL_SCHEMES: Record<Exclude<(typeof DIALECTS)[number], 'memory'>, string[]> = {
  postgres: ['postgres:', 'postgresql:'],
  mssql: ['mssql:', 'sqlserver:'],
  oracle: ['oracle:'],
}

const env = z.object({
  /** Port the HTTP server listens on. */
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  /** Interface to bind. 127.0.0.1 for local development; the container image sets 0.0.0.0. */
  HOST: z.string().default('127.0.0.1'),
  /** Where the in-memory store snapshots its state (design.json, state-*.json, meta-*.json, events.jsonl). Unset: nothing is written. */
  DATA_DIR: z.string().optional(),
  /** Simulated minutes per real minute for timers and due dates. 1 = real time. */
  TIME_SCALE: z.coerce.number().positive().default(1),
  /** A built studio (apps/studio/dist) to serve at `/`, with SPA fallback. Unset: API only. */
  STATIC_DIR: z.string().optional(),
  /** Turns on the language-model assistant. Unset: the built-in assistant answers. */
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Claude model for the assistant. */
  MODUS_ASSISTANT_MODEL: z.string().default('claude-opus-5-5'),
  /** Reasoning effort for the assistant (`off` leaves it to the model's default, for models without effort). */
  MODUS_ASSISTANT_EFFORT: z.enum([...EFFORTS, 'off']).default('medium'),
  /** Server-side refusal fallback (`default` lets the API pick a fallback model; `off` for models or platforms without it). */
  MODUS_ASSISTANT_FALLBACKS: z.enum(['default', 'off']).default('default'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  /** Storage backend: `memory` (JSON snapshots in DATA_DIR) or `postgres` (DATABASE_URL). `mssql` and `oracle` are validated and refused. */
  DB_DIALECT: z.enum(DIALECTS).default('memory'),
  DATABASE_URL: z.string().optional(),
  /** Most connections in each process's database pool (postgres). It also keeps one more open to listen for other replicas. */
  DB_POOL_MAX: z.coerce.number().int().min(1).max(200).optional(),
  /** `multi` is planned (tenant id in every key); accepted with a warning, runs as one tenant. */
  TENANT_MODE: z.enum(['single', 'multi']).default('single'),
  /** Comma-separated roles this process plays. Every process runs all of them today. */
  MODUS_ROLES: z.string().default(ROLES.join(',')),
  // Webhook endpoints (WEBHOOK_URL, WEBHOOK_SECRET, WEBHOOKS_FILE, WEBHOOKS_ALLOW_HTTP and the secretEnv variables) are read by loadEndpoints in webhooks.ts.
  /** Days to keep messages once delivered everywhere (or skipped). */
  WEBHOOKS_KEEP_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  /** Days to keep messages with a failed delivery, for the admin retry. */
  WEBHOOKS_KEEP_FAILED_DAYS: z.coerce.number().int().min(1).max(365).default(30),
})

export interface Config {
  port: number
  host: string
  dataDir?: string
  timeScale: number
  staticDir?: string
  logLevel: (typeof LOG_LEVELS)[number]
  db: { dialect: 'memory' } | { dialect: 'postgres'; url: string; poolMax: number }
  tenantMode: 'single' | 'multi'
  roles: Role[]
  assistant: {
    apiKey?: string
    model: string
    effort?: (typeof EFFORTS)[number]
    fallbacks: boolean
  }
  webhooks: Endpoint[]
  webhooksKeepDays: number
  webhooksKeepFailedDays: number
}

export class ConfigError extends Error {}

/** Read and check the configuration. Throws ConfigError with every problem listed; returns warnings to log. */
export function loadConfig(
  source: Record<string, string | undefined> = process.env,
  readFile: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): { config: Config; warnings: string[] } {
  // An empty variable counts as unset, so `FOO=` in a compose file means "use the default".
  const vars = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ''))
  const parsed = env.safeParse(vars)
  const problems = parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
  let webhooks: Endpoint[] = []
  try {
    webhooks = loadEndpoints(vars, readFile)
  } catch (err) {
    // loadEndpoints lists one problem per line, never quoting a secret or URL.
    problems.push(...(err instanceof Error ? err.message : String(err)).split('\n'))
  }
  if (!parsed.success || problems.length) throw new ConfigError(`Invalid configuration:\n${problems.map((p) => `  ${p}`).join('\n')}`)
  const e = parsed.data
  const warnings: string[] = []

  if (e.DB_DIALECT !== 'memory') {
    if (!e.DATABASE_URL) throw new ConfigError(`DATABASE_URL is required when DB_DIALECT=${e.DB_DIALECT}.`)
    let scheme: string
    try {
      scheme = new URL(e.DATABASE_URL).protocol
    } catch {
      throw new ConfigError('DATABASE_URL is not a valid URL.')
    }
    if (!URL_SCHEMES[e.DB_DIALECT].includes(scheme))
      throw new ConfigError(`DATABASE_URL should start with ${URL_SCHEMES[e.DB_DIALECT].map((s) => `${s}//`).join(' or ')} for DB_DIALECT=${e.DB_DIALECT}.`)
    if (e.DB_DIALECT !== 'postgres')
      throw new ConfigError(`DB_DIALECT=${e.DB_DIALECT} is planned but not implemented in this build. Use DB_DIALECT=postgres or memory.`)
    if (e.DATA_DIR) warnings.push(`DATA_DIR is ignored: DB_DIALECT=${e.DB_DIALECT} keeps everything in the database.`)
  } else {
    if (e.DATABASE_URL) warnings.push('DATABASE_URL is ignored: DB_DIALECT=memory.')
    if (e.DB_POOL_MAX !== undefined) warnings.push('DB_POOL_MAX is ignored: DB_DIALECT=memory.')
  }
  if (e.TENANT_MODE === 'multi') warnings.push('TENANT_MODE=multi is planned and not enforced yet; running as a single tenant.')

  const roles = [
    ...new Set(
      e.MODUS_ROLES.split(',')
        .map((r) => r.trim().toLowerCase())
        .filter(Boolean),
    ),
  ]
  const unknown = roles.filter((r) => !(ROLES as readonly string[]).includes(r))
  if (unknown.length) throw new ConfigError(`MODUS_ROLES has unknown roles: ${unknown.join(', ')}. Known: ${ROLES.join(', ')}.`)
  if (roles.length < ROLES.length) warnings.push(`MODUS_ROLES=${roles.join(',')}: splitting roles across processes is planned; this process runs every role.`)

  return {
    config: {
      port: e.PORT,
      host: e.HOST,
      dataDir: e.DATA_DIR,
      timeScale: e.TIME_SCALE,
      staticDir: e.STATIC_DIR,
      logLevel: e.LOG_LEVEL,
      db: e.DB_DIALECT === 'postgres' ? { dialect: 'postgres', url: e.DATABASE_URL!, poolMax: e.DB_POOL_MAX ?? 10 } : { dialect: 'memory' },
      tenantMode: e.TENANT_MODE,
      roles: roles as Role[],
      assistant: {
        apiKey: e.ANTHROPIC_API_KEY,
        model: e.MODUS_ASSISTANT_MODEL,
        effort: e.MODUS_ASSISTANT_EFFORT === 'off' ? undefined : e.MODUS_ASSISTANT_EFFORT,
        fallbacks: e.MODUS_ASSISTANT_FALLBACKS === 'default',
      },
      webhooks,
      webhooksKeepDays: e.WEBHOOKS_KEEP_DAYS,
      webhooksKeepFailedDays: e.WEBHOOKS_KEEP_FAILED_DAYS,
    },
    warnings,
  }
}

/** Where a database URL points (host, port, database), without the user name or password. */
function dbTarget(url: string): string {
  const u = new URL(url)
  return `${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname}`
}

/** An endpoint for the startup log: its name, host and filters. Never the path or query (they may carry a token) nor the secret. */
function describeEndpoint(e: Endpoint): string {
  const filters = [...(e.apps ?? []), ...(e.kinds ?? [])]
  return `${e.name} → ${new URL(e.url).host}${filters.length ? ` (${filters.join(', ')})` : ''}`
}

/** One line for the startup log. Never includes secrets. */
export function describeConfig(c: Config): string {
  const assistant = c.assistant.apiKey ? `model ${c.assistant.model}` : 'built-in (no ANTHROPIC_API_KEY)'
  const storage = c.db.dialect === 'postgres' ? `postgres → ${dbTarget(c.db.url)} (pool ${c.db.poolMax})` : `memory${c.dataDir ? ` → ${c.dataDir}` : ' (not persisted)'}`
  return `storage ${storage}; studio ${c.staticDir ?? 'not served'}; assistant ${assistant}; tenancy ${c.tenantMode}; time ×${c.timeScale}; webhooks ${c.webhooks.length ? c.webhooks.map(describeEndpoint).join(', ') : 'none'}`
}
