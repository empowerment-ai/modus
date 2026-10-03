// Design-time model: everything an administrator builds in the studio.
// The engine (src/engine) reads these definitions directly, which is what makes
// the tool "model-driven": edit the map and live work follows it.

export type Id = string

// ---------- Organization & security ----------

/**
 * Organization-wide roles. Everyone can work the steps their groups are given;
 * these add rights on top. Supervising a process or a step is configured on the
 * workflow and the step themselves (see `Audience`).
 * - admin:    everything, including every item and the design
 * - designer: can change designs in the studio
 * - auditor:  can see every item and its history, change nothing
 */
export type OrgRole = 'admin' | 'designer' | 'auditor'

/** A set of people: named users and/or everyone in some groups. */
export interface Audience {
  userIds?: Id[]
  groupIds?: Id[]
}

export interface User {
  id: Id
  name: string
  title: string
  color: string
  roles?: OrgRole[]
  /** Simulated handling speed: 1 = average, 0.7 = 30% faster, 1.4 = slower. */
  speed: number
  /** Unavailable users get no new work; whatever is already in their basket stays put. */
  available: boolean
}

export type GroupKind = 'team' | 'distribution'

export interface Group {
  id: Id
  name: string
  memberIds: Id[]
  supervisorId?: Id
  /**
   * `team` (default) does the work at steps. `distribution` is a group of dispatchers
   * who hand work out to the members of a team (several supervisors sharing the job).
   */
  kind?: GroupKind
  description?: string
}

export interface TypePermission {
  create: boolean
  read: boolean
  update: boolean
  delete: boolean
}

// ---------- Lists (flat or linked / cascading) ----------

export interface ListItem {
  id: Id
  label: string
  /** null for top-level items; otherwise the id of the item one level up. */
  parentId: Id | null
}

export interface ListDef {
  id: Id
  name: string
  /** One entry per level, e.g. ["Model Year", "Make", "Model"]. A flat list has one level. */
  levels: string[]
  items: ListItem[]
}

// ---------- Object types (the "application") ----------

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'currency'
  | 'date'
  | 'boolean'
  | 'choice'
  | 'user'
  | 'email'
  | 'attachment'
  | 'table'

/** Column types allowed inside a table (multi-row) field. */
export type ColumnType = 'text' | 'number' | 'currency' | 'date' | 'boolean' | 'choice' | 'user' | 'email'

/** One column of a table field (e.g. an invoice line's Quantity). */
export interface ColumnDef {
  id: Id
  label: string
  type: ColumnType
  required?: boolean
  /** choice: a flat list (or the first level of a linked list). */
  listId?: Id
  min?: number
  max?: number
  /** Relative width in the grid (default 1). */
  width?: number
  /** Computed column, e.g. Line Total = Quantity × Unit Price. Read-only in forms. */
  formula?: { op: 'multiply' | 'add'; of: [Id, Id] }
}

/** A row of a table field: an id plus one value per column. */
export type TableRow = { id: Id } & Record<Id, unknown>

export interface FieldDef {
  id: Id
  label: string
  type: FieldType
  required?: boolean
  helpText?: string
  width: 'full' | 'half'
  /** choice: list it draws from, which level of that list, and (level > 0) the field holding the parent level. */
  listId?: Id
  level?: number
  parentFieldId?: Id
  /** number / currency bounds; also used to generate realistic simulated values. */
  min?: number
  max?: number
  /** Show on work cards and in the object table. */
  summary?: boolean
  /** Set by the system or a workflow step; not shown on the create form. */
  system?: boolean
  /** table: the columns of each row (line items, contacts, dependents…). */
  columns?: ColumnDef[]
  minRows?: number
  maxRows?: number
  /**
   * number / currency: keep this field equal to the sum of a table column
   * (an invoice's Amount = the sum of its lines' Line Total). Read-only in forms.
   */
  total?: { tableFieldId: Id; columnId: Id }
  /**
   * Sensitive data: only members of these groups can see the field, anywhere.
   * Everyone else gets it hidden regardless of step settings. Empty/undefined = no restriction.
   */
  restrictedTo?: Id[]
}

export type Priority = 'low' | 'normal' | 'high' | 'urgent'

