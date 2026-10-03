import { ArrowLeft, BookOpen, ChevronDown, ChevronUp, CircleHelp, EyeOff, GitFork, Lock, MapPin, MessageSquare, Play, Save, Undo2, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { FormRenderer } from '../../components/FormRenderer'
import { TypeIcon } from '../../components/icons'
import { Avatar, Badge, Button, Card, cx, IconButton, Modal, Textarea } from '../../components/ui'
import { accessFor, type Ctx, describeToken, type SimState, type WorkItem, workItem, workDelegate, workRelease, workReturn, workSave, workSetPriority, workStart } from '@modus-bpm/core'
import { objectTitle } from '@modus-bpm/core/model/format'
import type { App, Group, Id, Outcome, Priority, User } from '@modus-bpm/core/model/types'
import { formatDuration, simDate } from '@modus-bpm/core/model/util'
import { useSim } from '../../store/sim'
import { useUi } from '../../store/ui'
import { ObjectHistory } from '../objects/ObjectHistory'
import { whereNow } from './actions'
import { ExpeditedBadge } from '../objects/PriorityBadge'
import { ExpediteAction, ExpediteNote } from './Expedite'
import { isRejectLike, timeOfDay } from './format'
import { perform } from './live'
import { DueLabel, PriorityMenu, StateChip } from './parts'
import { type Draft, useWorkspace } from './store'

const NO_DRAFT: Draft = { values: {}, comment: '' }

/** Same rule the engine uses: these outcomes may leave required fields empty. */
const UNHAPPY = /reject|deny|return|cancel|could not/i

const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)

interface Props {
  tokenId: Id
  me: User
  app: App
  ctx: Ctx
  users: User[]
  groups: Group[]
  sim: SimState
  tick: string
  /** Place in the basket list, for "3 of 12" and previous / next. */
  position?: { index: number; total: number; prev?: Id; next?: Id }
  onMove: (tokenId: Id) => void
  onClose: () => void
  /** The item left your basket through your own action (release, return, delegate). */
  onDone: () => void
}

/** One work item, opened from your basket: what to do, the step's form, and how to release it. */
export function WorkItemView(props: Props) {
  const { tokenId, sim, ctx, tick, me } = props
  const item = useMemo(() => workItem(sim, ctx, tokenId), [sim, ctx, tokenId, tick])
  const holds = !!item && item.token.userId === me.id && (item.token.state === 'assigned' || item.token.state === 'working')
  if (!item || !holds) return <Gone {...props} />
  return <ItemBody key={tokenId} {...props} item={item} />
}

/** The item was taken away (reassigned, escalated, cancelled) while it was open. */
function Gone({ tokenId, sim, ctx, onClose }: Props) {
  const obj = sim.objects[tokenId.slice(0, tokenId.lastIndexOf('~'))]
  return (
    <div className="flex h-full flex-col items-center justify-center bg-white px-6 text-center">
      <p className="text-sm font-medium text-slate-800">{obj ? `${obj.number} isn’t in your basket anymore` : 'This item is gone'}</p>
      <p className="mt-1 max-w-sm text-xs text-slate-500">
        {obj ? `It is now ${whereNow(sim, ctx, obj.id)}. An administrator, a dispatcher or an escalation may have moved it.` : 'The simulation was reset or the item finished.'}
      </p>
      <div className="mt-4 flex gap-2">
        <Button onClick={onClose}>Back to my work</Button>
        {obj && (
          <Button variant="ghost" onClick={() => useWorkspace.getState().openRequest(obj.id)}>
            Follow {obj.number}
          </Button>
        )}
      </div>
    </div>
  )
}

