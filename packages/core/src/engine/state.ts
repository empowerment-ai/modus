// Runtime state of the engine. Everything here is plain, serializable data so a
// simulation can be cloned (what-if scenarios), saved, or replayed, and so the
// same shapes can later be persisted by a server.

import type { Group, Id, Priority, ServiceDef, User, App } from '../model/types'

/**
 * Where a token is in its step:
 * - auto:       routing, or an automated call in flight
 * - queued:     waiting for a free slot on a service (or for the service to come back online)
 * - unassigned: at a people step, waiting to be assigned / fetched / handed out
 * - assigned:   in someone's basket
 * - working:    someone is working on it right now
 * - waiting:    on a timer
 * - joining:    a parallel branch waiting at a join for its siblings
 * - stuck:      can't continue until the map is fixed or an administrator steps in
 */
export type TokenState = 'auto' | 'queued' | 'unassigned' | 'assigned' | 'working' | 'waiting' | 'joining' | 'stuck'

/** A parallel split the token is part of; joins pair with the innermost frame. */
export interface ForkFrame {
  forkId: Id
  splitId: Id
}

/** A subflow the token is running inside; popped when the subflow ends. */
export interface CallFrame {
  callId: Id
  /** The subflow step in the calling workflow. */
  nodeId: Id
  /** The calling workflow. */
  workflowId: Id
  /** How many fork frames the token had when it entered (restored on return). */
  forkDepth: number
  /** When it entered the subflow step. */
  at: number
}

/** One thread of execution through the process. An item has one or more while active. */
export interface Token {
  id: Id
  objectId: Id
  workflowId: Id
  nodeId: Id
  enteredAt: number
  state: TokenState
  userId?: Id
  assignedAt?: number
  startedAt?: number
  /** Automated call / timer / person finishes at this sim minute. */
  dueAt?: number
  /** Outcome chosen on release that had no path; retried when the map is fixed. */
  pendingOutcomeId?: Id
  stuckReason?: string
  /** Why it is queued or joining (shown to people). */
  waitReason?: string
  forks: ForkFrame[]
  calls: CallFrame[]
  /** Service whose slot an in-flight automated call holds. */
  serviceId?: Id
  /** Live mode: the worker that claimed this job, and until when (sim minute). */
  workerId?: string
  leaseUntil?: number
  /** Automated step: which attempt is running (retries). */
  attempt?: number
  /** Automated step being done by a person (automation failed or an administrator reassigned it). */
  manual?: boolean
  /** Escalation already fired at this step. */
  escalated?: boolean
}

export interface Attachment {
  name: string
  size: number
  kind: string
  /** Object URL for files uploaded in this browser session (not persisted). */
  url?: string
}

export type AuditKind =
  | 'created'
  | 'entered'
  | 'decision'
  | 'auto'
  | 'service'
  | 'assigned'
  | 'distributed'
  | 'fetched'
  | 'claimed'
  | 'started'
  | 'released'
  | 'reassigned'
  | 'delegated'
  | 'returned'
  | 'moved'
  | 'notify'
  | 'integration'
  | 'field'
  | 'split'
  | 'joined'
  | 'subflow'
  | 'waiting'
  | 'escalated'
  | 'manual'
  | 'withdrawn'
  | 'priority'
  | 'security'
  | 'completed'
  | 'stuck'

export interface AuditEntry {
  at: number
  kind: AuditKind
  nodeId?: Id
  tokenId?: Id
  userId?: Id
  actor?: string
  text: string
  comment?: string
}

export interface SimObject {
  id: Id
  number: string
  typeId: Id
  /** The process workflow it was created in. */
  workflowId: Id
  data: Record<string, unknown>
  createdAt: number
  createdBy: string
  status: 'active' | 'completed' | 'rejected' | 'cancelled'
  completedAt?: number
  /** The end step it finished at. */
  endNodeId?: Id
  priority: Priority
  /** Due date for the whole item (sim minute), from the workflow's target time. */
  dueBy?: number
  /**
   * Flagged to go faster: ahead of every queue and basket (even urgent work),
   * tighter due dates and escalations, and routable via the `$expedited` rule attribute.
   */
  expedite?: { by: string; at: number; reason?: string }
  /** Active threads of execution (one per parallel branch). Empty once finished. */
  tokens: Token[]
  tokenSeq: number
  /** Steps the item has left, in order (field locks "after step X" use this). */
  passed: Id[]
  /**
   * How a scope (the whole item, or one subflow run) ended while other branches were
   * still running. When its last branch is later absorbed at a join, the scope
   * finishes this way. Keyed by call id, or "root".
   */
  scopeEnds?: Record<string, { result: 'completed' | 'rejected' | 'cancelled'; label: string; nodeId?: Id; outcome?: string }>
  history: AuditEntry[]
}

