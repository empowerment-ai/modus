import { Bot, Plus, RotateCw, Trash2, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge, Button, cx, EmptyState, Field, IconButton, Input, Segmented, Select, Textarea } from '../../../components/ui'
import { activeTokens, adminAssign, adminRetry, adminReturnToPool, type Token } from '@modus-bpm/core'
import { objectTitle } from '@modus-bpm/core/model/format'
import { AUTO_FAILURE } from '@modus-bpm/core/model/types'
import type { App, AutoStepData, FailurePolicy, NodeOf, ObjectType, ServiceDef, ServiceKind, ServiceOperation, User, Workflow } from '@modus-bpm/core/model/types'
import { formatDuration } from '@modus-bpm/core/model/util'
import { useDesign } from '../../../store/design'
import { useSim, useSimState, useSimView } from '../../../store/sim'
import { useUi } from '../../../store/ui'
import { FAILURE, fieldTypesFor, SERVICE_KIND, SERVICE_STATUS } from '../kinds'
import { ActionsEditor } from './ActionsEditor'
import { Body, ChoiceCard, deleteNode, NumberInput, PanelHeader, Section, useNodeUpdater } from './common'
import { ExpandToSubflow } from './ExpandToSubflow'
import { Stat } from './WorkPanel'

type AutoStep = NodeOf<'auto'>

export function AutoInspector({ app, wf, node }: { app: App; wf: Workflow; node: AutoStep }) {
  const [tab, setTab] = useState<'design' | 'live'>('design')
  const m = useSimView()?.nodes[node.id]
  const services = useDesign((s) => s.design.services)
  const svc = services.find((s) => s.id === node.data.serviceId)
  const KindIcon = svc ? SERVICE_KIND[svc.kind].icon : Bot
  return (
    <>
      <PanelHeader
        icon={
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
            <KindIcon size={17} />
          </span>
        }
        kind="Automated step"
        title={node.data.label}
        onDelete={() => deleteNode(app.id, wf, node.id)}
      />
      <div className="border-b border-slate-200 px-4 py-2">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'design', label: 'Design' },
            { value: 'live', label: `Live${m?.total ? ` (${m.total})` : ''}` },
          ]}
        />
      </div>
      <Body>{tab === 'design' ? <DesignTab app={app} wf={wf} node={node} /> : <LiveTab app={app} wf={wf} node={node} />}</Body>
    </>
  )
}

// ---------- Design ----------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Keep result mappings the operation still returns; map new ones onto same-named fields. */
function remapOutputs(op: ServiceOperation | undefined, type: ObjectType | undefined, current: AutoStepData['outputs']): AutoStepData['outputs'] {
  if (!op) return []
  return op.outputs.flatMap((o) => {
    const kept = current?.find((x) => x.key === o.key)
    if (kept) return [kept]
    const field = type?.fields.find((f) => fieldTypesFor(o.type).includes(f.type) && (norm(f.label) === norm(o.label) || norm(f.label) === norm(o.key)))
    return field ? [{ key: o.key, fieldId: field.id }] : []
  })
}

