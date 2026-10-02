import { useState } from 'react'
import type { Id, ServiceDef, ServiceKind } from '@modus-bpm/core/model/types'
import { uid } from '@modus-bpm/core/model/util'
import { Button, cx, Field, Input, Modal } from '../../components/ui'
import { useDesign } from '../../store/design'
import { useUi } from '../../store/ui'
import { KIND_ORDER, KINDS } from './kinds'

const DEFAULT_AUTH: Record<ServiceKind, ServiceDef['auth']> = { rest: 'oauth2', mcp: 'oauth2', worker: 'mtls', agent: 'managed-identity', email: 'api-key' }

/** Register a new system. Operations, credentials and capacity are filled in afterwards on its detail panel. */
export function NewServiceModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: Id) => void }) {
  const update = useDesign((s) => s.update)
  const toast = useUi((s) => s.toast)
  const [kind, setKind] = useState<ServiceKind>('rest')
  const [name, setName] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [owner, setOwner] = useState('')
  const meta = KINDS[kind]

  const create = () => {
    if (!name.trim()) return
    const svc: ServiceDef = {
      id: uid('svc'),
      name: name.trim(),
      kind,
      endpoint: endpoint.trim(),
      auth: DEFAULT_AUTH[kind],
      owner: owner.trim() || undefined,
      concurrency: kind === 'worker' ? 4 : undefined,
      status: 'online',
      operations: [],
    }
    update((d) => void d.services.push(svc))
    toast(`${svc.name} registered. Add the operations steps can call.`, 'success')
    onCreated(svc.id)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Register a service"
      subtitle="Add a system that automated steps in any application can call."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={create} disabled={!name.trim()}>
            Register service
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <span className="mb-1.5 block text-xs font-medium text-slate-600">What kind of system is it?</span>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2" role="radiogroup" aria-label="Kind of service">
            {KIND_ORDER.map((k) => {
              const m = KINDS[k]
              const Icon = m.icon
              const on = k === kind
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setKind(k)}
                  className={cx(
                    'flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors',
                    on ? 'border-brand-500 bg-brand-50/40 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300',
                  )}
                >
                  <span className={cx('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md', m.tile)}>
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-slate-800">{m.label}</span>
                    <span className="block text-[11px] leading-snug text-slate-500">{m.help}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" required>
            <Input autoFocus value={name} placeholder="e.g. Case Management API" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
          </Field>
          <Field label="Owner" hint="The team to call when it breaks.">
            <Input value={owner} placeholder="e.g. Platform team" onChange={(e) => setOwner(e.target.value)} />
          </Field>
          <Field label={meta.endpointLabel} className="col-span-2">
            <Input className="font-mono text-[13px]" value={endpoint} placeholder={meta.endpointPlaceholder} onChange={(e) => setEndpoint(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  )
}
