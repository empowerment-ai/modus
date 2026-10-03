import { ArrowDown, ArrowUp, Plus, Sigma, Trash2 } from 'lucide-react'
import { Button, IconButton, Input, Segmented, Select, Toggle } from '../../components/ui'
import { FIELD_TYPE_LABEL } from '@modus-bpm/core/model/format'
import type { App, ColumnDef, ColumnType, FieldDef, ObjectType } from '@modus-bpm/core/model/types'
import { uid } from '@modus-bpm/core/model/util'
import { useUi } from '../../store/ui'
import { columnReferences, describeRefs } from './references'

type Update = (fn: (f: FieldDef, t: ObjectType) => void) => void

const COLUMN_TYPES: ColumnType[] = ['text', 'number', 'currency', 'date', 'boolean', 'choice', 'user', 'email']
const NUMERIC = new Set<ColumnType>(['number', 'currency'])

/** Relative widths, in words. Any other stored value stays selectable. */
const WIDTHS: Array<{ value: number; label: string }> = [
  { value: 0.75, label: 'Narrow' },
  { value: 1, label: 'Normal' },
  { value: 1.5, label: 'Wide' },
  { value: 2, label: 'Wider' },
  { value: 3, label: 'Widest' },
]

export function newColumns(): ColumnDef[] {
  return [
    { id: uid('c'), label: 'Description', type: 'text', required: true, width: 3 },
    { id: uid('c'), label: 'Amount', type: 'currency', width: 1.2 },
  ]
}

