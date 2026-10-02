import { ArrowRight, Eye, MessageSquareText, Plus, Trash2, TriangleAlert, UserRound } from 'lucide-react'
import { useState } from 'react'
import { FormRenderer } from '../../../components/FormRenderer'
import { DISTRIBUTION } from '../../../components/icons'
import { Button, cx, Field, IconButton, Input, Modal, Segmented, Select, Textarea, Toggle } from '../../../components/ui'
import { generateData } from '@throughline/core/engine/generate'
import type { App, Distribution, Escalation, FieldAccess, Outcome, WfNode, Workflow } from '@throughline/core/model/types'
import { uid } from '@throughline/core/model/util'
import { useDesign } from '../../../store/design'
import { useSimView } from '../../../store/sim'
import { useUi } from '../../../store/ui'
import { ActionsEditor } from './ActionsEditor'
import { deleteNode, NumberInput, PanelHeader, Section, useNodeUpdater } from './common'
import { ExpandToSubflow } from './ExpandToSubflow'
import { WorkPanel } from './WorkPanel'

type UserStep = Extract<WfNode, { type: 'user' }>

export function UserStepInspector({ app, wf, node }: { app: App; wf: Workflow; node: UserStep }) {
  const [tab, setTab] = useState<'design' | 'work'>('design')
  const m = useSimView()?.nodes[node.id]
  return (
    <>
      <PanelHeader
        icon={
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
            <UserRound size={17} />
          </span>
        }
        kind="User step"
        title={node.data.label}
        onDelete={() => deleteNode(app.id, wf, node.id)}
      />
      <div className="border-b border-slate-200 px-4 py-2">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'design', label: 'Design' },
            { value: 'work', label: `Live work${m?.total ? ` (${m.total})` : ''}` },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{tab === 'design' ? <DesignTab app={app} wf={wf} node={node} /> : <WorkPanel app={app} wf={wf} node={node} />}</div>
    </>
  )
}