export interface ObjectType {
  id: Id
  name: string
  pluralName: string
  icon: string
  color: string
  numberPrefix: string
  fields: FieldDef[]
  titleFieldId?: Id
  /** A choice field whose value sets the work priority (labels containing low/high/urgent/critical). */
  priorityFieldId?: Id
  permissions: Record<Id, TypePermission>
}

// ---------- Conditions (decisions on object metadata) ----------

export type Operator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'empty'
  | 'notEmpty'
  | 'isTrue'
  | 'isFalse'

export interface Rule {
  id: Id
  /** A field id, or a work attribute: `$priority` (low/normal/high/urgent) or `$expedited` (yes/no). */
  fieldId: Id
  op: Operator
  value?: string | number
  /**
   * Table fields: what to test. `count` compares the number of rows; `sum`,
   * `min`, `max` compare an aggregate of `columnId`; `any` / `all` test the
   * column value row by row.
   */
  aggregate?: 'count' | 'sum' | 'min' | 'max' | 'any' | 'all'
  columnId?: Id
}

export interface Condition {
  match: 'all' | 'any'
  rules: Rule[]
}

// ---------- Integrations: the service registry ----------

/**
 * How an automated step reaches the outside world.
 * - rest:   an HTTP/OpenAPI endpoint the engine calls.
 * - mcp:    a tool on a Model Context Protocol server.
 * - worker: a registered worker pool that polls for jobs on a topic (the classic
 *           "device" / external-task pattern); its size limits throughput.
 * - agent:  an AI agent with a goal, tools and a confidence score.
 * - email:  outbound mail / notifications.
 */
export type ServiceKind = 'rest' | 'mcp' | 'worker' | 'agent' | 'email'

export type ServiceStatus = 'online' | 'degraded' | 'offline'

export interface ServiceOutput {
  key: string
  label: string
  type: 'boolean' | 'number' | 'text' | 'choice'
  /** Simulation: share of calls returning true (boolean). */
  trueRate?: number
  /** Simulation: value range (number). */
  min?: number
  max?: number
  /** Simulation: possible values (choice/text). */
  options?: string[]
}

export interface ServiceOperation {
  id: Id
  /** REST: "POST /payables"; MCP: tool name; worker: job type; agent: skill. */
  name: string
  description?: string
  /** Simulated average duration of one call, in minutes (decimals allowed). */
  avgMinutes: number
  /** Simulated share of calls that succeed (0..1). */
  successRate: number
  outputs: ServiceOutput[]
}

export interface ServiceDef {
  id: Id
  name: string
  kind: ServiceKind
  description?: string
  /** Base URL, MCP server address, or worker topic. */
  endpoint: string
  auth?: 'none' | 'api-key' | 'oauth2' | 'mtls' | 'managed-identity'
  /** Name of the credential in the secret store. Never the secret itself. */
  secretRef?: string
  /** Most calls in flight at once (worker pool size, rate limit). Undefined = unlimited. */
  concurrency?: number
  status: ServiceStatus
  operations: ServiceOperation[]
  owner?: string
}

// ---------- Workflow ----------

export type Distribution = 'load-balance' | 'queue' | 'manager' | 'direct' | 'field'

export type ActionDef =
  | { id: Id; kind: 'setField'; fieldId: Id; value: string }
  | { id: Id; kind: 'notify'; to: string; message: string }
  | { id: Id; kind: 'integration'; system: string; resultFieldId?: Id; successRate: number }

export interface Outcome {
  id: Id
  label: string
  /** Share of simulated users who choose this outcome (weights; need not sum to 100). */
  weight: number
  requireComment?: boolean
  actions: ActionDef[]
}

export type FieldAccess = 'edit' | 'read' | 'hidden'

/**
 * Workflow-wide field security: lock (read-only) or hide a field everywhere in
 * this workflow, or only once the item has passed a given step.
 */
export interface FieldLock {
  id: Id
  fieldId: Id
  access: 'read' | 'hidden'
  when: 'always' | 'after'
  afterNodeId?: Id
  /** Groups the lock does not apply to (e.g. leadership may still correct a locked amount). */
  exemptGroupIds?: Id[]
}

