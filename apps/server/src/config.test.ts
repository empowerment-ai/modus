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

  it('validates the planned SQL dialects and refuses them clearly', () => {
    expect(() => loadConfig({ DB_DIALECT: 'postgres' })).toThrow(/DATABASE_URL is required/)
    expect(() => loadConfig({ DB_DIALECT: 'postgres', DATABASE_URL: 'mssql://db/modus' })).toThrow(/postgres:\/\//)
    expect(() => loadConfig({ DB_DIALECT: 'postgres', DATABASE_URL: 'postgres://modus@db:5432/modus' })).toThrow(/planned but not implemented/)
    expect(() => loadConfig({ DB_DIALECT: 'sybase' })).toThrow(/DB_DIALECT/)
  })

  it('accepts planned modes with a warning', () => {
    const { warnings } = loadConfig({ TENANT_MODE: 'multi', MODUS_ROLES: 'api,realtime', DATABASE_URL: 'postgres://x/y' })
    expect(warnings.join('\n')).toMatch(/TENANT_MODE=multi is planned/)
    expect(warnings.join('\n')).toMatch(/MODUS_ROLES=api,realtime/)
    expect(warnings.join('\n')).toMatch(/DATABASE_URL is ignored/)
  })

  it('never puts the API key in the startup line', () => {
    const { config } = loadConfig({ ANTHROPIC_API_KEY: 'test-key-not-real' })
    expect(describeConfig(config)).not.toContain('test-key-not-real')
    expect(describeConfig(config)).toContain('claude-opus-5-5')
  })
})
