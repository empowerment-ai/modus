import { ArrowRight, Lock } from 'lucide-react'
import { TypeIcon } from '../../components/icons'
import { Card, EmptyState } from '../../components/ui'
import { canCreate, type Ctx } from '@throughline/core'
import type { App, Group, ObjectType, User, Workflow } from '@throughline/core/model/types'
import { useUi } from '../../store/ui'
import { PageHeader } from './parts'

/** Start something new: one card per process you are allowed to start. */
export function NewRequestPage({ me, app, ctx, groups }: { me: User; app: App; ctx: Ctx; groups: Group[] }) {
  const processes = app.workflows.filter((w) => w.kind !== 'subflow')
  const allowed = processes.filter((w) => canCreate(ctx, w.id, me.id))
  const others = processes.filter((w) => !allowed.includes(w))
  const typeOf = (w: Workflow) => app.objectTypes.find((t) => t.id === w.objectTypeId)
  const creators = (t: ObjectType | undefined) =>
    t
      ? groups
          .filter((g) => t.permissions[g.id]?.create)
          .map((g) => g.name)
          .join(', ')
      : ''

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1000px] space-y-5 px-6 py-6">
        <PageHeader title="New request" subtitle={`Start a new item in ${app.name}. It enters the workflow straight away, and you can follow it in My requests.`} />

        {allowed.length === 0 ? (
          <Card>
            <EmptyState icon={<Lock size={26} />} title={`You can’t start anything in ${app.name}`}>
              {processes.length
                ? processes.map((w) => {
                    const t = typeOf(w)
                    const who = creators(t)
                    return (
                      <span key={w.id} className="block">
                        {who ? `${t?.pluralName ?? w.name} can be created by ${who}.` : `No group may create ${t?.pluralName ?? 'items'} yet.`}
                      </span>
                    )
                  })
                : 'This application has no process workflows yet.'}
            </EmptyState>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {allowed.map((w) => {
              const t = typeOf(w)
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => useUi.getState().openCreate(w.id)}
                  className="group flex items-start gap-3.5 rounded-lg border border-slate-200 bg-white p-4 text-left shadow-xs transition-colors hover:border-brand-300 hover:bg-brand-50/30"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" style={{ background: `${t?.color ?? '#64748b'}1a`, color: t?.color }}>
                    <TypeIcon name={t?.icon ?? 'file'} size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold text-slate-900">New {t?.name ?? 'item'}</span>
                    <span className="block text-[11px] font-medium text-slate-500">{w.name}</span>
                    <span className="mt-1.5 block text-[13px] leading-snug text-slate-600">
                      {w.description || `Fill in the ${t?.name.toLowerCase() ?? 'item'} form and it starts the ${w.name} process.`}
                    </span>
                    {w.targetHours ? (
                      <span className="mt-1.5 block text-[11px] text-slate-500">Usually due within {w.targetHours < 1 ? `${Math.round(w.targetHours * 60)} minutes` : `${w.targetHours} hours`}.</span>
                    ) : null}
                  </span>
                  <ArrowRight size={16} className="mt-1 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600" />
                </button>
              )
            })}
          </div>
        )}

        {allowed.length > 0 && others.length > 0 && (
          <p className="text-xs text-slate-500">
            Can’t find what you need?{' '}
            {others.map((w) => {
              const t = typeOf(w)
              return (
                <span key={w.id}>
                  {t?.pluralName ?? w.name} are started by {creators(t) || 'no one yet'}.{' '}
                </span>
              )
            })}
          </p>
        )}
      </div>
    </div>
  )
}
