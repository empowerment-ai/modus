import { ArrowRightLeft, CircleCheck, MoveRight, ShieldCheck, TriangleAlert, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { Button, Select, Textarea } from '../../components/ui'
import { adminAssign, adminMove, adminRelease, adminReturnToPool, type SimObject } from '@throughline/core/engine/engine'
import type { Group, User, WfNode, Workflow } from '@throughline/core/model/types'
import { useSim } from '../../store/sim'
import { useUi } from '../../store/ui'

const NODE_KIND: Record<WfNode['type'], string> = {
  start: 'Start',
  user: 'User step',
  auto: 'Automated',
  decision: 'Decision',
  end: 'End',
}

type UserStep = Extract<WfNode, { type: 'user' }>

/**
 * The administrator's controls: reassign, return to the pool, move to another
 * step, or release on someone's behalf with an outcome and a comment.
 */
export function AdminPanel({ obj, wf, node, users, groups }: { obj: SimObject; wf: Workflow; node?: WfNode; users: User[]; groups: Group[] }) {
  const step = node?.type === 'user' ? node : undefined
  const stuck = obj.state === 'stuck'
  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-3.5 py-2.5">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
          <ShieldCheck size={13} /> Administer
        </h3>
        <span className="text-[11px] text-slate-400">Recorded in history as Administrator</span>
      </header>
      <div className="space-y-3.5 px-3.5 py-3">
        {stuck && (
          <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            <TriangleAlert size={15} className="mt-0.5 shrink-0 text-rose-600" />
            <span>
              {obj.stuckReason ?? 'No path out of this step.'} Fix the map and it continues on its own, or move it to a step yourself.
            </span>
          </div>
        )}
        {step && !stuck && <AssignRow key={`assign-${obj.nodeId}`} obj={obj} step={step} users={users} groups={groups} />}
        <MoveRow key={`move-${obj.nodeId}`} obj={obj} wf={wf} />
        {step && !stuck && <ReleaseRow key={`release-${obj.nodeId}`} obj={obj} step={step} wf={wf} />}
      </div>
    </section>
  )
}

function RowLabel({ children }: { children: string }) {
  return <div className="mb-1 text-xs font-medium text-slate-600">{children}</div>
}

