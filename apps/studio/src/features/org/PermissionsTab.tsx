import { ArrowUpRight, ShieldCheck } from 'lucide-react'
import { DISTRIBUTION, TypeIcon } from '../../components/icons'
import { Badge, Card, cx, EmptyState, SectionTitle } from '../../components/ui'
import type { Id, TypePermission } from '@throughline/core/model/types'
import { useApp, useDesign } from '../../store/design'
import { useUi } from '../../store/ui'
import { goToStep } from './usage'

const COLUMNS: Array<{ key: keyof TypePermission; label: string; help: string }> = [
  { key: 'create', label: 'Create', help: 'Create new objects of this type (e.g. upload an invoice)' },
  { key: 'read', label: 'Read', help: 'Open and search objects of this type' },
  { key: 'update', label: 'Update', help: 'Change field values outside of a workflow step' },
  { key: 'delete', label: 'Delete', help: 'Delete objects of this type' },
]

const NONE: TypePermission = { create: false, read: false, update: false, delete: false }

export function PermissionsTab() {
  const appId = useUi((s) => s.appId)
  const app = useApp(appId)
  const groups = useDesign((s) => s.design.groups)
  const users = useDesign((s) => s.design.users)
  const updateType = useDesign((s) => s.updateType)
  if (!app) return null

  const setPermission = (typeId: Id, groupId: Id, key: keyof TypePermission, on: boolean) =>
    updateType(appId, typeId, (t) => {
      const p: TypePermission = { ...NONE, ...t.permissions[groupId] }
      p[key] = on
      // Any write implies read; removing read removes everything.
      if (on && key !== 'read') p.read = true
      if (!on && key === 'read') Object.assign(p, NONE)
      if (!p.create && !p.read && !p.update && !p.delete) delete t.permissions[groupId]
      else t.permissions[groupId] = p
    })

  const steps = app.workflows.flatMap((wf) => wf.nodes.filter((n) => n.type === 'user').map((node) => ({ wf, node })))

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2.5 rounded-lg border border-brand-100 bg-brand-50/60 px-3.5 py-2.5 text-xs text-brand-900">
        <ShieldCheck size={16} className="mt-px shrink-0 text-brand-600" />
        <p>
          Security is set per object type and group. Every object is searchable and every change to it is recorded in its audit history automatically, so there is nothing extra
          to configure. Granting Create, Update or Delete also grants Read.
        </p>
      </div>

      {app.objectTypes.map((t) => {
        const granted = groups.filter((g) => t.permissions[g.id]).length
        return (
          <Card key={t.id}>
            <div className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-md text-white" style={{ background: t.color }}>
                <TypeIcon name={t.icon} size={15} />
              </span>
              <div className="leading-tight">
                <div className="text-sm font-semibold text-slate-900">{t.pluralName}</div>
                <div className="text-xs text-slate-500">
                  {granted} of {groups.length} groups have access
                </div>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                  <th className="px-4 py-2">Group</th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className="w-24 px-2 py-2 text-center" title={c.help}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {groups.map((g) => {
                  const p = t.permissions[g.id]
                  return (
                    <tr key={g.id} className={cx(!p && 'text-slate-400')}>
                      <td className="px-4 py-1.5">
                        <span className={cx('font-medium', p ? 'text-slate-800' : 'text-slate-500')}>{g.name}</span>
                        <span className="ml-2 text-xs text-slate-400">{g.memberIds.length} members</span>
                      </td>
                      {COLUMNS.map((c) => (
                        <td key={c.key} className="px-2 py-1.5 text-center">
                          <input
                            type="checkbox"
                            aria-label={`${g.name} can ${c.label.toLowerCase()} ${t.pluralName}`}
                            className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-brand-600"
                            checked={!!p?.[c.key]}
                            onChange={(e) => setPermission(t.id, g.id, c.key, e.target.checked)}
                          />
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>
        )
      })}

      <div>
        <SectionTitle>Who works each step</SectionTitle>
        {steps.length === 0 ? (
          <Card>
            <EmptyState title="No user steps yet">Add a user step to a workflow and assign it to a group.</EmptyState>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                  <th className="px-4 py-2">Step</th>
                  <th className="px-3 py-2">Workflow</th>
                  <th className="px-3 py-2">Distribution</th>
                  <th className="px-3 py-2">Group</th>
                  <th className="px-3 py-2">Assignee / supervisor</th>
                  <th className="w-px px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {steps.map(({ wf, node }) => {
                  const d = node.data
                  const dist = DISTRIBUTION[d.distribution]
                  const Icon = dist.icon
                  const group = groups.find((g) => g.id === d.groupId)
                  const supId = d.supervisorId ?? group?.supervisorId
                  const person =
                    d.distribution === 'direct'
                      ? users.find((u) => u.id === d.userId)?.name
                      : d.distribution === 'manager'
                        ? users.find((u) => u.id === supId)?.name
                        : undefined
                  return (
                    <tr key={node.id} onClick={() => goToStep(app.id, wf.id, node.id)} className="group cursor-pointer hover:bg-brand-50/40">
                      <td className="px-4 py-2 font-medium text-slate-800">{d.label}</td>
                      <td className="px-3 py-2 text-slate-600">{wf.name}</td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1.5 text-slate-700">
                          <Icon size={14} className="text-slate-500" /> {dist.label}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {group ? (
                          <span className="text-slate-700">
                            {group.name} <span className="text-xs text-slate-400">({group.memberIds.length})</span>
                          </span>
                        ) : (
                          <Badge tone="red">No group</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {person ? (
                          <>
                            {person}
                            {d.distribution === 'manager' && <span className="ml-1 text-xs text-slate-400">(supervisor)</span>}
                          </>
                        ) : d.distribution === 'direct' || d.distribution === 'manager' ? (
                          <Badge tone="red">Not set</Badge>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <ArrowUpRight size={14} className="text-slate-300 group-hover:text-brand-600" />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  )
}
