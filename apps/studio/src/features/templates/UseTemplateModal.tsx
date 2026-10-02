import { ArrowRight, TriangleAlert } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { FIELD_TYPE_LABEL } from '@throughline/core/model/format'
import { compatible, type FieldBinding, instantiateTemplate, suggestBinding } from '@throughline/core/model/templates'
import type { Group, Template, User, Workflow } from '@throughline/core/model/types'
import { plural } from '@throughline/core/model/util'
import { FIELD_ICONS } from '../../components/icons'
import { Badge, Button, cx, Field, Input, Modal, Select } from '../../components/ui'
import { useApp, useDesign } from '../../store/design'
import { useUi } from '../../store/ui'
import { TemplatePreview } from './TemplatePreview'

type Kind = NonNullable<Workflow['kind']>

/**
 * Steps that come in without anyone to do them: people steps with no group (or a
 * group this organization doesn't have), and by-hand fallbacks with no group.
 */
export function stepsNeedingGroup(wf: Pick<Workflow, 'nodes'>, groups: Group[], users: User[]): number {
  const group = (id?: string) => !!id && groups.some((g) => g.id === id)
  return wf.nodes.filter((n) => {
    if (n.type === 'user') return !group(n.data.groupId) && !(n.data.distribution === 'direct' && users.some((u) => u.id === n.data.userId))
    if (n.type === 'auto') return n.data.onFailure === 'manual' && !group(n.data.fallbackGroupId)
    return false
  }).length
}