function DesignTab({ app, wf, node }: { app: App; wf: Workflow; node: UserStep }) {
  const d = node.data
  const update = useNodeUpdater<UserStep>(app.id, wf.id, node.id)
  const users = useDesign((s) => s.design.users)
  const groups = useDesign((s) => s.design.groups)
  const type = app.objectTypes.find((t) => t.id === wf.objectTypeId)
  const group = groups.find((g) => g.id === d.groupId)
  const [preview, setPreview] = useState(false)
  const outgoing = wf.edges.filter((e) => e.source === node.id)
  const totalWeight = d.outcomes.reduce((s, o) => s + Math.max(0, o.weight), 0)
  const teams = groups.filter((g) => g.kind !== 'distribution' || g.id === d.groupId)
  const distributionGroups = groups.filter((g) => g.kind === 'distribution')
  const dispatchers = groups.find((g) => g.id === d.distributorGroupId)
  const personFields = type?.fields.filter((f) => f.type === 'user') ?? []
  const escalation = d.escalation ?? { raisePriority: true, toDistributors: false }

  const setEscalation = (patch: Partial<Escalation>) =>
    update((n) => {
      n.data.escalation = { ...(n.data.escalation ?? { raisePriority: true, toDistributors: false }), ...patch }
    })

  const setOutcome = (id: string, patch: Partial<Outcome>) =>
    update((n) => {
      const o = n.data.outcomes.find((x) => x.id === id)
      if (o) Object.assign(o, patch)
    })

  return (
    <>
      <Section title="Step">
        <div className="space-y-3">
          <Field label="Name">
            <Input value={d.label} onChange={(e) => update((n) => void (n.data.label = e.target.value))} />
          </Field>
          <Field label="Instructions">
            <Textarea value={d.description ?? ''} placeholder="What should the person do here?" className="min-h-[56px]" onChange={(e) => update((n) => void (n.data.description = e.target.value))} />
          </Field>
        </div>
      </Section>

      <Section title="Who does the work" hint={DISTRIBUTION[d.distribution].help}>
        <div className="mb-3 grid grid-cols-2 gap-1.5">
          {(Object.keys(DISTRIBUTION) as Distribution[]).map((key) => {
            const info = DISTRIBUTION[key]
            const Icon = info.icon
            const active = d.distribution === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => update((n) => void (n.data.distribution = key))}
                className={cx(
                  'flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs font-medium transition-colors',
                  active ? 'border-brand-500 bg-brand-50 text-brand-800 ring-1 ring-brand-500' : 'border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50',
                )}
              >
                <Icon size={15} className={active ? 'text-brand-600' : 'text-slate-400'} />
                {info.label}
              </button>
            )
          })}
        </div>
        <div className="space-y-3">
          {d.distribution === 'field' && (
            <Field label="Person field" hint={`The person named in this field gets the item. When it is empty, it is load balanced across ${group?.name ?? 'the group below'}.`}>
              <Select value={d.assigneeFieldId ?? ''} onChange={(e) => update((n) => void (n.data.assigneeFieldId = e.target.value || undefined))}>
                <option value="">Choose a person field…</option>
                {personFields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </Select>
              {personFields.length === 0 && <span className="mt-1 block text-[11px] text-amber-700">{type?.name ?? 'This object type'} has no person fields yet. Add one in Object Types.</span>}
            </Field>
          )}
          {d.distribution === 'direct' ? (
            <Field label="Assign every item to">
              <Select value={d.userId ?? ''} onChange={(e) => update((n) => void (n.data.userId = e.target.value || undefined))}>
                <option value="">Choose a person…</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} — {u.title}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field
              label={d.distribution === 'field' ? 'Fallback group' : 'Group'}
              hint={group ? `${group.memberIds.length} members${group.supervisorId ? ` · supervisor ${users.find((u) => u.id === group.supervisorId)?.name}` : ''}` : undefined}
            >
              <Select value={d.groupId ?? ''} onChange={(e) => update((n) => void (n.data.groupId = e.target.value || undefined))}>
                <option value="">Choose a group…</option>
                {teams.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.memberIds.length})
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {d.distribution === 'manager' && (
            <>
              <Field
                label="Who hands out the work"
                hint={
                  dispatchers
                    ? `Any of ${dispatchers.memberIds
                        .map((id) => users.find((u) => u.id === id)?.name)
                        .filter(Boolean)
                        .join(', ')} can hand items to ${group?.name ?? 'the group'}.`
                    : 'The supervisor hands out every item.'
                }
              >
                <Select value={d.distributorGroupId ?? ''} onChange={(e) => update((n) => void (n.data.distributorGroupId = e.target.value || undefined))}>
                  <option value="">Supervisor only</option>
                  {distributionGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} ({g.memberIds.length} dispatchers)
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Supervisor" hint={dispatchers ? 'Steps in when no dispatcher is set up.' : undefined}>
                <Select value={d.supervisorId ?? group?.supervisorId ?? ''} onChange={(e) => update((n) => void (n.data.supervisorId = e.target.value || undefined))}>
                  <option value="">Choose…</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} — {u.title}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="rounded-lg bg-slate-50 p-2.5">
                <Toggle
                  checked={d.autoDistribute}
                  onChange={(on) => update((n) => void (n.data.autoDistribute = on))}
                  label={<span className="text-xs">Simulate the {dispatchers ? 'dispatchers' : 'supervisor'} handing out work</span>}
                />
                {d.autoDistribute ? (
                  <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                    every
                    <NumberInput
                      className="w-[100px]"
                      value={d.distributeEveryMinutes}
                      min={5}
                      suffix="min"
                      onChange={(v) => update((n) => void (n.data.distributeEveryMinutes = Math.max(5, v ?? 30)))}
                    />
                  </div>
                ) : (
                  <p className="mt-1.5 text-[11px] text-slate-500">Work waits until you assign it from the Live work tab, or a dispatcher does in the Workspace.</p>
                )}
              </div>
            </>
          )}
          {d.distribution !== 'direct' && (
            <Toggle
              checked={d.allowDelegate ?? true}
              onChange={(on) => update((n) => void (n.data.allowDelegate = on))}
              label={<span className="text-xs">People can hand items to a colleague in the same group</span>}
            />
          )}
        </div>
      </Section>

      <Section title="Timing (simulation)">
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Average handling time">
            <NumberInput value={d.avgMinutes} min={1} suffix="min" onChange={(v) => update((n) => void (n.data.avgMinutes = Math.max(1, v ?? 1)))} />
          </Field>
          <Field label="Service level (SLA)">
            <NumberInput value={d.slaHours} min={0} suffix="hours" onChange={(v) => update((n) => void (n.data.slaHours = v || undefined))} />
          </Field>
        </div>
      </Section>

      <Section title="Escalation" hint="What happens to an item that sits at this step too long.">
        <Toggle
          checked={!!d.escalateAfterHours}
          onChange={(on) =>
            update((n) => {
              n.data.escalateAfterHours = on ? (n.data.slaHours ?? 24) : undefined
              if (on) n.data.escalation ??= { raisePriority: true, toDistributors: false }
            })
          }
          label={<span className="text-sm">Escalate items that wait too long</span>}
        />
        {d.escalateAfterHours ? (
          <div className="mt-3 space-y-2.5">
            <Field label="Escalate after">
              <NumberInput value={d.escalateAfterHours} min={0.25} step={0.25} suffix="hours" onChange={(v) => update((n) => void (n.data.escalateAfterHours = Math.max(0.25, v ?? 0.25)))} />
            </Field>
            <Toggle checked={escalation.raisePriority} onChange={(on) => setEscalation({ raisePriority: on })} label={<span className="text-xs">Raise its priority one level</span>} />
            <Toggle checked={escalation.toDistributors} onChange={(on) => setEscalation({ toDistributors: on })} label={<span className="text-xs">Send it back to be handed out again</span>} />
            {escalation.toDistributors && (
              <p className="-mt-1 pl-11 text-[11px] text-slate-500">Takes it out of the person’s basket so a dispatcher (or the supervisor) can give it to someone else.</p>
            )}
            <Field label="Notify" hint="Who hears about it, e.g. the AP Supervisor. Leave empty for no message.">
              <Input value={escalation.notify ?? ''} placeholder="Nobody" onChange={(e) => setEscalation({ notify: e.target.value || undefined })} />
            </Field>
          </div>
        ) : null}
      </Section>

      <Section
        title="Release outcomes"
        hint="When people finish, they release the item with one of these outcomes (and optionally a comment). Each outcome follows its own path."
        action={
          <Button
            size="sm"
            variant="ghost"
            icon={<Plus size={13} />}
            onClick={() =>
              update((n) => {
                n.data.outcomes.push({ id: uid('o'), label: 'New outcome', weight: 10, actions: [] })
              })
            }
          >
            Add
          </Button>
        }
      >
        <div className="space-y-2">
          {d.outcomes.map((o) => {
            const edge = outgoing.find((e) => e.data.outcomeId === o.id) ?? (outgoing.length === 1 && !outgoing[0]!.data.outcomeId ? outgoing[0] : undefined)
            const target = edge && wf.nodes.find((n) => n.id === edge.target)
            const share = totalWeight ? Math.round((Math.max(0, o.weight) / totalWeight) * 100) : 0
            return (
              <OutcomeRow
                key={o.id}
                outcome={o}
                share={share}
                targetLabel={target?.data.label}
                onSelectPath={edge ? () => useUi.getState().select({ kind: 'edge', id: edge.id }) : undefined}
                onChange={(patch) => setOutcome(o.id, patch)}
                onRemove={
                  d.outcomes.length > 1
                    ? () =>
                        useDesign.getState().updateWorkflow(app.id, wf.id, (w) => {
                          const n = w.nodes.find((x) => x.id === node.id)
                          if (n?.type === 'user') n.data.outcomes = n.data.outcomes.filter((x) => x.id !== o.id)
                          for (const e of w.edges) if (e.source === node.id && e.data.outcomeId === o.id) e.data.outcomeId = undefined
                        })
                    : undefined
                }
                actionsEditor={<ActionsEditor actions={o.actions} type={type} users={users} kinds={['setField', 'notify']} onChange={(actions) => setOutcome(o.id, { actions })} />}
              />
            )
          })}
        </div>
      </Section>

      {type && (
        <Section
          title="Field access at this step"
          hint="Security per step: what this step’s workers can change, only see, or not see at all."
          action={
            <Button size="sm" variant="ghost" icon={<Eye size={13} />} onClick={() => setPreview(true)}>
              Preview form
            </Button>
          }
        >
          <ul className="space-y-1">
            {type.fields.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2">
                <span className="truncate text-xs text-slate-700">
                  {f.label}
                  {f.system && <span className="ml-1 text-[10px] text-slate-400">(workflow)</span>}
                </span>
                <Segmented<FieldAccess>
                  size="sm"
                  value={d.fieldAccess[f.id] ?? 'edit'}
                  onChange={(v) => update((n) => void (n.data.fieldAccess[f.id] = v))}
                  options={[
                    { value: 'edit', label: 'Edit' },
                    { value: 'read', label: 'Read' },
                    { value: 'hidden', label: 'Hidden' },
                  ]}
                />
              </li>
            ))}
          </ul>
          <StepFormPreview open={preview} onClose={() => setPreview(false)} app={app} node={node} />
        </Section>
      )}

      <ExpandToSubflow app={app} wf={wf} nodeId={node.id} />
    </>
  )
}

