import { ArrowDown, ArrowUp, ChevronDown, CornerDownRight, GripVertical, Link2, ListTree, Plus } from 'lucide-react'
import { type DragEvent, useEffect, useRef, useState } from 'react'
import { FIELD_ICONS } from '../../components/icons'
import { useClickOutside } from '../../components/Shell'
import { Badge, Button, cx, EmptyState, IconButton, Modal } from '../../components/ui'
import { FIELD_TYPE_LABEL } from '@throughline/core/model/format'
import { countAtLevel } from '@throughline/core/model/lists'
import type { App, FieldDef, FieldType, ObjectType } from '@throughline/core/model/types'
import { uid } from '@throughline/core/model/util'
import { useDesign } from '../../store/design'
import { useUi } from '../../store/ui'
import { FieldEditor } from './FieldEditor'
import { FIELD_TYPE_HELP, FIELD_TYPE_ORDER } from './references'

interface Props {
  app: App
  type: ObjectType
  selectedId: string | null
  onSelect: (fieldId: string | null) => void
}

export function FieldList({ app, type, selectedId, onSelect }: Props) {
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const [linkedOpen, setLinkedOpen] = useState(false)

  // Keep the selected row in view (e.g. after picking it from the preview or adding it).
  useEffect(() => {
    if (!selectedId) return
    document.getElementById(`field-row-${selectedId}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedId])

  const move = (from: number, insertAt: number) => {
    if (from === insertAt || from + 1 === insertAt) return
    useDesign.getState().updateType(app.id, type.id, (t) => {
      const [f] = t.fields.splice(from, 1)
      if (!f) return
      t.fields.splice(insertAt > from ? insertAt - 1 : insertAt, 0, f)
    })
  }

  const addField = (fieldType: FieldType) => {
    const id = uid('f')
    useDesign.getState().updateType(app.id, type.id, (t) => {
      const f: FieldDef = { id, label: `New ${FIELD_TYPE_LABEL[fieldType].toLowerCase()} field`, type: fieldType, width: fieldType === 'textarea' ? 'full' : 'half' }
      if (fieldType === 'choice') {
        f.listId = app.lists[0]?.id
        f.level = 0
      }
      t.fields.push(f)
    })
    onSelect(id)
  }

  const onDragOver = (e: DragEvent<HTMLDivElement>, index: number) => {
    if (dragFrom === null) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    const at = e.clientY > rect.top + rect.height / 2 ? index + 1 : index
    if (at !== dropAt) setDropAt(at)
  }

  const endDrag = () => {
    setDragFrom(null)
    setDropAt(null)
  }

  const fieldById = (id?: string) => type.fields.find((f) => f.id === id)

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-xs">
      <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-slate-900">
            Fields <span className="ml-1 font-normal text-slate-400">{type.fields.length}</span>
          </h2>
          <p className="text-xs text-slate-500">The metadata every {type.name.toLowerCase()} carries. People and workflow rules decide on these values.</p>
        </div>
        <Button size="sm" icon={<Link2 size={13} />} onClick={() => setLinkedOpen(true)} title="Create a cascading chain of fields from a multi-level list">
          Add linked list fields
        </Button>
        <AddFieldMenu onAdd={addField} />
      </header>

      {type.fields.length === 0 ? (
        <EmptyState title="No fields yet">Add the fields this object type needs, such as an amount, a vendor, or a due date.</EmptyState>
      ) : (
        <div onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDropAt(null)}>
          {type.fields.map((f, i) => {
            const Icon = FIELD_ICONS[f.type]
            const selected = f.id === selectedId
            const list = f.type === 'choice' ? app.lists.find((l) => l.id === f.listId) : undefined
            const parent = fieldById(f.parentFieldId)
            const depth = parent ? Math.min(3, f.level ?? 1) : 0
            return (
              <div
                key={f.id}
                id={`field-row-${f.id}`}
                data-field-row
                onDragOver={(e) => onDragOver(e, i)}
                onDrop={(e) => {
                  e.preventDefault()
                  if (dragFrom !== null && dropAt !== null) move(dragFrom, dropAt)
                  endDrag()
                }}
                className={cx(
                  'relative border-b border-slate-100 last:border-b-0',
                  selected && 'bg-brand-50/50',
                  dragFrom === i && 'opacity-40',
                )}
              >
                {dropAt === i && <div className="absolute inset-x-2 -top-px z-10 h-0.5 rounded bg-brand-500" />}
                {dropAt === i + 1 && i === type.fields.length - 1 && <div className="absolute inset-x-2 -bottom-px z-10 h-0.5 rounded bg-brand-500" />}
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={selected}
                  onClick={() => onSelect(selected ? null : f.id)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSelect(selected ? null : f.id)
                    }
                  }}
                  className="group flex cursor-pointer items-center gap-2 px-2 py-2 hover:bg-slate-50/80"
                >
                  <span
                    draggable
                    aria-hidden
                    title="Drag to reorder"
                    onClick={(e) => e.stopPropagation()}
                    onDragStart={(e) => {
                      setDragFrom(i)
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', f.id)
                      const row = (e.currentTarget as HTMLElement).closest('[data-field-row]')
                      if (row) e.dataTransfer.setDragImage(row, 24, 18)
                    }}
                    onDragEnd={endDrag}
                    className="flex h-7 w-5 cursor-grab items-center justify-center text-slate-300 hover:text-slate-500 active:cursor-grabbing"
                  >
                    <GripVertical size={14} />
                  </span>
                  <div className="flex min-w-0 flex-1 items-center gap-2" style={{ paddingLeft: depth * 18 }}>
                    {depth > 0 && <CornerDownRight size={13} className="shrink-0 text-slate-300" />}
                    <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded', selected ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500')}>
                      <Icon size={13} />
                    </span>
                    <span className="max-w-[45%] shrink-0 truncate text-sm font-medium text-slate-800">{f.label}</span>
                    <span className="shrink-0 text-xs text-slate-400">{FIELD_TYPE_LABEL[f.type]}</span>
                    <div className="flex min-w-0 flex-wrap items-center gap-1">
                      {type.titleFieldId === f.id && <Badge tone="brand">Title</Badge>}
                      {f.required && <Badge tone="red">Required</Badge>}
                      {f.summary && <Badge tone="sky">Summary</Badge>}
                      {f.system && <Badge tone="violet">Set by workflow</Badge>}
                      {list && (
                        <Badge tone="slate" className="max-w-[170px]">
                          <ListTree size={11} className="shrink-0" />
                          <span className="truncate">
                            {list.name}
                            {list.levels.length > 1 ? ` · ${list.levels[f.level ?? 0] ?? ''}` : ''}
                          </span>
                        </Badge>
                      )}
                      {parent && <Badge tone="amber">after {parent.label}</Badge>}
                      {f.type === 'choice' && (f.level ?? 0) > 0 && !parent && <Badge tone="red">needs a parent field</Badge>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                    <IconButton
                      label="Move up"
                      disabled={i === 0}
                      onClick={(e) => {
                        e.stopPropagation()
                        move(i, i - 1)
                      }}
                    >
                      <ArrowUp size={13} />
                    </IconButton>
                    <IconButton
                      label="Move down"
                      disabled={i === type.fields.length - 1}
                      onClick={(e) => {
                        e.stopPropagation()
                        move(i, i + 2)
                      }}
                    >
                      <ArrowDown size={13} />
                    </IconButton>
                  </div>
                  <ChevronDown size={14} className={cx('mr-1 shrink-0 text-slate-400 transition-transform', selected && 'rotate-180')} />
                </div>
                {selected && <FieldEditor app={app} type={type} field={f} onSelect={onSelect} />}
              </div>
            )
          })}
        </div>
      )}

      <LinkedListModal open={linkedOpen} onClose={() => setLinkedOpen(false)} app={app} type={type} onCreated={(id) => onSelect(id)} />
    </section>
  )
}

function AddFieldMenu({ onAdd }: { onAdd: (t: FieldType) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false))
  return (
    <div className="relative" ref={ref}>
      <Button size="sm" variant="primary" icon={<Plus size={13} />} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Add field
      </Button>
      {open && (
        <div className="animate-slide-in absolute top-9 right-0 z-30 w-72 rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl" role="menu">
          {FIELD_TYPE_ORDER.map((t) => {
            const Icon = FIELD_ICONS[t]
            return (
              <button
                key={t}
                type="button"
                role="menuitem"
                onClick={() => {
                  onAdd(t)
                  setOpen(false)
                }}
                className="flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-slate-50"
              >
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded bg-slate-100 text-slate-600">
                  <Icon size={13} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-800">{FIELD_TYPE_LABEL[t]}</span>
                  <span className="block text-[11px] text-slate-500">{FIELD_TYPE_HELP[t]}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function LinkedListModal({ open, onClose, app, type, onCreated }: { open: boolean; onClose: () => void; app: App; type: ObjectType; onCreated: (firstFieldId: string) => void }) {
  const multi = app.lists.filter((l) => l.levels.length > 1)
  const [listId, setListId] = useState<string | null>(null)
  const chosen = multi.find((l) => l.id === listId) ?? multi[0]

  const create = () => {
    if (!chosen) return
    const ids = chosen.levels.map(() => uid('f'))
    useDesign.getState().updateType(app.id, type.id, (t) => {
      chosen.levels.forEach((name, i) => {
        t.fields.push({ id: ids[i]!, label: name, type: 'choice', listId: chosen.id, level: i, parentFieldId: i > 0 ? ids[i - 1] : undefined, width: 'half' })
      })
    })
    onCreated(ids[0]!)
    useUi.getState().toast(`Added ${chosen.levels.length} linked fields: ${chosen.levels.join(' › ')}.`, 'success')
    onClose()
  }

  const goToLists = () => {
    onClose()
    useUi.getState().setView('lists')
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add linked list fields"
      subtitle="One field per level, chained together: each field only offers the values that belong to the choice made above it."
      width={540}
      footer={
        multi.length ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={create} icon={<Link2 size={14} />}>
              Add {chosen?.levels.length ?? 0} fields
            </Button>
          </>
        ) : (
          <Button variant="primary" icon={<ListTree size={14} />} onClick={goToLists}>
            Create a linked list
          </Button>
        )
      }
    >
      {multi.length === 0 ? (
        <EmptyState icon={<ListTree size={28} />} title="This application has no multi-level lists yet">
          Build one in Lists, for example Model Year › Make › Model, then come back here to turn it into cascading fields.
        </EmptyState>
      ) : (
        <div className="space-y-2" role="radiogroup">
          {multi.map((l) => {
            const active = chosen?.id === l.id
            return (
              <button
                key={l.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setListId(l.id)}
                className={cx(
                  'w-full rounded-lg border px-3.5 py-3 text-left transition-colors',
                  active ? 'border-brand-400 bg-brand-50/60 ring-2 ring-brand-500/15' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                )}
              >
                <div className="text-sm font-medium text-slate-800">{l.name}</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {l.levels.map((name, i) => (
                    <span key={i} className="flex items-center gap-1.5">
                      {i > 0 && <span className="text-slate-300">›</span>}
                      <span className="rounded bg-white px-1.5 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
                        {name} <span className="font-normal text-slate-400">{countAtLevel(l, i)}</span>
                      </span>
                    </span>
                  ))}
                </div>
              </button>
            )
          })}
          {chosen && (
            <p className="pt-1 text-xs leading-relaxed text-slate-500">
              Picking a <strong className="font-medium text-slate-700">{chosen.levels[0]}</strong> narrows <strong className="font-medium text-slate-700">{chosen.levels[1]}</strong>
              {chosen.levels[2] ? (
                <>
                  , and picking a {chosen.levels[1]} narrows <strong className="font-medium text-slate-700">{chosen.levels[2]}</strong>
                </>
              ) : null}
              . Changing a choice clears the fields beneath it.
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}
