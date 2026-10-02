import { Bot, Boxes, Globe, type LucideIcon, Mail, Network } from 'lucide-react'
import type { ServiceDef, ServiceKind, ServiceOutput, ServiceStatus } from '@throughline/core/model/types'

// Plain-language labels for the service registry.

export interface KindMeta {
  label: string
  icon: LucideIcon
  /** One line on what this kind of service is. */
  help: string
  /** Icon tile colors. */
  tile: string
  endpointLabel: string
  endpointPlaceholder: string
  /** What an operation is called for this kind. */
  opLabel: string
  opPlaceholder: string
}

export const KIND_ORDER: ServiceKind[] = ['rest', 'mcp', 'worker', 'agent', 'email']

export const KINDS: Record<ServiceKind, KindMeta> = {
  rest: {
    label: 'REST / OpenAPI',
    icon: Globe,
    help: 'Calls an HTTP API.',
    tile: 'bg-sky-50 text-sky-600',
    endpointLabel: 'Base URL',
    endpointPlaceholder: 'https://api.example.org/v1',
    opLabel: 'Method and path',
    opPlaceholder: 'POST /orders',
  },
  mcp: {
    label: 'MCP server',
    icon: Network,
    help: 'Calls tools on a Model Context Protocol server — the same tools AI agents use.',
    tile: 'bg-violet-50 text-violet-600',
    endpointLabel: 'Server address',
    endpointPlaceholder: 'https://tools.example.org/mcp',
    opLabel: 'Tool name',
    opPlaceholder: 'records.search',
  },
  worker: {
    label: 'Worker pool',
    icon: Boxes,
    help: 'Registered workers poll a topic for jobs. This is how custom services plug in; pool size limits throughput.',
    tile: 'bg-amber-50 text-amber-700',
    endpointLabel: 'Topic',
    endpointPlaceholder: 'topic: documents.extract',
    opLabel: 'Job type',
    opPlaceholder: 'extract-invoice',
  },
  agent: {
    label: 'AI agent',
    icon: Bot,
    help: 'An agent with a goal and tools returns a decision and a confidence.',
    tile: 'bg-brand-50 text-brand-600',
    endpointLabel: 'Agent address',
    endpointPlaceholder: 'agent://team/agent-name',
    opLabel: 'Skill',
    opPlaceholder: 'assess-risk',
  },
  email: {
    label: 'Email & notifications',
    icon: Mail,
    help: 'Sends email, SMS and other notifications.',
    tile: 'bg-emerald-50 text-emerald-600',
    endpointLabel: 'Mail relay',
    endpointPlaceholder: 'smtp://relay.example.org',
    opLabel: 'Message type',
    opPlaceholder: 'send',
  },
}

export const STATUS: Record<ServiceStatus, { label: string; dot: string; text: string; help: string }> = {
  online: { label: 'Online', dot: 'bg-emerald-500', text: 'text-emerald-700', help: 'Calls run normally.' },
  degraded: { label: 'Degraded', dot: 'bg-amber-500', text: 'text-amber-700', help: 'Calls take about three times longer and fail more often.' },
  offline: { label: 'Offline', dot: 'bg-rose-500', text: 'text-rose-700', help: 'Nothing is sent. Steps that call it wait in line until it is back.' },
}

export const STATUS_ORDER: ServiceStatus[] = ['online', 'degraded', 'offline']

export type Auth = NonNullable<ServiceDef['auth']>

export const AUTH: Record<Auth, { label: string; needsSecret: boolean }> = {
  none: { label: 'None', needsSecret: false },
  'api-key': { label: 'API key', needsSecret: true },
  oauth2: { label: 'OAuth 2.0 client credentials', needsSecret: true },
  mtls: { label: 'Mutual TLS (client certificate)', needsSecret: true },
  'managed-identity': { label: 'Managed identity (no stored secret)', needsSecret: false },
}

export const OUTPUT_TYPES: Array<{ value: ServiceOutput['type']; label: string }> = [
  { value: 'boolean', label: 'Yes / no' },
  { value: 'number', label: 'Number' },
  { value: 'text', label: 'Text' },
  { value: 'choice', label: 'Choice' },
]

/** Simulated call time: seconds under a minute, otherwise minutes / hours. */
export function callTime(minutes: number): string {
  if (!isFinite(minutes) || minutes <= 0) return '—'
  if (minutes < 1) return `${Math.max(1, Math.round(minutes * 60))}s`
  if (minutes < 60) return `${Math.round(minutes * 10) / 10}m`
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return m ? `${h}h ${m}m` : `${h}h`
}

export function pct(rate: number): string {
  return `${Number((rate * 100).toFixed(1))}%`
}