function OutcomeRow({
  outcome,
  share,
  targetLabel,
  onSelectPath,
  onChange,
  onRemove,
  actionsEditor,
}: {
  outcome: Outcome
  share: number
  targetLabel?: string
  onSelectPath?: () => void
  onChange: (patch: Partial<Outcome>) => void
  onRemove?: () => void
  actionsEditor: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg border border-slate-200">
      <div className="flex items-center gap-1.5 p-2">
        <Input value={outcome.label} className="h-7 min-w-0 flex-1 text-[13px] font-medium" onChange={(e) => onChange({ label: e.target.value })} aria-label="Outcome name" />
        <div className="flex items-center gap-1" title="Relative weight: how often simulated people choose this outcome">
          <input
            type="number"
            min={0}
            value={outcome.weight}
            aria-label="Simulation weight"
            onChange={(e) => onChange({ weight: Math.max(0, Number(e.target.value) || 0) })}
            className="h-7 w-[52px] rounded-md border border-slate-300 bg-white px-1.5 text-right text-xs tabular-nums shadow-xs focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
          />
          <span className="w-8 text-[11px] text-slate-500 tabular-nums">{share}%</span>
        </div>
        <IconButton label={outcome.requireComment ? 'Comment required' : 'Comment optional'} active={outcome.requireComment} onClick={() => onChange({ requireComment: !outcome.requireComment })}>
          <MessageSquareText size={14} className={outcome.requireComment ? 'text-brand-600' : undefined} />
        </IconButton>
        {onRemove && (
          <IconButton label="Remove outcome" onClick={onRemove}>
            <Trash2 size={13} />
          </IconButton>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-slate-100 px-2 py-1.5 text-[11px]">
        {targetLabel ? (
          <button type="button" onClick={onSelectPath} className="flex min-w-0 items-center gap-1 text-slate-600 hover:text-brand-700">
            <ArrowRight size={11} className="shrink-0" /> <span className="truncate">{targetLabel}</span>
          </button>
        ) : (
          <span className="flex items-center gap-1 font-medium text-amber-700">
            <TriangleAlert size={11} /> Not connected — drag a path from this step
          </span>
        )}
        <button type="button" className="ml-auto shrink-0 font-medium text-slate-500 hover:text-slate-800" onClick={() => setOpen((v) => !v)}>
          {outcome.actions.length ? `${outcome.actions.length} on-release action${outcome.actions.length === 1 ? '' : 's'}` : 'On release…'}
        </button>
      </div>
      {open && <div className="border-t border-slate-100 bg-slate-50/50 p-2">{actionsEditor}</div>}
    </div>
  )
}

function StepFormPreview({ open, onClose, app, node }: { open: boolean; onClose: () => void; app: App; node: UserStep }) {
  const users = useDesign((s) => s.design.users)
  const wf = app.workflows.find((w) => w.nodes.some((n) => n.id === node.id))
  const type = app.objectTypes.find((t) => t.id === wf?.objectTypeId)
  const [values, setValues] = useState<Record<string, unknown>>({})
  if (!type) return null
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${node.data.label} — form preview`}
      subtitle={`Generated from the ${type.name} type, with this step’s field access applied.`}
      footer={
        <>
          <Button variant="ghost" onClick={() => setValues(generateData({ rng: (Math.random() * 2 ** 31) | 0 }, type, app.lists, users, 0, `${type.numberPrefix}1001`))}>
            Fill sample data
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      {node.data.description && <p className="mb-4 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900">{node.data.description}</p>}
      <FormRenderer type={type} lists={app.lists} users={users} values={values} onChange={setValues} access={node.data.fieldAccess} includeSystem />
      <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
        {node.data.outcomes.map((o) => (
          <Button key={o.id} variant={/reject|deny/i.test(o.label) ? 'danger' : 'secondary'}>
            {o.label}
          </Button>
        ))}
      </div>
    </Modal>
  )
}
