// Design-time model: everything an administrator builds in the designer.
// The simulation engine (src/engine) reads these definitions directly, which is
// what makes the tool "model-driven": edit the map and live work follows it.

export type Id = string

// ---------- Organization & security ----------

export interface User {
  id: Id
  name: string
  title: string
  color: string
  /** Simulated handling speed: 1 = average, 0.7 = 30% faster, 1.4 = slower. */
  speed: number
  /** Unavailable users get no new work; whatever is already in their basket stays put. */
  available: boolean
}

export interface Group {
  id: Id
  name: string
  memberIds: Id[]
  supervisorId?: Id
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
}

export interface ObjectType {
  id: Id
  name: string
  pluralName: string
  icon: string
  color: string
  numberPrefix: string
  fields: FieldDef[]
  titleFieldId?: Id
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
  fieldId: Id
  op: Operator
  value?: string | number
}

export interface Condition {
  match: 'all' | 'any'
  rules: Rule[]
}

// ---------- Workflow ----------

export type Distribution = 'load-balance' | 'queue' | 'manager' | 'direct'

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

export interface StartData {
  label: string
}

export interface UserStepData {
  label: string
  description?: string
  distribution: Distribution
  groupId?: Id
  /** Direct assignment target. */
  userId?: Id
  /** Manager distribution: the supervisor who hands out the work (defaults to the group's supervisor). */
  supervisorId?: Id
  /** Manager distribution: simulate the supervisor handing out work on a schedule. */
  autoDistribute: boolean
  distributeEveryMinutes: number
  avgMinutes: number
  slaHours?: number
  outcomes: Outcome[]
  fieldAccess: Record<Id, FieldAccess>
}

export interface AutoStepData {
  label: string
  description?: string
  avgMinutes: number
  actions: ActionDef[]
}

export interface DecisionData {
  label: string
}

export interface EndData {
  label: string
  result: 'completed' | 'rejected' | 'cancelled'
}

export type WfNode =
  | { id: Id; type: 'start'; position: XY; data: StartData }
  | { id: Id; type: 'user'; position: XY; data: UserStepData }
  | { id: Id; type: 'auto'; position: XY; data: AutoStepData }
  | { id: Id; type: 'decision'; position: XY; data: DecisionData }
  | { id: Id; type: 'end'; position: XY; data: EndData }

export type WfNodeType = WfNode['type']

export interface XY {
  x: number
  y: number
}

export interface EdgeData {
  /** Leaving a user step: which outcome takes this path. */
  outcomeId?: Id
  /** Leaving a decision: the rule set that selects this branch. Checked in `order`. */
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
  objectTypeId: Id
  nodes: WfNode[]
  edges: WfEdge[]
  /** Simulated arrivals of new objects (e.g. scanned invoices). */
  arrivalsPerHour: number
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
}
