import { ArrowRightLeft, Ban, CircleCheck, MoveRight, RotateCw, ShieldCheck, TriangleAlert, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { Button, Select, Textarea } from '../../components/ui'
import {
  adminAssign,
  adminCancel,
  adminMove,
  adminRelease,
  adminRetry,
  adminReturnToPool,
  adminSetPriority,
  MANUAL_OUTCOMES,
  PRIORITIES,
  type Result,
  type SimObject,
  type Token,
} from '@modus-bpm/core'
import type { App, Group, Outcome, Priority, User, WfNode } from '@modus-bpm/core/model/types'
import { useSim } from '../../store/sim'
import { useUi } from '../../store/ui'

const NODE_KIND: Record<WfNode['type'], string> = {
  start: 'Start',
  user: 'User step',
  auto: 'Automated',
  decision: 'Decision',
  split: 'Parallel split',
  join: 'Join',
  subflow: 'Subflow',
  wait: 'Timer',
  end: 'End',
}

function report(r: Result<unknown>, success: string) {
  useUi.getState().toast(r.ok ? success : r.error, r.ok ? 'success' : 'warn')
  return r.ok
}

/**
 * The administrator's controls for one branch of an item (reassign within the
 * group, take work off an automated step, move, release, retry) plus item-wide
 * controls (priority, cancel).
 */
export function AdminPanel({ obj, tok, node, app, users, groups }: { obj: SimObject; tok?: Token; node?: WfNode; app: App; users: User[]; groups: Group[] }) {
  const stuck = tok?.state === 'stuck'
  const people = node?.type === 'user' || (node?.type === 'auto' && tok?.manual)
  const automated = node?.type === 'auto' && !tok?.manual
  const outcomes: Outcome[] = node?.type === 'user' ? node.data.outcomes : node?.type === 'auto' && tok?.manual ? MANUAL_OUTCOMES : []
  const wf = tok ? app.workflows.find((w) => w.id === tok.workflowId) : undefined
  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-3.5 py-2.5">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
          <ShieldCheck size={13} /> Administer{obj.tokens.length > 1 && node ? ` · ${node.data.label}` : ''}
        </h3>
        <span className="text-[11px] text-slate-400">Recorded in history as Administrator</span>
      </header>
      <div className="space-y-3.5 px-3.5 py-3">
        {stuck && tok && (
          <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            <TriangleAlert size={15} className="mt-0.5 shrink-0 text-rose-600" />
            <span className="flex-1">{tok.stuckReason ?? 'No path out of this step.'} Fix the map and it continues on its own, retry, or move it yourself.</span>
            <Button size="sm" icon={<RotateCw size={13} />} onClick={() => report(useSim.getState().act((s, c) => adminRetry(s, c, tok.id)), `${obj.number}: retried.`)}>
              Retry
            </Button>
          </div>
        )}
        {tok && node && (people || automated) && !stuck && <AssignRow key={`assign-${tok.id}-${tok.nodeId}`} obj={obj} tok={tok} node={node} users={users} groups={groups} />}
        {tok && wf && <MoveRow key={`move-${tok.id}-${tok.nodeId}`} obj={obj} tok={tok} nodes={wf.nodes} />}
        {tok && people && !stuck && outcomes.length > 0 && <ReleaseRow key={`release-${tok.id}-${tok.nodeId}`} obj={obj} tok={tok} outcomes={outcomes} />}
        <ItemRow obj={obj} />
      </div>
    </section>
  )
}

function RowLabel({ children }: { children: string }) {
  return <div className="mb-1 text-xs font-medium text-slate-600">{children}</div>
}

