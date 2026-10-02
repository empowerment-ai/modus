import { ArrowUpRight, Cog, KeyRound, Pencil, Plus, Trash2, X } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import type { Id, ServiceDef, ServiceOperation } from '@throughline/core/model/types'
import { plural } from '@throughline/core/model/util'
import { Badge, Button, cx, Field, IconButton, Input, Select, Textarea } from '../../components/ui'
import { useDesign } from '../../store/design'
import { useSimView } from '../../store/sim'
import { useUi } from '../../store/ui'
import { InlineInput } from '../org/InlineInput'
import { type Auth, AUTH, callTime, KIND_ORDER, KINDS, pct, STATUS, STATUS_ORDER } from './kinds'
import { NumberInput } from './NumberInput'
import { OperationModal } from './OperationModal'
import { KindTile, LoadBar } from './ServiceCard'
import { nodesOfType, openStep, whereLabel } from './steps'
import { WorkerProtocol } from './WorkerProtocol'

/** Everything about one registered service: connection, status, capacity, live load, operations and where it is used. */
export function ServicePanel({ serviceId, onClose }: { serviceId: Id; onClose: () => void }) {
  const design = useDesign((s) => s.design)
  const updateService = useDesign((s) => s.updateService)
  const update = useDesign((s) => s.update)
  const toast = useUi((s) => s.toast)
  const appId = useUi((s) => s.appId)
  const m = useSimView()?.services[serviceId]
  const [editing, setEditing] = useState<ServiceOperation | 'new' | null>(null)

  const svc = design.services.find((s) => s.id === serviceId)
  const usedBy = useMemo(() => nodesOfType(design, 'auto').filter((r) => r.node.data.serviceId === serviceId), [design, serviceId])
  if (!svc) return null

  const kind = KINDS[svc.kind]
  const patch = (fn: (s: ServiceDef) => void) => updateService(svc.id, fn)
  const opUses = (opId: Id) => usedBy.filter((r) => r.node.data.operationId === opId).length
  const appName = design.apps.find((a) => a.id === appId)?.name ?? 'this application'
  const finished = (m?.ok ?? 0) + (m?.failed ?? 0)

  const remove = () => {
    if (usedBy.length) {
      toast(
        `Can’t delete ${svc.name}: ${plural(usedBy.length, 'automated step')} call${usedBy.length === 1 ? 's' : ''} it. Point ${usedBy.length === 1 ? 'it' : 'them'} at another service first.`,
        'warn',
      )
      return
    }
    const inTemplates = design.templates.filter((t) => t.nodes.some((n) => n.type === 'auto' && n.data.serviceId === svc.id)).length
    const extra = inTemplates
      ? `\n\n${plural(inTemplates, 'template')} also call${inTemplates === 1 ? 's' : ''} it; steps made from ${inTemplates === 1 ? 'it' : 'them'} will need another service.`
      : ''
    if (!window.confirm(`Delete ${svc.name} from the registry?${extra}`)) return
    update((d) => {
      d.services = d.services.filter((x) => x.id !== svc.id)
    })
    onClose()
    toast(`${svc.name} deleted.`)
  }

  const removeOp = (op: ServiceOperation) => {
    const n = opUses(op.id)
    if (n) return toast(`Can’t delete ${op.name}: ${plural(n, 'step')} call${n === 1 ? 's' : ''} it.`, 'warn')
    if (!window.confirm(`Delete the ${op.name} operation?`)) return
    patch((s) => void (s.operations = s.operations.filter((o) => o.id !== op.id)))
  }

  return (
    <aside className="animate-slide-in flex h-full w-[540px] max-w-[48vw] shrink-0 flex-col border-l border-slate-200 bg-white shadow-xl" aria-label={`${svc.name} details`}>
      <div className="flex items-center gap-2.5 border-b border-slate-200 px-4 py-3">
        <KindTile kind={svc.kind} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="px-1.5 text-[10.5px] font-semibold tracking-wide text-slate-400 uppercase">{kind.label}</div>
          <InlineInput aria-label="Service name" className="text-sm font-semibold" value={svc.name} onChange={(e) => patch((s) => void (s.name = e.target.value))} />
        </div>
        <IconButton label={`Delete ${svc.name}`} onClick={remove} className="hover:bg-rose-50 hover:text-rose-600">
          <Trash2 size={15} />
        </IconButton>
        <IconButton label="Close" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Status" hint="Changes apply to the running simulation right away.">
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Service status">
            {STATUS_ORDER.map((st) => {
              const s = STATUS[st]
              const on = svc.status === st
              return (
                <button
                  key={st}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    if (on) return
                    patch((x) => void (x.status = st))
                    toast(`${svc.name} is now ${s.label.toLowerCase()}.`, st === 'online' ? 'success' : 'warn')
                  }}
                  className={cx('rounded-lg border px-2.5 py-2 text-left transition-colors', on ? 'border-brand-500 bg-brand-50/40 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300')}
                >
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                    <span className={cx('h-2 w-2 rounded-full', s.dot)} />
                    {s.label}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{s.help}</span>
                </button>
              )
            })}
          </div>
        </Section>

        <Section title="Live load" hint={`From the ${appName} simulation.`}>
          <LoadBar svc={svc} m={m} />
          <div className="mt-3 grid grid-cols-4 gap-2">
            <Stat label="Waiting" value={m?.queued ?? 0} tone={(m?.queued ?? 0) > 0 ? 'amber' : undefined} hint="Calls waiting for a free slot, or for the service to come back online" />
            <Stat label="Calls" value={(m?.calls ?? 0).toLocaleString()} hint="Calls started, including retries" />
            <Stat
              label="Success"
              value={finished ? pct((m?.ok ?? 0) / finished) : '—'}
              tone={finished && (m?.failed ?? 0) / finished > 0.1 ? 'red' : undefined}
              hint="Share of finished calls that succeeded"
            />
            <Stat
              label="Utilization"
              value={m?.utilization !== undefined ? pct(m.utilization) : '—'}
              hint={svc.concurrency ? 'Share of capacity used since the simulation started' : 'Unlimited capacity: nothing to fill'}
            />
          </div>
        </Section>

        <Section title="Capacity">
          <div className="flex items-start gap-3">
            <Field className="w-32 shrink-0" label={svc.kind === 'worker' ? 'Pool size' : 'Calls at once'}>
              <NumberInput
                value={svc.concurrency}
                placeholder="Unlimited"
                normalize={(v) => (v < 1 ? undefined : Math.round(v))}
                onCommit={(v) => patch((s) => void (s.concurrency = v))}
                aria-label="Capacity"
              />
            </Field>
            <p className="mt-5 text-[11.5px] leading-snug text-slate-500">
              {svc.kind === 'worker'
                ? 'How many workers take jobs at once. More jobs than that wait on the topic.'
                : 'The most calls in flight at once (a rate limit or licence cap). More calls than that wait for a free slot.'}{' '}
              Leave empty for unlimited.
            </p>
          </div>
        </Section>

        <Section title="Connection">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Kind">
              <Select value={svc.kind} onChange={(e) => patch((s) => void (s.kind = e.target.value as ServiceDef['kind']))}>
                {KIND_ORDER.map((k) => (
                  <option key={k} value={k}>
                    {KINDS[k].label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Owner" hint="The team to call when it breaks.">
              <Input value={svc.owner ?? ''} placeholder="e.g. Platform team" onChange={(e) => patch((s) => void (s.owner = e.target.value || undefined))} />
            </Field>
            <Field label={kind.endpointLabel} className="col-span-2">
              <Input className="font-mono text-[13px]" value={svc.endpoint} placeholder={kind.endpointPlaceholder} onChange={(e) => patch((s) => void (s.endpoint = e.target.value))} />
            </Field>
            <Field label="Authentication">
              <Select value={svc.auth ?? 'none'} onChange={(e) => patch((s) => void (s.auth = e.target.value as Auth))}>
                {(Object.keys(AUTH) as Auth[]).map((a) => (
                  <option key={a} value={a}>
                    {AUTH[a].label}
                  </option>
                ))}
              </Select>
            </Field>
            {AUTH[svc.auth ?? 'none'].needsSecret && (
              <Field label="Credential">
                <div className="flex h-8 items-center rounded-md border border-slate-300 bg-white shadow-xs focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20">
                  <span className="flex h-full items-center gap-1 rounded-l-md border-r border-slate-200 bg-slate-50 px-2 font-mono text-[11.5px] text-slate-500">
                    <KeyRound size={12} /> vault:
                  </span>
                  <input
                    aria-label="Credential name in the secret store"
                    className="h-full min-w-0 flex-1 bg-transparent px-2 font-mono text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none"
                    value={svc.secretRef ?? ''}
                    placeholder="credential-name"
                    onChange={(e) => patch((s) => void (s.secretRef = e.target.value.replace(/\s+/g, '-') || undefined))}
                  />
                </div>
              </Field>
            )}
            <p className="col-span-2 -mt-1 flex items-start gap-1.5 rounded-md bg-slate-50 px-2.5 py-1.5 text-[11.5px] leading-snug text-slate-600">
              <KeyRound size={13} className="mt-px shrink-0 text-slate-400" />
              Secrets live in the secret store. The registry keeps only the name of the credential, never its value.
            </p>
            <Field label="Description" className="col-span-2">
              <Textarea
                value={svc.description ?? ''}
                placeholder="What it does and who relies on it"
                onChange={(e) => patch((s) => void (s.description = e.target.value || undefined))}
                className="min-h-[56px]"
              />
            </Field>
          </div>
        </Section>

        <Section
          title={`Operations (${svc.operations.length})`}
          hint="What automated steps can ask this service to do. Times and success rates drive the simulation."
          action={
            <Button size="sm" icon={<Plus size={13} />} onClick={() => setEditing('new')}>
              Add operation
            </Button>
          }
        >
          {svc.operations.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500">No operations yet. Add one so steps can call this service.</p>
          ) : (
            <div className="overflow-hidden rounded-md border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-[10.5px] font-semibold tracking-wide text-slate-500 uppercase">
                    <th className="py-1.5 pr-2 pl-3 font-semibold">{kind.opLabel}</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Avg time</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Success</th>
                    <th className="px-2 py-1.5 font-semibold">Outputs</th>
                    <th className="w-14" />
                  </tr>
                </thead>
                <tbody>
                  {svc.operations.map((op) => {
                    const uses = opUses(op.id)
                    return (
                      <tr key={op.id} className="group cursor-pointer border-b border-slate-100 align-top last:border-b-0 hover:bg-slate-50" onClick={() => setEditing(op)}>
                        <td className="py-2 pr-2 pl-3">
                          <div className="font-mono text-[11.5px] font-medium break-all text-slate-800">{op.name}</div>
                          {op.description && <div className="mt-0.5 text-[11px] leading-snug text-slate-500">{op.description}</div>}
                          <div className="mt-0.5 text-[10.5px] text-slate-400">{uses ? `Called by ${plural(uses, 'step')}` : 'Not called by any step'}</div>
                        </td>
                        <td className="px-2 py-2 text-right whitespace-nowrap text-slate-700 tabular-nums">{callTime(op.avgMinutes)}</td>
                        <td className="px-2 py-2 text-right whitespace-nowrap text-slate-700 tabular-nums">{pct(op.successRate)}</td>
                        <td className="px-2 py-2">
                          {op.outputs.length === 0 ? (
                            <span className="text-slate-400">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {op.outputs.map((o) => (
                                <Badge key={o.key} tone="sky" className="font-normal">
                                  {o.label}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="py-1.5 pr-1.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          <IconButton label={`Edit ${op.name}`} onClick={() => setEditing(op)}>
                            <Pencil size={13} />
                          </IconButton>
                          <IconButton label={`Delete ${op.name}`} onClick={() => removeOp(op)} className="hover:bg-rose-50 hover:text-rose-600">
                            <Trash2 size={13} />
                          </IconButton>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title={`Used by (${usedBy.length})`} hint="Automated steps in every application that call this service. Click one to open it.">
          {usedBy.length === 0 ? (
            <p className="text-xs text-slate-400">No automated step calls this service yet.</p>
          ) : (
            <ul className="space-y-1">
              {usedBy.map((r) => {
                const op = svc.operations.find((o) => o.id === r.node.data.operationId)
                return (
                  <li key={`${r.wf.id}:${r.node.id}`}>
                    <button
                      type="button"
                      onClick={() => openStep(r.app.id, r.wf.id, r.node.id)}
                      className="group flex w-full items-center gap-2 rounded-md border border-slate-200 px-2 py-1.5 text-left text-xs hover:border-brand-300 hover:bg-brand-50/50"
                      title={r.app.id === appId ? 'Open this step in the workflow designer' : `Switch to ${r.app.name} and open this step`}
                    >
                      <Cog size={14} className="shrink-0 text-slate-500" />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="text-slate-500">{whereLabel(r)} › </span>
                        <span className="font-medium text-slate-800">{r.node.data.label}</span>
                      </span>
                      {r.wf.kind === 'subflow' && <Badge tone="violet">Subflow</Badge>}
                      {op ? <span className="max-w-[140px] truncate font-mono text-[10.5px] text-slate-500">{op.name}</span> : <Badge tone="amber">No operation</Badge>}
                      <ArrowUpRight size={13} className="shrink-0 text-slate-300 group-hover:text-brand-600" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>

        {svc.kind === 'worker' && (
          <Section title="Plugging in a worker">
            <WorkerProtocol topic={svc.endpoint || undefined} jobType={svc.operations[0]?.name} />
          </Section>
        )}
      </div>

      {editing && <OperationModal service={svc} op={editing === 'new' ? undefined : editing} usedBy={editing === 'new' ? 0 : opUses(editing.id)} onClose={() => setEditing(null)} />}
    </aside>
  )
}

function Section({ title, hint, action, children }: { title: string; hint?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b border-slate-100 px-4 py-3.5 last:border-b-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{title}</h3>
        {action}
      </div>
      {hint && <p className="-mt-1 mb-2.5 text-[11.5px] leading-snug text-slate-500">{hint}</p>}
      {children}
    </section>
  )
}

function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: 'amber' | 'red' }) {
  return (
    <div className="rounded-md bg-slate-50 px-2.5 py-1.5" title={hint}>
      <div className="text-[10px] font-medium tracking-wide text-slate-500 uppercase">{label}</div>
      <div className={cx('text-sm font-semibold tabular-nums', tone === 'amber' ? 'text-amber-700' : tone === 'red' ? 'text-rose-600' : 'text-slate-900')}>{value}</div>
    </div>
  )
}
