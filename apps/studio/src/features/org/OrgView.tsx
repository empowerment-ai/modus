import { useState } from 'react'
import { Segmented } from '../../components/ui'
import { useApp, useDesign } from '../../store/design'
import { useUi } from '../../store/ui'
import { GroupsTab } from './GroupsTab'
import { PeopleTab } from './PeopleTab'
import { PermissionsTab } from './PermissionsTab'
import { RolesTab } from './RolesTab'
import { SecurityTab } from './SecurityTab'

type Tab = 'people' | 'groups' | 'roles' | 'permissions' | 'security'

export function OrgView() {
  const [tab, setTab] = useState<Tab>('people')
  const appId = useUi((s) => s.appId)
  const app = useApp(appId)
  const userCount = useDesign((s) => s.design.users.length)
  const groupCount = useDesign((s) => s.design.groups.length)

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-6 py-3.5">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-slate-900">People &amp; Security</h1>
          <p className="text-xs text-slate-500">
            {tab === 'permissions'
              ? `Object type permissions for ${app?.name ?? 'this application'}.`
              : tab === 'security'
                ? `Field-level security for ${app?.name ?? 'this application'}: what each step can edit, read or not see.`
                : tab === 'roles'
                  ? 'Organization-wide roles (administrator, designer, auditor), and who supervises each process and step.'
                  : 'The organization is shared by every application: who can do the work, and who supervises it.'}
          </p>
        </div>
        <div className="flex-1" />
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'people', label: `People (${userCount})` },
            { value: 'groups', label: `Groups (${groupCount})` },
            { value: 'roles', label: 'Roles' },
            { value: 'permissions', label: 'Permissions' },
            { value: 'security', label: 'Field security' },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {tab === 'people' && <PeopleTab />}
        {tab === 'groups' && <GroupsTab />}
        {tab === 'roles' && <RolesTab />}
        {tab === 'permissions' && <PermissionsTab />}
        {tab === 'security' && <SecurityTab />}
      </div>
    </div>
  )
}