export type TriggerKind = 'form' | 'api' | 'event' | 'schedule' | 'email'

export interface StartData {
  label: string
  /** How new items enter: a person fills the form, an API/webhook call, an event stream, a schedule, an inbox. */
  trigger?: TriggerKind
  /** Event topic, cron expression, webhook path or mailbox, depending on the trigger. */
  source?: string
}

export interface Escalation {
  /** Raise the item's priority one level. */
  raisePriority: boolean
  /** Send it back to the distribution group (or supervisor) to be handed out again. */
  toDistributors: boolean
  /** Notify the step's and the process's supervisors. */
  notifySupervisors?: boolean
  /** Who to notify, e.g. "Supervisor". Empty for no notification. */
  notify?: string
}

export interface UserStepData {
  label: string
  description?: string
  distribution: Distribution
  groupId?: Id
  /** Direct assignment target. */
  userId?: Id
  /**
   * `field` distribution: a person field on the item names who gets it (the requester,
   * the officer who responded, the manager on record). Falls back to load balancing
   * across the group when the field is empty.
   */
  assigneeFieldId?: Id
  /** Manager distribution: the supervisor who hands out the work (defaults to the group's supervisor). */
  supervisorId?: Id
  /** Manager distribution: a distribution group whose members (dispatchers) hand out the work. */
  distributorGroupId?: Id
  /** Manager distribution: simulate the dispatchers handing out work on a schedule. */
  autoDistribute: boolean
  distributeEveryMinutes: number
  avgMinutes: number
  slaHours?: number
  /** Escalate items still here after this many hours (half as long for expedited items). */
  escalateAfterHours?: number
  escalation?: Escalation
  /** Workers may hand an item to someone else in the same group. */
  allowDelegate?: boolean
  /**
   * Task supervisors: who oversees the work at this step (reassign within the
   * group, release on someone's behalf, receive escalations). The work group's
   * own supervisor always counts too.
   */
  supervisors?: Audience
  /**
   * Separation of duties (four eyes): nobody who released any of these steps on
   * this item may work this one.
   */
  separateFrom?: Id[]
  outcomes: Outcome[]
  fieldAccess: Record<Id, FieldAccess>
}

export type FailurePolicy = 'route' | 'manual' | 'stuck'

export interface AutoStepData {
  label: string
  description?: string
  /** Processing time when no service is bound (built-in actions only). */
  avgMinutes: number
  /** Built-in actions, run after a successful call. */
  actions: ActionDef[]
  /** Registered service and operation this step calls. */
  serviceId?: Id
  operationId?: Id
  /** Request parameters: literal values or {field:<id>} / {number} placeholders. */
  inputs?: Record<string, string>
  /** Where each result value is stored on the object. */
  outputs?: Array<{ key: string; fieldId: Id }>
  /** Automatic retries before the call counts as failed. */
  retries?: number
  /**
   * When the call fails: `route` follows the step's "Failed" path; `manual` hands
   * the item to a person in the fallback group; `stuck` parks it for an administrator.
   */
  onFailure?: FailurePolicy
  /** People who can do this step by hand when automation fails or an administrator reassigns it. */
  fallbackGroupId?: Id
}

export interface DecisionData {
  label: string
}

export interface SplitData {
  label: string
  /** `all`: every path runs in parallel (broadcast). `inclusive`: every path whose rule matches. */
  mode: 'all' | 'inclusive'
}

export interface JoinData {
  label: string
  /** `all`: wait for every branch (rendezvous). `any`: continue with the first. `count`: continue after N. */
  mode: 'all' | 'any' | 'count'
  count?: number
  /** For `any`/`count`: withdraw the branches still running once the join continues. */
  cancelRemaining?: boolean
}

export interface SubflowData {
  label: string
  description?: string
  /** The workflow (kind `subflow`) that runs inside this step. */
  workflowId?: Id
}

export interface WaitData {
  label: string
  minutes: number
}

export interface EndData {
  label: string
  result: 'completed' | 'rejected' | 'cancelled'
  /**
   * Inside a subflow: the name of this ending as seen by the step that runs the
   * subflow ("Approved", "Returned"). Paths leaving that step route on it.
   * Defaults to the result.
   */
  outcome?: string
  /**
   * Stop the whole item here, withdrawing any parallel branches still running.
   * Defaults to true for rejected/cancelled ends and false for completed ends
   * (a completed branch simply ends while the others carry on).
   */
  terminate?: boolean
}

