import { ChevronRight, Plus, X } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import { Button, Field, IconButton, Input, Modal, Segmented } from '../../components/ui'
import { uid } from '@throughline/core/model/util'
import { useDesign } from '../../store/design'
import { useUi } from '../../store/ui'

export type ListKind = 'flat' | 'linked'

const EXAMPLES = ['Model Year', 'Make', 'Model', 'Trim']

export function NewListModal({ kind: initialKind, onClose }: { kind: ListKind | null; onClose: () => void }) {
  const appId = useUi((s) => s.appId)
  const [kind, setKind] = useState<ListKind>('flat')
  const [name, setName] = useState('')
  const [levels, setLevels] = useState<string[]>([''])

  useEffect(() => {
    if (!initialKind) return
    setKind(initialKind)
    setName('')
    setLevels(initialKind === 'linked' ? ['', '', ''] : [''])
  }, [initialKind])

  const switchKind = (k: ListKind) => {
    setKind(k)
    setLevels((ls) => (k === 'flat' ? [ls[0] ?? ''] : ls.length >= 2 ? ls : [ls[0] ?? '', '']))
  }

  const create = () => {
    const finalName = name.trim() || (kind === 'linked' ? 'New linked list' : 'New list')
    const finalLevels = levels.map((l, i) => l.trim() || (kind === 'flat' ? 'Value' : `Level ${i + 1}`))
    const id = uid('l')
    useDesign.getState().updateApp(appId, (app) => {
      app.lists.push({ id, name: finalName, levels: finalLevels, items: [] })
    })
    useUi.getState().setList(id)
    useUi.getState().toast(`Created “${finalName}”. Add its ${finalLevels[0]!.toLowerCase()} values next.`, 'success')
    onClose()
  }

  return (
    <Modal
      open={initialKind !== null}
      onClose={onClose}
      title="New list"
      subtitle="Lists feed the choice fields on your forms. Linked lists cascade: each level only offers the children of the choice above it."
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={create}>
            Create list
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Segmented<ListKind>
          value={kind}
          onChange={switchKind}
          options={[
            { value: 'flat', label: 'Flat list' },
            { value: 'linked', label: 'Linked list (cascading)' },
          ]}
        />
        <Field label="List name">
          <Input
            autoFocus
            value={name}
            placeholder={kind === 'linked' ? 'e.g. Vehicles' : 'e.g. Payment Terms'}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />
        </Field>
        {kind === 'flat' ? (
          <Field label="What is each value called?" hint="Used for labels like “Add Payment Term…”.">
            <Input value={levels[0] ?? ''} placeholder="e.g. Payment Term" onChange={(e) => setLevels([e.target.value])} />
          </Field>
        ) : (
          <div>
            <span className="mb-1 block text-xs font-medium text-slate-600">Levels, from the top down</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {levels.map((l, i) => (
                <Fragment key={i}>
                  {i > 0 && <ChevronRight size={14} className="text-slate-300" />}
                  <div className="flex items-center gap-1 rounded-md border border-slate-300 bg-white pr-1 pl-1.5 shadow-xs focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20">
                    <span className="flex h-4 w-4 items-center justify-center rounded bg-brand-600 text-[10px] font-semibold text-white">{i + 1}</span>
                    <input
                      aria-label={`Level ${i + 1} name`}
                      className="h-7 w-28 bg-transparent text-sm focus:outline-none"
                      value={l}
                      placeholder={EXAMPLES[i]}
                      onChange={(e) => setLevels((ls) => ls.map((x, j) => (j === i ? e.target.value : x)))}
                    />
                    {levels.length > 2 && i === levels.length - 1 && (
                      <IconButton label="Remove level" className="h-5 w-5" onClick={() => setLevels((ls) => ls.slice(0, -1))}>
                        <X size={12} />
                      </IconButton>
                    )}
                  </div>
                </Fragment>
              ))}
              {levels.length < 4 && (
                <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => setLevels((ls) => [...ls, ''])}>
                  Level
                </Button>
              )}
            </div>
            <p className="mt-2 text-[11px] text-slate-500">Example: picking a Model Year shows only the Makes sold that year, and picking a Make shows only its Models.</p>
          </div>
        )}
      </div>
    </Modal>
  )
}