function ItemBody({ item, me, app, ctx, users, groups, sim, tick, position, onMove, onClose, onDone }: Props & { item: WorkItem }) {
  const { token, obj, step } = item
  const type = app.objectTypes.find((t) => t.id === obj.typeId)
  const [tab, setTab] = useState<'details' | 'history'>('details')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [commentError, setCommentError] = useState('')
  const [delegating, setDelegating] = useState(false)
  const draft = useWorkspace((s) => s.drafts[token.id]) ?? NO_DRAFT
  const setDraft = useWorkspace((s) => s.setDraft)
  const clock = sim.clock

  const verdicts = useMemo(() => accessFor(sim, ctx, token.id, me.id) ?? {}, [sim, ctx, token.id, me.id, tick])
  const access = useMemo(() => Object.fromEntries(Object.entries(verdicts).map(([k, v]) => [k, v.access])), [verdicts])
  const values = useMemo(() => ({ ...obj.data, ...draft.values }), [obj.data, draft.values, tick])
  const dirty = Object.keys(draft.values).length > 0
  const nodeLabel = useMemo(() => {
    const m = new Map<Id, string>()
    for (const wf of app.workflows) for (const n of wf.nodes) m.set(n.id, n.data.label)
    return (id: Id) => m.get(id) ?? 'a removed step'
  }, [app.workflows])

  if (!type) return null
  const restricted = type.fields.filter((f) => verdicts[f.id] && verdicts[f.id]!.access !== 'edit')
  // Other active branches of the same item; identical ones (e.g. several waiting at a join) are grouped.
  const others = new Map<string, { label: string; text: string; n: number }>()
  for (const t of obj.tokens) {
    if (t.id === token.id) continue
    const label = nodeLabel(t.nodeId)
    const text = describeToken(sim, ctx, t)
    const same = others.get(`${label}|${text}`)
    if (same) same.n++
    else others.set(`${label}|${text}`, { label, text, n: 1 })
  }
  const title = objectTitle(type, obj.data, app.lists, users)
  const description = item.node.type === 'user' || item.node.type === 'auto' ? item.node.data.description : undefined
  const needComment = step.outcomes.filter((o) => o.requireComment)
  const commentId = `ws-comment-${token.id}`
  const toast = useUi.getState().toast

  // Only fields you actually changed (and may change) go into the draft.
  const onFormChange = (next: Record<string, unknown>) => {
    const changed: Record<string, unknown> = {}
    for (const k of new Set([...Object.keys(next), ...Object.keys(obj.data)])) {
      if (access[k] !== 'edit') continue
      if (JSON.stringify(next[k]) !== JSON.stringify(obj.data[k])) changed[k] = next[k]
    }
    setDraft(token.id, { values: changed })
    if (Object.keys(errors).length) setErrors({})
  }

  const finished = (text: string) => {
    useWorkspace.getState().clearDraft(token.id)
    toast(text, 'success')
    onDone()
  }

  const start = () => {
    if (perform((s, c) => workStart(s, c, token.id, me.id)).ok) toast(`Started ${obj.number}. Colleagues can see you’re on it.`)
  }

  const save = () => {
    if (!perform((s, c) => workSave(s, c, token.id, me.id, draft.values)).ok) return
    setDraft(token.id, { values: {} })
    setErrors({})
    toast(`${obj.number} saved`, 'success')
  }

  const release = (o: Outcome) => {
    if (o.requireComment && !draft.comment.trim()) {
      setCommentError(`“${o.label}” needs a comment. Say why, so the next person knows.`)
      document.getElementById(commentId)?.focus()
      return
    }
    if (!UNHAPPY.test(o.label)) {
      const missing = type.fields.filter((f) => f.required && access[f.id] === 'edit' && isEmpty(values[f.id]))
      if (missing.length) {
        setErrors(Object.fromEntries(missing.map((f) => [f.id, `Required before you ${o.label.toLowerCase()}`])))
        setTab('details')
        toast(`Fill in ${missing.map((f) => f.label).join(', ')} first.`, 'warn')
        return
      }
    }
    if (!perform((s, c) => workRelease(s, c, token.id, me.id, o.id, draft.comment, draft.values)).ok) return
    finished(`${obj.number} released as “${o.label}”. It’s now ${whereNow(sim, ctx, obj.id)}.`)
  }

  const canReturn = step.distribution !== 'direct'
  const returnTo = step.distribution === 'queue' ? 'the queue' : step.distribution === 'manager' ? 'the dispatchers' : 'the pool'
  const giveBack = () => {
    if (perform((s, c) => workReturn(s, c, token.id, me.id, draft.comment)).ok) finished(`${obj.number} went back to ${returnTo}.`)
  }

  const delegate = (toId: Id, comment: string) => {
    if (!perform((s, c) => workDelegate(s, c, token.id, me.id, toId, comment)).ok) return
    setDelegating(false)
    finished(`${obj.number} is now with ${users.find((u) => u.id === toId)?.name ?? 'your colleague'}.`)
  }

  const setPriority = (p: Priority) => {
    if (perform((s, c) => workSetPriority(s, c, obj.id, me.id, p)).ok) toast(`${obj.number} is now ${p} priority.`, 'success')
  }

  const dangers = step.outcomes.filter((o) => isRejectLike(o.label))
  const forwards = step.outcomes.filter((o) => !isRejectLike(o.label))

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-slate-200 px-3">
        <IconButton label="Back to my work (Esc)" onClick={onClose}>
          <ArrowLeft size={16} />
        </IconButton>
        <span className="text-xs text-slate-500">
          My work <span aria-hidden>›</span> <span className="font-mono font-medium text-slate-700">{obj.number}</span>
        </span>
        <div className="flex-1" />
        <ExpediteAction obj={obj} me={me} sim={sim} ctx={ctx} size="sm" />
        {position && (
          <>
            <span className="text-[11px] text-slate-500 tabular-nums">
              {position.index + 1} of {position.total}
            </span>
            <IconButton label="Previous item (k)" disabled={!position.prev} onClick={() => position.prev && onMove(position.prev)}>
              <ChevronUp size={16} />
            </IconButton>
            <IconButton label="Next item (j)" disabled={!position.next} onClick={() => position.next && onMove(position.next)}>
              <ChevronDown size={16} />
            </IconButton>
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[880px] px-6 pt-5 pb-8">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="flex h-5 w-5 items-center justify-center rounded" style={{ background: `${type.color}1a`, color: type.color }}>
              <TypeIcon name={type.icon} size={12} />
            </span>
            <span className="font-mono font-medium text-slate-700">{obj.number}</span>
            <span aria-hidden>·</span>
            <span>{type.name}</span>
          </div>
          <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-slate-900">{title || `${type.name} ${obj.number}`}</h2>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {item.expedited && <ExpeditedBadge reason={obj.expedite?.reason} />}
            <PriorityMenu priority={obj.priority} onChange={setPriority} />
            <StateChip state={token.state} />
            <DueChip label="Step" due={item.stepDue} clock={clock} />
            <DueChip label="Case" due={item.caseDue} clock={clock} />
            <span className="text-[11px] text-slate-500">
              {formatDuration(item.age)} at this step
              {token.state === 'working' && token.startedAt !== undefined && ` · working since ${timeOfDay(simDate(token.startedAt))}`}
            </span>
          </div>

          <div className="mt-3 space-y-1 text-[13px] text-slate-600">
            <ExpediteNote obj={obj} clock={clock} />
            <p className="flex items-center gap-1.5">
              <MapPin size={13} className="shrink-0 text-slate-400" />
              At <span className="font-medium text-slate-900">{step.label}</span>
              <span className="text-slate-400">in {item.path}</span>
            </p>
            {[...others].map(([key, b]) => (
              <p key={key} className="flex items-center gap-1.5">
                <GitFork size={13} className="shrink-0 text-indigo-400" />
                Also at <span className="font-medium text-slate-800">{b.label}</span>
                {b.n > 1 && <span className="text-slate-500">({b.n} branches)</span>}
                <span className="text-slate-500">— {b.text}</span>
              </p>
            ))}
          </div>

          <div className="mt-5 flex gap-4 border-b border-slate-200" role="tablist">
            {(['details', 'history'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cx(
                  '-mb-px border-b-2 px-0.5 pb-2 text-[13px] font-medium capitalize',
                  tab === t ? 'border-brand-600 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800',
                )}
              >
                {t}
                {t === 'history' && <span className="ml-1 text-[11px] text-slate-400 tabular-nums">{obj.history.length}</span>}
              </button>
            ))}
          </div>

          {tab === 'details' ? (
            <div className="mt-4 space-y-4">
              {token.state === 'assigned' && (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-sky-200 bg-sky-50/60 px-3.5 py-2.5 text-[13px] text-sky-900">
                  <span className="min-w-0 flex-1">It’s in your basket but not started. Start it so colleagues and supervisors can see you’re on it.</span>
                  <Button size="sm" variant="primary" icon={<Play size={13} />} onClick={start}>
                    Start working
                  </Button>
                </div>
              )}

              <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-3">
                <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                  <BookOpen size={12} /> What to do
                </p>
                <p className="text-[13px] leading-relaxed text-slate-700">
                  {item.node.type === 'auto'
                    ? `The automation for “${step.label}” couldn’t finish, so it came to you. Do it by hand and fill in what the system would have returned.`
                    : description || `Review the details below, then choose ${step.outcomes.map((o) => `“${o.label}”`).join(' or ')}.`}
                </p>
                {item.node.type === 'auto' && description && <p className="mt-1 text-[13px] text-slate-600">{description}</p>}
              </div>

              <Card className="p-4">
                <FormRenderer type={type} lists={app.lists} users={users} values={values} access={access} includeSystem errors={errors} onChange={onFormChange} />
              </Card>

              {restricted.length > 0 && (
                <details className="group rounded-lg border border-slate-200 bg-white">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900">
                    <CircleHelp size={13} className="text-slate-400" />
                    Why can’t I edit some fields?
                    <span className="text-slate-400">({restricted.length})</span>
                    <ChevronDown size={13} className="ml-auto text-slate-400 transition-transform group-open:rotate-180" />
                  </summary>
                  <ul className="space-y-1.5 border-t border-slate-100 px-3 py-2.5">
                    {restricted.map((f) => {
                      const v = verdicts[f.id]!
                      return (
                        <li key={f.id} className="flex items-start gap-2 text-xs">
                          {v.access === 'hidden' ? <EyeOff size={12} className="mt-0.5 shrink-0 text-slate-400" /> : <Lock size={12} className="mt-0.5 shrink-0 text-slate-400" />}
                          <span className="font-medium text-slate-700">{f.label}</span>
                          <span className="text-slate-500">
                            {v.access === 'hidden' ? 'hidden' : 'read-only'}: {v.reason ?? 'not editable here'}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </details>
              )}
            </div>
          ) : (
            <div className="mt-4">
              <ObjectHistory obj={obj} app={app} />
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-slate-200 bg-slate-50/80 px-6 py-3">
        <div className="mx-auto max-w-[880px] space-y-2.5">
          <div>
            <Textarea
              id={commentId}
              value={draft.comment}
              onChange={(e) => {
                setDraft(token.id, { comment: e.target.value })
                if (commentError) setCommentError('')
              }}
              placeholder={needComment.length ? `Comment (needed for ${needComment.map((o) => `“${o.label}”`).join(', ')})` : 'Comment for the next person (optional)'}
              className={cx('min-h-[52px] text-[13px]', commentError && 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20')}
              aria-label="Comment"
              aria-invalid={!!commentError}
            />
            {commentError && <p className="mt-1 text-[11px] text-rose-600">{commentError}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button icon={<Save size={14} />} disabled={!dirty} onClick={save} title={dirty ? 'Save your changes without releasing' : 'No unsaved changes'}>
              Save
            </Button>
            {canReturn && (
              <Button variant="ghost" icon={<Undo2 size={14} />} onClick={giveBack} title={`Give it back to ${returnTo} for someone else to pick up`}>
                Return
              </Button>
            )}
            {step.allowDelegate && (
              <Button variant="ghost" icon={<Users size={14} />} onClick={() => setDelegating(true)} title="Hand it to a colleague in your group">
                Delegate
              </Button>
            )}
            {dirty && <span className="text-[11px] text-amber-700">Unsaved changes</span>}
            <div className="flex-1" />
            {dangers.map((o) => (
              <OutcomeButton key={o.id} outcome={o} variant="danger" onClick={() => release(o)} />
            ))}
            {forwards.map((o, i) => (
              <OutcomeButton key={o.id} outcome={o} variant={i === 0 ? 'primary' : 'secondary'} onClick={() => release(o)} />
            ))}
          </div>
        </div>
      </div>

      {delegating && <DelegateModal item={item} me={me} users={users} groups={groups} comment={draft.comment} onClose={() => setDelegating(false)} onDelegate={delegate} />}
    </div>
  )
}

function OutcomeButton({ outcome, variant, onClick }: { outcome: Outcome; variant: 'primary' | 'secondary' | 'danger'; onClick: () => void }) {
  return (
    <Button variant={variant} onClick={onClick} title={outcome.requireComment ? `Release as “${outcome.label}” (needs a comment)` : `Release as “${outcome.label}”`}>
      {outcome.requireComment && <MessageSquare size={13} className="opacity-70" />}
      {outcome.label}
    </Button>
  )
}

function DueChip({ label, due, clock }: { label: string; due: number | undefined; clock: number }) {
  if (due === undefined) return null
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px]">
      <span className="text-slate-500">{label}</span>
      <DueLabel due={due} clock={clock} />
    </span>
  )
}

/** Pick a colleague in the step's group to hand the item to. */
function DelegateModal({
  item,
  me,
  users,
  groups,
  comment,
  onClose,
  onDelegate,
}: {
  item: WorkItem
  me: User
  users: User[]
  groups: Group[]
  comment: string
  onClose: () => void
  onDelegate: (toId: Id, comment: string) => void
}) {
  const group = groups.find((g) => g.id === item.step.groupId)
  const loads = useSim.getState().views[useUi.getState().appId]?.users
  const colleagues = (group?.memberIds ?? []).filter((id) => id !== me.id).flatMap((id) => users.filter((u) => u.id === id))
  const [to, setTo] = useState<Id>(colleagues.find((u) => u.available)?.id ?? '')
  const [text, setText] = useState(comment)
  const target = colleagues.find((u) => u.id === to)
  return (
    <Modal
      open
      onClose={onClose}
      width={480}
      title={`Delegate ${item.obj.number}`}
      subtitle={`Hand it to someone else in ${group?.name ?? 'your group'}. It moves to their basket at “${item.step.label}”.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!target} onClick={() => onDelegate(to, text)}>
            {target ? `Delegate to ${target.name.split(' ')[0]}` : 'Delegate'}
          </Button>
        </>
      }
    >
      {colleagues.length === 0 ? (
        <p className="text-sm text-slate-600">No one else is in {group?.name ?? 'this step’s group'}.</p>
      ) : (
        <div className="space-y-3">
          <ul className="max-h-[300px] space-y-1 overflow-y-auto" role="radiogroup" aria-label="Colleague">
            {colleagues.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={to === u.id}
                  disabled={!u.available}
                  onClick={() => setTo(u.id)}
                  className={cx(
                    'flex w-full items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-left',
                    to === u.id ? 'border-brand-300 bg-brand-50' : 'border-transparent hover:bg-slate-50',
                    !u.available && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <Avatar name={u.name} color={u.color} size={24} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-slate-800">{u.name}</span>
                    <span className="block truncate text-[11px] text-slate-500">{u.title}</span>
                  </span>
                  {u.available ? <span className="text-[11px] text-slate-500 tabular-nums">{loads?.[u.id]?.open ?? 0} open</span> : <Badge>Out</Badge>}
                </button>
              </li>
            ))}
          </ul>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note for them (optional)" aria-label="Note" />
        </div>
      )}
    </Modal>
  )
}