/** Stamp a template into the open application: pick the object type, map its fields, choose subflow or process. */
export function UseTemplateModal({ template, onClose }: { template: Template; onClose: () => void }) {
  const appId = useUi((s) => s.appId)
  const app = useApp(appId)
  const groups = useDesign((s) => s.design.groups)
  const users = useDesign((s) => s.design.users)
  const [typeId, setTypeId] = useState(app?.objectTypes[0]?.id ?? '')
  const type = app?.objectTypes.find((t) => t.id === typeId)
  const [binding, setBinding] = useState<FieldBinding>(() => suggestBinding(template, type?.fields ?? []))
  const [kind, setKind] = useState<Kind>('subflow')
  const [name, setName] = useState(template.name)

  if (!app) return null

  const changeType = (id: string) => {
    setTypeId(id)
    setBinding(suggestBinding(template, app.objectTypes.find((t) => t.id === id)?.fields ?? []))
  }

  const newFields = template.fields.filter((f) => (binding[f.id] ?? 'new') === 'new')
  const mapped = Object.values(binding).filter((v) => v !== 'new')
  const doubled = new Set(mapped.filter((v, i) => mapped.indexOf(v) !== i))
  const newLists = (template.lists ?? []).filter((l) => !app.lists.some((x) => x.id === l.id || x.name === l.name))
  const needGroup = stepsNeedingGroup(template, groups, users)
  const steps = template.nodes.filter((n) => n.type !== 'start' && n.type !== 'end').length
  const finalName = name.trim() || template.name
  const nameTaken = app.workflows.some((w) => w.name.trim().toLowerCase() === finalName.toLowerCase())

  const use = () => {
    if (!type) return
    const res = instantiateTemplate(app, template, { objectTypeId: type.id, name: finalName, binding, groups, users, kind })
    useDesign.getState().update((d) => {
      const a = d.apps.find((x) => x.id === app.id)
      const t = a?.objectTypes.find((x) => x.id === type.id)
      if (!a || !t) return
      a.lists.push(...res.newLists)
      t.fields.push(...res.newFields)
      a.workflows.push(res.workflow)
    })
    const ui = useUi.getState()
    ui.setView('workflow')
    ui.setWorkflow(res.workflow.id)
    const parts = [`Added “${finalName}” as ${kind === 'subflow' ? 'a subflow' : 'a new process workflow'}.`]
    if (res.newFields.length) parts.push(`${plural(res.newFields.length, 'new field')}: ${res.newFields.map((f) => f.label).join(', ')}.`)
    if (res.newLists.length) parts.push(`${plural(res.newLists.length, 'new list')}: ${res.newLists.map((l) => l.name).join(', ')}.`)
    const need = stepsNeedingGroup(res.workflow, groups, users)
    if (need) parts.push(need === 1 ? 'Pick a group for the step that needs one.' : `Pick groups for the ${need} steps that need one.`)
    ui.toast(parts.join(' '), 'success')
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      width={760}
      title={`Use “${template.name}”`}
      subtitle={`Adds a copy to ${app.name}. The template itself stays as it is.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={use} disabled={!type}>
            Add to {app.name}
          </Button>
        </>
      }
    >
      {app.objectTypes.length === 0 ? (
        <p className="rounded-md bg-amber-50 px-3 py-2.5 text-sm text-amber-800">{app.name} has no object types yet. Create one under Object Types first; the workflow needs something to carry.</p>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-[1fr_200px] gap-4">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Object type" hint="What the steps work on.">
                  <Select value={typeId} onChange={(e) => changeType(e.target.value)}>
                    {app.objectTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Name" hint={nameTaken ? <span className="text-amber-700">{app.name} already has a workflow with this name.</span> : undefined}>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
              </div>
              <div>
                <span className="mb-1 block text-xs font-medium text-slate-600">Add it as</span>
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Add it as">
                  <KindOption
                    on={kind === 'subflow'}
                    onClick={() => setKind('subflow')}
                    title="A subflow"
                    body="Runs inside a Subflow step of another workflow. Paths leave that step by how the subflow ends."
                  />
                  <KindOption
                    on={kind === 'process'}
                    onClick={() => setKind('process')}
                    title="A new process workflow"
                    body={`New ${type?.pluralName.toLowerCase() ?? 'items'} can start here. Simulated arrivals start at 4 an hour.`}
                  />
                </div>
              </div>
            </div>
            <div className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-slate-50/70">
              <TemplatePreview nodes={template.nodes} edges={template.edges} className="h-full min-h-[120px] w-full flex-1 p-2" />
              <div className="border-t border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-500">{plural(steps, 'step')}</div>
            </div>
          </div>

          <div>
            <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Fields</h3>
            <p className="mb-2 text-[11.5px] leading-snug text-slate-500">
              The template’s rules, forms and actions use these fields. Point each one at a field {type ? `${type.name} already has` : 'you already have'}, or let it create a new one.
            </p>
            {template.fields.length === 0 ? (
              <p className="rounded-md border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500">This template doesn’t use any fields.</p>
            ) : (
              <div className="overflow-hidden rounded-md border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-[10.5px] font-semibold tracking-wide text-slate-500 uppercase">
                      <th className="py-1.5 pr-2 pl-3 font-semibold">Template field</th>
                      <th className="w-6" />
                      <th className="px-2 py-1.5 font-semibold">Field on {type?.name ?? 'the object type'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {template.fields.map((f) => {
                      const Icon = FIELD_ICONS[f.type]
                      const options = (type?.fields ?? []).filter((t) => compatible(f, t))
                      const value = binding[f.id] ?? 'new'
                      const list = f.listId ? template.lists?.find((l) => l.id === f.listId) : undefined
                      return (
                        <tr key={f.id} className="border-b border-slate-100 last:border-b-0">
                          <td className="py-1.5 pr-2 pl-3">
                            <div className="flex items-center gap-2">
                              <Icon size={14} className="shrink-0 text-slate-400" />
                              <span className="font-medium text-slate-800">{f.label}</span>
                              <span className="text-slate-400">{FIELD_TYPE_LABEL[f.type]}</span>
                              {f.required && <Badge>Required</Badge>}
                            </div>
                          </td>
                          <td className="text-slate-300">
                            <ArrowRight size={14} />
                          </td>
                          <td className="px-2 py-1.5">
                            <Select
                              aria-label={`Field for ${f.label}`}
                              value={value}
                              onChange={(e) => setBinding((b) => ({ ...b, [f.id]: e.target.value }))}
                              className={cx(value === 'new' && 'text-brand-700')}
                            >
                              <option value="new">Create new field “{f.label}”</option>
                              {options.length > 0 && (
                                <optgroup label="Existing fields">
                                  {options.map((t) => (
                                    <option key={t.id} value={t.id}>
                                      {t.label} ({FIELD_TYPE_LABEL[t.type]})
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                            </Select>
                            {value !== 'new' && doubled.has(value) && <p className="mt-1 text-[11px] text-amber-700">Another template field also uses this field.</p>}
                            {value === 'new' && list && newLists.includes(list) && <p className="mt-1 text-[11px] text-slate-500">Also adds the “{list.name}” list.</p>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-2.5">
            <h3 className="mb-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">What will be added to {app.name}</h3>
            <ul className="space-y-1 text-xs text-slate-700">
              <Line>
                {kind === 'subflow' ? 'A subflow' : 'A process workflow'} named <b className="font-semibold">“{finalName}”</b> for {type?.pluralName.toLowerCase() ?? 'items'}, with{' '}
                {plural(steps, 'step')}.
              </Line>
              <Line>
                {newFields.length ? (
                  <>
                    {plural(newFields.length, 'new field')} on {type?.name}: {newFields.map((f) => f.label).join(', ')}.
                  </>
                ) : (
                  'No new fields: every template field uses one you already have.'
                )}
              </Line>
              {newLists.length > 0 && (
                <Line>
                  {plural(newLists.length, 'new list')}: {newLists.map((l) => l.name).join(', ')}.
                </Line>
              )}
              {needGroup > 0 && (
                <Line warn>{needGroup === 1 ? 'One step needs' : `${needGroup} steps need`} a group picked before work can flow. The template leaves that to you so it fits your organization.</Line>
              )}
              {kind === 'subflow' && <Line>To run it, add a Subflow step to a workflow and point it at “{finalName}”.</Line>}
            </ul>
          </div>
        </div>
      )}
    </Modal>
  )
}

function KindOption({ on, onClick, title, body }: { on: boolean; onClick: () => void; title: string; body: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={cx('rounded-lg border px-3 py-2 text-left transition-colors', on ? 'border-brand-500 bg-brand-50/40 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300')}
    >
      <span className="block text-xs font-semibold text-slate-800">{title}</span>
      <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{body}</span>
    </button>
  )
}

function Line({ children, warn }: { children: ReactNode; warn?: boolean }) {
  return (
    <li className={cx('flex items-start gap-1.5', warn && 'text-amber-800')}>
      {warn ? <TriangleAlert size={13} className="mt-px shrink-0" /> : <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-slate-400" />}
      <span>{children}</span>
    </li>
  )
}
