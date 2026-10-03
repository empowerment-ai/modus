import { Zap, ZapOff } from 'lucide-react'
import { useState } from 'react'
import { Button, cx, Field, Modal, Textarea } from '../../components/ui'
import { canExpedite, type Ctx, setExpedite, type SimObject, type SimState } from '@modus-bpm/core'
import type { Priority, User, Workflow } from '@modus-bpm/core/model/types'
import { useUi } from '../../store/ui'
import { PriorityBadge } from '../objects/PriorityBadge'
import { agoText, dueText } from './format'
import { perform } from './live'

// Expedite: flag an item to go faster. It jumps every queue (even urgent work) and
// its due dates tighten by the process's factor. Who may do it is set per process.

/** Expedited: ahead of every queue, even urgent work. */
export function ExpeditedBadge({ className, title }: { className?: string; title?: string }) {
  return (
    <span
      className={cx('inline-flex items-center gap-0.5 rounded bg-orange-500 px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-white', className)}
      title={title ?? 'Expedited: ahead of every queue, even urgent work'}
    >
      <Zap size={11} strokeWidth={2.5} className="fill-current" />
      Expedited
    </span>
  )
}

/** The priority badge, or Expedited when the item is flagged (it outranks urgent). */
export function UrgencyBadge({ priority, expedited, quietNormal, className }: { priority: Priority; expedited: boolean; quietNormal?: boolean; className?: string }) {
  if (expedited) return <ExpeditedBadge className={className} title={`Expedited (${priority} priority): ahead of every queue, even urgent work`} />
  return <PriorityBadge priority={priority} quietNormal={quietNormal} className={className} />
}

/** How much faster expedited work must move: "2×" for a 0.5 due-date factor. */
export function speedText(wf: Workflow | undefined): string {
  const x = 1 / Math.min(1, Math.max(0.05, wf?.expedite?.slaFactor ?? 0.5))
  return `${Number.isInteger(x) ? x : x.toFixed(1)}×`
}

function whoText(wf: Workflow | undefined): string {
  const who = wf?.expedite?.who ?? 'supervisors'
  if (who === 'anyone') return 'Anyone working on it, the requester or a supervisor can expedite it.'
  if (who === 'requester') return 'The requester or a supervisor can expedite it.'
  return 'Only supervisors can expedite it.'
}

/** Who expedited it, when, and why. */
export function ExpediteNote({ obj, clock, className }: { obj: SimObject; clock: number; className?: string }) {
  if (!obj.expedite) return null
  const { by, at, reason } = obj.expedite
  return (
    <p className={cx('flex items-start gap-1.5 text-[13px] text-orange-800', className)}>
      <Zap size={13} className="mt-0.5 shrink-0 fill-orange-500 text-orange-500" />
      <span>
        Expedited by <span className="font-medium">{by}</span> {agoText(clock - at)}
        {reason && <span className="text-orange-700/90">: “{reason}”</span>}
      </span>
    </p>
  )
}

/** "Expedite" (with a dialog for the reason) or "Remove expedite", when the process lets this person do it. */
export function ExpediteAction({ obj, me, sim, ctx, size = 'md' }: { obj: SimObject; me: User; sim: SimState; ctx: Ctx; size?: 'sm' | 'md' }) {
  const [open, setOpen] = useState(false)
  if (obj.status !== 'active' || !canExpedite(sim, ctx, obj.id, me.id)) return null
  const wf = ctx.app.workflows.find((w) => w.id === obj.workflowId)
  if (obj.expedite) {
    const remove = () => {
      if (perform((s, c) => setExpedite(s, c, obj.id, me.id, false)).ok) useUi.getState().toast(`${obj.number} is no longer expedited. Its normal due date is back.`, 'success')
    }
    return (
      <Button variant="ghost" size={size} icon={<ZapOff size={13} />} onClick={remove} title="Take the expedite flag off: it goes back to its normal place and due date">
        Remove expedite
      </Button>
    )
  }
  return (
    <>
      <Button size={size} icon={<Zap size={13} className="text-orange-500" />} onClick={() => setOpen(true)} title={`Move it to the front of every queue; it must be done ${speedText(wf)} faster`}>
        Expedite
      </Button>
      {open && <ExpediteDialog obj={obj} me={me} wf={wf} clock={sim.clock} onClose={() => setOpen(false)} />}
    </>
  )
}

/** Ask why it needs to go faster (required when the process says so) and show what expediting does. */
export function ExpediteDialog({ obj, me, wf, clock, onClose }: { obj: SimObject; me: User; wf: Workflow | undefined; clock: number; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const required = !!wf?.expedite?.requireReason
  const factor = Math.min(1, Math.max(0.05, wf?.expedite?.slaFactor ?? 0.5))
  const newDue = wf?.targetHours ? Math.min(obj.dueBy ?? Infinity, obj.createdAt + wf.targetHours * 60 * factor) : undefined
  const submit = () => {
    if (!perform((s, c) => setExpedite(s, c, obj.id, me.id, true, reason)).ok) return
    useUi.getState().toast(`${obj.number} is expedited. It moves to the front of every queue.`, 'success')
    onClose()
  }
  return (
    <Modal
      open
      onClose={onClose}
      width={480}
      title={`Expedite ${obj.number}`}
      subtitle={wf?.name}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={<Zap size={14} />} disabled={required && !reason.trim()} onClick={submit}>
            Expedite
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-orange-200 bg-orange-50/70 px-3.5 py-3 text-[13px] leading-snug text-orange-950">
          <p className="flex items-start gap-2 font-medium">
            <Zap size={15} className="mt-px shrink-0 fill-orange-500 text-orange-500" />
            Expedited items go to the front of every queue and must be done {speedText(wf)} faster.
          </p>
          <p className="mt-1 pl-[23px] text-orange-900/80">
            {whoText(wf)} Keep it for real rush cases so the fast lane stays fast.
            {newDue !== undefined && obj.dueBy !== undefined && newDue < obj.dueBy && (
              <>
                {' '}
                Its due date moves from {dueText(obj.dueBy, clock)} to <span className="font-medium">{dueText(newDue, clock)}</span>.
              </>
            )}
          </p>
        </div>
        <Field
          label="Why does it need to go faster?"
          required={required}
          hint={required ? `${wf?.name ?? 'This process'} asks for a reason. Everyone working on it will see it.` : 'Optional, but it helps the people working on it.'}
        >
          <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What makes it urgent, and by when it must be done" aria-label="Reason" />
        </Field>
      </div>
    </Modal>
  )
}
