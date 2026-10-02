import { ArrowUpRight, Cog, Plus, Trash2, X } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { DISTRIBUTION } from '../../components/icons'
import { Avatar, Badge, Button, Card, cx, Field, IconButton, Segmented, SectionTitle, Select } from '../../components/ui'
import type { App, Design, Group, GroupKind, Id, WfNode, Workflow } from '@modus-bpm/core/model/types'
import { useDesign } from '../../store/design'
import { useUi } from '../../store/ui'
import { nodesOfType, openStep } from '../integrations/steps'
import { GroupCreateModal } from './GroupCreateModal'
import { GROUP_KINDS, groupKind } from './GroupKind'
import { InlineInput } from './InlineInput'
import { groupDeleteBlockers } from './usage'

/** Steps that point at a group in ways the shared delete check doesn't cover: dispatching and by-hand fallbacks. */
function moreDeleteBlockers(design: Design, groupId: Id): string[] {
  const reasons: string[] = []
  for (const { app, node } of nodesOfType(design, 'user')) if (node.data.distributorGroupId === groupId) reasons.push(`dispatches for ${app.name} › ${node.data.label}`)
  for (const { app, node } of nodesOfType(design, 'auto')) if (node.data.fallbackGroupId === groupId) reasons.push(`works ${app.name} › ${node.data.label} by hand`)
  return reasons
}