function AssignRow({ obj, tok, node, users, groups }: { obj: SimObject; tok: Token; node: WfNode; users: User[]; groups: Group[] }) {
  const [target, setTarget] = useState('')
  const automated = node.type === 'auto' && !tok.manual
  const groupId = node.type === 'user' ? node.data.groupId : node.type === 'auto' ? node.data.fallbackGroupId : undefined
  const group = groups.find((g) => g.id === groupId)
  const members = users.filter((u) => group?.memberIds.includes(u.id))
  const others = users.filter((u) => !group?.memberIds.includes(u.id))
  const holding = tok.state === 'assigned' || tok.state === 'working'
  const sameAsCurrent = holding && target === tok.userId
  const dist = node.type === 'user' ? node.data.distribution : 'load-balance'
  const returnLabel = dist === 'queue' ? 'Return to queue' : dist === 'manager' ? 'Return to dispatchers' : 'Return to pool'

  const assign = () => {
    const name = users.find((u) => u.id === target)?.name ?? 'that person'
    const ok = report(
      useSim.getState().act((sim, ctx) => adminAssign(sim, ctx, tok.id, target)),
      automated ? `${obj.number}: taken off the automation and given to ${name}.` : `${obj.number} assigned to ${name}.`,
    )
    if (ok) setTarget('')
  }

  const giveBack = () => report(useSim.getState().act((sim, ctx) => adminReturnToPool(sim, ctx, tok.id)), `${obj.number} returned${group ? ` to ${group.name}` : ''}.`)

  const fmt = (u: User) => `${u.name} — ${u.title}${u.available ? '' : ' (unavailable)'}`

  return (
    <div>
      <RowLabel>{automated ? 'Take it off the automation: give it to a person' : 'Reassign'}</RowLabel>
      <div className="flex gap-2">
        <Select value={target} onChange={(e) => setTarget(e.target.value)} className="min-w-0 flex-1">
          <option value="">Choose a person…</option>
          {members.length > 0 && (
            <optgroup label={`${group?.name ?? 'Group'} (same group)`}>
              {members.map((u) => (
                <option key={u.id} value={u.id}>
                  {fmt(u)}
                  {u.id === tok.userId ? ' · current' : ''}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Everyone else (administrator override)">
            {others.map((u) => (
              <option key={u.id} value={u.id}>
                {fmt(u)}
              </option>
            ))}
          </optgroup>
        </Select>
        <Button icon={<ArrowRightLeft size={14} />} disabled={!target || sameAsCurrent} onClick={assign}>
          {automated ? 'Hand over' : holding ? 'Reassign' : 'Assign'}
        </Button>
        {!automated && (
          <Button variant="ghost" icon={<Undo2 size={14} />} disabled={tok.state === 'unassigned'} onClick={giveBack}>
            {returnLabel}
          </Button>
        )}
      </div>
      {automated && !group && <p className="mt-1 text-[11px] text-amber-700">This step has no fallback group; pick anyone, or set one in the designer.</p>}
    </div>
  )
}

function MoveRow({ obj, tok, nodes }: { obj: SimObject; tok: Token; nodes: WfNode[] }) {
  const [target, setTarget] = useState('')
  const options = nodes.filter((n) => n.id !== tok.nodeId && n.type !== 'start')
  const from = nodes.find((n) => n.id === tok.nodeId)?.data.label ?? 'its current step'

  const move = () => {
    const to = nodes.find((n) => n.id === target)
    if (!to) return
    if (!window.confirm(`Move ${obj.number} from “${from}” to “${to.data.label}”? It skips the normal routing rules.`)) return
    if (report(useSim.getState().act((sim, ctx) => adminMove(sim, ctx, tok.id, target)), `${obj.number} moved to “${to.data.label}”.`)) setTarget('')
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

function ReleaseRow({ obj, tok, outcomes }: { obj: SimObject; tok: Token; outcomes: Outcome[] }) {
  const [outcomeId, setOutcomeId] = useState(outcomes[0]?.id ?? '')
  const [comment, setComment] = useState('')
  const outcome = outcomes.find((o) => o.id === outcomeId)
  const needsComment = !!outcome?.requireComment && !comment.trim()

  const release = () => {
    if (!outcome || needsComment) return
    if (report(useSim.getState().act((sim, ctx) => adminRelease(sim, ctx, tok.id, outcome.id, comment)), `${obj.number} released as “${outcome.label}”.`)) setComment('')
  }

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
            {needsComment ? 'A comment is required for this outcome.' : tok.userId ? 'Released on behalf of the assignee.' : 'No one holds it; released by the administrator.'}
          </span>
          <Button variant="primary" icon={<CircleCheck size={14} />} disabled={!outcome || needsComment} onClick={release}>
            Release
          </Button>
        </div>
      </div>
    </div>
  )
}

function ItemRow({ obj }: { obj: SimObject }) {
  const setPriority = (p: Priority) => report(useSim.getState().act((sim, ctx) => adminSetPriority(sim, ctx, obj.id, p)), `${obj.number} is now ${p} priority.`)
  const cancel = () => {
    const why = window.prompt(`Cancel ${obj.number}? Every branch is withdrawn. Reason (recorded in the history):`)
    if (why === null) return
    report(useSim.getState().act((sim, ctx) => adminCancel(sim, ctx, obj.id, why)), `${obj.number} cancelled.`)
  }
  return (
    <div className="flex items-end gap-2 border-t border-slate-100 pt-3">
      <div className="flex-1">
        <RowLabel>Priority (whole item)</RowLabel>
        <Select value={obj.priority} onChange={(e) => setPriority(e.target.value as Priority)}>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p[0]!.toUpperCase() + p.slice(1)}
            </option>
          ))}
        </Select>
      </div>
      <Button variant="danger" icon={<Ban size={14} />} onClick={cancel}>
        Cancel item
      </Button>
    </div>
  )
}
