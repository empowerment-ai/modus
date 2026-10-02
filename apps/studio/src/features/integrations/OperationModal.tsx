import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { ServiceDef, ServiceOperation, ServiceOutput } from '@modus-bpm/core/model/types'
import { plural, uid } from '@modus-bpm/core/model/util'
import { Button, Field, IconButton, Input, Modal, Select } from '../../components/ui'
import { useDesign } from '../../store/design'
import { useUi } from '../../store/ui'
import { KINDS, OUTPUT_TYPES } from './kinds'
import { NumberInput } from './NumberInput'

const percent = (rate?: number) => (rate === undefined ? undefined : Number((rate * 100).toFixed(2)))
const clampPct = (v: number) => Math.min(100, Math.max(0, v))

/** Add or edit one operation of a service, including the results it returns and how the simulation makes them up. */
export function OperationModal({ service, op, usedBy, onClose }: { service: ServiceDef; op?: ServiceOperation; usedBy: number; onClose: () => void }) {
  const updateService = useDesign((s) => s.updateService)
  const toast = useUi((s) => s.toast)
  const [draft, setDraft] = useState<ServiceOperation>(() => (op ? structuredClone(op) : { id: uid('op'), name: '', avgMinutes: 1, successRate: 0.98, outputs: [] }))
  const kind = KINDS[service.kind]

  const set = (fn: (d: ServiceOperation) => void) =>
    setDraft((d) => {
      const next = structuredClone(d)
      fn(next)
      return next
    })
  const setOutput = (i: number, fn: (o: ServiceOutput) => void) => set((d) => fn(d.outputs[i]!))

  const keys = draft.outputs.map((o) => o.key.trim())
  const dupKey = keys.find((k, i) => k && keys.indexOf(k) !== i)
  const blankKey = keys.some((k) => !k)
  const problem = !draft.name.trim() ? `Give the operation a ${kind.opLabel.toLowerCase()}.` : blankKey ? 'Every output needs a key.' : dupKey ? `Two outputs use the key “${dupKey}”.` : undefined

  const save = () => {
    if (problem) return
    const clean: ServiceOperation = {
      ...draft,
      name: draft.name.trim(),
      description: draft.description?.trim() || undefined,
      outputs: draft.outputs.map((o) => ({ ...o, key: o.key.trim(), label: o.label.trim() || o.key.trim() })),
    }
    updateService(service.id, (s) => {
      const i = s.operations.findIndex((o) => o.id === clean.id)
      if (i >= 0) s.operations[i] = clean
      else s.operations.push(clean)
    })
    toast(op ? `${clean.name} saved.` : `${clean.name} added to ${service.name}.`, 'success')
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      width={720}
      title={op ? `Edit ${op.name}` : 'New operation'}
      subtitle={`${service.name} · ${kind.label}${usedBy ? ` · called by ${plural(usedBy, 'step')}` : ''}`}
      footer={
        <>
          {problem && <span className="mr-auto text-xs text-rose-600">{problem}</span>}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={!!problem}>
            {op ? 'Save operation' : 'Add operation'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={kind.opLabel} required>
            <Input autoFocus className="font-mono text-[13px]" value={draft.name} placeholder={kind.opPlaceholder} onChange={(e) => set((d) => void (d.name = e.target.value))} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Average time" hint="Minutes per call; decimals allowed.">
              <NumberInput value={draft.avgMinutes} normalize={(v) => Math.max(0.01, v)} onCommit={(v) => set((d) => void (d.avgMinutes = v ?? 1))} />
            </Field>
            <Field label="Success rate" hint="Percent of calls that succeed.">
              <NumberInput value={percent(draft.successRate)} normalize={clampPct} onCommit={(v) => set((d) => void (d.successRate = (v ?? 100) / 100))} />
            </Field>
          </div>
          <Field label="Description" className="col-span-2">
            <Input value={draft.description ?? ''} placeholder="What the call does, in a sentence" onChange={(e) => set((d) => void (d.description = e.target.value))} />
          </Field>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <h3 className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Outputs</h3>
            <Button size="sm" icon={<Plus size={13} />} onClick={() => set((d) => void d.outputs.push({ key: '', label: '', type: 'boolean', trueRate: 0.8 }))}>
              Add output
            </Button>
          </div>
          <p className="mb-2.5 text-[11.5px] leading-snug text-slate-500">
            Results the call returns. Steps store each one in a field by its key, so renaming a key unlinks it from those steps. The last column tells the simulation what values to make up.
          </p>
          {draft.outputs.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500">This operation returns nothing a step needs to keep.</p>
          ) : (
            <div className="overflow-hidden rounded-md border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-[10.5px] font-semibold tracking-wide text-slate-500 uppercase">
                    <th className="py-1.5 pr-1.5 pl-2.5 font-semibold">Key</th>
                    <th className="px-1.5 py-1.5 font-semibold">Label</th>
                    <th className="px-1.5 py-1.5 font-semibold">Type</th>
                    <th className="px-1.5 py-1.5 font-semibold">Simulated values</th>
                    <th className="w-9" />
                  </tr>
                </thead>
                <tbody>
                  {draft.outputs.map((o, i) => (
                    <tr key={i} className="border-b border-slate-100 align-top last:border-b-0">
                      <td className="w-[22%] py-1.5 pr-1.5 pl-2.5">
                        <Input
                          aria-label="Output key"
                          className="font-mono text-[12px]"
                          value={o.key}
                          placeholder="matched"
                          onChange={(e) => setOutput(i, (x) => void (x.key = e.target.value.replace(/\s+/g, '_')))}
                        />
                      </td>
                      <td className="w-[24%] px-1.5 py-1.5">
                        <Input aria-label="Output label" value={o.label} placeholder="PO matched" onChange={(e) => setOutput(i, (x) => void (x.label = e.target.value))} />
                      </td>
                      <td className="w-[16%] px-1.5 py-1.5">
                        <Select aria-label="Output type" value={o.type} onChange={(e) => setOutput(i, (x) => retype(x, e.target.value as ServiceOutput['type']))}>
                          {OUTPUT_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-1.5 py-1.5">
                        <SimHints output={o} onChange={(fn) => setOutput(i, fn)} />
                      </td>
                      <td className="py-1.5 pr-1.5 text-right">
                        <IconButton label="Remove output" onClick={() => set((d) => void d.outputs.splice(i, 1))} className="mt-0.5 hover:bg-rose-50 hover:text-rose-600">
                          <Trash2 size={13} />
                        </IconButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

/** Switching type drops the hints that no longer apply and seeds sensible ones. */
function retype(o: ServiceOutput, type: ServiceOutput['type']) {
  o.type = type
  delete o.trueRate
  delete o.min
  delete o.max
  if (type === 'boolean') o.trueRate = 0.8
  if (type === 'number') Object.assign(o, { min: 0, max: 100 })
  if (type !== 'choice' && type !== 'text') delete o.options
}

function SimHints({ output: o, onChange }: { output: ServiceOutput; onChange: (fn: (o: ServiceOutput) => void) => void }) {
  if (o.type === 'boolean')
    return (
      <div className="flex items-center gap-1.5 text-[11.5px] text-slate-500">
        Yes for
        <NumberInput
          aria-label="Share of calls returning yes, in percent"
          className="w-16"
          value={percent(o.trueRate)}
          normalize={clampPct}
          onCommit={(v) => onChange((x) => void (x.trueRate = v === undefined ? undefined : v / 100))}
        />
        % of calls
      </div>
    )
  if (o.type === 'number')
    return (
      <div className="flex items-center gap-1.5 text-[11.5px] text-slate-500">
        From
        <NumberInput aria-label="Lowest value" className="w-20" value={o.min} onCommit={(v) => onChange((x) => void (x.min = v))} />
        to
        <NumberInput aria-label="Highest value" className="w-20" value={o.max} onCommit={(v) => onChange((x) => void (x.max = v))} />
      </div>
    )
  return (
    <Input
      key={(o.options ?? []).join('|')}
      aria-label="Possible values, separated by commas"
      defaultValue={(o.options ?? []).join(', ')}
      placeholder="Low, Medium, High"
      title="Possible values, separated by commas. Repeat a value to make it more likely."
      onBlur={(e) => {
        const options = e.target.value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        onChange((x) => void (x.options = options.length ? options : undefined))
      }}
    />
  )
}
