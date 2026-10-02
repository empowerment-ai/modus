import type { ServiceMetrics } from '@modus-bpm/core'
import type { ServiceDef } from '@modus-bpm/core/model/types'
import { plural } from '@modus-bpm/core/model/util'
import { cx, Meter } from '../../components/ui'
import { KINDS, pct, STATUS } from './kinds'

export function StatusPill({ status }: { status: ServiceDef['status'] }) {
  const s = STATUS[status]
  return (
    <span className={cx('inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium ring-1 ring-slate-200', s.text)} title={s.help}>
      <span className={cx('h-1.5 w-1.5 rounded-full', s.dot, status === 'degraded' && 'animate-pulse')} />
      {s.label}
    </span>
  )
}

export function KindTile({ kind, size = 'md' }: { kind: ServiceDef['kind']; size?: 'sm' | 'md' }) {
  const k = KINDS[kind]
  const Icon = k.icon
  return (
    <span className={cx('flex shrink-0 items-center justify-center rounded-md', k.tile, size === 'sm' ? 'h-7 w-7' : 'h-8 w-8')} title={k.label}>
      <Icon size={size === 'sm' ? 15 : 16} />
    </span>
  )
}

/** Calls in flight against the service's capacity, plus the line waiting for a slot. */
export function LoadBar({ svc, m }: { svc: ServiceDef; m?: ServiceMetrics }) {
  const inFlight = m?.inFlight ?? 0
  const queued = m?.queued ?? 0
  const cap = svc.concurrency
  const full = !!cap && inFlight >= cap
  const color = svc.status === 'offline' ? 'var(--color-rose-500)' : full ? 'var(--color-amber-500)' : 'var(--color-brand-500)'
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-slate-500">In flight</span>
        <span className="tabular-nums">
          <b className="font-semibold text-slate-800">{inFlight}</b>
          <span className="text-slate-400"> / {cap ?? 'unlimited'}</span>
        </span>
      </div>
      {cap ? <Meter value={inFlight} max={cap} color={color} /> : <div className="h-1.5 w-full rounded-full bg-[repeating-linear-gradient(90deg,var(--color-slate-100)_0_6px,transparent_6px_9px)]" />}
      {queued > 0 && (
        <div className="mt-1 text-[11px] font-medium text-amber-700">
          {queued} waiting {svc.status === 'offline' ? 'until it is back online' : 'for a free slot'}
        </div>
      )}
    </div>
  )
}

export function ServiceCard({ svc, m, usedBy, selected, onOpen }: { svc: ServiceDef; m?: ServiceMetrics; usedBy: number; selected: boolean; onOpen: () => void }) {
  const finished = (m?.ok ?? 0) + (m?.failed ?? 0)
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-pressed={selected}
      className={cx(
        'flex w-full flex-col rounded-lg border bg-white text-left shadow-xs transition-colors',
        selected ? 'border-brand-500 ring-2 ring-brand-200' : 'border-slate-200 hover:border-slate-300 hover:shadow-sm',
      )}
    >
      <div className="flex items-start gap-2.5 px-3.5 pt-3">
        <KindTile kind={svc.kind} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-900">{svc.name}</div>
          <div className="truncate font-mono text-[11px] text-slate-500">{svc.endpoint || 'No endpoint yet'}</div>
        </div>
        <StatusPill status={svc.status} />
      </div>
      <div className="px-3.5 pt-3 pb-3">
        <LoadBar svc={svc} m={m} />
      </div>
      <div className="mt-auto flex items-center gap-x-3 gap-y-0.5 border-t border-slate-100 px-3.5 py-2 text-[11px] text-slate-500">
        <span>{plural(svc.operations.length, 'operation')}</span>
        <span className={usedBy ? '' : 'text-slate-400'}>{usedBy ? `Used by ${plural(usedBy, 'step')}` : 'Not used yet'}</span>
        <span className="ml-auto tabular-nums" title="Calls finished in the simulation, and the share that succeeded">
          {finished ? `${finished.toLocaleString()} calls · ${pct((m?.ok ?? 0) / finished)} ok` : 'No calls yet'}
        </span>
      </div>
    </button>
  )
}
