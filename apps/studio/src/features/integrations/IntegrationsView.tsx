import { ChevronRight, Plug, Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Id, ServiceKind } from '@modus-bpm/core/model/types'
import { Badge, Button, Card, cx, EmptyState, Input } from '../../components/ui'
import { useApp, useDesign } from '../../store/design'
import { useSimView } from '../../store/sim'
import { useUi } from '../../store/ui'
import { KIND_ORDER, KINDS } from './kinds'
import { NewServiceModal } from './NewServiceModal'
import { KindTile, ServiceCard } from './ServiceCard'
import { ServicePanel } from './ServicePanel'
import { nodesOfType } from './steps'
import { WorkerProtocol } from './WorkerProtocol'

// The organization-wide service registry: every system an automated step can
// call, shared by all applications, with live load from the open app's simulation.

export function IntegrationsView() {
  const design = useDesign((s) => s.design)
  const services = design.services
  const app = useApp(useUi((s) => s.appId))
  const view = useSimView()
  const [selected, setSelected] = useState<Id | null>(null)
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')

  const usage = useMemo(() => {
    const n = new Map<Id, number>()
    for (const r of nodesOfType(design, 'auto')) if (r.node.data.serviceId) n.set(r.node.data.serviceId, (n.get(r.node.data.serviceId) ?? 0) + 1)
    return n
  }, [design])

  const q = query.trim().toLowerCase()
  const shown = q ? services.filter((s) => [s.name, s.endpoint, s.owner, s.description, ...s.operations.map((o) => o.name)].some((t) => t?.toLowerCase().includes(q))) : services
  const byKind = new Map<ServiceKind, typeof services>(KIND_ORDER.map((k) => [k, shown.filter((s) => s.kind === k)]))

  const degraded = services.filter((s) => s.status === 'degraded').length
  const offline = services.filter((s) => s.status === 'offline').length
  const inFlight = Object.values(view?.services ?? {}).reduce((sum, m) => sum + m.inFlight, 0)
  const waiting = Object.values(view?.services ?? {}).reduce((sum, m) => sum + m.queued, 0)

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 bg-white px-6 py-3.5">
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-slate-900">Integrations</h1>
            <p className="text-xs text-slate-500">The organization’s registry of systems that automated steps call. Every application shares it.</p>
          </div>
          <div className="flex-1" />
          <div className="relative w-64">
            <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" />
            <Input className="w-64 pl-8" placeholder="Search services and operations" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search services" />
          </div>
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
            Register service
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="mx-auto max-w-[1400px] space-y-6">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <Badge>{services.length} services</Badge>
              {degraded > 0 && <Badge tone="amber">{degraded} degraded</Badge>}
              {offline > 0 && <Badge tone="red">{offline} offline</Badge>}
              {degraded + offline === 0 && <Badge tone="green">All online</Badge>}
              <span className="text-slate-300">·</span>
              <span>
                Live in <span className="font-medium text-slate-800">{app?.name ?? 'this application'}</span>: <b className="font-semibold tabular-nums">{inFlight}</b> calls in flight
                {waiting > 0 && (
                  <>
                    , <b className="font-semibold text-amber-700 tabular-nums">{waiting}</b> waiting for a service
                  </>
                )}
              </span>
            </div>

            {shown.length === 0 && (
              <Card>
                <EmptyState icon={<Plug size={30} />} title={q ? 'No service matches your search' : 'No services registered yet'}>
                  {q ? 'Try a different name, endpoint or operation.' : 'Register the systems your automated steps call: APIs, MCP servers, worker pools, AI agents and email.'}
                </EmptyState>
              </Card>
            )}

            {KIND_ORDER.map((k) => {
              const list = byKind.get(k) ?? []
              if (q && list.length === 0) return null
              const meta = KINDS[k]
              return (
                <section key={k} aria-labelledby={`kind-${k}`}>
                  <div className="mb-2.5 flex items-center gap-2.5">
                    <KindTile kind={k} size="sm" />
                    <div className="min-w-0">
                      <h2 id={`kind-${k}`} className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        {meta.label}
                        <span className="text-xs font-normal text-slate-400 tabular-nums">{list.length}</span>
                      </h2>
                      <p className="text-xs text-slate-500">{meta.help}</p>
                    </div>
                  </div>
                  {list.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-slate-200 px-4 py-3 text-xs text-slate-500">None registered.</p>
                  ) : (
                    <div className={cx('grid grid-cols-1 gap-3 md:grid-cols-2', selected ? '2xl:grid-cols-3' : 'xl:grid-cols-3 2xl:grid-cols-4')}>
                      {list.map((s) => (
                        <ServiceCard
                          key={s.id}
                          svc={s}
                          m={view?.services[s.id]}
                          usedBy={usage.get(s.id) ?? 0}
                          selected={selected === s.id}
                          onOpen={() => setSelected(selected === s.id ? null : s.id)}
                        />
                      ))}
                    </div>
                  )}
                  {k === 'worker' && (
                    <details className="group mt-2.5 max-w-3xl">
                      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-600">
                        <ChevronRight size={13} className="transition-transform group-open:rotate-90" />
                        How a worker registers
                      </summary>
                      <div className="mt-2">
                        <WorkerProtocol />
                      </div>
                    </details>
                  )}
                </section>
              )
            })}
          </div>
        </div>
      </div>

      {selected && services.some((s) => s.id === selected) && <ServicePanel key={selected} serviceId={selected} onClose={() => setSelected(null)} />}
      {creating && (
        <NewServiceModal
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            setQuery('')
            setSelected(id)
          }}
        />
      )}
    </div>
  )
}
