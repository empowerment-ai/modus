import { itemLabel } from './lists'
import type { Condition, FieldDef, FieldType, ListDef, ObjectType, Operator, Rule, User } from './types'
import { currencyShort } from './util'

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

export function evaluateCondition(cond: Condition | undefined, type: ObjectType, data: Record<string, unknown>): boolean {
  if (!cond || cond.rules.length === 0) return false
  const results = cond.rules.map((r) =>
    evaluateRule(
      r,
      type.fields.find((f) => f.id === r.fieldId),
      data,
    ),
  )
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
  const field = ctx.type.fields.find((f) => f.id === rule.fieldId)
  if (!field) return 'Pick a field'
  const op = OPERATOR_LABEL[rule.op]
  if (!operatorNeedsValue(rule.op)) return `${field.label} ${op}`
  return `${field.label} ${op} ${describeValue(field, rule.value, ctx)}`
}

export function describeCondition(cond: Condition | undefined, ctx: DescribeCtx): string {
  if (!cond || cond.rules.length === 0) return 'No rule yet'
  return cond.rules.map((r) => describeRule(r, ctx)).join(cond.match === 'all' ? ' and ' : ' or ')
}
