import { useState } from 'react'
import type { GroupKind, Id } from '@throughline/core/model/types'
import { uid } from '@throughline/core/model/util'
import { Button, Field, Input, Modal } from '../../components/ui'
import { useDesign } from '../../store/design'
import { useUi } from '../../store/ui'
import { GROUP_KINDS, GroupKindPicker } from './GroupKind'

/** Create a group: a team that does the work, or a distribution group that hands it out. */
export function GroupCreateModal({ onClose, onCreated }: { onClose: () => void; onCreated?: (id: Id) => void }) {
  const update = useDesign((s) => s.update)
  const toast = useUi((s) => s.toast)
  const [kind, setKind] = useState<GroupKind>('team')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const create = () => {
    if (!name.trim()) return
    const id = uid('g')
    update((d) => {
      d.groups.push({ id, name: name.trim(), memberIds: [], kind: kind === 'distribution' ? 'distribution' : undefined, description: description.trim() || undefined })
    })
    toast(`${name.trim()} added at the end of the list. Add its ${kind === 'distribution' ? 'dispatchers' : 'members'} next.`, 'success')
    onCreated?.(id)
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      width={560}
      title="New group"
      subtitle="Groups are shared by every application."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={create} disabled={!name.trim()}>
            Create group
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <GroupKindPicker value={kind} onChange={setKind} />
        <Field label="Name" required>
          <Input
            autoFocus
            value={name}
            placeholder={kind === 'distribution' ? 'e.g. AP Dispatch' : 'e.g. AP Clerks'}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />
        </Field>
        <Field label="Description" hint="Optional. A line on what the group is for.">
          <Input value={description} placeholder={GROUP_KINDS[kind].placeholder} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