export function GroupsTab() {
  const design = useDesign((s) => s.design)
  const update = useDesign((s) => s.update)
  const toast = useUi((s) => s.toast)
  const appId = useUi((s) => s.appId)
  const [creating, setCreating] = useState(false)
  const userSteps = nodesOfType(design, 'user')
  const autoSteps = nodesOfType(design, 'auto')

  const patch = (id: Id, fn: (g: Group) => void) =>
    update((d) => {
      const g = d.groups.find((x) => x.id === id)
      if (g) fn(g)
    })

  const setKind = (g: Group, kind: GroupKind) =>
    patch(g.id, (x) => {
      if (kind === 'distribution') x.kind = 'distribution'
      else delete x.kind
    })

  const removeGroup = (g: Group) => {
    const d = useDesign.getState().design
    const reasons = [...groupDeleteBlockers(d, g.id), ...moreDeleteBlockers(d, g.id)]
    if (reasons.length) {
      toast(`Can’t delete ${g.name}: it ${reasons.join('; ')}.`, 'warn')
      return
    }
    if (!window.confirm(`Delete the ${g.name} group?`)) return
    update((d) => {
      d.groups = d.groups.filter((x) => x.id !== g.id)
    })
    toast(`${g.name} deleted.`)
  }

  const stepLink = (r: { app: App; wf: Workflow; node: WfNode }, badge: ReactNode, icon: ReactNode) => (
    <li key={`${r.wf.id}:${r.node.id}`}>
      <button
        type="button"
        onClick={() => openStep(r.app.id, r.wf.id, r.node.id)}
        className="group flex w-full items-center gap-2 rounded-md border border-slate-200 px-2 py-1.5 text-left text-xs hover:border-brand-300 hover:bg-brand-50/50"
        title={r.app.id === appId ? 'Open this step in the workflow designer' : `Switch to ${r.app.name} and open this step`}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate">
          <span className="text-slate-500">{r.app.name} › </span>
          <span className="font-medium text-slate-800">{r.node.data.label}</span>
        </span>
        {badge}
        <ArrowUpRight size={13} className="shrink-0 text-slate-300 group-hover:text-brand-600" />
      </button>
    </li>
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="text-xs text-slate-500">
          <p>Groups decide who can work a step. A step’s distribution method decides how its work is shared among the members.</p>
          <p>
            <span className="font-medium text-slate-700">Distribution groups</span> are dispatchers who hand work to a team. Any member can distribute; work waits for them.
          </p>
        </div>
        <div className="flex-1" />
        <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
          New group
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {design.groups.map((g) => {
          const kind = groupKind(g)
          const meta = GROUP_KINDS[kind]
          const KindIcon = meta.icon
          const isDist = kind === 'distribution'
          const members = g.memberIds.map((id) => design.users.find((u) => u.id === id)).filter((u) => !!u)
          const others = design.users.filter((u) => !g.memberIds.includes(u.id))
          const works = userSteps.filter((s) => s.node.data.groupId === g.id)
          const byHand = autoSteps.filter((s) => s.node.data.fallbackGroupId === g.id)
          const dispatches = userSteps.filter((s) => s.node.data.distributorGroupId === g.id)
          const out = members.filter((m) => !m.available).length
          const worksCount = works.length + byHand.length

          const worksSection = (
            <div>
              <SectionTitle>Works</SectionTitle>
              {worksCount === 0 ? (
                <p className="text-xs text-slate-400">Not assigned to any workflow step.</p>
              ) : (
                <ul className="space-y-1">
                  {works.map((r) => {
                    const dist = DISTRIBUTION[r.node.data.distribution]
                    const Icon = dist.icon
                    return stepLink(r, <Badge tone="brand">{dist.short}</Badge>, <Icon size={14} className="shrink-0 text-slate-500" />)
                  })}
                  {byHand.map((r) => stepLink(r, <Badge tone="amber">By hand if automation fails</Badge>, <Cog size={14} className="shrink-0 text-slate-500" />))}
                </ul>
              )}
            </div>
          )

          const dispatchSection = (
            <div>
              <SectionTitle>Dispatches for</SectionTitle>
              {dispatches.length === 0 ? (
                <p className="text-xs text-slate-400">No step uses this group to hand out its work.</p>
              ) : (
                <ul className="space-y-1">
                  {dispatches.map((r) => {
                    const team = design.groups.find((x) => x.id === r.node.data.groupId)
                    return stepLink(r, <Badge tone="violet">{team ? `to ${team.name}` : 'No team picked'}</Badge>, <KindIcon size={14} className="shrink-0 text-violet-500" />)
                  })}
                </ul>
              )}
            </div>
          )

          return (
            <Card key={g.id} className="flex flex-col">
              <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5">
                <span className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', meta.tile)} title={meta.label}>
                  <KindIcon size={15} />
                </span>
                <InlineInput aria-label="Group name" className="text-sm font-semibold" value={g.name} onChange={(e) => patch(g.id, (x) => void (x.name = e.target.value))} />
                {isDist && <Badge tone="violet">Distribution group</Badge>}
                <Badge>
                  {members.length} {isDist ? 'dispatcher' : 'member'}
                  {members.length === 1 ? '' : 's'}
                </Badge>
                {out > 0 && <Badge tone="amber">{out} out</Badge>}
                <IconButton label={`Delete ${g.name}`} onClick={() => removeGroup(g)}>
                  <Trash2 size={14} />
                </IconButton>
              </div>
              <div className="flex-1 space-y-4 p-4">
                <div className="space-y-2">
                  <InlineInput
                    aria-label={`Description of ${g.name}`}
                    className="-ml-1.5 text-xs text-slate-600"
                    placeholder="Add a description…"
                    value={g.description ?? ''}
                    onChange={(e) => patch(g.id, (x) => void (x.description = e.target.value || undefined))}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Segmented<GroupKind>
                      size="sm"
                      value={kind}
                      onChange={(k) => setKind(g, k)}
                      options={[
                        { value: 'team', label: 'Team', title: GROUP_KINDS.team.help },
                        { value: 'distribution', label: 'Distribution group', title: GROUP_KINDS.distribution.help },
                      ]}
                    />
                    <span className="min-w-0 flex-1 text-[11px] leading-snug text-slate-500">{meta.help}</span>
                  </div>
                </div>

                {!isDist && (
                  <Field label="Supervisor" hint="Hands out work at steps that use supervisor distribution.">
                    <Select value={g.supervisorId ?? ''} onChange={(e) => patch(g.id, (x) => void (x.supervisorId = e.target.value || undefined))}>
                      <option value="">No supervisor</option>
                      {design.users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} — {u.title}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}

                <div>
                  <SectionTitle>{isDist ? 'Dispatchers' : 'Members'}</SectionTitle>
                  {members.length === 0 ? (
                    <p className="mb-2 text-xs text-slate-400">{isDist ? 'No dispatchers yet. Work waiting for this group can’t be handed out.' : 'No members yet.'}</p>
                  ) : (
                    <ul className="mb-2 max-h-56 space-y-0.5 overflow-y-auto">
                      {members.map((m) => (
                        <li key={m.id} className="group flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-slate-50">
                          <Avatar name={m.name} color={m.color} size={22} />
                          <span className={cx('truncate text-sm', m.available ? 'text-slate-800' : 'text-slate-400 line-through')}>{m.name}</span>
                          <span className="truncate text-xs text-slate-400">{m.title}</span>
                          {!m.available && <Badge tone="amber">Out</Badge>}
                          <button
                            type="button"
                            aria-label={`Remove ${m.name} from ${g.name}`}
                            className="ml-auto rounded p-0.5 text-slate-300 opacity-0 group-hover:opacity-100 hover:bg-slate-200 hover:text-slate-700 focus:opacity-100"
                            onClick={() => patch(g.id, (x) => void (x.memberIds = x.memberIds.filter((id) => id !== m.id)))}
                          >
                            <X size={13} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Select
                    value=""
                    aria-label={`Add a ${isDist ? 'dispatcher' : 'member'} to ${g.name}`}
                    disabled={others.length === 0}
                    onChange={(e) => {
                      const id = e.target.value
                      if (id) patch(g.id, (x) => void x.memberIds.push(id))
                    }}
                  >
                    <option value="">{others.length ? (isDist ? 'Add dispatcher…' : 'Add member…') : 'Everyone is a member'}</option>
                    {others.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} — {u.title}
                      </option>
                    ))}
                  </Select>
                </div>

                {isDist ? dispatchSection : worksSection}
                {isDist ? worksCount > 0 && worksSection : dispatches.length > 0 && dispatchSection}
              </div>
            </Card>
          )
        })}
      </div>
      {creating && <GroupCreateModal onClose={() => setCreating(false)} />}
    </div>
  )
}
