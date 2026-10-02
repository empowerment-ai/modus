import { CircleAlert, CircleCheck, CircleMinus } from 'lucide-react'
import type { SimView } from '@throughline/core'
import type { App, Id, ServiceDef } from '@throughline/core/model/types'
import { Badge, cx, Meter } from '../../components/ui'
import { useUi } from '../../store/ui'

const STATUS: Record<ServiceDef['status'], { label: string; tone: 'green' | 'amber' | 'red'; icon: typeof CircleCheck }> = {
  online: { label: 'Online', tone: 'green', icon: CircleCheck },
  degraded: { label: 'Degraded', tone: 'amber', icon: CircleMinus },
  offline: { label: 'Offline', tone: 'red', icon: CircleAlert },
}

const KIND: Record<ServiceDef['kind'], string> = { rest: 'REST API', mcp: 'MCP tool', worker: 'Worker pool', agent: 'AI agent', email: 'Email' }

/** Services this app's automated steps call: load against capacity, queue, failures. */
export function ServicesPanel({ app, services, view }: { app: App; services: ServiceDef[]; view: SimView | undefined }) {
  const stepsBySvc = new Map<Id, string[]>()
  for (const wf of app.workflows) for (const n of wf.nodes) if (n.type === 'auto' && n.data.serviceId) stepsBySvc.set(n.data.serviceId, [...(stepsBySvc.get(n.data.serviceId) ?? []), n.data.label])
  const used = services.filter((s) => stepsBySvc.has(s.id))
  const bottleneckNode = view?.bottleneckId ? app.workflows.flatMap((w) => w.nodes).find((n) => n.id === view.bottleneckId) : undefined
  const bottleneckSvc = bottleneckNode?.type === 'auto' ? bottleneckNode.data.serviceId : undefined

  if (!used.length) return <p className="px-4 py-6 text-center text-xs text-slate-500">No automated step in this application calls a registered service.</p>

  return (
    <ul className="divide-y divide-slate-100">
      {used.map((svc) => {
        const m = view?.services[svc.id]
        const st = STATUS[svc.status]
        const StatusIcon = st.icon
        const inFlight = m?.inFlight ?? 0
        const finished = (m?.ok ?? 0) + (m?.failed ?? 0)
        const failRate = finished ? (m!.failed / finished) * 100 : 0
        const full = !!svc.concurrency && inFlight >= svc.concurrency
        return (
          <li key={svc.id} className={cx('px-4 py-2.5', bottleneckSvc === svc.id && 'bg-rose-50/40')}>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="text-sm font-medium text-slate-800 hover:text-brand-700 hover:underline"
                onClick={() => useUi.getState().setView('integrations')}
                title="Open Integrations"
              >
                {svc.name}
              </button>
              <span className="text-[11px] text-slate-400">{KIND[svc.kind]}</span>
              <div className="flex-1" />
              {bottleneckSvc === svc.id && <Badge tone="red">Bottleneck</Badge>}
              <Badge tone={st.tone}>
                <StatusIcon size={11} /> {st.label}
              </Badge>
            </div>
            <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 tabular-nums">
              {svc.concurrency ? (
                <>
                  <Meter value={inFlight} max={svc.concurrency} color={full ? '#e11d48' : undefined} />
                  <span className={cx('w-24 text-right', full ? 'font-medium text-rose-700' : 'text-slate-600')}>
                    {inFlight} / {svc.concurrency} in flight
                  </span>
                </>
              ) : (
                <>
                  <span className="text-slate-400">No capacity limit</span>
                  <span className="w-24 text-right text-slate-600">{inFlight} in flight</span>
                </>
              )}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-slate-500 tabular-nums">
              <span className={cx((m?.queued ?? 0) > 0 && 'font-medium text-amber-700')}>{m?.queued ?? 0} queued</span>
              <span>{(m?.calls ?? 0).toLocaleString()} calls</span>
              <span className={cx(failRate >= 10 && 'font-medium text-rose-700')} title="Failed calls as a share of finished calls (retries included)">
                {finished ? `${failRate.toFixed(failRate < 10 ? 1 : 0)}% failed` : 'no finished calls yet'}
              </span>
              <span className="min-w-0 truncate text-slate-400" title={stepsBySvc.get(svc.id)!.join(', ')}>
                Used by {stepsBySvc.get(svc.id)!.join(', ')}
              </span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