function DesignTab({ app, wf, node }: { app: App; wf: Workflow; node: AutoStep }) {
  const d = node.data
  const update = useNodeUpdater<AutoStep>(app.id, wf.id, node.id)
  const services = useDesign((s) => s.design.services)
  const groups = useDesign((s) => s.design.groups)
  const users = useDesign((s) => s.design.users)
  const type = app.objectTypes.find((t) => t.id === wf.objectTypeId)
  const svc = services.find((s) => s.id === d.serviceId)
  const op = svc?.operations.find((o) => o.id === d.operationId)
  const policy = d.onFailure ?? 'route'
  const failedPath = wf.edges.find((e) => e.source === node.id && e.data.outcomeId === AUTO_FAILURE)
  const failedTarget = failedPath && wf.nodes.find((n) => n.id === failedPath.target)

  const setService = (id: string) =>
    update((n) => {
      const next = services.find((s) => s.id === id)
      n.data.serviceId = next?.id
      n.data.operationId = next?.operations[0]?.id
      n.data.outputs = remapOutputs(next?.operations[0], type, n.data.outputs)
    })

  const setOperation = (id: string) =>
    update((n) => {
      n.data.operationId = id
      n.data.outputs = remapOutputs(
        svc?.operations.find((o) => o.id === id),
        type,
        n.data.outputs,
      )
    })

  return (
    <>
      <Section title="Step">
        <div className="space-y-3">
          <Field label="Name">
            <Input value={d.label} onChange={(e) => update((n) => void (n.data.label = e.target.value))} />
          </Field>
          <Field label="Description">
            <Textarea value={d.description ?? ''} className="min-h-[56px]" onChange={(e) => update((n) => void (n.data.description = e.target.value))} />
          </Field>
        </div>
      </Section>

      <Section title="Calls" hint="A registered system this step calls for every item: an API, an MCP tool, a worker pool, an AI agent or email.">
        <div className="space-y-3">
          <Field label="Service">
            <Select value={d.serviceId ?? ''} onChange={(e) => setService(e.target.value)}>
              <option value="">None — built-in actions only</option>
              {(Object.keys(SERVICE_KIND) as ServiceKind[]).map((kind) => {
                const list = services.filter((s) => s.kind === kind)
                if (!list.length) return null
                return (
                  <optgroup key={kind} label={SERVICE_KIND[kind].group}>
                    {list.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {s.status !== 'online' ? ` (${SERVICE_STATUS[s.status].label.toLowerCase()})` : ''}
                      </option>
                    ))}
                  </optgroup>
                )
              })}
            </Select>
          </Field>
          {d.serviceId && !svc && <p className="text-xs font-medium text-rose-600">The service this step called is no longer registered. Pick another one.</p>}
          {svc && <ServiceCard svc={svc} />}
          {svc && (
            <Field
              label="Operation"
              hint={op ? `${op.description ? `${op.description} ` : ''}Takes about ${formatDuration(op.avgMinutes)}; ${Math.round(op.successRate * 100)}% of calls succeed (simulation).` : undefined}
            >
              <Select value={d.operationId ?? ''} onChange={(e) => setOperation(e.target.value)}>
                {!op && <option value="">Choose an operation…</option>}
                {svc.operations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {!svc && (
            <Field label="Average processing time" hint="Simulated time the server takes per item.">
              <NumberInput value={d.avgMinutes} min={0} suffix="min" onChange={(v) => update((n) => void (n.data.avgMinutes = Math.max(0, v ?? 0)))} />
            </Field>
          )}
        </div>
      </Section>

      {svc && <InputsEditor d={d} type={type} onChange={(inputs) => update((n) => void (n.data.inputs = inputs))} />}

      {svc && op && (
        <Section title="Store the results" hint="Where each value the service returns is saved on the item. Later decisions can route on them.">
          {op.outputs.length === 0 ? (
            <p className="text-xs text-slate-500">{op.name} returns nothing to store.</p>
          ) : (
            <ul className="space-y-1.5">
              {op.outputs.map((o) => {
                const mapped = d.outputs?.find((x) => x.key === o.key)
                const allowed = fieldTypesFor(o.type)
                const fields = (type?.fields ?? []).filter((f) => allowed.includes(f.type))
                return (
                  <li key={o.key} className="grid grid-cols-[1fr_150px] items-center gap-2">
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-slate-800">{o.label}</span>
                      <span className="block text-[10.5px] text-slate-500">
                        {o.key} · {o.type}
                      </span>
                    </span>
                    <Select
                      className="h-7 text-xs"
                      value={mapped?.fieldId ?? ''}
                      aria-label={`Store ${o.label} in`}
                      onChange={(e) =>
                        update((n) => {
                          const rest = (n.data.outputs ?? []).filter((x) => x.key !== o.key)
                          n.data.outputs = e.target.value ? [...rest, { key: o.key, fieldId: e.target.value }] : rest
                        })
                      }
                    >
                      <option value="">Don’t store</option>
                      {fields.map((f) => (
                        <option key={f.id} value={f.id}>
                          → {f.label}
                        </option>
                      ))}
                      {mapped && !fields.some((f) => f.id === mapped.fieldId) && <option value={mapped.fieldId}>→ (removed field)</option>}
                    </Select>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>
      )}

      {svc && (
        <Section title="When the call fails">
          <div className="space-y-3">
            <Field label="Retry first" hint="Automatic retries before the call counts as failed.">
              <Segmented size="sm" value={d.retries ?? 0} onChange={(v) => update((n) => void (n.data.retries = v))} options={[0, 1, 2, 3, 4, 5].map((v) => ({ value: v, label: String(v) }))} />
            </Field>
            <div>
              <span className="mb-1 block text-xs font-medium text-slate-600">Then</span>
              <div className="space-y-1.5">
                {(Object.keys(FAILURE) as FailurePolicy[]).map((p) => {
                  const info = FAILURE[p]
                  return (
                    <ChoiceCard key={p} active={policy === p} icon={<info.icon size={14} />} title={info.label} text={info.help} onClick={() => update((n) => void (n.data.onFailure = p))}>
                      {p === 'route' &&
                        (failedTarget ? (
                          <p className="text-[11.5px] text-slate-600">
                            Failed path → <b className="font-semibold text-slate-800">{failedTarget.data.label}</b>
                          </p>
                        ) : (
                          <p className="flex items-center gap-1 text-[11.5px] font-medium text-amber-700">
                            <TriangleAlert size={12} /> No “Failed” path yet: draw a second path from this step.
                          </p>
                        ))}
                    </ChoiceCard>
                  )
                })}
              </div>
            </div>
          </div>
        </Section>
      )}

      <Section title="By hand" hint="People who can do this step themselves when automation fails, or when an administrator hands an item to a person.">
        <Select value={d.fallbackGroupId ?? ''} onChange={(e) => update((n) => void (n.data.fallbackGroupId = e.target.value || undefined))} aria-label="Fallback group">
          <option value="">No fallback group</option>
          {groups
            .filter((g) => g.kind !== 'distribution')
            .map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.memberIds.length})
              </option>
            ))}
        </Select>
        {policy === 'manual' && !d.fallbackGroupId && svc && <p className="mt-1.5 text-[11.5px] font-medium text-amber-700">Pick a group, or failed calls will get stuck.</p>}
      </Section>

      <Section
        title={svc ? 'Then, on success' : 'Actions'}
        hint={svc ? 'Built-in actions run after a successful call.' : 'Run in order by the server; later decisions can route on the values they set.'}
      >
        <ActionsEditor actions={d.actions} type={type} users={users} onChange={(actions) => update((n) => void (n.data.actions = actions))} />
      </Section>

      <ExpandToSubflow app={app} wf={wf} nodeId={node.id} />
    </>
  )
}

function ServiceCard({ svc }: { svc: ServiceDef }) {
  const kind = SERVICE_KIND[svc.kind]
  const status = SERVICE_STATUS[svc.status]
  const live = useSimView()?.services[svc.id]
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-xs text-slate-600">
        <kind.icon size={13} className="text-violet-600" />
        {kind.label}
        <Badge tone={status.tone} className="ml-auto">
          <span className={cx('h-1.5 w-1.5 rounded-full', status.dot)} /> {status.label}
        </Badge>
      </div>
      <div className="mt-1 truncate font-mono text-[11px] text-slate-500" title={svc.endpoint}>
        {svc.endpoint}
      </div>
      <div className="mt-1 text-[11px] text-slate-500">
        {svc.concurrency ? `Up to ${svc.concurrency} calls at once` : 'No limit on calls at once'}
        {live && live.calls > 0 && ` · ${live.inFlight} in flight, ${live.queued} queued now`}
      </div>
    </div>
  )
}

const PARAM_TOKENS: Array<[string, string]> = [['{number}', 'Item number']]

/** Request parameters: a name and a value that can mix text with field placeholders. */
function InputsEditor({ d, type, onChange }: { d: AutoStepData; type?: ObjectType; onChange: (inputs: Record<string, string>) => void }) {
  const entries = Object.entries(d.inputs ?? {})
  const set = (i: number, key: string, value: string) => onChange(Object.fromEntries(entries.map((e, j) => (j === i ? [key, value] : e))))
  const fieldLabel = (id: string) => type?.fields.find((f) => f.id === id)?.label ?? 'removed field'
  const freshKey = () => {
    let i = entries.length + 1
    while (d.inputs?.[`param${i}`] !== undefined) i++
    return `param${i}`
  }
  const preview = (v: string) => v.replace(/\{field:([^}]+)\}/g, (_, id: string) => `‹${fieldLabel(id)}›`).replace(/\{number\}/g, '‹Item number›')

  return (
    <Section
      title="Send"
      hint="Parameters sent with each call. Insert a field to send that item’s value."
      action={
        <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => onChange({ ...Object.fromEntries(entries), [freshKey()]: '' })}>
          Add
        </Button>
      }
    >
      {entries.length === 0 ? (
        <p className="text-xs text-slate-500">Nothing is sent yet.</p>
      ) : (
        <ul className="space-y-2">
          {entries.map(([key, value], i) => (
            <li key={i} className="rounded-lg border border-slate-200 p-2">
              <div className="flex items-center gap-1.5">
                <Input value={key} className="h-7 w-[96px] font-mono text-xs" aria-label="Parameter name" onChange={(e) => set(i, e.target.value, value)} />
                <Input value={value} className="h-7 min-w-0 flex-1 text-xs" placeholder="Value" aria-label={`Value for ${key}`} onChange={(e) => set(i, key, e.target.value)} />
                <IconButton label="Remove parameter" onClick={() => onChange(Object.fromEntries(entries.filter((_, j) => j !== i)))}>
                  <Trash2 size={13} />
                </IconButton>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <Select className="h-6 w-[130px] py-0 text-[11px]" value="" aria-label="Insert a field" onChange={(e) => e.target.value && set(i, key, `${value}${e.target.value}`)}>
                  <option value="">+ Insert field…</option>
                  {(type?.fields ?? []).map((f) => (
                    <option key={f.id} value={`{field:${f.id}}`}>
                      {f.label}
                    </option>
                  ))}
                  {PARAM_TOKENS.map(([token, label]) => (
                    <option key={token} value={token}>
                      {label}
                    </option>
                  ))}
                </Select>
                {/\{(field:|number)/.test(value) && <span className="min-w-0 truncate text-[11px] text-slate-500">{preview(value)}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

// ---------- Live ----------

function stateOf(t: Token): { label: string; tone: 'slate' | 'brand' | 'green' | 'amber' | 'red' } {
  if (t.state === 'stuck') return { label: 'Stuck', tone: 'red' }
  if (t.state === 'queued') return { label: 'Queued', tone: 'amber' }
  if (t.manual) return { label: t.state === 'working' ? 'By hand · working' : t.userId ? 'By hand · basket' : 'By hand · waiting', tone: 'amber' }
  return { label: (t.attempt ?? 1) > 1 ? `Retry ${(t.attempt ?? 1) - 1}` : 'Running', tone: 'brand' }
}

function LiveTab({ app, wf, node }: { app: App; wf: Workflow; node: AutoStep }) {
  const sim = useSimState()
  const view = useSimView()
  const users = useDesign((s) => s.design.users)
  const groups = useDesign((s) => s.design.groups)
  const services = useDesign((s) => s.design.services)
  const m = view?.nodes[node.id]
  const svc = services.find((s) => s.id === node.data.serviceId)
  const sm = svc ? view?.services[svc.id] : undefined
  const type = app.objectTypes.find((t) => t.id === wf.objectTypeId)
  const fallback = groups.find((g) => g.id === node.data.fallbackGroupId)
  const members = (fallback?.memberIds ?? []).map((id) => users.find((u) => u.id === id)).filter((u): u is User => !!u)

  const items = useMemo(() => {
    if (!sim) return [] as Token[]
    return activeTokens(sim)
      .filter((t) => t.nodeId === node.id)
      .sort((a, b) => a.enteredAt - b.enteredAt)
  }, [sim, node.id, view])

  if (!sim || !m) return <EmptyState title="No simulation yet">Run the simulation to see work pass through this step.</EmptyState>

  const assign = (t: Token, userId: string) => {
    if (!userId && !t.manual) return
    const r = useSim.getState().act((s, ctx) => (userId ? adminAssign(s, ctx, t.id, userId) : adminReturnToPool(s, ctx, t.id)))
    if (!r.ok) useUi.getState().toast(r.error, 'warn')
  }
  const retry = (t: Token) => {
    const r = useSim.getState().act((s, ctx) => adminRetry(s, ctx, t.id))
    if (!r.ok) useUi.getState().toast(r.error, 'warn')
  }

  return (
    <div>
      <Section title="Right now">
        <div className="grid grid-cols-4 gap-2 text-center">
          <Stat label={svc ? 'In flight' : 'Running'} value={m.automated} />
          <Stat label="Queued" value={m.queued} tone={m.queued ? 'amber' : undefined} />
          <Stat label="By hand" value={m.manual} tone={m.manual ? 'amber' : undefined} />
          <Stat label="Stuck" value={m.stuck} tone={m.stuck ? 'red' : undefined} />
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-x-3 text-[11.5px] text-slate-500">
          <span>
            Avg time here <b className="font-semibold text-slate-700">{formatDuration(m.avgTime)}</b>
          </span>
          <span>
            Done <b className="font-semibold text-slate-700">{m.exited.toLocaleString()}</b>
          </span>
        </div>
        {svc && sm && (
          <p className="mt-2 rounded-md bg-slate-50 px-2.5 py-2 text-[11.5px] leading-relaxed text-slate-600">
            <b className="font-semibold text-slate-800">{svc.name}</b> (every step using it): {sm.calls.toLocaleString()} calls, {sm.failed.toLocaleString()} failed
            {sm.utilization !== undefined && ` · ${Math.round(sm.utilization * 100)}% of capacity used`}.
          </p>
        )}
      </Section>

      <Section title={`Items here (${items.length})`} hint="Hand any item to a person to finish by hand, or retry one that is stuck.">
        {items.length === 0 ? (
          <p className="text-xs text-slate-500">Nothing at this step right now.</p>
        ) : (
          <ul className="-mx-1 divide-y divide-slate-100">
            {items.slice(0, 80).map((t) => {
              const o = sim.objects[t.objectId]!
              const st = stateOf(t)
              const why = t.state === 'stuck' ? t.stuckReason : t.state === 'queued' ? t.waitReason : undefined
              return (
                <li key={t.id} className="flex items-center gap-2 px-1 py-1.5">
                  <button type="button" onClick={() => useUi.getState().openObject(o.id)} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-brand-700 hover:underline">{o.number}</span>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </div>
                    <div className="truncate text-[11px] text-slate-500" title={why}>
                      {why ?? objectTitle(type, o.data, app.lists, users)} · {formatDuration(sim.clock - t.enteredAt)}
                    </div>
                  </button>
                  {t.state === 'stuck' && (
                    <IconButton label="Retry" onClick={() => retry(t)}>
                      <RotateCw size={13} />
                    </IconButton>
                  )}
                  <div className="w-[132px] shrink-0">
                    <Select className="h-7 text-xs" value={t.manual ? (t.userId ?? '') : ''} onChange={(e) => assign(t, e.target.value)} aria-label={`Hand ${o.number} to a person`}>
                      <option value="">{t.manual ? '— Fallback pool —' : 'Hand to a person…'}</option>
                      {members.length > 0 && (
                        <optgroup label={fallback?.name ?? 'Fallback group'}>
                          {members.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                              {u.available ? '' : ' (out)'}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      <optgroup label={members.length ? 'Everyone else' : 'People'}>
                        {users
                          .filter((u) => !members.some((mm) => mm.id === u.id))
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                              {u.available ? '' : ' (out)'}
                            </option>
                          ))}
                      </optgroup>
                    </Select>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {items.length > 80 && <p className="mt-2 text-[11px] text-slate-500">Showing the 80 oldest of {items.length}.</p>}
      </Section>
    </div>
  )
}
