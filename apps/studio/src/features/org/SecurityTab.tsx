import { ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { TypeIcon } from '../../components/icons'
import { Card, EmptyState, Field, Select } from '../../components/ui'
import { useApp, useDesign } from '../../store/design'
import { useUi } from '../../store/ui'
import { SecurityCheck } from './SecurityCheck'
import { SecurityLocks } from './SecurityLocks'
import { SecurityMatrix } from './SecurityMatrix'
import { SecuritySensitive } from './SecuritySensitive'

/** Field-level security for one workflow: the matrix, workflow locks, sensitive fields, and a per-person check. */
export function SecurityTab() {
  const appId = useUi((s) => s.appId)
  const app = useApp(appId)
  const groups = useDesign((s) => s.design.groups)
  const users = useDesign((s) => s.design.users)
  const [picked, setPicked] = useState<string>()
  if (!app) return null

  const wf = app.workflows.find((w) => w.id === picked) ?? app.workflows.find((w) => (w.kind ?? 'process') === 'process') ?? app.workflows[0]
  const type = app.objectTypes.find((t) => t.id === wf?.objectTypeId)

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2.5 rounded-lg border border-brand-100 bg-brand-50/60 px-3.5 py-2.5 text-xs text-brand-900">
        <ShieldCheck size={16} className="mt-px shrink-0 text-brand-600" />
        <p>
          Three layers decide what someone can do with a field — sensitive-data rules on the object type, workflow locks, and step settings. The strictest wins, and the engine enforces it (the API
          refuses locked changes too).
        </p>
      </div>

      {!wf ? (
        <Card>
          <EmptyState title="No workflows yet">Add a workflow to this application to set field security on its steps.</EmptyState>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Workflow" className="w-72">
              <Select value={wf.id} onChange={(e) => setPicked(e.target.value)}>
                {app.workflows.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                    {w.kind === 'subflow' ? ' (subflow)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
            {type && (
              <div className="flex items-center gap-2 pb-1.5 text-xs text-slate-500">
                <span className="flex h-6 w-6 items-center justify-center rounded-md text-white" style={{ background: type.color }}>
                  <TypeIcon name={type.icon} size={13} />
                </span>
                {type.pluralName} · {type.fields.length} fields
              </div>
            )}
          </div>

          {!type ? (
            <Card>
              <EmptyState title="This workflow has no object type">Pick the object type it works on in the workflow designer.</EmptyState>
            </Card>
          ) : (
            <>
              <SecurityMatrix appId={appId} type={type} wf={wf} groups={groups} users={users} />
              <div className="grid gap-4 2xl:grid-cols-2">
                <SecurityLocks appId={appId} type={type} wf={wf} groups={groups} />
                <SecurityCheck key={wf.id} type={type} wf={wf} groups={groups} users={users} />
              </div>
              <SecuritySensitive appId={appId} type={type} groups={groups} />
            </>
          )}
        </>
      )}
    </div>
  )
}
