import { Clock, Pencil, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { FormRenderer } from '../../components/FormRenderer'
import { TypeIcon } from '../../components/icons'
import { Badge, Button, cx, IconButton, Segmented } from '../../components/ui'
import { adminUpdateData, type SimObject } from '@throughline/core/engine/engine'
import { objectTitle } from '@throughline/core/model/format'
import type { App, Group, User, WfNode } from '@throughline/core/model/types'
import { formatDuration } from '@throughline/core/model/util'
import { useApp, useDesign } from '../../store/design'
import { useSim, useSimState } from '../../store/sim'
import { useUi } from '../../store/ui'
import { AdminPanel } from './AdminPanel'
import { ObjectHistory } from './ObjectHistory'

const DRAWER_KEYFRAMES = '@keyframes objdrawer-in{from{transform:translateX(28px);opacity:0}to{transform:none;opacity:1}}'

export function ObjectDrawer() {
  const objectId = useUi((s) => s.objectId)
  const appId = useUi((s) => s.appId)
  const app = useApp(appId)
  const sim = useSimState()
  const obj = objectId ? sim?.objects[objectId] : undefined

  // The object can vanish (simulation reset, app switch): close quietly.
  useEffect(() => {
    if (objectId && !obj) useUi.getState().openObject(null)
  }, [objectId, obj])

  useEffect(() => {
    if (!objectId) return
    const onKey = (e: KeyboardEvent) => {
      // Let an open modal (e.g. the create form) handle Escape first.
      if (e.key === 'Escape' && !useUi.getState().createFor) useUi.getState().openObject(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [objectId])

  if (!objectId || !obj || !app || !sim) return null
  return <DrawerBody key={obj.id} obj={obj} app={app} clock={sim.clock} />
}

type StateTone = 'slate' | 'brand' | 'green' | 'amber' | 'red'

function describeState(obj: SimObject, node: WfNode | undefined, users: User[], groups: Group[], clock: number): { text: string; tone: StateTone } {
  const name = (id?: string) => users.find((u) => u.id === id)?.name ?? 'someone'
  if (obj.status !== 'active') {
    const where = node?.data.label ?? 'the end'
    return { text: `Finished at ${where}`, tone: obj.status === 'completed' ? 'green' : obj.status === 'rejected' ? 'red' : 'slate' }
  }
  switch (obj.state) {
    case 'working': {
      const since = clock - (obj.startedAt ?? clock)
      return { text: `Working — ${name(obj.userId)} (${since < 1 ? 'just started' : `started ${formatDuration(since)} ago`})`, tone: 'brand' }
    }
    case 'assigned':
      return { text: `In ${name(obj.userId)}’s basket`, tone: 'brand' }
    case 'unassigned': {
      if (node?.type !== 'user') return { text: 'Waiting', tone: 'amber' }
      const group = groups.find((g) => g.id === node.data.groupId)
      switch (node.data.distribution) {
        case 'queue':
          return { text: `Waiting in the ${group?.name ?? 'group'} queue`, tone: 'amber' }
        case 'manager': {
          const sup = node.data.supervisorId ?? group?.supervisorId
          return { text: `Awaiting supervisor ${name(sup)}`, tone: 'amber' }
        }
        case 'load-balance':
          return { text: `Waiting for an available ${group?.name ?? 'group'} member`, tone: 'amber' }
        default:
          return { text: 'Waiting to be assigned', tone: 'amber' }
      }
    }
    case 'auto':
      return { text: node?.type === 'auto' ? 'Automated step running' : 'Routing…', tone: 'slate' }
    case 'stuck':
      return { text: `Stuck: ${obj.stuckReason ?? 'no path out of this step'}`, tone: 'red' }
    default:
      return { text: 'Done', tone: 'slate' }
  }
}

const STATUS: Record<SimObject['status'], { label: string; tone: 'brand' | 'green' | 'red' | 'slate' }> = {
  active: { label: 'Active', tone: 'brand' },
  completed: { label: 'Completed', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
  cancelled: { label: 'Cancelled', tone: 'slate' },
}

const TONE_TEXT: Record<StateTone, string> = {
  slate: 'text-slate-600',
  brand: 'text-brand-700',
  green: 'text-emerald-700',
  amber: 'text-amber-700',
  red: 'text-rose-700',
}

const TONE_DOT: Record<StateTone, string> = {
  slate: 'bg-slate-400',
  brand: 'bg-brand-500',
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-rose-500',
}

function DrawerBody({ obj, app, clock }: { obj: SimObject; app: App; clock: number }) {
  const users = useDesign((s) => s.design.users)
  const groups = useDesign((s) => s.design.groups)
  const close = () => useUi.getState().openObject(null)
  const [tab, setTab] = useState<'details' | 'history'>('details')

  const type = app.objectTypes.find((t) => t.id === obj.typeId)
  const wf = app.workflows.find((w) => w.id === obj.workflowId)
  const node = wf?.nodes.find((n) => n.id === obj.nodeId)
  const state = describeState(obj, node, users, groups, clock)
  const status = STATUS[obj.status]
  const title = objectTitle(type, obj.data, app.lists, users)
  const creator = users.find((u) => u.id === obj.createdBy)?.name ?? obj.createdBy
  const inStep = clock - obj.enteredAt
  const slaMinutes = node?.type === 'user' && node.data.slaHours ? node.data.slaHours * 60 : undefined
  const overdue = obj.status === 'active' && slaMinutes !== undefined && inStep > slaMinutes
  const canAdminister = obj.status === 'active' && !!wf && (node?.type === 'user' || obj.state === 'stuck')

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30" onMouseDown={close}>
      <style>{DRAWER_KEYFRAMES}</style>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${obj.number} details`}
        className="flex h-full w-[600px] max-w-full flex-col bg-white shadow-2xl"
        style={{ animation: 'objdrawer-in 180ms ease-out' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-slate-200 px-5 pt-4 pb-3.5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: `${type?.color ?? '#4f46e5'}1a`, color: type?.color }}>
              <TypeIcon name={type?.icon ?? 'file'} size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-mono text-lg font-semibold tracking-tight text-slate-900">{obj.number}</h2>
                <Badge tone={status.tone}>{status.label}</Badge>
                {overdue && (
                  <Badge tone="red">
                    <Clock size={11} /> SLA overdue by {formatDuration(inStep - slaMinutes!)}
                  </Badge>
                )}
              </div>
              <p className="truncate text-sm text-slate-600">
                {title || type?.name}
                <span className="text-slate-400">
                  {' '}
                  · {type?.name} · {wf?.name ?? 'Unknown workflow'}
                </span>
              </p>
            </div>
            <IconButton label="Close" onClick={close}>
              <X size={16} />
            </IconButton>
          </div>

          <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2">
            <div className="flex items-center gap-2 text-sm">
              <span className={cx('h-2 w-2 shrink-0 rounded-full', TONE_DOT[state.tone], obj.state === 'working' && 'animate-pulse')} />
              <span className="font-medium text-slate-800">{node?.data.label ?? 'Removed step'}</span>
              <span className="text-slate-300">—</span>
              <span className={cx('min-w-0 truncate', TONE_TEXT[state.tone])} title={state.text}>
                {state.text}
              </span>
            </div>
            <p className="mt-1 pl-4 text-[11px] text-slate-500">
              Created by {creator} {ago(clock - obj.createdAt)}
              {obj.status === 'active' && <> · in this step {inStep < 1 ? 'under a minute' : formatDuration(inStep)}</>}
              {obj.status !== 'active' && obj.completedAt !== undefined && <> · cycle time {formatDuration(obj.completedAt - obj.createdAt)}</>}
              {slaMinutes !== undefined && obj.status === 'active' && <> · SLA {formatDuration(slaMinutes)}</>}
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {canAdminister && wf && <AdminPanel obj={obj} wf={wf} node={node} users={users} groups={groups} />}

          <div className="flex items-center justify-between">
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: 'details', label: 'Details' },
                { value: 'history', label: `History (${obj.history.length})` },
              ]}
            />
          </div>

          {tab === 'details' && type && <Details obj={obj} app={app} users={users} />}
          {tab === 'history' && <ObjectHistory obj={obj} wf={wf} />}
        </div>
      </aside>
    </div>
  )
}

function ago(minutes: number): string {
  return minutes < 1 ? 'just now' : `${formatDuration(minutes)} ago`
}

function Details({ obj, app, users }: { obj: SimObject; app: App; users: User[] }) {
  const type = app.objectTypes.find((t) => t.id === obj.typeId)!
  const [editing, setEditing] = useState(false)
  const [base, setBase] = useState<Record<string, unknown>>({})
  const [draft, setDraft] = useState<Record<string, unknown>>({})

  const startEdit = () => {
    setBase({ ...obj.data })
    setDraft({ ...obj.data })
    setEditing(true)
  }

  const save = () => {
    // Only send what the administrator actually changed, so values set by the
    // running workflow in the meantime are not overwritten with stale copies.
    const patch: Record<string, unknown> = {}
    for (const k of new Set([...Object.keys(base), ...Object.keys(draft)])) {
      if (JSON.stringify(base[k]) !== JSON.stringify(draft[k])) patch[k] = draft[k]
    }
    const changed = Object.keys(patch).length
    if (changed) {
      useSim.getState().act((sim, ctx) => adminUpdateData(sim, ctx, obj.id, patch))
      useUi.getState().toast('Changes saved and audited.', 'success')
    } else {
      useUi.getState().toast('No changes to save.')
    }
    setEditing(false)
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[11px] text-slate-500">{editing ? 'Editing as Administrator — each change is written to the history.' : 'Generated from the object type definition, including fields set by the workflow.'}</p>
        {!editing ? (
          <Button size="sm" icon={<Pencil size={13} />} onClick={startEdit}>
            Edit
          </Button>
        ) : (
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={save}>
              Save
            </Button>
          </div>
        )}
      </div>
      <FormRenderer type={type} lists={app.lists} users={users} values={editing ? draft : obj.data} onChange={editing ? setDraft : undefined} includeSystem />
    </div>
  )
}
