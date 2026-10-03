import { Plus, Trash2 } from 'lucide-react'
import { Button, IconButton, Input, Segmented, Select } from '../../../components/ui'
import { AGGREGATE_LABEL, columnAsField, META_FIELDS, OPERATOR_LABEL, operatorNeedsValue, operatorsFor, ruleField } from '@modus-bpm/core/model/conditions'
import { itemDepth } from '@modus-bpm/core/model/lists'
import type { ColumnDef, Condition, FieldDef, ListDef, ObjectType, Operator, Rule, User } from '@modus-bpm/core/model/types'
import { PRIORITIES } from '@modus-bpm/core'
import { uid } from '@modus-bpm/core/model/util'

type Aggregate = NonNullable<Rule['aggregate']>

const AGGREGATES: Aggregate[] = ['count', 'sum', 'min', 'max', 'any', 'all']
const NUMERIC = new Set(['number', 'currency'])
/** Comparing a number (a row count, a sum, the lowest or highest value). */
const COMPARE: Operator[] = ['gt', 'gte', 'lt', 'lte', 'eq', 'neq']
const COUNT_FIELD: FieldDef = { id: '_count', label: 'Rows', type: 'number', width: 'half' }

/** Columns an aggregate can use: numbers for sum, lowest and highest; anything row by row. */
function columnsFor(table: FieldDef, agg: Aggregate): ColumnDef[] {
  const cols = table.columns ?? []
  if (agg === 'count') return []
  return agg === 'any' || agg === 'all' ? cols : cols.filter((c) => NUMERIC.has(c.type))
}

/**
 * What a rule actually compares, and how: the field (or table column) whose type
 * picks the operators and the value editor.
 */
function ruleTarget(type: ObjectType, rule: Rule): { field?: FieldDef; value?: FieldDef; ops: Operator[] } {
  const field = ruleField(type, rule.fieldId)
  if (!field) return { ops: [] }
  if (field.id === '$priority') return { field, value: field, ops: ['eq', 'neq'] }
  if (field.type !== 'table') return { field, value: field, ops: operatorsFor(field.type) }
  const agg = rule.aggregate ?? 'count'
  if (agg === 'count') return { field, value: COUNT_FIELD, ops: COMPARE }
  const col = field.columns?.find((c) => c.id === rule.columnId)
  if (!col) return { field, ops: [] }
  const cell = columnAsField(col)
  return { field, value: cell, ops: agg === 'any' || agg === 'all' ? operatorsFor(cell.type) : COMPARE }
}

/** A sensible first rule on a field: tables start with "number of rows > 0". */
function freshRule(field: FieldDef, id = uid('r')): Rule {
  if (field.type === 'table') return { id, fieldId: field.id, aggregate: 'count', op: 'gt', value: 0 }
  if (field.id === '$priority') return { id, fieldId: field.id, op: 'eq', value: 'urgent' }
  return { id, fieldId: field.id, op: operatorsFor(field.type)[0]! }
}

