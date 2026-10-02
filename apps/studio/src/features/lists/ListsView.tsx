import { ArrowUpRight, ChevronRight, List, ListTree, Plus, Trash2, X } from 'lucide-react'
import { Fragment, useState } from 'react'
import { TypeIcon } from '../../components/icons'
import { Badge, Button, cx, EmptyState, Field, SectionTitle, Select } from '../../components/ui'
import { childrenOf, countAtLevel, itemDepth } from '@throughline/core/model/lists'
import type { App, Id, ListDef } from '@throughline/core/model/types'
import { useApp, useDesign } from '../../store/design'
import { useUi } from '../../store/ui'
import { ListColumns, pluralize } from './ListColumns'
import { type ListKind, NewListModal } from './NewListModal'

export function ListsView() {
  const appId = useUi((s) => s.appId)
  const app = useApp(appId)
  const listId = useUi((s) => s.listId)
  const setList = useUi((s) => s.setList)
  const [creating, setCreating] = useState<ListKind | null>(null)
  if (!app) return null
  const list = app.lists.find((l) => l.id === listId) ?? app.lists[0]

  return (
    <div className="flex h-full">
      <aside className="flex w-[264px] shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 pt-3.5 pb-3">
          <h1 className="text-base font-semibold text-slate-900">Lists</h1>
          <p className="mt-0.5 text-xs leading-snug text-slate-500">Choices for list fields. Linked lists cascade from one level to the next.</p>
          <div className="mt-3 flex gap-1.5">
            <Button size="sm" icon={<Plus size={13} />} onClick={() => setCreating('flat')} className="flex-1">
              Flat list
            </Button>
            <Button size="sm" icon={<Plus size={13} />} onClick={() => setCreating('linked')} className="flex-1">
              Linked list
            </Button>
          </div>
        </div>
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
          {app.lists.map((l) => {
            const active = l.id === list?.id
            const Icon = l.levels.length > 1 ? ListTree : List
            return (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => setList(l.id)}
                  className={cx('w-full rounded-lg px-3 py-2 text-left transition-colors', active ? 'bg-brand-50 ring-1 ring-brand-200' : 'hover:bg-slate-50')}
                >
                  <div className="flex items-center gap-2">
                    <Icon size={14} className={active ? 'text-brand-600' : 'text-slate-400'} />
                    <span className={cx('truncate text-sm font-medium', active ? 'text-brand-800' : 'text-slate-800')}>{l.name}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-slate-400 tabular-nums">{l.items.length}</span>
                  </div>
                  <div className="mt-0.5 truncate pl-[22px] text-[11px] text-slate-500">{l.levels.length > 1 ? l.levels.join(' › ') : 'Flat list'}</div>
                </button>
              </li>
            )
          })}
          {app.lists.length === 0 && <li className="px-3 py-6 text-center text-xs text-slate-400">No lists yet.</li>}
        </ul>
      </aside>

      {list ? (
        <>
          <ListEditor key={list.id} app={app} list={list} />
          <TryIt key={`try-${list.id}`} app={app} list={list} />
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState icon={<ListTree size={36} />} title="No lists in this application">
            Create a flat list for simple choices, or a linked list where each choice narrows the next — like Model Year, then Make, then Model.
          </EmptyState>
        </div>
      )}

      <NewListModal kind={creating} onClose={() => setCreating(null)} />
    </div>
  )
}

function fieldsUsing(app: App, listId: Id) {
  return app.objectTypes.flatMap((t) => t.fields.filter((f) => f.listId === listId).map((f) => ({ type: t, field: f })))
}

