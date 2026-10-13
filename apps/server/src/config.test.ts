import { describe, expect, it } from 'vitest'
import { ConfigError, describeConfig, loadConfig } from './config'

describe('configuration', () => {
  it('has working defaults', () => {
    const { config, warnings } = loadConfig({})
    expect(config).toMatchObject({ port: 8787, host: '127.0.0.1', timeScale: 1, logLevel: 'info', db: { dialect: 'memory' }, tenantMode: 'single' })
    expect(config.assistant).toEqual({ apiKey: undefined, model: 'claude-opus-5-5', effort: 'medium', fallbacks: true })
    expect(config.roles).toHaveLength(6)
    expect(warnings).toEqual([])
  })

  it('reads and checks every variable, treating empty ones as unset', () => {
    const { config } = loadConfig({
      PORT: '9000',
      HOST: '0.0.0.0',
      DATA_DIR: '/data',
      TIME_SCALE: '60',
      STATIC_DIR: '',
      MODUS_ASSISTANT_EFFORT: 'off',
      MODUS_ASSISTANT_FALLBACKS: 'off',
      LOG_LEVEL: 'debug',
    })
    expect(config).toMatchObject({ port: 9000, host: '0.0.0.0', dataDir: '/data', timeScale: 60, staticDir: undefined, logLevel: 'debug' })
    expect(config.assistant).toMatchObject({ effort: undefined, fallbacks: false })
    expect(() => loadConfig({ PORT: 'eighty' })).toThrow(ConfigError)
    expect(() => loadConfig({ TIME_SCALE: '-1' })).toThrow(/TIME_SCALE/)
    expect(() => loadConfig({ LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/)
    expect(() => loadConfig({ MODUS_ROLES: 'api,cook' })).toThrow(/unknown roles: cook/)
  })

  it('accepts postgres with a matching DATABASE_URL', () => {
    const url = 'postgres://modus:s3cret-pw@db:5432/modus'
    const { config, warnings } = loadConfig({ DB_DIALECT: 'postgres', DATABASE_URL: url })
    expect(config.db).toEqual({ dialect: 'postgres', url, poolMax: 10 })
    expect(warnings).toEqual([])
    expect(loadConfig({ DB_DIALECT: 'postgres', DATABASE_URL: 'postgresql://db/modus', DATA_DIR: '/data' }).warnings.join('\n')).toMatch(/DATA_DIR is ignored/)
    expect(() => loadConfig({ DB_DIALECT: 'postgres' })).toThrow(/DATABASE_URL is required/)
    expect(() => loadConfig({ DB_DIALECT: 'postgres', DATABASE_URL: 'mssql://db/modus' })).toThrow(/postgres:\/\//)
  })

  it('validates the planned SQL dialects and refuses them clearly', () => {
    expect(() => loadConfig({ DB_DIALECT: 'mssql', DATABASE_URL: 'mssql://db/modus' })).toThrow(/DB_DIALECT=mssql is planned but not implemented/)
    expect(() => loadConfig({ DB_DIALECT: 'oracle', DATABASE_URL: 'oracle://db/modus' })).toThrow(/DB_DIALECT=oracle is planned but not implemented/)
    expect(() => loadConfig({ DB_DIALECT: 'mssql', DATABASE_URL: 'postgres://db/modus' })).toThrow(/mssql:\/\//)
    expect(() => loadConfig({ DB_DIALECT: 'sybase' })).toThrow(/DB_DIALECT/)
  })

  it('accepts planned modes with a warning', () => {
    const { warnings } = loadConfig({ TENANT_MODE: 'multi', MODUS_ROLES: 'api,realtime', DATABASE_URL: 'postgres://x/y' })
    expect(warnings.join('\n')).toMatch(/TENANT_MODE=multi is planned/)
    expect(warnings.join('\n')).toMatch(/MODUS_ROLES=api,realtime/)
    expect(warnings.join('\n')).toMatch(/DATABASE_URL is ignored/)
  })

  it('sizes the database pool from DB_POOL_MAX', () => {
    const url = 'postgres://db/modus'
    expect(loadConfig({ DB_DIALECT: 'postgres', DATABASE_URL: url }).config.db).toEqual({ dialect: 'postgres', url, poolMax: 10 })
    const { config } = loadConfig({ DB_DIALECT: 'postgres', DATABASE_URL: url, DB_POOL_MAX: '25' })
    expect(config.db).toEqual({ dialect: 'postgres', url, poolMax: 25 })
    expect(describeConfig(config)).toContain('pool 25')
    for (const bad of ['0', '201', '2.5', 'ten']) expect(() => loadConfig({ DB_DIALECT: 'postgres', DATABASE_URL: url, DB_POOL_MAX: bad })).toThrow(/DB_POOL_MAX/)
    const memory = loadConfig({ DB_POOL_MAX: '25' })
    expect(memory.config.db).toEqual({ dialect: 'memory' })
    expect(memory.warnings.join('\n')).toMatch(/DB_POOL_MAX is ignored/)
  })

  it('never puts the database password or user in the startup line', () => {
    const { config } = loadConfig({ DB_DIALECT: 'postgres', DATABASE_URL: 'postgres://modus:s3cret-pw@db:5432/modus' })
    const line = describeConfig(config)
    expect(line).toContain('storage postgres → db:5432/modus')
    expect(line).not.toContain('s3cret-pw')
    expect(line).not.toContain('modus:')
  })

  it('never puts the API key in the startup line', () => {
    const { config } = loadConfig({ ANTHROPIC_API_KEY: 'test-key-not-real' })
    expect(describeConfig(config)).not.toContain('test-key-not-real')
    expect(describeConfig(config)).toContain('claude-opus-5-5')
  })
})
