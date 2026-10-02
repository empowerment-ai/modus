import { ArrowLeft, ChevronRight, Layers, LibraryBig, Plus, Zap } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import { TypeIcon } from '../../components/icons'
import { Button, cx, Field, Input, Modal, Segmented, Select } from '../../components/ui'
import { blankWorkflow } from '@throughline/core/model/seed'
import type { App, Workflow } from '@throughline/core/model/types'
import { useApp, useDesign } from '../../store/design'
import { useSim } from '../../store/sim'
import { useUi } from '../../store/ui'
import { Canvas } from './Canvas'
import { Inspector } from './inspector/Inspector'
import { blankSubflow, subflowCallers } from './model'
import { showStep } from './navigate'
import { SaveTemplateModal } from './TemplateModals'

export function WorkflowView() {
  const appId = useUi((s) => s.appId)
  const app = useApp(appId)
  const workflowId = useUi((s) => s.workflowId)
  const setWorkflow = useUi((s) => s.setWorkflow)
  const trail = useUi((s) => s.trail)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const wf = app?.workflows.find((w) => w.id === workflowId) ?? app?.workflows.find((w) => w.kind !== 'subflow') ?? app?.workflows[0]

  useEffect(() => {
    if (wf && wf.id !== workflowId) setWorkflow(wf.id)
  }, [wf, workflowId, setWorkflow])

  if (!app) return null
  const type = app.objectTypes.find((t) => t.id === wf?.objectTypeId)
  const processes = app.workflows.filter((w) => w.kind !== 'subflow')
  const subflows = app.workflows.filter((w) => w.kind === 'subflow')
  const isSubflow = wf?.kind === 'subflow'

  const tab = (w: Workflow) => {
    const t = app.objectTypes.find((x) => x.id === w.objectTypeId)
    const sub = w.kind === 'subflow'
    return (
      <button
        key={w.id}
        type="button"
        onClick={() => setWorkflow(w.id)}
        title={sub ? 'Subflow · runs inside other steps' : undefined}
        className={cx(
          'flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium',
          w.id === wf?.id ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800',
        )}
      >
        {sub ? <Layers size={14} className="text-teal-600 opacity-80" /> : <TypeIcon name={t?.icon ?? 'file'} size={14} className="opacity-70" />}
        {w.name}
      </button>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {processes.map(tab)}
          {subflows.length > 0 && (
            <>
              <span className="mx-1 h-5 w-px shrink-0 bg-slate-200" aria-hidden />
              <span className="shrink-0 px-1 text-[10.5px] font-semibold tracking-wide text-slate-400 uppercase">Subflows</span>
              {subflows.map(tab)}
            </>
          )}
          <Button variant="ghost" size="sm" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
            Workflow
          </Button>
        </div>
        <div className="flex-1" />
        {wf && (
          <Button size="sm" variant="ghost" icon={<LibraryBig size={13} />} title="Save this workflow to the template library so it can be reused as a subflow" onClick={() => setSaving(true)}>
            Save as template
          </Button>
        )}
        {wf && type && !isSubflow && (
          <>
            <span className="hidden text-xs text-slate-500 xl:inline">
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
      {wf && (isSubflow || trail.length > 0) && <SubflowBar app={app} wf={wf} />}
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
      {saving && wf && <SaveTemplateModal app={app} wf={wf} onClose={() => setSaving(false)} />}
    </div>
  )
}

/** Where you are inside nested subflows, and which steps run this one. */
function SubflowBar({ app, wf }: { app: App; wf: Workflow }) {
  const trail = useUi((s) => s.trail)
  const callers = subflowCallers(app, wf.id)
  const parent = trail.length ? app.workflows.find((w) => w.id === trail[trail.length - 1]) : undefined
  return (
    <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-teal-100 bg-teal-50/50 px-3 text-xs">
      {parent && (
        <button
          type="button"
          onClick={() => useUi.getState().drillTo(trail.length - 1)}
          className="mr-1 flex items-center gap-1 rounded-md px-1.5 py-1 font-medium text-teal-800 hover:bg-teal-100/70"
          title={`Back to ${parent.name}`}
        >
          <ArrowLeft size={13} /> Back
        </button>
      )}
      <nav aria-label="Subflow path" className="flex min-w-0 items-center gap-1">
        {trail.map((id, i) => (
          <Fragment key={`${id}-${i}`}>
            <button type="button" onClick={() => useUi.getState().drillTo(i)} className="shrink-0 truncate rounded px-1 py-0.5 text-slate-600 hover:bg-white hover:text-slate-900">
              {app.workflows.find((w) => w.id === id)?.name ?? 'Removed workflow'}
            </button>
            <ChevronRight size={12} className="shrink-0 text-slate-400" />
          </Fragment>
        ))}
        <span className="flex min-w-0 items-center gap-1 font-semibold text-slate-800">
          {wf.kind === 'subflow' && <Layers size={13} className="shrink-0 text-teal-600" />}
          <span className="truncate">{wf.name}</span>
        </span>
      </nav>
      {wf.kind === 'subflow' && (
        <span className="ml-auto flex min-w-0 items-center gap-1.5 text-slate-500">
          <span className="shrink-0">Runs inside:</span>
          {callers.length === 0 ? (
            <span className="font-medium text-amber-700">no step yet</span>
          ) : (
            callers.map((c) => (
              <button
                key={c.node.id}
                type="button"
                onClick={() => showStep(c.wf.id, c.node.id)}
                className="min-w-0 truncate rounded-md border border-teal-200 bg-white px-1.5 py-0.5 font-medium text-slate-700 hover:border-teal-300 hover:text-slate-900"
                title={`Go to “${c.node.data.label}” in ${c.wf.name}`}
              >
                {c.node.data.label} <span className="font-normal text-slate-400">· {c.wf.name}</span>
              </button>
            ))
          )}
        </span>
      )}
    </div>
  )
}

function NewWorkflowModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const appId = useUi((s) => s.appId)
  const app = useApp(appId)
  const [name, setName] = useState('')
  const [typeId, setTypeId] = useState('')
  const [kind, setKind] = useState<'process' | 'subflow'>('process')
  if (!app) return null
  const chosen = typeId || app.objectTypes[0]?.id || ''
  const create = () => {
    if (!chosen) return
    const label = name.trim() || (kind === 'subflow' ? 'New subflow' : 'New workflow')
    const wf = kind === 'subflow' ? blankSubflow(label, chosen) : blankWorkflow(label, chosen)
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
      title={kind === 'subflow' ? 'New subflow' : 'New workflow'}
      subtitle={kind === 'subflow' ? 'A subflow runs inside a step of another workflow, and can be reused by several.' : 'A workflow moves one object type from creation to completion.'}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!chosen} onClick={create}>
            Create {kind === 'subflow' ? 'subflow' : 'workflow'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: 'process', label: 'Workflow' },
            { value: 'subflow', label: 'Subflow' },
          ]}
        />
        <Field label="Name">
          <Input
            autoFocus
            value={name}
            placeholder={kind === 'subflow' ? 'e.g. Legal review' : 'e.g. Invoice Disputes'}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />
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
