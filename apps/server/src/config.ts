// Configuration: every setting is an environment variable, read and checked
// once at startup. This file is the reference; docs/DEPLOYMENT.md lists the
// same variables for operators. Secrets (ANTHROPIC_API_KEY, DATABASE_URL) come
// only from the environment and are never logged.

import { z } from 'zod'

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
  /** Where the in-memory store snapshots its state (design.json, state-*.json, events.jsonl). Unset: nothing is written. */
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
  /** Storage backend. Only `memory` is implemented; the SQL dialects are validated and refused. */
  DB_DIALECT: z.enum(DIALECTS).default('memory'),
  DATABASE_URL: z.string().optional(),
  /** `multi` is planned (tenant id in every key); accepted with a warning, runs as one tenant. */
  TENANT_MODE: z.enum(['single', 'multi']).default('single'),
  /** Comma-separated roles this process plays. Every process runs all of them today. */
  MODUS_ROLES: z.string().default(ROLES.join(',')),
})

export interface Config {
  port: number
  host: string
  dataDir?: string
  timeScale: number
  staticDir?: string
  logLevel: (typeof LOG_LEVELS)[number]
  db: { dialect: 'memory' }
  tenantMode: 'single' | 'multi'
  roles: Role[]
  assistant: {
    apiKey?: string
    model: string
    effort?: (typeof EFFORTS)[number]
    fallbacks: boolean
  }
}

export class ConfigError extends Error {}

/** Read and check the configuration. Throws ConfigError with every problem listed; returns warnings to log. */
export function loadConfig(source: Record<string, string | undefined> = process.env): { config: Config; warnings: string[] } {
  // An empty variable counts as unset, so `FOO=` in a compose file means "use the default".
  const vars = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ''))
  const parsed = env.safeParse(vars)
  if (!parsed.success) {
    throw new ConfigError(`Invalid configuration:\n${parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`)
  }
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
    throw new ConfigError(
      `DB_DIALECT=${e.DB_DIALECT} is planned but not implemented in this build. Storage is in memory, snapshotted to JSON files in DATA_DIR. Unset DB_DIALECT (or set it to "memory") to start.`,
    )
  }
  if (e.DATABASE_URL) warnings.push('DATABASE_URL is ignored: DB_DIALECT=memory.')
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
      db: { dialect: 'memory' },
      tenantMode: e.TENANT_MODE,
      roles: roles as Role[],
      assistant: {
        apiKey: e.ANTHROPIC_API_KEY,
        model: e.MODUS_ASSISTANT_MODEL,
        effort: e.MODUS_ASSISTANT_EFFORT === 'off' ? undefined : e.MODUS_ASSISTANT_EFFORT,
        fallbacks: e.MODUS_ASSISTANT_FALLBACKS === 'default',
      },
    },
    warnings,
  }
}

/** One line for the startup log. Never includes secrets. */
export function describeConfig(c: Config): string {
  const assistant = c.assistant.apiKey ? `model ${c.assistant.model}` : 'built-in (no ANTHROPIC_API_KEY)'
  return `storage ${c.db.dialect}${c.dataDir ? ` → ${c.dataDir}` : ' (not persisted)'}; studio ${c.staticDir ?? 'not served'}; assistant ${assistant}; tenancy ${c.tenantMode}; time ×${c.timeScale}`
}
