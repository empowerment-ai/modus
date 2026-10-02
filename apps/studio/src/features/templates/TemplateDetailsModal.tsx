import { useState } from 'react'
import type { Template } from '@throughline/core/model/types'
import { Button, Field, Input, Modal, Textarea } from '../../components/ui'
import { useDesign } from '../../store/design'
import { useUi } from '../../store/ui'

/** Rename a template and change how it is filed: description, category and tags. */
export function TemplateDetailsModal({ template, categories, onClose }: { template: Template; categories: string[]; onClose: () => void }) {
  const updateTemplate = useDesign((s) => s.updateTemplate)
  const toast = useUi((s) => s.toast)
  const [name, setName] = useState(template.name)
  const [description, setDescription] = useState(template.description)
  const [category, setCategory] = useState(template.category)
  const [tags, setTags] = useState((template.tags ?? []).join(', '))

  const save = () => {
    if (!name.trim()) return
    const tagList = [
      ...new Set(
        tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      ),
    ]
    updateTemplate(template.id, (t) => {
      t.name = name.trim()
      t.description = description.trim()
      t.category = category.trim() || 'General'
      t.tags = tagList.length ? tagList : undefined
    })
    toast(`“${name.trim()}” saved.`, 'success')
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      width={520}
      title="Template details"
      subtitle={template.builtIn ? 'This is a built-in template. Your changes apply to everyone in the organization.' : 'Shared with every application in the organization.'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={!name.trim()}>
            Save details
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name" required>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description" hint="What it does and how it ends, so others know when to use it.">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <Input value={category} list="template-categories" placeholder="e.g. Approvals" onChange={(e) => setCategory(e.target.value)} />
            <datalist id="template-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Tags" hint="Separate with commas.">
            <Input value={tags} placeholder="approval, finance" onChange={(e) => setTags(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  )
}