/** The columns of a table field (line items, attendees…), its row limits, and calculated columns. */
export function ColumnsEditor({ app, type, field, update }: { app: App; type: ObjectType; field: FieldDef; update: Update }) {
  const toast = useUi((s) => s.toast)
  const columns = field.columns ?? []

  const setColumn = (id: string, fn: (c: ColumnDef) => void) =>
    update((f) => {
      const c = f.columns?.find((x) => x.id === id)
      if (c) fn(c)
    })

  const add = () =>
    update((f) => {
      f.columns = [...(f.columns ?? []), { id: uid('c'), label: 'New column', type: 'text' }]
    })

  const move = (from: number, to: number) =>
    update((f) => {
      const cols = f.columns ?? []
      const [c] = cols.splice(from, 1)
      if (c) cols.splice(to, 0, c)
    })

  const remove = (c: ColumnDef) => {
    const refs = columnReferences(app, type, field.id, c.id)
    if (refs.length) {
      toast(`Can’t delete the “${c.label}” column: it is used by ${describeRefs(refs)}.`, 'warn')
      return
    }
    update((f) => void (f.columns = (f.columns ?? []).filter((x) => x.id !== c.id)))
  }

  const changeType = (c: ColumnDef, next: ColumnType) => {
    if (next === c.type) return
    const refs = columnReferences(app, type, field.id, c.id)
    setColumn(c.id, (x) => {
      x.type = next
      delete x.listId
      delete x.min
      delete x.max
      if (!NUMERIC.has(next)) delete x.formula
      if (next === 'choice') x.listId = (app.lists.find((l) => l.levels.length === 1) ?? app.lists[0])?.id
    })
    if (refs.length) toast(`“${c.label}” is used by ${describeRefs(refs)}. Check those still make sense for a ${FIELD_TYPE_LABEL[next]} column.`, 'warn')
  }

  return (
    <div className="col-span-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <div className="text-xs font-medium text-slate-700">Columns</div>
          <p className="text-[11px] text-slate-500">Each row of the table has these. Calculated columns fill themselves in.</p>
        </div>
        <Button size="sm" icon={<Plus size={13} />} onClick={add}>
          Add column
        </Button>
      </div>

      {columns.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-3 text-center text-xs text-slate-500">No columns yet. Add the first one, for example a description.</p>
      ) : (
        <ol className="space-y-1.5">
          {columns.map((c, i) => (
            <ColumnRow
              key={c.id}
              app={app}
              column={c}
              index={i}
              columns={columns}
              onChange={(fn) => setColumn(c.id, fn)}
              onType={(t) => changeType(c, t)}
              onMove={(to) => move(i, to)}
              onRemove={() => remove(c)}
            />
          ))}
        </ol>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-slate-600">
        <span>Rows: at least</span>
        <Input
          type="number"
          min={0}
          className="h-7 w-16 text-right tabular-nums"
          aria-label="Fewest rows"
          value={field.minRows ?? ''}
          onChange={(e) => update((f) => void (f.minRows = Number(e.target.value) > 0 ? Math.round(Number(e.target.value)) : undefined))}
        />
        <span>and at most</span>
        <Input
          type="number"
          min={1}
          className="h-7 w-16 text-right tabular-nums"
          aria-label="Most rows"
          placeholder="any"
          value={field.maxRows ?? ''}
          onChange={(e) => update((f) => void (f.maxRows = Number(e.target.value) > 0 ? Math.round(Number(e.target.value)) : undefined))}
        />
        {field.minRows && field.maxRows && field.minRows > field.maxRows ? <span className="text-amber-700">The minimum is above the maximum.</span> : null}
      </div>
    </div>
  )
}

function ColumnRow({
  app,
  column: c,
  index,
  columns,
  onChange,
  onType,
  onMove,
  onRemove,
}: {
  app: App
  column: ColumnDef
  index: number
  columns: ColumnDef[]
  onChange: (fn: (c: ColumnDef) => void) => void
  onType: (t: ColumnType) => void
  onMove: (to: number) => void
  onRemove: () => void
}) {
  // A formula multiplies or adds two typed-in number or currency columns.
  const operands = columns.filter((x) => x.id !== c.id && NUMERIC.has(x.type) && !x.formula)
  const widths = WIDTHS.some((w) => w.value === (c.width ?? 1)) ? WIDTHS : [...WIDTHS, { value: c.width!, label: `${c.width}× normal` }].sort((a, b) => a.value - b.value)
  const num = (s: string) => (s === '' ? undefined : Number(s))

  const setCalculated = (on: boolean) => {
    if (!on) return onChange((x) => void delete x.formula)
    const usedBy = columns.find((x) => x.formula?.of.includes(c.id))
    if (usedBy) return useUi.getState().toast(`“${usedBy.label}” is calculated from “${c.label}”, so “${c.label}” has to be typed in.`, 'warn')
    const [a, b] = [operands[0], operands[1] ?? operands[0]]
    if (!a || !b) return useUi.getState().toast('Add another number or currency column first: a calculated column multiplies or adds two of them.', 'warn')
    onChange((x) => {
      x.formula = { op: 'multiply', of: [a.id, b.id] }
      delete x.required
    })
  }

  return (
    <li className="rounded-md border border-slate-200 bg-white">
      <div className="flex items-center gap-1.5 p-1.5">
        <span className="w-5 shrink-0 text-center text-[11px] text-slate-400 tabular-nums">{index + 1}</span>
        <Input value={c.label} className="h-7 min-w-0 flex-1" aria-label="Column name" onChange={(e) => onChange((x) => void (x.label = e.target.value))} />
        <Select value={c.type} className="h-7 w-[118px] shrink-0 text-xs" aria-label="Column type" onChange={(e) => onType(e.target.value as ColumnType)}>
          {COLUMN_TYPES.map((t) => (
            <option key={t} value={t}>
              {FIELD_TYPE_LABEL[t]}
            </option>
          ))}
        </Select>
        <IconButton label="Move earlier" disabled={index === 0} onClick={() => onMove(index - 1)}>
          <ArrowUp size={13} />
        </IconButton>
        <IconButton label="Move later" disabled={index === columns.length - 1} onClick={() => onMove(index + 1)}>
          <ArrowDown size={13} />
        </IconButton>
        <IconButton label={`Delete the ${c.label} column`} className="hover:text-rose-600" onClick={onRemove}>
          <Trash2 size={13} />
        </IconButton>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-100 px-2 py-1.5 pl-8 text-xs text-slate-600">
        {c.type === 'choice' && (
          <label className="flex items-center gap-1.5">
            List
            <Select value={c.listId ?? ''} className="h-7 w-44 text-xs" onChange={(e) => onChange((x) => void (x.listId = e.target.value || undefined))}>
              <option value="">Choose a list…</option>
              {app.lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.levels.length > 1 ? ` (top level: ${l.levels[0]})` : ''}
                </option>
              ))}
            </Select>
          </label>
        )}

        {NUMERIC.has(c.type) && (
          <Segmented
            size="sm"
            value={c.formula ? 'calc' : 'typed'}
            onChange={(v) => setCalculated(v === 'calc')}
            options={[
              { value: 'typed', label: 'Typed in' },
              { value: 'calc', label: 'Calculated', title: operands.length ? 'Multiply or add two other columns' : 'Add another number or currency column first' },
            ]}
          />
        )}

        {c.formula ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <Sigma size={12} className="text-slate-400" aria-hidden />
            <OperandSelect columns={operands} value={c.formula.of[0]} label="First column" onChange={(id) => onChange((x) => void (x.formula = { ...x.formula!, of: [id, x.formula!.of[1]] }))} />
            <Segmented
              size="sm"
              value={c.formula.op}
              onChange={(op) => onChange((x) => void (x.formula = { ...x.formula!, op }))}
              options={[
                { value: 'multiply', label: '×', title: 'Multiply' },
                { value: 'add', label: '+', title: 'Add' },
              ]}
            />
            <OperandSelect columns={operands} value={c.formula.of[1]} label="Second column" onChange={(id) => onChange((x) => void (x.formula = { ...x.formula!, of: [x.formula!.of[0], id] }))} />
          </span>
        ) : (
          NUMERIC.has(c.type) && (
            <span className="flex items-center gap-1.5">
              Min
              <Input type="number" className="h-7 w-20 text-right tabular-nums" aria-label="Minimum" value={c.min ?? ''} onChange={(e) => onChange((x) => void (x.min = num(e.target.value)))} />
              Max
              <Input type="number" className="h-7 w-20 text-right tabular-nums" aria-label="Maximum" value={c.max ?? ''} onChange={(e) => onChange((x) => void (x.max = num(e.target.value)))} />
            </span>
          )
        )}

        <label className="flex items-center gap-1.5">
          Width
          <Select value={String(c.width ?? 1)} className="h-7 w-32 text-xs" onChange={(e) => onChange((x) => void (x.width = Number(e.target.value) === 1 ? undefined : Number(e.target.value)))}>
            {widths.map((w) => (
              <option key={w.value} value={String(w.value)}>
                {w.label}
              </option>
            ))}
          </Select>
        </label>

        {!c.formula && <Toggle checked={!!c.required} onChange={(v) => onChange((x) => void (x.required = v || undefined))} label={<span className="text-xs">Required</span>} />}
      </div>
      {NUMERIC.has(c.type) && !c.formula && operands.length === 0 && columns.length > 1 && (
        <p className="px-2 pb-1.5 pl-8 text-[11px] text-slate-500">To calculate this column, add another number or currency column to multiply or add.</p>
      )}
    </li>
  )
}

function OperandSelect({ columns, value, label, onChange }: { columns: ColumnDef[]; value: string; label: string; onChange: (id: string) => void }) {
  return (
    <Select value={value} className="h-7 w-36 text-xs" aria-label={label} onChange={(e) => onChange(e.target.value)}>
      {!columns.some((c) => c.id === value) && <option value={value}>Removed column</option>}
      {columns.map((c) => (
        <option key={c.id} value={c.id}>
          {c.label}
        </option>
      ))}
    </Select>
  )
}
