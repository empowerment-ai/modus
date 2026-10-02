import { Plus, Trash2 } from 'lucide-react'
import { Button, IconButton, Input, Segmented, Select } from '../../../components/ui'
import { OPERATOR_LABEL, operatorNeedsValue, operatorsFor } from '@modus-bpm/core/model/conditions'
import { itemDepth } from '@modus-bpm/core/model/lists'
import type { Condition, FieldDef, ListDef, ObjectType, Rule, User } from '@modus-bpm/core/model/types'
import { uid } from '@modus-bpm/core/model/util'

/** Rule builder for a decision branch: "Amount > 1000 and Department is Facilities". */
export function ConditionEditor({
  condition,
  onChange,
  type,
  lists,
  users,
}: {
  condition: Condition
  onChange: (c: Condition) => void
  type: ObjectType
  lists: ListDef[]
  users: User[]
}) {
  const setRule = (i: number, patch: Partial<Rule>) => onChange({ ...condition, rules: condition.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) })
  const addRule = () => {
    const f = type.fields[0]
    if (!f) return
    onChange({ ...condition, rules: [...condition.rules, { id: uid('r'), fieldId: f.id, op: operatorsFor(f.type)[0]! }] })
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
        const field = type.fields.find((f) => f.id === rule.fieldId)
        const ops = field ? operatorsFor(field.type) : []
        return (
          <div key={rule.id} className="rounded-lg border border-amber-200 bg-amber-50/50 p-2">
            <div className="mb-1.5 flex items-center gap-1.5">
              <span className="w-9 text-[10.5px] font-semibold text-amber-800 uppercase">{i === 0 ? 'When' : condition.match === 'all' ? 'and' : 'or'}</span>
              <Select
                value={rule.fieldId}
                className="min-w-0 flex-1"
                onChange={(e) => {
                  const nf = type.fields.find((f) => f.id === e.target.value)
                  if (nf) setRule(i, { fieldId: nf.id, op: operatorsFor(nf.type)[0]!, value: undefined })
                }}
              >
                {!field && <option value={rule.fieldId}>Missing field</option>}
                {type.fields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </Select>
              <IconButton label="Remove rule" onClick={() => onChange({ ...condition, rules: condition.rules.filter((_, j) => j !== i) })}>
                <Trash2 size={13} />
              </IconButton>
            </div>
            <div className="flex items-center gap-1.5 pl-[42px]">
              <Select value={rule.op} className="w-[118px] shrink-0" onChange={(e) => setRule(i, { op: e.target.value as Rule['op'] })}>
                {ops.map((op) => (
                  <option key={op} value={op}>
                    {OPERATOR_LABEL[op]}
                  </option>
                ))}
              </Select>
              {field && operatorNeedsValue(rule.op) && <RuleValue field={field} value={rule.value} lists={lists} users={users} onChange={(value) => setRule(i, { value })} />}
            </div>
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
  if (field.type === 'number' || field.type === 'currency')
    return (
      <div className="relative min-w-0 flex-1">
        {field.type === 'currency' && <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-slate-400">$</span>}
        <Input
          type="number"
          className={field.type === 'currency' ? 'pl-6 tabular-nums' : 'tabular-nums'}
          value={value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      </div>
    )
  if (field.type === 'date') return <Input type="date" className="min-w-0 flex-1" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
  if (field.type === 'choice') {
    const list = lists.find((l) => l.id === field.listId)
    const level = field.level ?? 0
    const items = list ? list.items.filter((it) => itemDepth(list, it) === level) : []
    const parentLabel = (pid: string | null) => (pid ? list?.items.find((x) => x.id === pid)?.label : undefined)
    return (
      <Select className="min-w-0 flex-1" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)}>
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
      <Select className="min-w-0 flex-1" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">Pick…</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </Select>
    )
  return <Input className="min-w-0 flex-1" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
}