/** Rule builder for a decision branch: "Amount > 1000 and Department is Facilities". */
export function ConditionEditor({ condition, onChange, type, lists, users }: { condition: Condition; onChange: (c: Condition) => void; type: ObjectType; lists: ListDef[]; users: User[] }) {
  const replaceRule = (i: number, rule: Rule) => onChange({ ...condition, rules: condition.rules.map((r, j) => (j === i ? rule : r)) })
  const setRule = (i: number, patch: Partial<Rule>) => replaceRule(i, { ...condition.rules[i]!, ...patch })
  const addRule = () => {
    const f = type.fields[0] ?? META_FIELDS[0]!
    onChange({ ...condition, rules: [...condition.rules, freshRule(f)] })
  }

  /** Switch what a table rule measures, keeping the column when it still fits. */
  const setAggregate = (i: number, rule: Rule, table: FieldDef, agg: Aggregate) => {
    const cols = columnsFor(table, agg)
    const columnId = agg === 'count' ? undefined : cols.some((c) => c.id === rule.columnId) ? rule.columnId : cols[0]?.id
    const next: Rule = { id: rule.id, fieldId: rule.fieldId, aggregate: agg, columnId, op: 'gt' }
    const { ops } = ruleTarget(type, next)
    replaceRule(i, { ...next, op: ops.includes(rule.op) ? rule.op : (ops[0] ?? 'gt'), value: agg === 'count' ? 0 : undefined })
  }

  const setColumn = (i: number, rule: Rule, columnId: string) => {
    const next: Rule = { ...rule, columnId, value: undefined }
    const { ops } = ruleTarget(type, next)
    replaceRule(i, { ...next, op: ops.includes(rule.op) ? rule.op : (ops[0] ?? 'eq') })
  }

  return (
    <div className="space-y-2">
      {condition.rules.length > 1 && (
        <div className="flex items-center gap-2 text-xs text-slate-600">
          Match
          <Segmented
            size="sm"
            value={condition.match}
            onChange={(match) => onChange({ ...condition, match })}
            options={[
              { value: 'all', label: 'all rules' },
              { value: 'any', label: 'any rule' },
            ]}
          />
        </div>
      )}
      {condition.rules.map((rule, i) => {
        const { field, value: valueField, ops } = ruleTarget(type, rule)
        const table = field?.type === 'table' ? field : undefined
        const agg = rule.aggregate ?? 'count'
        const cols = table ? columnsFor(table, agg) : []
        return (
          <div key={rule.id} className="rounded-lg border border-amber-200 bg-amber-50/50 p-2">
            <div className="mb-1.5 flex items-center gap-1.5">
              <span className="w-9 text-[10.5px] font-semibold text-amber-800 uppercase">{i === 0 ? 'When' : condition.match === 'all' ? 'and' : 'or'}</span>
              <Select
                value={rule.fieldId}
                className="min-w-0 flex-1"
                aria-label="Field"
                onChange={(e) => {
                  const nf = ruleField(type, e.target.value)
                  if (nf) replaceRule(i, freshRule(nf, rule.id))
                }}
              >
                {!field && <option value={rule.fieldId}>Missing field</option>}
                <optgroup label={`${type.name} fields`}>
                  {type.fields.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                      {f.type === 'table' ? ' (rows)' : ''}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="About the work">
                  {META_FIELDS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </optgroup>
              </Select>
              <IconButton label="Remove rule" onClick={() => onChange({ ...condition, rules: condition.rules.filter((_, j) => j !== i) })}>
                <Trash2 size={13} />
              </IconButton>
            </div>
            {table && (
              <div className="mb-1.5 flex items-center gap-1.5 pl-[42px]">
                <Select value={agg} className="w-[150px] shrink-0" aria-label="What to check" onChange={(e) => setAggregate(i, rule, table, e.target.value as Aggregate)}>
                  {AGGREGATES.map((a) => (
                    <option key={a} value={a} disabled={a !== 'count' && !columnsFor(table, a).length}>
                      {AGGREGATE_LABEL[a]}
                    </option>
                  ))}
                </Select>
                {agg !== 'count' && (
                  <Select value={rule.columnId ?? ''} className="min-w-0 flex-1" aria-label="Column" onChange={(e) => setColumn(i, rule, e.target.value)}>
                    {!cols.some((c) => c.id === rule.columnId) && <option value={rule.columnId ?? ''}>{rule.columnId ? 'Missing column' : 'Pick a column…'}</option>}
                    {cols.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                )}
              </div>
            )}
            {ops.length > 0 && (
              <div className="flex items-center gap-1.5 pl-[42px]">
                <Select value={rule.op} className="w-[118px] shrink-0" aria-label="Comparison" onChange={(e) => setRule(i, { op: e.target.value as Rule['op'] })}>
                  {!ops.includes(rule.op) && <option value={rule.op}>{OPERATOR_LABEL[rule.op]}</option>}
                  {ops.map((op) => (
                    <option key={op} value={op}>
                      {OPERATOR_LABEL[op]}
                    </option>
                  ))}
                </Select>
                {valueField && operatorNeedsValue(rule.op) && <RuleValue field={valueField} value={rule.value} lists={lists} users={users} onChange={(value) => setRule(i, { value })} />}
              </div>
            )}
          </div>
        )
      })}
      <Button size="sm" variant="subtle" icon={<Plus size={13} />} onClick={addRule}>
        Add rule
      </Button>
    </div>
  )
}

function RuleValue({ field, value, lists, users, onChange }: { field: FieldDef; value: Rule['value']; lists: ListDef[]; users: User[]; onChange: (v: Rule['value']) => void }) {
  if (field.id === '$priority')
    return (
      <Select className="min-w-0 flex-1" value={(value as string) ?? ''} aria-label="Priority" onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">Pick…</option>
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {p[0]!.toUpperCase() + p.slice(1)}
          </option>
        ))}
      </Select>
    )
  if (field.type === 'number' || field.type === 'currency')
    return (
      <div className="relative min-w-0 flex-1">
        {field.type === 'currency' && <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-slate-400">$</span>}
        <Input
          type="number"
          aria-label="Value"
          className={field.type === 'currency' ? 'pl-6 tabular-nums' : 'tabular-nums'}
          value={value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      </div>
    )
  if (field.type === 'date') return <Input type="date" aria-label="Value" className="min-w-0 flex-1" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
  if (field.type === 'choice') {
    const list = lists.find((l) => l.id === field.listId)
    const level = field.level ?? 0
    const items = list ? list.items.filter((it) => itemDepth(list, it) === level) : []
    const parentLabel = (pid: string | null) => (pid ? list?.items.find((x) => x.id === pid)?.label : undefined)
    return (
      <Select className="min-w-0 flex-1" aria-label="Value" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">Pick…</option>
        {items.map((it) => (
          <option key={it.id} value={it.id}>
            {it.label}
            {level > 0 && parentLabel(it.parentId) ? ` (${parentLabel(it.parentId)})` : ''}
          </option>
        ))}
      </Select>
    )
  }
  if (field.type === 'user')
    return (
      <Select className="min-w-0 flex-1" aria-label="Value" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">Pick…</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </Select>
    )
  return <Input className="min-w-0 flex-1" aria-label="Value" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
}
