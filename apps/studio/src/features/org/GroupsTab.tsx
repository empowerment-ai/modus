import { ArrowUpRight, Plus, Trash2, Users, X } from 'lucide-react'
import { DISTRIBUTION } from '../../components/icons'
import { Avatar, Badge, Button, Card, cx, Field, IconButton, SectionTitle, Select } from '../../components/ui'
import type { Group, Id } from '@throughline/core/model/types'
import { uid } from '@throughline/core/model/util'
import { useDesign } from '../../store/design'
import { useUi } from '../../store/ui'
import { InlineInput } from './InlineInput'
import { allUserSteps, goToStep, groupDeleteBlockers } from './usage'

export function GroupsTab() {
  const design = useDesign((s) => s.design)
  const update = useDesign((s) => s.update)
  const toast = useUi((s) => s.toast)
  const appId = useUi((s) => s.appId)
  const steps = allUserSteps(design)

  const patch = (id: Id, fn: (g: Group) => void) =>
    update((d) => {
      const g = d.groups.find((x) => x.id === id)
      if (g) fn(g)
    })

  const addGroup = () => {
    update((d) => {
      d.groups.push({ id: uid('g'), name: 'New group', memberIds: [] })
    })
    toast('Group added at the end of the list.', 'success')
  }

  const removeGroup = (g: Group) => {
    const reasons = groupDeleteBlockers(useDesign.getState().design, g.id)
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

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <p className="text-xs text-slate-500">Groups decide who can work a step. A step’s distribution method decides how its work is shared among the members.</p>
        <div className="flex-1" />
        <Button variant="primary" icon={<Plus size={14} />} onClick={addGroup}>
          New group
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {design.groups.map((g) => {
          const members = g.memberIds.map((id) => design.users.find((u) => u.id === id)).filter((u) => !!u)
          const others = design.users.filter((u) => !g.memberIds.includes(u.id))
          const usedBy = steps.filter((s) => s.node.data.groupId === g.id)
          const out = members.filter((m) => !m.available).length
          return (
            <Card key={g.id} className="flex flex-col">
              <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-600">
                  <Users size={15} />
                </span>
                <InlineInput aria-label="Group name" className="text-sm font-semibold" value={g.name} onChange={(e) => patch(g.id, (x) => void (x.name = e.target.value))} />
                <Badge>
                  {members.length} member{members.length === 1 ? '' : 's'}
                </Badge>
                {out > 0 && <Badge tone="amber">{out} out</Badge>}
                <IconButton label={`Delete ${g.name}`} onClick={() => removeGroup(g)}>
                  <Trash2 size={14} />
                </IconButton>
              </div>
              <div className="flex-1 space-y-4 p-4">
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

                <div>
                  <SectionTitle>Members</SectionTitle>
                  {members.length === 0 ? (
                    <p className="mb-2 text-xs text-slate-400">No members yet.</p>
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
                    aria-label={`Add a member to ${g.name}`}
                    disabled={others.length === 0}
                    onChange={(e) => {
                      const id = e.target.value
                      if (id) patch(g.id, (x) => void x.memberIds.push(id))
                    }}
                  >
                    <option value="">{others.length ? 'Add member…' : 'Everyone is a member'}</option>
                    {others.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} — {u.title}
                      </option>
                    ))}
                  </Select>
                </div>

                <div>
                  <SectionTitle>Used by</SectionTitle>
                  {usedBy.length === 0 ? (
                    <p className="text-xs text-slate-400">Not assigned to any workflow step.</p>
                  ) : (
                    <ul className="space-y-1">
                      {usedBy.map(({ app, wf, node }) => {
                        const dist = DISTRIBUTION[node.data.distribution]
                        const Icon = dist.icon
                        return (
                          <li key={node.id}>
                            <button
                              type="button"
                              onClick={() => goToStep(app.id, wf.id, node.id)}
                              className="group flex w-full items-center gap-2 rounded-md border border-slate-200 px-2 py-1.5 text-left text-xs hover:border-brand-300 hover:bg-brand-50/50"
                              title={app.id === appId ? 'Open this step in the workflow designer' : `Switch to ${app.name} and open this step`}
                            >
                              <Icon size={14} className="shrink-0 text-slate-500" />
                              <span className="min-w-0 flex-1 truncate">
                                <span className="text-slate-500">{app.name} › </span>
                                <span className="font-medium text-slate-800">{node.data.label}</span>
                              </span>
                              <Badge tone="brand">{dist.short}</Badge>
                              <ArrowUpRight size={13} className="shrink-0 text-slate-300 group-hover:text-brand-600" />
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
