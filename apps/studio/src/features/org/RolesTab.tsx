import { Eye, Layers, type LucideIcon, PencilRuler, ShieldCheck, Users, Workflow as WorkflowIcon } from 'lucide-react'
import { Fragment } from 'react'
import { Avatar, Badge, Card, cx, EmptyState, Toggle } from '../../components/ui'
import type { App, Audience, Group, Id, OrgRole, User } from '@modus-bpm/core/model/types'
import { useApp, useDesign } from '../../store/design'
import { useUi } from '../../store/ui'
import { openStep, pathToSubflow } from '../integrations/steps'

const ROLES: Array<{ role: OrgRole; label: string; text: string; icon: LucideIcon; tone: string }> = [
  { role: 'admin', label: 'Administrator', text: 'Everything, including every item and the design.', icon: ShieldCheck, tone: 'bg-rose-50 text-rose-600' },
  { role: 'designer', label: 'Designer', text: 'Can change designs in the studio.', icon: PencilRuler, tone: 'bg-brand-50 text-brand-600' },
  { role: 'auditor', label: 'Auditor', text: 'Can see every item and its history, but change nothing.', icon: Eye, tone: 'bg-sky-50 text-sky-600' },
]

/** Organization-wide roles, and who supervises each process and step of the open application. */
export function RolesTab() {
  const users = useDesign((s) => s.design.users)
  const groups = useDesign((s) => s.design.groups)
  const app = useApp(useUi((s) => s.appId))
  const admins = users.filter((u) => u.roles?.includes('admin')).length

  const setRole = (u: User, role: OrgRole, on: boolean) => {
    if (!on && role === 'admin' && admins <= 1 && u.roles?.includes('admin')) {
      useUi.getState().toast(`${u.name} is the only administrator. Make someone else an administrator first.`, 'warn')
      return
    }
    useDesign.getState().update((d) => {
      const x = d.users.find((y) => y.id === u.id)
      if (!x) return
      const next = on ? [...new Set([...(x.roles ?? []), role])] : (x.roles ?? []).filter((r) => r !== role)
      x.roles = next.length ? next : undefined
    })
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-3 text-xs text-slate-600">Everyone can work the steps their groups are given. Roles add rights on top, across every application.</p>
        <div className="mb-3 grid gap-2 sm:grid-cols-3">
          {ROLES.map((r) => (
            <div key={r.role} className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-xs">
              <span className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', r.tone)}>
                <r.icon size={15} />
              </span>
              <div className="min-w-0 leading-tight">
                <div className="text-sm font-medium text-slate-800">{r.label}</div>
                <div className="mt-0.5 text-[11.5px] text-slate-500">{r.text}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-xs">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                <th className="px-3 py-2">Person</th>
                {ROLES.map((r) => (
                  <th key={r.role} className="w-[140px] px-3 py-2" title={r.text}>
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <Avatar name={u.name} color={u.color} size={26} />
                      <div className="min-w-0 leading-tight">
                        <div className="truncate font-medium text-slate-800">{u.name}</div>
                        <div className="truncate text-[11px] text-slate-500">{u.title}</div>
                      </div>
                    </div>
                  </td>
                  {ROLES.map((r) => (
                    <td key={r.role} className="px-3 py-1.5">
                      <Toggle checked={!!u.roles?.includes(r.role)} onChange={(on) => setRole(u, r.role, on)} label={<span className="sr-only">{`${r.label}: ${u.name}`}</span>} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {app && <WhoSupervises app={app} users={users} groups={groups} />}
    </div>
  )
}

/** Open a workflow in the designer, drilling down through the processes that run it when it is a subflow. */
function openWorkflow(app: App, wfId: Id) {
  const ui = useUi.getState()
  ui.setView('workflow')
  const path = app.workflows.find((w) => w.id === wfId)?.kind === 'subflow' ? pathToSubflow(app, wfId) : undefined
  if (!path) return ui.setWorkflow(wfId)
  ui.setWorkflow(path[0])
  for (const id of path.slice(1)) ui.drillInto(id)
}

function WhoSupervises({ app, users, groups }: { app: App; users: User[]; groups: Group[] }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-200 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-slate-900">Who supervises what in {app.name}</h2>
        <p className="text-[11px] text-slate-500">
          Supervisors can reassign, release on someone’s behalf, change priority and expedite. Administrators can supervise everything. Set them on each workflow and people step.
        </p>
      </div>
      {app.workflows.length === 0 ? (
        <EmptyState title="No workflows yet">Add a workflow to this application to give it supervisors.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                <th className="px-4 py-2">Process or step</th>
                <th className="px-3 py-2">Supervisors</th>
                <th className="px-3 py-2">Work group</th>
              </tr>
            </thead>
            <tbody>
              {app.workflows.map((wf) => {
                const steps = wf.nodes.flatMap((n) => (n.type === 'user' ? [n] : []))
                const subflow = wf.kind === 'subflow'
                return (
                  <Fragment key={wf.id}>
                    <tr className="border-t border-slate-200 bg-slate-50/70 first:border-t-0">
                      <td className="px-4 py-2 align-top">
                        <button type="button" onClick={() => openWorkflow(app, wf.id)} className="flex items-center gap-1.5 text-left font-semibold text-slate-800 hover:text-brand-700">
                          {subflow ? <Layers size={14} className="shrink-0 text-teal-600" /> : <WorkflowIcon size={14} className="shrink-0 text-brand-600" />}
                          {wf.name}
                        </button>
                        {subflow && <span className="ml-5 text-[11px] text-slate-500">Subflow</span>}
                      </td>
                      <td className="px-3 py-2 align-top" colSpan={2}>
                        <AudienceChips audience={wf.supervisors} users={users} groups={groups} empty="No process supervisors — only administrators and group supervisors can step in." />
                      </td>
                    </tr>
                    {steps.map((n) => {
                      const group = groups.find((g) => g.id === n.data.groupId)
                      const sup = users.find((u) => u.id === group?.supervisorId)
                      return (
                        <tr key={n.id} className="border-t border-slate-100">
                          <td className="py-1.5 pr-3 pl-9 align-top">
                            <button type="button" onClick={() => openStep(app.id, wf.id, n.id)} className="text-left text-slate-700 hover:text-brand-700 hover:underline">
                              {n.data.label}
                            </button>
                          </td>
                          <td className="px-3 py-1.5 align-top">
                            <AudienceChips audience={n.data.supervisors} users={users} groups={groups} empty="No task supervisors" />
                          </td>
                          <td className="px-3 py-1.5 align-top text-xs">
                            {group ? (
                              <>
                                <div className="text-slate-700">{group.name}</div>
                                {sup ? <div className="text-slate-500">Group supervisor: {sup.name}</div> : <div className="text-slate-400">No group supervisor</div>}
                              </>
                            ) : (
                              <span className="text-slate-400">{n.data.distribution === 'direct' ? 'Goes to one person' : 'No work group'}</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

/** Read-only chips for an audience: people with avatars, groups with their size. */
function AudienceChips({ audience, users, groups, empty }: { audience?: Audience; users: User[]; groups: Group[]; empty: string }) {
  const people = (audience?.userIds ?? []).map((id) => users.find((u) => u.id === id)).filter((u): u is User => !!u)
  const teams = (audience?.groupIds ?? []).map((id) => groups.find((g) => g.id === id)).filter((g): g is Group => !!g)
  if (!people.length && !teams.length) return <span className="text-xs text-slate-400">{empty}</span>
  return (
    <div className="flex flex-wrap gap-1">
      {teams.map((g) => (
        <Badge key={g.id} tone="violet" className="max-w-[220px]">
          <Users size={11} className="shrink-0" />
          <span className="truncate">
            {g.name} ({g.memberIds.length})
          </span>
        </Badge>
      ))}
      {people.map((u) => (
        <span key={u.id} className="inline-flex items-center gap-1 rounded bg-slate-100 py-0.5 pr-1.5 pl-0.5 text-[11px] font-medium text-slate-700">
          <Avatar name={u.name} color={u.color} size={16} />
          {u.name}
        </span>
      ))}
    </div>
  )
}
