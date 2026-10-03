import { itemLabel } from './lists'
import { columnSum, rowsOf } from './tables'
import type { ColumnDef, Condition, FieldDef, FieldType, ListDef, ObjectType, Operator, Rule, User } from './types'
import { currencyShort } from './util'

// ---------- Work attributes rules can test besides the item's own fields ----------

/** Pseudo-fields for rules: the item's work priority and whether it is expedited. */
export const META_FIELDS: FieldDef[] = [
  { id: '$priority', label: 'Work priority', type: 'text', width: 'half', helpText: 'low, normal, high or urgent' },
  { id: '$expedited', label: 'Expedited', type: 'boolean', width: 'half' },
]

/** The field a rule refers to: one of the type's fields, or a work attribute. */
export function ruleField(type: ObjectType, fieldId: string): FieldDef | undefined {
  return type.fields.find((f) => f.id === fieldId) ?? META_FIELDS.find((f) => f.id === fieldId)
}

/** Item data plus its work attributes, the shape rules are evaluated against. */
export function withMeta(data: Record<string, unknown>, meta: { priority?: string; expedited?: boolean }): Record<string, unknown> {
  return { ...data, $priority: meta.priority ?? 'normal', $expedited: !!meta.expedited }
}

export const AGGREGATE_LABEL: Record<NonNullable<Rule['aggregate']>, string> = {
  count: 'number of rows',
  sum: 'sum of',
  min: 'lowest',
  max: 'highest',
  any: 'any row where',
  all: 'every row where',
}

/** A column seen as a field, so the usual operators and value pickers apply to it. */
export function columnAsField(c: ColumnDef): FieldDef {
  return { id: c.id, label: c.label, type: c.type, width: 'half', listId: c.listId, level: c.listId ? 0 : undefined, min: c.min, max: c.max }
}

export const OPERATOR_LABEL: Record<Operator, string> = {
  eq: 'is',
  neq: 'is not',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  contains: 'contains',
  empty: 'is empty',
  notEmpty: 'has a value',
  isTrue: 'is Yes',
  isFalse: 'is No',
}

