import { Lock, Shield } from 'lucide-react'
import { useMemo } from 'react'
import { fieldVerdicts } from '@modus-bpm/core'
import type { FieldDef, Group, Id, ObjectType, User, Workflow } from '@modus-bpm/core/model/types'
import { FIELD_ICONS } from '../../components/icons'
import { Badge, Card } from '../../components/ui'
import { useDesign } from '../../store/design'
import { ACCESS, AccessChip, type Effective, effectiveAtStep, namesOf, NEXT, orderedUserSteps, RANK, type UserNode } from './SecurityShared'

/** Fields × steps: the step setting in each cell, with the effective access overlaid when something stricter wins. */
export function SecurityMatrix({ appId, type, wf, groups, users }: { appId: Id; type: ObjectType; wf: Workflow; groups: Group[]; users: User[] }) {
  const updateWorkflow = useDesign((s) => s.updateWorkflow)
  const steps = useMemo(() => orderedUserSteps(wf), [wf])
  const effective = useMemo(() => Object.fromEntries(steps.map((n) => [n.id, effectiveAtStep(type, wf, n, groups)])), [steps, type, wf, groups])
  const createForm = useMemo(() => fieldVerdicts({ type, creating: true, groups }), [type, groups])
  const groupName = (id?: Id) => groups.find((g) => g.id === id)?.name

  const cycle = (node: UserNode, f: FieldDef) =>
    updateWorkflow(appId, wf.id, (w) => {
      const n = w.nodes.find((x) => x.id === node.id)
      if (n?.type === 'user') n.data.fieldAccess[f.id] = NEXT[n.data.fieldAccess[f.id] ?? 'edit']
    })

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-200 px-4 py-2.5 text-[11px] text-slate-500">
        <span className="font-medium text-slate-700">Click a cell to change the step setting.</span>
        <span className="flex items-center gap-1">
          <AccessChip access="edit" /> <AccessChip access="read" /> <AccessChip access="hidden" />
        </span>
        <span className="flex items-center gap-1">
          <Lock size={12} className="text-amber-600" /> A workflow lock or sensitive-data rule makes it stricter for the people working that step (hover for why).
        </span>
      </div>
      {steps.length === 0 && <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">This workflow has no user steps, so only the create form applies.</p>}
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-left text-xs">
          <thead>
            <tr className="text-[10.5px] font-semibold tracking-wide text-slate-500 uppercase">
              <th className="sticky left-0 z-10 min-w-[220px] border-b border-slate-200 bg-white py-2 pr-2 pl-4">Field</th>
              <th className="border-b border-l border-slate-200 bg-slate-50/70 px-2 py-2" title="What people see when they create a new item. System fields are set by the workflow.">
                <div className="w-[92px] truncate normal-case">Create form</div>
                <div className="text-[10px] font-normal tracking-normal text-slate-400 normal-case">informational</div>
              </th>
              {steps.map((n) => (
                <th key={n.id} className="border-b border-l border-slate-100 px-2 py-2" title={`${n.data.label}${groupName(n.data.groupId) ? ` · ${groupName(n.data.groupId)}` : ''}`}>
                  <div className="max-w-[118px] min-w-[96px] truncate tracking-normal text-slate-700 normal-case">{n.data.label}</div>
                  <div className="max-w-[118px] truncate text-[10px] font-normal tracking-normal text-slate-400 normal-case">
                    {n.data.distribution === 'direct' ? namesOf(n.data.userId ? [n.data.userId] : [], users) : (groupName(n.data.groupId) ?? 'No group')}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {type.fields.map((f) => (
              <tr key={f.id} className="group">
                <th scope="row" className="sticky left-0 z-10 border-b border-slate-100 bg-white py-1.5 pr-2 pl-4 font-normal group-hover:bg-slate-50">
                  <FieldLabel field={f} groups={groups} />
                </th>
                <td className="border-b border-l border-slate-100 bg-slate-50/70 px-2 py-1.5">
                  <CreateCell field={f} access={createForm[f.id]!.access} reason={createForm[f.id]!.reason} groups={groups} />
                </td>
                {steps.map((n) => (
                  <td key={n.id} className="border-b border-l border-slate-100 px-1.5 py-1 group-hover:bg-slate-50/60">
                    <StepCell node={n} field={f} eff={effective[n.id]![f.id]!} users={users} onCycle={() => cycle(n, f)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function FieldLabel({ field: f, groups }: { field: FieldDef; groups: Group[] }) {
  const Icon = FIELD_ICONS[f.type]
  const restricted = f.restrictedTo?.length ? groups.filter((g) => f.restrictedTo!.includes(g.id)).map((g) => g.name) : []
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Icon size={13} className="shrink-0 text-slate-400" />
      <span className="truncate font-medium text-slate-800" title={f.label}>
        {f.label}
      </span>
      {f.required && <Badge tone="amber">Required</Badge>}
      {f.system && <Badge>System</Badge>}
      {restricted.length > 0 && (
        <span title={`Sensitive: visible only to ${restricted.join(', ')}`}>
          <Badge tone="violet">
            <Shield size={10} /> Restricted
          </Badge>
        </span>
      )}
    </div>
  )
}

function CreateCell({ field, access, reason, groups }: { field: FieldDef; access: 'edit' | 'read' | 'hidden'; reason?: string; groups: Group[] }) {
  const restricted = field.restrictedTo?.length && access !== 'hidden' ? groups.filter((g) => field.restrictedTo!.includes(g.id)).map((g) => g.name) : []
  const title = restricted.length ? `${ACCESS[access].long} for ${restricted.join(', ')}; hidden from everyone else` : reason ? `${ACCESS[access].long}: ${reason}` : ACCESS[access].long
  return (
    <span className="inline-flex items-center gap-1" title={title}>
      <AccessChip access={access} />
      {restricted.length > 0 && <Shield size={12} className="text-violet-600" />}
    </span>
  )
}

function StepCell({ node, field, eff, users, onCycle }: { node: UserNode; field: FieldDef; eff: Effective; users: User[]; onCycle: () => void }) {
  const configured = node.data.fieldAccess[field.id] ?? 'edit'
  const stricter = RANK[eff.access] > RANK[configured]
  const lines = [`Step setting: ${ACCESS[configured].long}. Click to change.`]
  if (stricter && eff.uniform) lines.push(`Effective: ${ACCESS[eff.access].long}. ${eff.groups[0]!.verdict.reason ?? ''}`.trim())
  else if (stricter)
    for (const g of eff.groups) lines.push(`${namesOf(g.userIds, users)}: ${ACCESS[g.verdict.access].long}${g.verdict.reason && g.verdict.access !== configured ? ` (${g.verdict.reason})` : ''}`)

  return (
    <button
      type="button"
      onClick={onCycle}
      title={lines.join('\n')}
      aria-label={`${field.label} at ${node.data.label}: ${lines.join(' ')}`}
      className="flex w-full items-center gap-1 rounded px-0.5 py-0.5 hover:bg-white hover:ring-1 hover:ring-slate-200"
    >
      {stricter && eff.uniform ? (
        <>
          <Lock size={11} className="shrink-0 text-amber-600" />
          <AccessChip access={eff.access} />
          <span className="text-[10px] text-slate-400 line-through">{ACCESS[configured].label}</span>
        </>
      ) : (
        <>
          <AccessChip access={configured} />
          {stricter && <Lock size={11} className="shrink-0 text-amber-600" aria-hidden />}
        </>
      )}
    </button>
  )
}