export type WfNode =
  | { id: Id; type: 'start'; position: XY; data: StartData }
  | { id: Id; type: 'user'; position: XY; data: UserStepData }
  | { id: Id; type: 'auto'; position: XY; data: AutoStepData }
  | { id: Id; type: 'decision'; position: XY; data: DecisionData }
  | { id: Id; type: 'split'; position: XY; data: SplitData }
  | { id: Id; type: 'join'; position: XY; data: JoinData }
  | { id: Id; type: 'subflow'; position: XY; data: SubflowData }
  | { id: Id; type: 'wait'; position: XY; data: WaitData }
  | { id: Id; type: 'end'; position: XY; data: EndData }

export type WfNodeType = WfNode['type']

export type NodeOf<T extends WfNodeType> = Extract<WfNode, { type: T }>

export interface XY {
  x: number
  y: number
}

/** Outcome ids used on paths leaving an automated step. */
export const AUTO_SUCCESS = 'success'
export const AUTO_FAILURE = 'failure'

export interface EdgeData {
  /**
   * Leaving a user step: which outcome takes this path.
   * Leaving an automated step: `success` or `failure`.
   * Leaving a subflow: the subflow's result (`completed`, `rejected`, `cancelled`).
   */
  outcomeId?: Id
  /** Leaving a decision (or inclusive split): the rule set that selects this branch. Checked in `order`. */
  condition?: Condition
  isDefault?: boolean
  order?: number
}

export interface WfEdge {
  id: Id
  source: Id
  target: Id
  sourceHandle?: string | null
  targetHandle?: string | null
  data: EdgeData
}

export interface Workflow {
  id: Id
  name: string
  description?: string
  /** `process` items start here when created; `subflow` runs only inside a subflow step. */
  kind?: 'process' | 'subflow'
  objectTypeId: Id
  nodes: WfNode[]
  edges: WfEdge[]
  /** Simulated arrivals of new objects (e.g. scanned invoices, camera events). */
  arrivalsPerHour: number
  /** Target time to finish an item, in hours. Sets each item's due date. */
  targetHours?: number
  fieldLocks?: FieldLock[]
  /** The template this workflow was created from, if any. */
  templateId?: Id
  /** Process supervisors: oversee every item in this workflow (and the subflows it runs). */
  supervisors?: Audience
  /** Expedited items: who may flag them, and how much faster they must move. */
  expedite?: ExpeditePolicy
}

/**
 * Expediting puts an item at the front of every queue and basket, tightens its
 * due dates, and lets rules route it on a fast lane (`$expedited`).
 */
export interface ExpeditePolicy {
  /** Who may flag an item: anyone who can see it, only the requester (and supervisors), or only supervisors. */
  who: 'anyone' | 'requester' | 'supervisors'
  /** Due-date multiplier for expedited items (0.5 = twice as fast). */
  slaFactor: number
  /** Simulation: share of new items that arrive already expedited. */
  simulateRate?: number
  /** A reason is required when flagging. */
  requireReason?: boolean
}

// ---------- Templates ----------

export interface Template {
  id: Id
  name: string
  description: string
  category: string
  /** Fields the template's rules, forms and actions use; mapped onto the target object type when used. */
  fields: FieldDef[]
  /** Lists those fields draw from (copied into the app if missing). */
  lists?: ListDef[]
  nodes: WfNode[]
  edges: WfEdge[]
  builtIn?: boolean
  createdBy?: string
  createdAt?: string
  tags?: string[]
}

// ---------- Application ----------

export interface App {
  id: Id
  name: string
  description: string
  color: string
  objectTypes: ObjectType[]
  lists: ListDef[]
  workflows: Workflow[]
}

export interface Design {
  apps: App[]
  users: User[]
  groups: Group[]
  /** Organization-wide registry of systems automated steps can call. */
  services: ServiceDef[]
  /** Organization-wide library of reusable subflows. */
  templates: Template[]
}
