import { ArrowLeft, ArrowRight, Layers, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { FIELD_ICONS } from '../../components/icons'
import { Badge, Button, Field, Input, Modal, Select, Textarea } from '../../components/ui'
import { ADMIN } from '@modus-bpm/core'
import { FIELD_TYPE_LABEL } from '@modus-bpm/core/model/format'
import { compatible, type FieldBinding, instantiateTemplate, suggestBinding, templateFromWorkflow } from '@modus-bpm/core/model/templates'
import type { App, Id, Template, WfNode, Workflow, XY } from '@modus-bpm/core/model/types'
import { uid } from '@modus-bpm/core/model/util'
import { useDesign } from '../../store/design'
import { useUi } from '../../store/ui'

const STEP_TYPES = new Set(['user', 'auto', 'subflow'])

function stepCount(nodes: WfNode[]): number {
  return nodes.filter((n) => STEP_TYPES.has(n.type)).length
}

/** "Two-level approval", or "Two-level approval 2" when the app already has one. */
function freshName(app: App, base: string): string {
  const taken = new Set(app.workflows.map((w) => w.name.toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  let i = 2
  while (taken.has(`${base} ${i}`.toLowerCase())) i++
  return `${base} ${i}`
}

/**
 * Add a step that runs a template: pick one from the library, map the fields it
 * uses onto this workflow's object type, and it is copied in as a new subflow.
 */
export function InsertTemplateModal({ app, wf, at, onClose }: { app: App; wf: Workflow; at: () => XY; onClose: () => void }) {
  const templates = useDesign((s) => s.design.templates)
  const groups = useDesign((s) => s.design.groups)
  const users = useDesign((s) => s.design.users)
  const type = app.objectTypes.find((t) => t.id === wf.objectTypeId)
  const [query, setQuery] = useState('')
  const [chosenId, setChosenId] = useState<Id | null>(null)
  const [binding, setBinding] = useState<FieldBinding>({})
  const [name, setName] = useState('')
  const chosen = templates.find((t) => t.id === chosenId)

  const byCategory = useMemo(() => {
    const q = query.trim().toLowerCase()
    const hits = templates.filter((t) => !q || [t.name, t.description, t.category, ...(t.tags ?? [])].some((s) => s.toLowerCase().includes(q)))
    const cats = new Map<string, Template[]>()
    for (const t of hits) cats.set(t.category, [...(cats.get(t.category) ?? []), t])
    return [...cats.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [templates, query])

  const choose = (t: Template) => {
    setChosenId(t.id)
    setBinding(suggestBinding(t, type?.fields ?? []))
    setName(freshName(app, t.name))
  }

  const insert = () => {
    if (!chosen || !type) return
    const { workflow, newFields, newLists } = instantiateTemplate(app, chosen, { objectTypeId: type.id, name: name.trim() || chosen.name, binding, groups, users })
    // The core doesn't carry "person on the item" assignments over yet: point them at the matched fields.
    const fieldFor = new Map<Id, Id>()
    let next = 0
    for (const f of chosen.fields) {
      const b = binding[f.id]
      fieldFor.set(f.id, b && b !== 'new' && type.fields.some((x) => x.id === b) ? b : newFields[next++]!.id)
    }
    for (const n of workflow.nodes) if (n.type === 'user' && n.data.assigneeFieldId) n.data.assigneeFieldId = fieldFor.get(n.data.assigneeFieldId) ?? n.data.assigneeFieldId
    const p = at()
    const node: WfNode = {
      id: uid('n'),
      type: 'subflow',
      position: { x: Math.round(p.x - 129), y: Math.round(p.y - 40) },
      data: { label: chosen.name, description: chosen.description, workflowId: workflow.id },
    }
    useDesign.getState().update((d) => {
      const a = d.apps.find((x) => x.id === app.id)
      if (!a) return
      a.lists.push(...newLists)
      a.objectTypes.find((t) => t.id === type.id)?.fields.push(...newFields)
      a.workflows.push(workflow)
      a.workflows.find((w) => w.id === wf.id)?.nodes.push(node)
    })
    useUi.getState().select({ kind: 'node', id: node.id })
    const added = newFields.length ? ` and ${newFields.length} new field${newFields.length === 1 ? '' : 's'} on ${type.name}` : ''
    useUi.getState().toast(`Added “${workflow.name}” as a subflow step${added}.`, 'success')
    onClose()
  }

  const newCount = chosen ? chosen.fields.filter((f) => binding[f.id] === 'new').length : 0

  return (
    <Modal
      open
      onClose={onClose}
      width={620}
      title={chosen ? `Use “${chosen.name}”` : 'Add a step from a template'}
      subtitle={
        chosen
          ? `Match the fields the template uses to fields of ${type?.name ?? 'this object type'}. Anything you don’t match is added as a new field.`
          : 'Templates are reusable subflows. The one you pick is copied into this application and runs inside a new step on the map.'
      }
      footer={
        chosen ? (
          <>
            <Button variant="ghost" icon={<ArrowLeft size={14} />} onClick={() => setChosenId(null)} className="mr-auto">
              All templates
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!type} onClick={insert}>
              Add subflow step
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        )
      }
    >
      {!chosen ? (
        <div className="space-y-4">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" />
            <Input autoFocus value={query} placeholder="Search by name, category or tag" className="pl-8" onChange={(e) => setQuery(e.target.value)} />
          </div>
          {byCategory.length === 0 && <p className="py-6 text-center text-sm text-slate-500">No templates match “{query}”.</p>}
          {byCategory.map(([category, list]) => (
            <section key={category}>
              <h4 className="mb-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{category}</h4>
              <ul className="space-y-1.5">
                {list.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => choose(t)}
                      className="flex w-full items-start gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-left hover:border-teal-300 hover:bg-teal-50/40"
                    >
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
                        <Layers size={16} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900">{t.name}</span>
                          {t.builtIn ? <Badge>Built in</Badge> : t.createdBy ? <Badge tone="violet">By {t.createdBy}</Badge> : null}
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-xs text-slate-600">{t.description}</span>
                        <span className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
                          {stepCount(t.nodes)} steps · {t.fields.length} field{t.fields.length === 1 ? '' : 's'}
                          {(t.tags ?? []).map((tag) => (
                            <span key={tag} className="rounded bg-slate-100 px-1.5 py-px text-slate-600">
                              {tag}
                            </span>
                          ))}
                        </span>
                      </span>
                      <ArrowRight size={15} className="mt-2 shrink-0 text-slate-300" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Name of the new subflow" hint="You can open and change it like any other workflow; the template itself stays as it is.">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          {chosen.fields.length === 0 ? (
            <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">This template doesn’t use any fields, so there is nothing to match.</p>
          ) : (
            <div>
              <div className="mb-1.5 grid grid-cols-[1fr_16px_1fr] items-center gap-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                <span>Template field</span>
                <span />
                <span>{type?.name ?? 'Object'} field</span>
              </div>
              <ul className="space-y-1.5">
                {chosen.fields.map((f) => {
                  const Icon = FIELD_ICONS[f.type]
                  const options = (type?.fields ?? []).filter((x) => compatible(f, x))
                  return (
                    <li key={f.id} className="grid grid-cols-[1fr_16px_1fr] items-center gap-2">
                      <span className="flex min-w-0 items-center gap-2 rounded-md bg-slate-50 px-2.5 py-1.5">
                        <Icon size={14} className="shrink-0 text-slate-400" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-slate-800">{f.label}</span>
                          <span className="block text-[11px] text-slate-500">{FIELD_TYPE_LABEL[f.type]}</span>
                        </span>
                      </span>
                      <ArrowRight size={14} className="text-slate-300" />
                      <Select value={binding[f.id] ?? 'new'} onChange={(e) => setBinding((b) => ({ ...b, [f.id]: e.target.value }))} aria-label={`Field for ${f.label}`}>
                        <option value="new">Create new field “{f.label}”</option>
                        {options.length > 0 && (
                          <optgroup label={`Use a ${type?.name ?? ''} field`}>
                            {options.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.label} ({FIELD_TYPE_LABEL[x.type]})
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </Select>
                    </li>
                  )
                })}
              </ul>
              <p className="mt-3 text-xs text-slate-500">
                {newCount ? `${newCount} new field${newCount === 1 ? '' : 's'} will be added to ${type?.name ?? 'the object type'}.` : `Every field maps onto an existing ${type?.name ?? ''} field.`}{' '}
                Groups and people the template names are kept when they exist here; otherwise pick them on each step afterwards.
              </p>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

/** Save the open workflow into the organization's template library. */
export function SaveTemplateModal({ app, wf, onClose }: { app: App; wf: Workflow; onClose: () => void }) {
  const templates = useDesign((s) => s.design.templates)
  const [name, setName] = useState(wf.name)
  const [description, setDescription] = useState(wf.description ?? '')
  const [category, setCategory] = useState('My templates')
  const [tags, setTags] = useState('')
  const categories = useMemo(() => [...new Set(templates.map((t) => t.category))].sort(), [templates])
  const preview = useMemo(() => templateFromWorkflow(app, wf, { name: '', description: '', category: '' }), [app, wf])
  const nested = wf.nodes.filter((n) => n.type === 'subflow').length

  const save = () => {
    const tpl = templateFromWorkflow(app, wf, {
      name: name.trim() || wf.name,
      description: description.trim(),
      category: category.trim() || 'My templates',
      tags: tags
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      createdBy: ADMIN,
    })
    // Person fields that pick who gets a step travel with the template too.
    const type = app.objectTypes.find((t) => t.id === wf.objectTypeId)
    for (const n of tpl.nodes) {
      const fid = n.type === 'user' ? n.data.assigneeFieldId : undefined
      const field = fid && !tpl.fields.some((f) => f.id === fid) ? type?.fields.find((f) => f.id === fid) : undefined
      if (field) tpl.fields.push(structuredClone(field))
    }
    useDesign.getState().update((d) => {
      d.templates.push(tpl)
    })
    useUi.getState().toast('Saved to the template library.', 'success')
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      width={500}
      title="Save as template"
      subtitle="Anyone building a workflow can then add a copy of this one as a subflow step."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name.trim()} onClick={save}>
            Save template
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name" required>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description" hint="What it does and when to use it.">
          <Textarea value={description} className="min-h-[64px]" onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <Input list="modus-template-categories" value={category} onChange={(e) => setCategory(e.target.value)} />
            <datalist id="modus-template-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Tags" hint="Separate with commas.">
            <Input value={tags} placeholder="approval, finance" onChange={(e) => setTags(e.target.value)} />
          </Field>
        </div>
        <p className="rounded-md bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
          Includes {stepCount(preview.nodes)} step{stepCount(preview.nodes) === 1 ? '' : 's'} and the {preview.fields.length} field{preview.fields.length === 1 ? '' : 's'} they use
          {preview.lists?.length ? `, with ${preview.lists.length} list${preview.lists.length === 1 ? '' : 's'}` : ''}.
          {nested > 0 && ` Subflow steps inside it keep their names but need to be pointed at a subflow again once the template is used.`}
        </p>
      </div>
    </Modal>
  )
}