function AssignRow({ obj, step, users, groups }: { obj: SimObject; step: UserStep; users: User[]; groups: Group[] }) {
  const [target, setTarget] = useState('')
  const group = groups.find((g) => g.id === step.data.groupId)
  const members = users.filter((u) => group?.memberIds.includes(u.id))
  const others = users.filter((u) => !group?.memberIds.includes(u.id))
  const holding = obj.state === 'assigned' || obj.state === 'working'
  const sameAsCurrent = holding && target === obj.userId
  const dist = step.data.distribution
  const returnLabel = dist === 'queue' ? 'Return to queue' : dist === 'manager' ? 'Return to supervisor' : 'Return to pool'
  const returnHint =
    dist === 'load-balance' ? 'It will be load balanced again within a minute.' : dist === 'direct' ? 'It will be handed back to the assigned person.' : undefined

  const assign = () => {
    const name = users.find((u) => u.id === target)?.name ?? 'that person'
    const ok = useSim.getState().act((sim, ctx) => adminAssign(sim, ctx, obj.id, target))
    useUi.getState().toast(ok ? `${obj.number} assigned to ${name}.` : `${obj.number} is already with ${name}.`, ok ? 'success' : 'info')
    if (ok) setTarget('')
  }

  const giveBack = () => {
    const ok = useSim.getState().act((sim, ctx) => adminReturnToPool(sim, ctx, obj.id))
    useUi.getState().toast(ok ? `${obj.number} returned${group ? ` to ${group.name}` : ''}.` : 'Nothing to return — it is not assigned.', ok ? 'success' : 'info')
  }

  const fmt = (u: User) => `${u.name} — ${u.title}${u.available ? '' : ' (unavailable)'}`

  return (
    <div>
      <RowLabel>Assign to</RowLabel>
      <div className="flex gap-2">
        <Select value={target} onChange={(e) => setTarget(e.target.value)} className="min-w-0 flex-1">
          <option value="">Choose a person…</option>
          {members.length > 0 && (
            <optgroup label={`${group?.name ?? 'Group'} members`}>
              {members.map((u) => (
                <option key={u.id} value={u.id}>
                  {fmt(u)}
                  {u.id === obj.userId ? ' · current' : ''}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Everyone else">
            {others.map((u) => (
              <option key={u.id} value={u.id}>
                {fmt(u)}
              </option>
            ))}
          </optgroup>
        </Select>
        <Button icon={<ArrowRightLeft size={14} />} disabled={!target || sameAsCurrent} onClick={assign}>
          {holding ? 'Reassign' : 'Assign'}
        </Button>
        <Button variant="ghost" icon={<Undo2 size={14} />} disabled={obj.state === 'unassigned'} onClick={giveBack} title={returnHint}>
          {returnLabel}
        </Button>
      </div>
    </div>
  )
}

function MoveRow({ obj, wf }: { obj: SimObject; wf: Workflow }) {
  const [target, setTarget] = useState('')
  const options = wf.nodes.filter((n) => n.id !== obj.nodeId)
  const from = wf.nodes.find((n) => n.id === obj.nodeId)?.data.label ?? 'its current step'

  const move = () => {
    const to = wf.nodes.find((n) => n.id === target)
    if (!to) return
    if (!window.confirm(`Move ${obj.number} from “${from}” to “${to.data.label}”? It skips the normal routing rules.`)) return
    const ok = useSim.getState().act((sim, ctx) => adminMove(sim, ctx, obj.id, target))
    useUi.getState().toast(ok ? `${obj.number} moved to “${to.data.label}”.` : `Could not move ${obj.number}.`, ok ? 'success' : 'warn')
    if (ok) setTarget('')
  }

  return (
    <div>
      <RowLabel>Move to step</RowLabel>
      <div className="flex gap-2">
        <Select value={target} onChange={(e) => setTarget(e.target.value)} className="min-w-0 flex-1">
          <option value="">Choose a step…</option>
          {options.map((n) => (
            <option key={n.id} value={n.id}>
              {NODE_KIND[n.type]} · {n.data.label}
            </option>
          ))}
        </Select>
        <Button icon={<MoveRight size={14} />} disabled={!target} onClick={move}>
          Move
        </Button>
      </div>
    </div>
  )
}

function ReleaseRow({ obj, step, wf }: { obj: SimObject; step: UserStep; wf: Workflow }) {
  const outcomes = step.data.outcomes
  const [outcomeId, setOutcomeId] = useState(outcomes[0]?.id ?? '')
  const [comment, setComment] = useState('')
  const outcome = outcomes.find((o) => o.id === outcomeId)
  const needsComment = !!outcome?.requireComment && !comment.trim()

  const release = () => {
    if (!outcome || needsComment) return
    const ok = useSim.getState().act((sim, ctx) => adminRelease(sim, ctx, obj.id, outcome.id, comment))
    if (!ok) {
      useUi.getState().toast(`Could not release ${obj.number}.`, 'warn')
      return
    }
    // The object has already been routed onward by the engine.
    const now = useSim.getState().sims[useUi.getState().appId]?.objects[obj.id]
    const next = wf.nodes.find((n) => n.id === now?.nodeId)?.data.label
    const tail = now?.state === 'stuck' ? ` but is stuck: ${now.stuckReason}` : next ? ` → ${next}` : ''
    useUi.getState().toast(`${obj.number} released as “${outcome.label}”${tail}`, now?.state === 'stuck' ? 'warn' : 'success')
    setComment('')
  }

  if (!outcomes.length) return null
  return (
    <div className="border-t border-slate-100 pt-3">
      <RowLabel>Release with outcome</RowLabel>
      <div className="space-y-2">
        <Select value={outcomeId} onChange={(e) => setOutcomeId(e.target.value)}>
          {outcomes.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
              {o.requireComment ? ' (comment required)' : ''}
            </option>
          ))}
        </Select>
        <Textarea
          rows={2}
          className="min-h-[56px]"
          value={comment}
          placeholder={outcome?.requireComment ? 'A comment is required for this outcome…' : 'Add a comment (optional)…'}
          onChange={(e) => setComment(e.target.value)}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-500">
            {needsComment ? 'A comment is required for this outcome.' : obj.userId ? 'Released on behalf of the assignee.' : 'No one holds it; released by the administrator.'}
          </span>
          <Button variant="primary" icon={<CircleCheck size={14} />} disabled={!outcome || needsComment} onClick={release}>
            Release
          </Button>
        </div>
      </div>
    </div>
  )
}
