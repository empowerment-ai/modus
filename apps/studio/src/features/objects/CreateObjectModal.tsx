import { ShieldAlert, WandSparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { FormRenderer } from '../../components/FormRenderer'
import { TypeIcon } from '../../components/icons'
import { Button, Field, Modal, Select } from '../../components/ui'
import { createObject, nextNumber } from '@throughline/core'
import { generateData } from '@throughline/core/engine/generate'
import { validateRequired } from '@throughline/core/model/format'
import type { App, Group, ObjectType, User, Workflow } from '@throughline/core/model/types'
import { useApp, useDesign } from '../../store/design'
import { useSim, useSimState } from '../../store/sim'
import { useUi } from '../../store/ui'

/** Groups the user belongs to, and whether any of them may create objects of this type. */
function createRights(type: ObjectType, groups: Group[], userId: string) {
  const mine = groups.filter((g) => g.memberIds.includes(userId))
  return { groups: mine, allowed: mine.some((g) => type.permissions[g.id]?.create) }
}

export function CreateObjectModal() {
  const createFor = useUi((s) => s.createFor)
  const appId = useUi((s) => s.appId)
  const app = useApp(appId)
  const wf = createFor ? app?.workflows.find((w) => w.id === createFor) : undefined
  const type = wf ? app?.objectTypes.find((t) => t.id === wf.objectTypeId) : undefined
  if (!app || !wf || !type) return null
  // Keyed so the form state resets whenever a different workflow's modal opens.
  return <CreateForm key={wf.id} app={app} wf={wf} type={type} />
}

function CreateForm({ app, wf, type }: { app: App; wf: Workflow; type: ObjectType }) {
  const users = useDesign((s) => s.design.users)
  const groups = useDesign((s) => s.design.groups)
  const sim = useSimState()
  const close = () => useUi.getState().openCreate(null)

  const permitted = useMemo(() => users.filter((u) => createRights(type, groups, u.id).allowed), [users, groups, type])
  const others = useMemo(() => users.filter((u) => !permitted.includes(u)), [users, permitted])
  // In the Workspace you create as the person you are working as.
  const inWorkspace = useUi((s) => s.mode === 'workspace')
  const actingAs = useUi((s) => s.actingAs)
  const [chosen, setCreateAs] = useState<string>(permitted[0]?.id ?? users[0]?.id ?? '')
  const createAs = inWorkspace ? actingAs : chosen
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  const creator = users.find((u) => u.id === createAs)
  const rights = createRights(type, groups, createAs)
  const allowedGroups = groups.filter((g) => type.permissions[g.id]?.create)

  const fillSample = () => {
    const number = sim ? nextNumber(sim, type) : `${type.numberPrefix}NEW`
    setValues(generateData({ rng: (Math.random() * 2 ** 31) | 0 }, type, app.lists, users, sim?.clock ?? 0, number))
    setErrors({})
  }

  const submit = (andOpen: boolean) => {
    if (!rights.allowed) return
    const errs = validateRequired(type, values)
    setErrors(errs)
    if (Object.keys(errs).length) return
    const obj = useSim.getState().act((s, ctx) => createObject(s, ctx, wf.id, values, createAs))
    const ui = useUi.getState()
    if (!obj) {
      ui.toast(`Could not create the ${type.name.toLowerCase()} — check the workflow.`, 'warn')
      return
    }
    const app = useDesign.getState().design.apps.find((a) => a.id === ui.appId)
    const label = (id: string) => app?.workflows.flatMap((w) => w.nodes).find((n) => n.id === id)?.data.label ?? 'the workflow'
    const stuck = obj.tokens.find((t) => t.state === 'stuck')
    const at = obj.tokens.map((t) => label(t.nodeId)).join(' + ') || (obj.endNodeId ? label(obj.endNodeId) : 'the end')
    if (stuck) ui.toast(`${obj.number} created but is stuck at “${label(stuck.nodeId)}”: ${stuck.stuckReason}`, 'warn')
    else ui.toast(`${obj.number} created → now at “${at}”`, 'success')
    close()
    if (andOpen) ui.openObject(obj.id)
  }

  return (
    <Modal
      open
      onClose={close}
      width={720}
      title={
        <span className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md" style={{ background: `${type.color}1a`, color: type.color }}>
            <TypeIcon name={type.icon} size={14} />
          </span>
          New {type.name}
        </span>
      }
      subtitle={`Enters the “${wf.name}” workflow at its start step.`}
      footer={
        <>
          <span className="mr-auto text-[11px] text-slate-500">The form is generated from the {type.name} object type.</span>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button disabled={!rights.allowed} onClick={() => submit(true)}>
            Create &amp; open
          </Button>
          <Button variant="primary" disabled={!rights.allowed} onClick={() => submit(false)}>
            Create {type.name}
          </Button>
        </>
      }
    >
      <div className="mb-4 flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
        <Field
          label="Create as"
          className="min-w-0 flex-1"
          hint={
            inWorkspace
              ? 'You’re creating it as the person you are working as. Switch with “Working as”.'
              : allowedGroups.length
                ? `Groups allowed to create ${type.pluralName}: ${allowedGroups.map((g) => g.name).join(', ')}`
                : `No group may create ${type.pluralName} yet — set it in People & Security.`
          }
        >
          <Select value={createAs} onChange={(e) => setCreateAs(e.target.value)} disabled={inWorkspace}>
            {permitted.length > 0 && (
              <optgroup label={`Can create ${type.pluralName}`}>
                {permitted.map((u) => (
                  <UserOption key={u.id} user={u} />
                ))}
              </optgroup>
            )}
            {others.length > 0 && (
              <optgroup label="No create permission">
                {others.map((u) => (
                  <UserOption key={u.id} user={u} />
                ))}
              </optgroup>
            )}
          </Select>
        </Field>
        <Button icon={<WandSparkles size={14} />} onClick={fillSample} className="mt-5">
          Fill with sample data
        </Button>
      </div>

      {!rights.allowed && creator && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <ShieldAlert size={16} className="mt-0.5 shrink-0 text-amber-600" />
          <span>
            {rights.groups.length
              ? `${creator.name}’s groups (${rights.groups.map((g) => g.name).join(', ')}) can’t create ${type.pluralName}.`
              : `${creator.name} isn’t in any group that can create ${type.pluralName}.`}{' '}
            Pick someone else, or grant Create in People &amp; Security.
          </span>
        </div>
      )}

      <FormRenderer
        type={type}
        lists={app.lists}
        users={users}
        values={values}
        errors={errors}
        onChange={(v) => {
          setValues(v)
          if (Object.keys(errors).length) setErrors(validateRequired(type, v))
        }}
      />
    </Modal>
  )
}

function UserOption({ user }: { user: User }) {
  return (
    <option value={user.id}>
      {user.name} — {user.title}
    </option>
  )
}
