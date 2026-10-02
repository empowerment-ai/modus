import { Copy, LayoutTemplate, Pencil, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Id, Template } from '@throughline/core/model/types'
import { plural, uid } from '@throughline/core/model/util'
import { FIELD_ICONS } from '../../components/icons'
import { Badge, Button, Card, cx, EmptyState, IconButton, Input } from '../../components/ui'
import { useApp, useDesign } from '../../store/design'
import { useUi } from '../../store/ui'
import { TemplateDetailsModal } from './TemplateDetailsModal'
import { TemplatePreview } from './TemplatePreview'
import { UseTemplateModal } from './UseTemplateModal'

// The organization's library of reusable subflows: browse, preview, and stamp
// one into the open application with its fields mapped onto an object type.

const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function provenance(t: Template): string {
  if (t.builtIn) return 'Built-in'
  const date = t.createdAt ? dateFmt.format(new Date(t.createdAt)) : undefined
  if (t.createdBy && date) return `Saved by ${t.createdBy} on ${date}`
  if (t.createdBy) return `Saved by ${t.createdBy}`
  return date ? `Saved on ${date}` : 'Saved by your organization'
}

function searchText(t: Template): string {
  return [t.name, t.description, t.category, ...(t.tags ?? []), ...t.fields.map((f) => f.label), ...t.nodes.map((n) => n.data.label)].join(' ').toLowerCase()
}

export function TemplatesView() {
  const templates = useDesign((s) => s.design.templates)
  const update = useDesign((s) => s.update)
  const toast = useUi((s) => s.toast)
  const app = useApp(useUi((s) => s.appId))
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [using, setUsing] = useState<Id | null>(null)
  const [editing, setEditing] = useState<Id | null>(null)

  const tags = useMemo(() => {
    const n = new Map<string, number>()
    for (const t of templates) for (const g of t.tags ?? []) n.set(g, (n.get(g) ?? 0) + 1)
    return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([g]) => g)
  }, [templates])
  const categories = useMemo(() => [...new Set(templates.map((t) => t.category))].sort(), [templates])

  const q = query.trim().toLowerCase()
  const shown = templates.filter((t) => (!tag || t.tags?.includes(tag)) && (!q || searchText(t).includes(q)))
  const byCategory = categories.map((c) => ({ category: c, list: shown.filter((t) => t.category === c) })).filter((g) => g.list.length)

  const duplicate = (t: Template) => {
    const copy: Template = { ...structuredClone(t), id: uid('tpl'), name: `${t.name} (copy)`, builtIn: false, createdBy: undefined, createdAt: new Date().toISOString() }
    update((d) => {
      const at = d.templates.findIndex((x) => x.id === t.id)
      d.templates.splice(at + 1, 0, copy)
    })
    toast(`Duplicated as “${copy.name}”. Rename it and make it your own.`, 'success')
    setEditing(copy.id)
  }

  const remove = (t: Template) => {
    if (t.builtIn) return
    if (!window.confirm(`Delete the “${t.name}” template? Workflows already made from it are not affected.`)) return
    update((d) => {
      d.templates = d.templates.filter((x) => x.id !== t.id)
    })
    toast(`“${t.name}” deleted.`)
  }

  const usingTpl = templates.find((t) => t.id === using)
  const editingTpl = templates.find((t) => t.id === editing)

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 bg-white px-6 py-3.5">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-slate-900">Templates</h1>
          <p className="text-xs text-slate-500">Reusable workflows shared by every application. Use one to add proven steps to {app?.name ?? 'this application'} in a minute.</p>
        </div>
        <div className="flex-1" />
        <div className="relative w-64">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" />
          <Input className="w-64 pl-8" placeholder="Search templates, fields and steps" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search templates" />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-[1400px] space-y-5">
          {tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by tag">
              <span className="mr-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Tags</span>
              <TagChip on={!tag} onClick={() => setTag(null)}>
                All
              </TagChip>
              {tags.map((g) => (
                <TagChip key={g} on={tag === g} onClick={() => setTag(tag === g ? null : g)}>
                  {g}
                </TagChip>
              ))}
            </div>
          )}

          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <LayoutTemplate size={13} className="text-slate-400" />
            To save one of your own, open it in the designer and choose <span className="font-medium text-slate-700">Workflows › Save as template</span>.
          </p>

          {templates.length === 0 ? (
            <Card>
              <EmptyState icon={<LayoutTemplate size={30} />} title="No templates yet">
                Save a workflow as a template from the designer (Workflows › Save as template) and it shows up here for every application to use.
              </EmptyState>
            </Card>
          ) : byCategory.length === 0 ? (
            <Card>
              <EmptyState icon={<Search size={28} />} title="No template matches">
                <p>Try another word{tag ? ' or clear the tag filter' : ''}.</p>
                <div className="mt-3">
                  <Button
                    size="sm"
                    onClick={() => {
                      setQuery('')
                      setTag(null)
                    }}
                  >
                    Clear filters
                  </Button>
                </div>
              </EmptyState>
            </Card>
          ) : (
            // One grid, ordered by category: each card names its category, so a small library doesn't read as a sparse list.
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {byCategory
                .flatMap(({ list }) => list)
                .map((t) => (
                  <TemplateCard
                    key={t.id}
                    t={t}
                    activeTag={tag}
                    onTag={setTag}
                    onUse={() => setUsing(t.id)}
                    onDuplicate={() => duplicate(t)}
                    onEdit={() => setEditing(t.id)}
                    onDelete={() => remove(t)}
                  />
                ))}
            </div>
          )}
        </div>
      </div>

      {usingTpl && <UseTemplateModal key={usingTpl.id} template={usingTpl} onClose={() => setUsing(null)} />}
      {editingTpl && <TemplateDetailsModal key={editingTpl.id} template={editingTpl} categories={categories} onClose={() => setEditing(null)} />}
    </div>
  )
}

function TagChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx(
        'rounded-full px-2.5 py-0.5 text-[11.5px] font-medium transition-colors',
        on ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 hover:text-slate-900',
      )}
    >
      {children}
    </button>
  )
}

function TemplateCard({
  t,
  activeTag,
  onTag,
  onUse,
  onDuplicate,
  onEdit,
  onDelete,
}: {
  t: Template
  activeTag: string | null
  onTag: (tag: string | null) => void
  onUse: () => void
  onDuplicate: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const people = t.nodes.filter((n) => n.type === 'user').length
  const auto = t.nodes.filter((n) => n.type === 'auto').length
  const parallel = t.nodes.some((n) => n.type === 'split')
  const steps = t.nodes.filter((n) => n.type !== 'start' && n.type !== 'end').length
  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="h-32 border-b border-slate-100 bg-slate-50/70">
        <TemplatePreview nodes={t.nodes} edges={t.edges} className="h-full w-full p-3" />
      </div>
      <div className="flex-1 space-y-2.5 px-4 py-3">
        <div>
          <div className="flex items-start gap-2">
            <h3 className="min-w-0 flex-1 text-sm font-semibold text-slate-900">{t.name}</h3>
            {t.builtIn && <Badge tone="brand">Built-in</Badge>}
          </div>
          <p className="text-[11px] text-slate-500">
            {t.category}
            {!t.builtIn && ` · ${provenance(t)}`}
          </p>
        </div>
        {t.description && <p className="line-clamp-3 text-xs leading-relaxed text-slate-600">{t.description}</p>}
        <p className="text-[11px] text-slate-500">
          {plural(steps, 'step')}
          {people > 0 && ` · ${people} by people`}
          {auto > 0 && ` · ${auto} automated`}
          {parallel && ' · runs in parallel'}
        </p>
        {t.fields.length > 0 && (
          <div>
            <div className="mb-1 text-[10.5px] font-semibold tracking-wide text-slate-400 uppercase">Brings {plural(t.fields.length, 'field')}</div>
            <div className="flex flex-wrap gap-1">
              {t.fields.map((f) => {
                const Icon = FIELD_ICONS[f.type]
                return (
                  <span key={f.id} className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-700">
                    <Icon size={11} className="text-slate-400" />
                    {f.label}
                  </span>
                )
              })}
            </div>
          </div>
        )}
        {(t.tags?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1">
            {t.tags!.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => onTag(activeTag === g ? null : g)}
                className={cx('rounded px-1.5 py-0.5 text-[11px] transition-colors', activeTag === g ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}
                title={`Show templates tagged “${g}”`}
              >
                #{g}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 border-t border-slate-100 px-3 py-2">
        <Button variant="primary" size="sm" onClick={onUse}>
          Use in this app
        </Button>
        <div className="flex-1" />
        <IconButton label="Duplicate" onClick={onDuplicate}>
          <Copy size={14} />
        </IconButton>
        <IconButton label="Edit details" onClick={onEdit}>
          <Pencil size={14} />
        </IconButton>
        {!t.builtIn && (
          <IconButton label={`Delete ${t.name}`} onClick={onDelete} className="hover:bg-rose-50 hover:text-rose-600">
            <Trash2 size={14} />
          </IconButton>
        )}
      </div>
    </Card>
  )
}