export function operatorsFor(type: FieldType): Operator[] {
  switch (type) {
    case 'number':
    case 'currency':
      return ['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'empty', 'notEmpty']
    case 'date':
      return ['lt', 'gt', 'eq', 'empty', 'notEmpty']
    case 'boolean':
      return ['isTrue', 'isFalse']
    case 'choice':
    case 'user':
      return ['eq', 'neq', 'empty', 'notEmpty']
    case 'attachment':
      return ['notEmpty', 'empty']
    default:
      return ['eq', 'neq', 'contains', 'empty', 'notEmpty']
  }
}

export function operatorNeedsValue(op: Operator): boolean {
  return !['empty', 'notEmpty', 'isTrue', 'isFalse'].includes(op)
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
}

export function evaluateRule(rule: Rule, field: FieldDef | undefined, data: Record<string, unknown>): boolean {
  if (!field) return false
  if (field.type === 'table') return evaluateTableRule(rule, field, data)
  const v = data[field.id]
  switch (rule.op) {
    case 'empty':
      return isEmpty(v)
    case 'notEmpty':
      return !isEmpty(v)
    case 'isTrue':
      return v === true
    case 'isFalse':
      return v !== true
  }
  if (isEmpty(v)) return false
  if (field.type === 'number' || field.type === 'currency') {
    const a = Number(v)
    const b = Number(rule.value)
    if (Number.isNaN(a) || Number.isNaN(b)) return false
    switch (rule.op) {
      case 'eq':
        return a === b
      case 'neq':
        return a !== b
      case 'gt':
        return a > b
      case 'gte':
        return a >= b
      case 'lt':
        return a < b
      case 'lte':
        return a <= b
      default:
        return false
    }
  }
  const a = String(v).toLowerCase()
  const b = String(rule.value ?? '').toLowerCase()
  switch (rule.op) {
    case 'eq':
      return a === b
    case 'neq':
      return a !== b
    case 'contains':
      return a.includes(b)
    // ISO dates compare correctly as strings.
    case 'gt':
    case 'gte':
      return rule.op === 'gt' ? a > b : a >= b
    case 'lt':
    case 'lte':
      return rule.op === 'lt' ? a < b : a <= b
  }
  return false
}

/** Table fields: test the row count, an aggregate of a column, or a column row by row. */
function evaluateTableRule(rule: Rule, field: FieldDef, data: Record<string, unknown>): boolean {
  const rows = rowsOf(data[field.id])
  const agg = rule.aggregate ?? 'count'
  const number = (n: number) => evaluateRule({ ...rule, aggregate: undefined, columnId: undefined }, { id: '_', label: '', type: 'number', width: 'half' }, { _: n })
  if (agg === 'count') return number(rows.length)
  const col = field.columns?.find((c) => c.id === rule.columnId)
  if (!col) return false
  if (agg === 'sum') return number(columnSum(rows, col.id))
  if (agg === 'min' || agg === 'max') {
    const values = rows.map((r) => Number(r[col.id])).filter((n) => !Number.isNaN(n))
    if (!values.length) return false
    return number(agg === 'min' ? Math.min(...values) : Math.max(...values))
  }
  const cell = columnAsField(col)
  const test = (r: Record<string, unknown>) => evaluateRule({ ...rule, aggregate: undefined, columnId: undefined, fieldId: col.id }, cell, r)
  return agg === 'any' ? rows.some(test) : rows.length > 0 && rows.every(test)
}

export function evaluateCondition(cond: Condition | undefined, type: ObjectType, data: Record<string, unknown>): boolean {
  if (!cond || cond.rules.length === 0) return false
  const results = cond.rules.map((r) => evaluateRule(r, ruleField(type, r.fieldId), data))
  return cond.match === 'all' ? results.every(Boolean) : results.some(Boolean)
}

export interface DescribeCtx {
  type: ObjectType
  lists: ListDef[]
  users: User[]
}

export function describeValue(field: FieldDef, value: unknown, ctx: Omit<DescribeCtx, 'type'>): string {
  if (field.type === 'currency') return currencyShort.format(Number(value) || 0)
  if (field.type === 'choice')
    return itemLabel(
      ctx.lists.find((l) => l.id === field.listId),
      value,
    ) || '?'
  if (field.type === 'user') return ctx.users.find((u) => u.id === value)?.name ?? '?'
  return String(value ?? '')
}

export function describeRule(rule: Rule, ctx: DescribeCtx): string {
  const field = ruleField(ctx.type, rule.fieldId)
  if (!field) return 'Pick a field'
  const op = OPERATOR_LABEL[rule.op]
  if (field.type === 'table') {
    const agg = rule.aggregate ?? 'count'
    const col = field.columns?.find((c) => c.id === rule.columnId)
    const value = (f: FieldDef) => (operatorNeedsValue(rule.op) ? ` ${describeValue(f, rule.value, ctx)}` : '')
    if (agg === 'count') return `${field.label}: ${AGGREGATE_LABEL.count} ${op}${value({ id: '_', label: '', type: 'number', width: 'half' })}`
    if (!col) return `${field.label}: pick a column`
    const cell = columnAsField(col)
    if (agg === 'any' || agg === 'all') return `${field.label}: ${AGGREGATE_LABEL[agg]} ${col.label} ${op}${value(cell)}`
    return `${field.label}: ${AGGREGATE_LABEL[agg]} ${col.label} ${op}${value(cell)}`
  }
  if (!operatorNeedsValue(rule.op)) return `${field.label} ${op}`
  return `${field.label} ${op} ${describeValue(field, rule.value, ctx)}`
}

export function describeCondition(cond: Condition | undefined, ctx: DescribeCtx): string {
  if (!cond || cond.rules.length === 0) return 'No rule yet'
  return cond.rules.map((r) => describeRule(r, ctx)).join(cond.match === 'all' ? ' and ' : ' or ')
}
