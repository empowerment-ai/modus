import { Check, Eraser, ExternalLink, Minus, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { FormRenderer } from '../../components/FormRenderer'
import { DISTRIBUTION } from '../../components/icons'
import { Button, Select } from '../../components/ui'
import { generateData } from '@modus-bpm/core/engine/generate'
import { validateRequired } from '@modus-bpm/core/model/format'
import type { App, ObjectType, TypePermission } from '@modus-bpm/core/model/types'
import { useDesign } from '../../store/design'
import { useUi } from '../../store/ui'

interface Props {
  app: App
  type: ObjectType
  selectedFieldId: string | null
  onFieldClick: (fieldId: string) => void
}

/** Live, interactive rendering of the generated form for the type or for one workflow step. */
export function FormPreview({ app, type, selectedFieldId, onFieldClick }: Props) {
  const users = useDesign((s) => s.design.users)
  const groups = useDesign((s) => s.design.groups)
  const toast = useUi((s) => s.toast)
  const [mode, setMode] = useState<string>('create')
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [errors, setErrors] = useState<Record<string, string> | undefined>()

  const steps = app.workflows
    .filter((w) => w.objectTypeId === type.id)
    .flatMap((wf) => wf.nodes.flatMap((n) => (n.type === 'user' ? [{ wf, node: n }] : [])))
  const step = steps.find((s) => s.node.id === mode)
  const access = step?.node.data.fieldAccess

  const fill = () => {
    const data = generateData({ rng: (Math.random() * 2 ** 31) | 0 }, type, app.lists, users, 0, `${type.numberPrefix}1001`)
    setValues(data)
    setErrors(undefined)
  }

  const testSubmit = () => {
    const all = validateRequired(type, values, !!step)
    // At a step, only fields the person can edit can be fixed there.
    const errs = Object.fromEntries(Object.entries(all).filter(([id]) => !access || (access[id] ?? 'edit') === 'edit'))
    setErrors(errs)
    if (Object.keys(errs).length === 0) toast(step ? `The “${step.node.data.label}” form would save.` : `This ${type.name.toLowerCase()} would be created.`, 'success')
  }

  const counts = access
    ? type.fields.reduce(
        (acc, f) => {
          acc[access[f.id] ?? 'edit']++
          return acc
        },
        { edit: 0, read: 0, hidden: 0 },
      )
    : undefined

  const permRows = Object.entries(type.permissions)
    .filter(([, p]) => p.create || p.read || p.update || p.delete)
    .map(([gid, p]) => ({ gid, name: groups.find((g) => g.id === gid)?.name ?? 'Unknown group', p }))
  const noAccess = groups.length - permRows.length

  return (
    <aside className="flex w-[440px] shrink-0 flex-col border-l border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 pt-3.5 pb-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Form preview</h2>
          <span className="text-[11px] text-slate-400">Generated from the definition</span>
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          <Select
            value={step ? mode : 'create'}
            aria-label="Which form to preview"
            onChange={(e) => {
              setMode(e.target.value)
              setErrors(undefined)
            }}
          >
            <option value="create">Create form</option>
            {steps.map(({ wf, node }) => (
              <option key={node.id} value={node.id}>
                Step form: {node.data.label}
                {steps.some((s) => s.wf.id !== wf.id) ? ` (${wf.name})` : ''}
              </option>
            ))}
          </Select>
          <Button size="sm" icon={<Sparkles size={13} />} onClick={fill} title="Fill with realistic sample data">
            Fill sample
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<Eraser size={13} />}
            onClick={() => {
              setValues({})
              setErrors(undefined)
            }}
          >
            Clear
          </Button>
        </div>
        {step && counts && (
          <div className="mt-2.5 rounded-md bg-slate-50 px-2.5 py-2 text-[11px] leading-relaxed text-slate-600">
            <div className="flex items-center gap-1.5">
              {(() => {
                const D = DISTRIBUTION[step.node.data.distribution]
                return <D.icon size={12} className="text-slate-500" />
              })()}
              <span>
                {DISTRIBUTION[step.node.data.distribution].label}
                {step.node.data.groupId ? ` · ${groups.find((g) => g.id === step.node.data.groupId)?.name ?? ''}` : ''}
              </span>
            </div>
            <div className="mt-0.5 flex items-center justify-between gap-2">
              <span>
                {counts.edit} editable · {counts.read} read-only · {counts.hidden} hidden
              </span>
              <button
                type="button"
                className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"
                onClick={() => {
                  const ui = useUi.getState()
                  ui.setView('workflow')
                  ui.setWorkflow(step.wf.id)
                  ui.select({ kind: 'node', id: step.node.id })
                }}
              >
                Edit field access <ExternalLink size={11} />
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-4 py-4">
          {type.fields.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-500">Add a field and it appears here instantly.</p>
          ) : (
            <FormRenderer
              type={type}
              lists={app.lists}
              users={users}
              values={values}
              onChange={(v) => {
                setValues(v)
                if (errors) setErrors(undefined)
              }}
              access={access}
              includeSystem={!!step}
              errors={errors}
              highlightFieldId={selectedFieldId ?? undefined}
              onFieldClick={onFieldClick}
            />
          )}
          {type.fields.length > 0 && (
            <div className="mt-4 flex justify-end border-t border-slate-100 pt-3">
              <Button size="sm" variant="primary" onClick={testSubmit}>
                {step ? 'Test save' : 'Test submit'}
              </Button>
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 bg-slate-50/50 px-4 py-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Security</h3>
            <button type="button" onClick={() => useUi.getState().setView('org')} className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-700 hover:underline">
              Edit in People &amp; Security <ExternalLink size={11} />
            </button>
          </div>
          {permRows.length === 0 ? (
            <p className="text-xs text-slate-500">No group has access to {type.pluralName.toLowerCase() || 'this type'} yet.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] tracking-wide text-slate-400 uppercase">
                  <th className="pb-1 text-left font-medium">Group</th>
                  {(['Create', 'Read', 'Update', 'Delete'] as const).map((h) => (
                    <th key={h} className="w-12 pb-1 text-center font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {permRows.map(({ gid, name, p }) => (
                  <tr key={gid} className="border-t border-slate-200/70">
                    <td className="py-1.5 pr-2 text-slate-700">{name}</td>
                    {(['create', 'read', 'update', 'delete'] as Array<keyof TypePermission>).map((k) => (
                      <td key={k} className="py-1.5 text-center">
                        {p[k] ? (
                          <Check size={13} className="inline text-emerald-600" aria-label="Allowed" />
                        ) : (
                          <Minus size={13} className="inline text-slate-300" aria-label="Not allowed" />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {noAccess > 0 && permRows.length > 0 && (
            <p className="mt-2 text-[11px] text-slate-500">
              {noAccess} other group{noAccess === 1 ? ' has' : 's have'} no access.
            </p>
          )}
        </div>
      </div>
    </aside>
  )
}
