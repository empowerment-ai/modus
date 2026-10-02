import { Plus, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { TypeIcon } from '../../components/icons'
import { Button, cx, Field, Input, Modal, Select } from '../../components/ui'
import { blankWorkflow } from '@throughline/core/model/seed'
import { useApp, useDesign } from '../../store/design'
import { useSim } from '../../store/sim'
import { useUi } from '../../store/ui'
import { Canvas } from './Canvas'
import { Inspector } from './inspector/Inspector'

export function WorkflowView() {
  const appId = useUi((s) => s.appId)
  const app = useApp(appId)
  const workflowId = useUi((s) => s.workflowId)
  const setWorkflow = useUi((s) => s.setWorkflow)
  const [creating, setCreating] = useState(false)
  const wf = app?.workflows.find((w) => w.id === workflowId) ?? app?.workflows[0]

  useEffect(() => {
    if (wf && wf.id !== workflowId) setWorkflow(wf.id)
  }, [wf, workflowId, setWorkflow])

  if (!app) return null
  const type = app.objectTypes.find((t) => t.id === wf?.objectTypeId)

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {app.workflows.map((w) => {
            const t = app.objectTypes.find((x) => x.id === w.objectTypeId)
            return (
              <button
                key={w.id}
                type="button"
                onClick={() => setWorkflow(w.id)}
                className={cx(
                  'flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium',
                  w.id === wf?.id ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800',
                )}
              >
                <TypeIcon name={t?.icon ?? 'file'} size={14} className="opacity-70" />
                {w.name}
              </button>
            )
          })}
          <Button variant="ghost" size="sm" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
            Workflow
          </Button>
        </div>
        <div className="flex-1" />
        {wf && type && (
          <>
            <span className="hidden text-xs text-slate-500 lg:inline">
              Simulating <b className="font-semibold text-slate-700">{wf.arrivalsPerHour}</b> new {type.pluralName.toLowerCase()} / hour
            </span>
            <Button
              size="sm"
              icon={<Zap size={13} />}
              title={`25 new ${type.pluralName.toLowerCase()} arrive at once`}
              onClick={() => {
                const n = useSim.getState().burst(wf.id, 25)
                useUi.getState().toast(`${n} ${type.pluralName.toLowerCase()} arrived at once.`, 'success')
              }}
            >
              Burst of 25
            </Button>
            <Button size="sm" variant="primary" icon={<Plus size={13} />} onClick={() => useUi.getState().openCreate(wf.id)}>
              New {type.name}
            </Button>
          </>
        )}
      </div>
      {wf ? (
        <div className="flex min-h-0 flex-1">
          <div className="relative min-w-0 flex-1">
            <Canvas key={wf.id} app={app} wf={wf} />
          </div>
          <Inspector app={app} wf={wf} />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
            Create the first workflow
          </Button>
        </div>
      )}
      <NewWorkflowModal open={creating} onClose={() => setCreating(false)} />
    </div>
  )
}

function NewWorkflowModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const appId = useUi((s) => s.appId)
  const app = useApp(appId)
  const [name, setName] = useState('')
  const [typeId, setTypeId] = useState('')
  if (!app) return null
  const chosen = typeId || app.objectTypes[0]?.id || ''
  const create = () => {
    if (!chosen) return
    const wf = blankWorkflow(name.trim() || 'New workflow', chosen)
    useDesign.getState().updateApp(app.id, (a) => {
      a.workflows.push(wf)
    })
    useUi.getState().setWorkflow(wf.id)
    setName('')
    onClose()
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New workflow"
      subtitle="A workflow moves one object type from creation to completion."
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!chosen} onClick={create}>
            Create workflow
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name">
          <Input autoFocus value={name} placeholder="e.g. Invoice Disputes" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
        </Field>
        <Field label="Object type it processes">
          <Select value={chosen} onChange={(e) => setTypeId(e.target.value)}>
            {app.objectTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  )
}