function ListEditor({ app, list }: { app: App; list: ListDef }) {
  const updateApp = useDesign((s) => s.updateApp)
  const toast = useUi((s) => s.toast)
  const linked = list.levels.length > 1

  const mutate = (fn: (l: ListDef) => void) =>
    updateApp(app.id, (a) => {
      const l = a.lists.find((x) => x.id === list.id)
      if (l) fn(l)
    })

  const deleteList = () => {
    const users = fieldsUsing(app, list.id)
    if (users.length) {
      toast(`Can’t delete “${list.name}”: used by ${users.map((u) => `${u.type.name} › ${u.field.label}`).join(', ')}.`, 'warn')
      return
    }
    if (!window.confirm(`Delete the list “${list.name}” and its ${list.items.length} items?`)) return
    updateApp(app.id, (a) => {
      a.lists = a.lists.filter((l) => l.id !== list.id)
    })
    useUi.getState().setList(undefined)
    toast(`Deleted “${list.name}”.`)
  }

  const addLevel = () => {
    if (list.levels.length >= 4) return
    mutate((l) => void l.levels.push(`Level ${l.levels.length + 1}`))
  }

  const removeLastLevel = () => {
    const idx = list.levels.length - 1
    const name = list.levels[idx]!
    const bound = fieldsUsing(app, list.id).filter((u) => (u.field.level ?? 0) >= idx)
    if (bound.length) {
      toast(`Can’t remove the ${name} level: ${bound.map((u) => `${u.type.name} › ${u.field.label}`).join(', ')} uses it.`, 'warn')
      return
    }
    const count = countAtLevel(list, idx)
    if (count > 0 && !window.confirm(`Remove the ${name} level and its ${count} ${count === 1 ? 'item' : 'items'}?`)) return
    mutate((l) => {
      l.items = l.items.filter((i) => itemDepth(l, i) !== idx)
      l.levels.pop()
    })
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-slate-200 bg-white px-6 py-3.5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <input
              aria-label="List name"
              value={list.name}
              onChange={(e) => mutate((l) => void (l.name = e.target.value))}
              className="-mx-1.5 w-full max-w-xl rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-lg font-semibold text-slate-900 hover:border-slate-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
            />
            <p className="mt-0.5 text-xs text-slate-500">
              {linked ? 'Linked list: each level only offers the children of the choice made above it.' : 'Flat list: a single set of choices.'} {list.items.length} items in total.
            </p>
          </div>
          <Button variant="danger" size="sm" icon={<Trash2 size={13} />} onClick={deleteList}>
            Delete list
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Levels</span>
          {list.levels.map((level, i) => (
            <Fragment key={i}>
              {i > 0 && <ChevronRight size={14} className="text-slate-300" />}
              <div className="flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white pr-1 pl-1.5 shadow-xs focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20">
                <span className="flex h-4 w-4 items-center justify-center rounded bg-brand-600 text-[10px] font-semibold text-white">{i + 1}</span>
                <input
                  aria-label={`Level ${i + 1} name`}
                  value={level}
                  size={Math.max(5, level.length + 1)}
                  onChange={(e) => mutate((l) => void (l.levels[i] = e.target.value))}
                  className="bg-transparent text-sm font-medium text-slate-800 focus:outline-none"
                />
                <span className="text-[11px] text-slate-400 tabular-nums">{countAtLevel(list, i)}</span>
                {i === list.levels.length - 1 && list.levels.length > 1 && (
                  <button type="button" aria-label={`Remove the ${level} level`} onClick={removeLastLevel} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                    <X size={12} />
                  </button>
                )}
              </div>
            </Fragment>
          ))}
          {list.levels.length < 4 && (
            <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={addLevel} title={linked ? 'Add a deeper level' : 'Turn this into a linked list'}>
              Add level
            </Button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-canvas p-6">
        <ListColumns list={list} appId={app.id} />
      </div>
    </section>
  )
}

function TryIt({ app, list }: { app: App; list: ListDef }) {
  const [sel, setSel] = useState<string[]>([])
  const usedBy = fieldsUsing(app, list.id)
  const linked = list.levels.length > 1

  // Resolve the chosen path, dropping anything that no longer exists.
  const chosen: string[] = []
  for (let i = 0; i < list.levels.length; i++) {
    const options = childrenOf(list, i === 0 ? null : (chosen[i - 1] ?? '__none__'))
    if (sel[i] && options.some((o) => o.id === sel[i])) chosen.push(sel[i]!)
    else break
  }
  const labels = chosen.map((id) => list.items.find((i) => i.id === id)?.label ?? '')
  const complete = chosen.length === list.levels.length

  const openType = (typeId: Id) => {
    useUi.getState().setType(typeId)
    useUi.getState().setView('types')
  }

  return (
    <aside className="w-[320px] shrink-0 overflow-y-auto border-l border-slate-200 bg-white px-5 py-4">
      <SectionTitle>Try it</SectionTitle>
      <p className="mb-3 text-xs leading-snug text-slate-500">
        {linked ? 'This is exactly how the list behaves on a form. Each choice narrows the next one.' : 'This is how the list appears on a form.'}
      </p>
      <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
        {list.levels.map((level, i) => {
          const parent = i === 0 ? null : (chosen[i - 1] ?? null)
          const enabled = i === 0 || parent !== null
          const options = enabled ? childrenOf(list, parent) : []
          return (
            <Field key={i} label={level}>
              <Select
                value={chosen[i] ?? ''}
                disabled={!enabled}
                onChange={(e) => setSel([...chosen.slice(0, i), e.target.value].filter(Boolean))}
              >
                <option value="">{enabled ? `Select ${level.toLowerCase()}…` : `Choose ${list.levels[i - 1]!.toLowerCase()} first`}</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </Select>
              {enabled && <span className="mt-1 block text-[11px] text-slate-400">{options.length ? `${options.length} ${options.length === 1 ? level.toLowerCase() : pluralize(level).toLowerCase()} available` : 'No choices here yet'}</span>}
            </Field>
          )
        })}
        {complete && labels.length > 0 && (
          <div className="rounded-md bg-emerald-50 px-2.5 py-2 text-xs text-emerald-800">
            Selected: <span className="font-medium">{labels.join(' › ')}</span>
          </div>
        )}
      </div>

      <div className="mt-6">
        <SectionTitle>Used by</SectionTitle>
        {usedBy.length === 0 ? (
          <p className="text-xs leading-snug text-slate-500">
            Not used by any field yet. In Object Types, add a <span className="font-medium text-slate-700">List choice</span> field and pick this list.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {usedBy.map(({ type, field }) => {
              const parent = field.parentFieldId ? type.fields.find((f) => f.id === field.parentFieldId) : undefined
              return (
                <li key={`${type.id}:${field.id}`}>
                  <button
                    type="button"
                    onClick={() => openType(type.id)}
                    className="group flex w-full items-start gap-2 rounded-md border border-slate-200 px-2.5 py-2 text-left hover:border-brand-300 hover:bg-brand-50/50"
                    title="Open in Object Types"
                  >
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-white" style={{ background: type.color }}>
                      <TypeIcon name={type.icon} size={12} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs">
                        <span className="text-slate-500">{type.name} › </span>
                        <span className="font-medium text-slate-800">{field.label}</span>
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1">
                        <Badge tone="brand">{list.levels[field.level ?? 0] ?? 'Unknown level'}</Badge>
                        {parent && <span className="text-[11px] text-slate-500">depends on {parent.label}</span>}
                      </span>
                    </span>
                    <ArrowUpRight size={13} className="mt-0.5 shrink-0 text-slate-300 group-hover:text-brand-600" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <Button size="sm" variant="ghost" className="mt-2 -ml-2" icon={<ArrowUpRight size={13} />} onClick={() => useUi.getState().setView('types')}>
          Open Object Types
        </Button>
      </div>
    </aside>
  )
}