export interface NodeStat {
  entered: number
  exited: number
  timeInStep: number
  waitTotal: number
  waitCount: number
}

export interface UserStat {
  completed: number
  busyMinutes: number
  currentId?: Id
}

export interface ServiceStat {
  inFlight: number
  calls: number
  ok: number
  failed: number
  busyMinutes: number
}

export interface ForkState {
  objectId: Id
  splitId: Id
  /** Branches started by the split. */
  expected: number
  /** Tokens waiting at the join. */
  arrived: Id[]
  /** Branches that finished somewhere else (an end step) and will never arrive. */
  ended: number
  /** The join already continued (any / N-of-M); later arrivals are absorbed. */
  closed: boolean
}

export interface FeedEntry {
  at: number
  objectId: Id
  number: string
  kind: AuditKind
  text: string
  comment?: string
  userId?: Id
  nodeId?: Id
}

export interface Flight {
  edgeId: Id
  objectId: Id
  reject: boolean
}

export interface SimState {
  appId: Id
  clock: number
  rng: number
  seq: number
  objects: Record<Id, SimObject>
  activeIds: Id[]
  users: Record<Id, UserStat>
  nodeStats: Record<Id, NodeStat>
  edgeCounts: Record<Id, number>
  services: Record<Id, ServiceStat>
  forks: Record<Id, ForkState>
  forkSeq: number
  callSeq: number
  nextArrival: Record<Id, number>
  lastDistribution: Record<Id, number>
  rrCursor: Record<Id, number>
  feed: FeedEntry[]
  series: Array<{ t: number; wip: number; done: number }>
  /** Edge traversals since the UI last drained them; used to animate tokens. */
  flights: Flight[]
  arrivals: boolean
  created: number
  completed: number
  rejected: number
  cycleTotal: number
  /** Expedited items finished, and their total cycle time (to compare with normal work). */
  expFinished?: number
  expCycleTotal?: number
}

/** Everything the engine needs from the design to run one application. */
export interface Ctx {
  app: App
  users: User[]
  groups: Group[]
  services?: ServiceDef[]
  /**
   * People driven by a real person in the Workspace instead of the simulation:
   * their baskets fill as usual, but nothing is started or released for them.
   */
  manualUserIds?: Id[]
  /**
   * Live mode (the server): no simulated arrivals or people, nobody is worked or
   * dispatched automatically, and service-bound automated steps become jobs that
   * external workers poll and complete (pollJobs / completeJob / failJob).
   */
  live?: boolean
}

export const ADMIN = 'Administrator'

export function newSim(appId: Id, seed = 20261005): SimState {
  return {
    appId,
    clock: 0,
    rng: seed,
    seq: 0,
    objects: {},
    activeIds: [],
    users: {},
    nodeStats: {},
    edgeCounts: {},
    services: {},
    forks: {},
    forkSeq: 0,
    callSeq: 0,
    nextArrival: {},
    lastDistribution: {},
    rrCursor: {},
    feed: [],
    series: [{ t: 0, wip: 0, done: 0 }],
    flights: [],
    arrivals: true,
    created: 0,
    completed: 0,
    rejected: 0,
    cycleTotal: 0,
  }
}

export const PRIORITY_RANK: Record<Priority, number> = { low: 0, normal: 1, high: 2, urgent: 3 }

/** How urgent an item is for ordering work: expedited items outrank even urgent ones. */
export function urgencyRank(obj: Pick<SimObject, 'priority' | 'expedite'> | undefined): number {
  if (!obj) return PRIORITY_RANK.normal
  return obj.expedite ? 4 : PRIORITY_RANK[obj.priority]
}
export const PRIORITIES: Priority[] = ['low', 'normal', 'high', 'urgent']

/** Work order everywhere: most urgent first, then oldest. */
export function byUrgency(when: (t: Token) => number, objectOf: (t: Token) => SimObject | undefined) {
  return (a: Token, b: Token) => {
    return urgencyRank(objectOf(b)) - urgencyRank(objectOf(a)) || when(a) - when(b)
  }
}
