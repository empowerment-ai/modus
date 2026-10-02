// Display metadata shared by the canvas nodes and the inspectors: service kinds,
// start triggers and what an automated step does when its call fails.

import { Blocks, CalendarClock, Cpu, FileText, Globe, Hand, Inbox, type LucideIcon, Mail, OctagonPause, Radio, Route, Sparkles, Webhook } from 'lucide-react'
import type { FailurePolicy, FieldType, ServiceKind, ServiceOutput, ServiceStatus, TriggerKind } from '@modus-bpm/core/model/types'

export const SERVICE_KIND: Record<ServiceKind, { label: string; group: string; icon: LucideIcon }> = {
  rest: { label: 'REST API', group: 'REST APIs', icon: Globe },
  mcp: { label: 'MCP server', group: 'MCP servers', icon: Blocks },
  worker: { label: 'Worker pool', group: 'Worker pools', icon: Cpu },
  agent: { label: 'AI agent', group: 'AI agents', icon: Sparkles },
  email: { label: 'Email', group: 'Email & notifications', icon: Mail },
}

export const SERVICE_STATUS: Record<ServiceStatus, { label: string; dot: string; tone: 'green' | 'amber' | 'red' }> = {
  online: { label: 'Online', dot: 'bg-emerald-500', tone: 'green' },
  degraded: { label: 'Degraded', dot: 'bg-amber-500', tone: 'amber' },
  offline: { label: 'Offline', dot: 'bg-rose-500', tone: 'red' },
}

export const TRIGGER: Record<TriggerKind, { label: string; short: string; icon: LucideIcon; placeholder: string; help: string }> = {
  form: { label: 'Form', short: 'Form', icon: FileText, placeholder: 'Optional: where the form lives', help: 'Someone fills in the form in the workspace (or an administrator creates it).' },
  api: { label: 'API / webhook', short: 'API', icon: Webhook, placeholder: 'POST /api/requests', help: 'Another system creates items by calling the API.' },
  event: { label: 'Event stream', short: 'Event stream', icon: Radio, placeholder: 'mqtt: cameras/+/events', help: 'Every message on the topic or stream becomes an item. Expect high volumes.' },
  schedule: { label: 'Schedule', short: 'Schedule', icon: CalendarClock, placeholder: '0 7 * * MON-FRI', help: 'Items are created on a schedule (a cron expression).' },
  email: { label: 'Email inbox', short: 'Inbox', icon: Inbox, placeholder: 'invoices@example.org', help: 'Every email that arrives in the mailbox becomes an item.' },
}

export const FAILURE: Record<FailurePolicy, { label: string; short: string; icon: LucideIcon; help: string }> = {
  route: {
    label: 'Take the Failed path',
    short: 'Failed path',
    icon: Route,
    help: 'Follow the path marked “Failed” out of this step. With no such path, the fallback group does it by hand (or it stops for an administrator).',
  },
  manual: { label: 'Hand to a person', short: 'By hand', icon: Hand, help: 'Someone in the fallback group does the step by hand and fills in what the service would have returned.' },
  stuck: { label: 'Stop for an administrator', short: 'Stops', icon: OctagonPause, help: 'The item waits here, marked stuck, until an administrator retries it or hands it to someone.' },
}

/** Field types that can hold a service result of this type. */
export function fieldTypesFor(output: ServiceOutput['type']): FieldType[] {
  switch (output) {
    case 'boolean':
      return ['boolean']
    case 'number':
      return ['number', 'currency']
    case 'choice':
      return ['choice', 'text']
    default:
      return ['text', 'textarea', 'email']
  }
}
