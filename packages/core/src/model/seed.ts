import { flatList, outcome, P, treeList } from './seed-helpers'
import { socApp } from './seed-soc'
import { seedServices } from './seed-services'
import { seedTemplates } from './seed-templates'
import type { App, Design, FieldDef, Group, ListDef, ObjectType, User, Workflow } from './types'
import { uid } from './util'

// ---------- Organization ----------

const PALETTE = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777', '#2563eb', '#65a30d', '#0d9488', '#c2410c', '#9333ea']

const people: Array<[string, string, string, number]> = [
  // id, name, title, speed
  ['u_maya', 'Maya Patel', 'AP Clerk', 0.85],
  ['u_jordan', 'Jordan Reyes', 'AP Clerk', 1.0],
  ['u_aisha', 'Aisha Bello', 'AP Clerk', 0.9],
  ['u_tom', 'Tom Novak', 'AP Clerk', 1.25],
  ['u_grace', 'Grace Kim', 'AP Clerk', 0.8],
  ['u_luis', 'Luis Ortega', 'AP Clerk', 1.1],
  ['u_hannah', 'Hannah Brooks', 'AP Clerk', 1.0],
  ['u_sam', 'Sam Whitfield', 'AP Clerk', 1.35],
  ['u_priya', 'Priya Raman', 'AP Clerk', 0.95],
  ['u_daniel', 'Daniel Cho', 'AP Clerk', 1.05],
  ['u_rosa', 'Rosa Delgado', 'AP Exceptions Specialist', 0.9],
  ['u_kevin', 'Kevin Mbeki', 'AP Exceptions Specialist', 1.1],
  ['u_ellen', 'Ellen Fischer', 'AP Exceptions Specialist', 1.0],
  ['u_marcus', 'Marcus Hale', 'Budget Manager', 1.0],
  ['u_nadia', 'Nadia Petrov', 'Budget Manager', 0.85],
  ['u_owen', 'Owen Gallagher', 'Budget Manager', 1.2],
  ['u_lena', 'Lena Sorensen', 'Budget Manager', 0.95],
  ['u_carla', 'Carla Mendes', 'AP Supervisor', 1.0],
  ['u_victor', 'Victor Lindqvist', 'Controller', 1.1],
  ['u_dana', 'Dana Whitaker', 'Fleet Manager', 1.0],
  ['u_ray', 'Ray Okafor', 'Fleet Coordinator', 0.9],
  ['u_beth', 'Beth Sullivan', 'Fleet Coordinator', 1.05],
  ['u_chris', 'Chris Tanaka', 'Fleet Coordinator', 1.15],
  ['u_gloria', 'Gloria Vance', 'Director of Operations', 1.0],
  ['u_ian', 'Ian McAllister', 'Procurement Officer', 0.95],
  ['u_zoe', 'Zoe Hart', 'Procurement Officer', 1.1],
  ['u_felix', 'Felix Romano', 'Procurement Officer', 1.0],
  ['u_amir', 'Amir Haddad', 'Engineer', 1.0],
  ['u_chloe', 'Chloe Martin', 'Field Supervisor', 1.0],
  ['u_noah', 'Noah Fitzgerald', 'Analyst', 1.0],
  // Security operations center
  ['u_elena', 'Elena Vasquez', 'Watch Commander', 1.0],
  ['u_kwame', 'Kwame Asante', 'Watch Commander', 1.0],
  ['u_liz', 'Liz Moreno', 'Watch Commander', 1.0],
  ['u_tess', 'Tess Nakamura', 'SOC Analyst', 0.85],
  ['u_omar', 'Omar Farouk', 'SOC Analyst', 1.0],
  ['u_jade', 'Jade Wilson', 'SOC Analyst', 1.1],
  ['u_ben', 'Ben Adler', 'SOC Analyst', 0.95],
  ['u_carmen', 'Carmen Diaz', 'Patrol Officer', 0.9],
  ['u_jamal', 'Jamal Wright', 'Patrol Officer', 1.0],
  ['u_ivy', 'Ivy Chen', 'Patrol Officer', 0.95],
  ['u_pete', 'Pete Kowalski', 'Patrol Officer', 1.2],
  ['u_ana', 'Ana Silva', 'Patrol Officer', 1.0],
  ['u_ross', 'Ross Taylor', 'Patrol Officer', 1.1],
  ['u_nina', 'Nina Okoro', 'Patrol Officer', 0.9],
  ['u_dev', 'Dev Sharma', 'Patrol Officer', 1.05],
  ['u_mei', 'Mei Lin', 'Records Specialist', 1.0],
]

export function seedUsers(): User[] {
  return people.map(([id, name, title, speed], i) => ({
    id,
    name,
    title,
    speed,
    color: PALETTE[i % PALETTE.length]!,
    available: true,
  }))
}

export function seedGroups(): Group[] {
  return [
    {
      id: 'g_clerks',
      name: 'AP Clerks',
      supervisorId: 'u_carla',
      memberIds: ['u_maya', 'u_jordan', 'u_aisha', 'u_tom', 'u_grace', 'u_luis', 'u_hannah', 'u_sam', 'u_priya', 'u_daniel'],
    },
    { id: 'g_exceptions', name: 'AP Exceptions', supervisorId: 'u_carla', memberIds: ['u_rosa', 'u_kevin', 'u_ellen'] },
    { id: 'g_approvers', name: 'Budget Approvers', supervisorId: 'u_carla', memberIds: ['u_marcus', 'u_nadia', 'u_owen', 'u_lena'] },
    { id: 'g_finlead', name: 'Finance Leadership', memberIds: ['u_carla', 'u_victor'] },
    { id: 'g_fleet', name: 'Fleet Coordinators', supervisorId: 'u_dana', memberIds: ['u_ray', 'u_beth', 'u_chris'] },
    { id: 'g_procure', name: 'Procurement', supervisorId: 'u_dana', memberIds: ['u_ian', 'u_zoe', 'u_felix'] },
    { id: 'g_fleetlead', name: 'Fleet Leadership', memberIds: ['u_dana', 'u_gloria'] },
    { id: 'g_requesters', name: 'Vehicle Requesters', memberIds: ['u_amir', 'u_chloe', 'u_noah', 'u_ray', 'u_beth'] },
    {
      id: 'g_apdispatch',
      name: 'AP Dispatch',
      kind: 'distribution',
      description: 'Supervisors who hand approval work to budget managers.',
      memberIds: ['u_carla', 'u_victor'],
    },
    { id: 'g_fleetdispatch', name: 'Fleet Dispatch', kind: 'distribution', description: 'Hands vehicle requests to fleet coordinators.', memberIds: ['u_dana', 'u_gloria'] },
    { id: 'g_analysts', name: 'SOC Analysts', supervisorId: 'u_elena', memberIds: ['u_tess', 'u_omar', 'u_jade', 'u_ben'] },
    { id: 'g_officers', name: 'Patrol Officers', supervisorId: 'u_kwame', memberIds: ['u_carmen', 'u_jamal', 'u_ivy', 'u_pete', 'u_ana', 'u_ross', 'u_nina', 'u_dev'] },
    {
      id: 'g_watch',
      name: 'Watch Commanders',
      kind: 'distribution',
      description: 'Point officers at cameras: hand each dispatch to the officer of their choice.',
      memberIds: ['u_elena', 'u_kwame', 'u_liz'],
    },
    { id: 'g_records', name: 'Records', memberIds: ['u_mei'] },
  ]
}

// ---------- Helpers ----------

// ---------- Invoice Processing ----------

function invoiceApp(): App {
  const lists: ListDef[] = [
    flatList('l_vendors', 'Vendors', 'Vendor', [
      'Acme Office Supply',
      'Northwind Logistics',
      'Contoso Facilities',
      'Globex Engineering',
      'Initech Software',
      'Blue Ridge Catering',
      'Cardinal IT Services',
      'Summit Electric Co.',
      'Harbor Freight Partners',
      'Pinecrest Janitorial',
    ]),
    flatList('l_priority', 'Priority', 'Priority', ['Normal', 'High', 'Urgent']),
    treeList('l_org', 'Department / Cost Center / GL Account', ['Department', 'Cost Center', 'GL Account'], {
      Finance: {
        'CC-1100 Accounting': ['6100 Professional Fees', '6110 Audit Services'],
        'CC-1200 Treasury': ['6120 Bank Fees', '6130 Insurance'],
      },
      Facilities: {
        'CC-2100 Maintenance': ['6200 Repairs', '6210 Janitorial'],
        'CC-2200 Utilities': ['6220 Electric', '6230 Water & Sewer'],
      },
      'Information Technology': {
        'CC-3100 Infrastructure': ['6300 Hardware', '6310 Cloud Hosting'],
        'CC-3200 Applications': ['6320 Software Licenses', '6330 Consulting'],
      },
      Operations: {
        'CC-4100 Logistics': ['6400 Freight', '6410 Fuel'],
        'CC-4200 Field Services': ['6420 Equipment Rental', '6430 Supplies'],
      },
    }),
  ]

  const fields: FieldDef[] = [
    { id: 'f_invno', label: 'Invoice Number', type: 'text', required: true, width: 'half', summary: true },
    { id: 'f_vendor', label: 'Vendor', type: 'choice', listId: 'l_vendors', level: 0, required: true, width: 'half', summary: true },
    { id: 'f_amount', label: 'Amount', type: 'currency', required: true, width: 'half', min: 40, max: 48000, summary: true },
    { id: 'f_priority', label: 'Priority', type: 'choice', listId: 'l_priority', level: 0, width: 'half' },
    { id: 'f_invdate', label: 'Invoice Date', type: 'date', required: true, width: 'half' },
    { id: 'f_duedate', label: 'Due Date', type: 'date', width: 'half' },
    {
      id: 'f_dept',
      label: 'Department',
      type: 'choice',
      listId: 'l_org',
      level: 0,
      required: true,
      width: 'half',
      summary: true,
      helpText: 'Picking a department narrows the cost centers you can choose.',
    },
    { id: 'f_cc', label: 'Cost Center', type: 'choice', listId: 'l_org', level: 1, parentFieldId: 'f_dept', required: true, width: 'half' },
    { id: 'f_gl', label: 'GL Account', type: 'choice', listId: 'l_org', level: 2, parentFieldId: 'f_cc', width: 'half' },
    { id: 'f_po', label: 'PO Number', type: 'text', width: 'half', helpText: 'Used by the automated PO match.' },
    { id: 'f_email', label: 'Vendor Contact Email', type: 'email', width: 'half' },
    { id: 'f_doc', label: 'Invoice Document', type: 'attachment', width: 'half', helpText: 'PDF or image of the scanned invoice.' },
    { id: 'f_desc', label: 'Description', type: 'textarea', width: 'full' },
    {
      id: 'f_bank',
      label: 'Vendor Bank Account',
      type: 'text',
      width: 'half',
      helpText: 'Sensitive: visible to AP Exceptions and Finance Leadership only.',
      restrictedTo: ['g_exceptions', 'g_finlead'],
    },
    { id: 'f_pomatch', label: 'PO Matched', type: 'boolean', width: 'half', system: true },
    { id: 'f_approver', label: 'Approved By', type: 'user', width: 'half', system: true },
    { id: 'f_paydate', label: 'Scheduled Payment Date', type: 'date', width: 'half', system: true },
  ]

  const invoice: ObjectType = {
    id: 't_invoice',
    name: 'Invoice',
    pluralName: 'Invoices',
    icon: 'receipt',
    color: '#4f46e5',
    numberPrefix: 'INV-',
    fields,
    titleFieldId: 'f_vendor',
    priorityFieldId: 'f_priority',
    permissions: {
      g_clerks: P(true, true, true, false),
      g_exceptions: P(true, true, true, false),
      g_approvers: P(false, true, false, false),
      g_finlead: P(true, true, true, true),
    },
  }

  const approveSetsApprover = [{ id: 'a_appr', kind: 'setField' as const, fieldId: 'f_approver', value: '{currentUser}' }]
  const allRead = Object.fromEntries(fields.map((f) => [f.id, 'read' as const]))

  const wf: Workflow = {
    id: 'w_invoice',
    name: 'Invoice Approval',
    kind: 'process',
    objectTypeId: 't_invoice',
    arrivalsPerHour: 14,
    targetHours: 72,
    fieldLocks: [
      { id: 'lk_amt', fieldId: 'f_amount', access: 'read', when: 'after', afterNodeId: 'n_amount', exemptGroupIds: ['g_finlead'] },
      { id: 'lk_vendor', fieldId: 'f_vendor', access: 'read', when: 'after', afterNodeId: 'n_pocheck', exemptGroupIds: ['g_exceptions', 'g_finlead'] },
    ],
    nodes: [
      { id: 'n_start', type: 'start', position: { x: 0, y: 286 }, data: { label: 'Invoice received' } },
      {
        id: 'n_capture',
        type: 'auto',
        position: { x: 230, y: 283 },
        data: {
          label: 'Capture & match PO',
          description: 'Match the invoice against open purchase orders in the ERP. If the ERP keeps failing, an exceptions specialist matches it by hand.',
          avgMinutes: 4,
          actions: [],
          serviceId: 'svc_erp',
          operationId: 'op_erp_match',
          inputs: { invoiceNumber: '{field:f_invno}', vendor: '{field:f_vendor}', amount: '{field:f_amount}', po: '{field:f_po}' },
          outputs: [{ key: 'matched', fieldId: 'f_pomatch' }],
          retries: 1,
          onFailure: 'manual',
          fallbackGroupId: 'g_exceptions',
        },
      },
      { id: 'n_pocheck', type: 'decision', position: { x: 530, y: 250 }, data: { label: 'PO matched?' } },
      { id: 'n_amount', type: 'decision', position: { x: 790, y: 250 }, data: { label: 'Route by amount' } },
      {
        id: 'n_controller',
        type: 'user',
        position: { x: 1060, y: 40 },
        data: {
          label: 'Controller approval',
          description: 'Large invoices go straight to the Controller.',
          distribution: 'direct',
          groupId: 'g_finlead',
          userId: 'u_victor',
          autoDistribute: true,
          distributeEveryMinutes: 30,
          avgMinutes: 22,
          slaHours: 8,
          outcomes: [outcome('o_c_ok', 'Approve', 88, { actions: approveSetsApprover }), outcome('o_c_no', 'Reject', 12, { requireComment: true })],
          fieldAccess: { ...allRead, f_gl: 'edit', f_desc: 'edit' },
        },
      },
      {
        id: 'n_manager',
        type: 'user',
        position: { x: 1060, y: 262 },
        data: {
          label: 'Manager approval',
          description: 'The AP Dispatch group hands each invoice to the budget manager of their choice.',
          distribution: 'manager',
          groupId: 'g_approvers',
          supervisorId: 'u_carla',
          distributorGroupId: 'g_apdispatch',
          autoDistribute: true,
          distributeEveryMinutes: 40,
          avgMinutes: 16,
          slaHours: 24,
          escalateAfterHours: 16,
          escalation: { raisePriority: true, toDistributors: true, notify: 'AP Supervisor' },
          outcomes: [
            outcome('o_m_ok', 'Approve', 84, { actions: approveSetsApprover }),
            outcome('o_m_no', 'Reject', 10, { requireComment: true }),
          ],
          fieldAccess: { ...allRead, f_gl: 'edit', f_desc: 'edit' },
        },
      },
      {
        id: 'n_clerk',
        type: 'user',
        position: { x: 1060, y: 484 },
        data: {
          label: 'AP clerk review',
          description: 'Small invoices are load balanced evenly across the AP clerks.',
          distribution: 'load-balance',
          groupId: 'g_clerks',
          autoDistribute: true,
          distributeEveryMinutes: 30,
          avgMinutes: 11,
          slaHours: 24,
          escalateAfterHours: 20,
          escalation: { raisePriority: true, toDistributors: false },
          outcomes: [outcome('o_k_ok', 'Approve', 94, { actions: approveSetsApprover }), outcome('o_k_no', 'Reject', 6, { requireComment: true })],
          fieldAccess: { ...allRead, f_cc: 'edit', f_gl: 'edit', f_po: 'edit', f_desc: 'edit', f_priority: 'edit' },
        },
      },
      {
        id: 'n_exception',
        type: 'subflow',
        position: { x: 461, y: 484 },
        data: {
          label: 'Resolve exception',
          description: 'Unmatched invoices run the Exception Handling subflow: triage, then get the PO or correct the data.',
          workflowId: 'w_exception',
        },
      },
      { id: 'n_split', type: 'split', position: { x: 1400, y: 268 }, data: { label: 'Pay & file', mode: 'all' } },
      {
        id: 'n_post',
        type: 'auto',
        position: { x: 1560, y: 110 },
        data: {
          label: 'Post to ERP',
          description: 'Create the payable and schedule payment.',
          avgMinutes: 1,
          serviceId: 'svc_erp',
          operationId: 'op_erp_post',
          retries: 2,
          onFailure: 'stuck',
          actions: [{ id: 'a_pd', kind: 'setField', fieldId: 'f_paydate', value: '{today+14}' }],
        },
      },
      {
        id: 'n_remit',
        type: 'auto',
        position: { x: 1560, y: 283 },
        data: {
          label: 'Send remittance advice',
          avgMinutes: 1,
          serviceId: 'svc_mail',
          operationId: 'op_mail_send',
          retries: 3,
          onFailure: 'stuck',
          actions: [{ id: 'a_rem', kind: 'notify', to: 'Vendor Contact Email', message: 'Remittance advice for {number}' }],
        },
      },
      {
        id: 'n_archive',
        type: 'auto',
        position: { x: 1560, y: 456 },
        data: {
          label: 'Archive to records',
          description: 'File the invoice image and approvals under the 7-year retention schedule.',
          avgMinutes: 1,
          serviceId: 'svc_records',
          operationId: 'op_rec_put',
          retries: 1,
          onFailure: 'manual',
          fallbackGroupId: 'g_clerks',
          actions: [],
        },
      },
      { id: 'n_join', type: 'join', position: { x: 1880, y: 268 }, data: { label: 'All filed', mode: 'all' } },
      { id: 'n_paid', type: 'end', position: { x: 2040, y: 290 }, data: { label: 'Paid', result: 'completed' } },
      {
        id: 'n_notify',
        type: 'auto',
        position: { x: 1075, y: 700 },
        data: {
          label: 'Notify vendor',
          description: 'Email the vendor that the invoice was rejected, with the reviewer comment.',
          avgMinutes: 1,
          actions: [{ id: 'a_nv', kind: 'notify', to: 'Vendor Contact Email', message: 'Invoice {number} was rejected' }],
        },
      },
      { id: 'n_rejected', type: 'end', position: { x: 1440, y: 702 }, data: { label: 'Rejected', result: 'rejected' } },
    ],
    edges: [
      { id: 'e_1', source: 'n_start', target: 'n_capture', sourceHandle: 'r', targetHandle: 'l', data: {} },
      { id: 'e_2', source: 'n_capture', target: 'n_pocheck', sourceHandle: 'r', targetHandle: 'l', data: {} },
      {
        id: 'e_3',
        source: 'n_pocheck',
        target: 'n_amount',
        sourceHandle: 'r',
        targetHandle: 'l',
        data: { order: 0, condition: { match: 'all', rules: [{ id: 'r_pm', fieldId: 'f_pomatch', op: 'isTrue' }] } },
      },
      { id: 'e_4', source: 'n_pocheck', target: 'n_exception', sourceHandle: 'b', targetHandle: 't', data: { isDefault: true, order: 1 } },
      { id: 'e_5', source: 'n_exception', target: 'n_capture', sourceHandle: 'l', targetHandle: 'b', data: { outcomeId: 'Resolved' } },
      { id: 'e_6', source: 'n_exception', target: 'n_notify', sourceHandle: 'b', targetHandle: 'l', data: { outcomeId: 'Rejected' } },
      {
        id: 'e_7',
        source: 'n_amount',
        target: 'n_controller',
        sourceHandle: 't',
        targetHandle: 'l',
        data: { order: 0, condition: { match: 'all', rules: [{ id: 'r_a1', fieldId: 'f_amount', op: 'gt', value: 10000 }] } },
      },
      {
        id: 'e_8',
        source: 'n_amount',
        target: 'n_manager',
        sourceHandle: 'r',
        targetHandle: 'l',
        data: { order: 1, condition: { match: 'all', rules: [{ id: 'r_a2', fieldId: 'f_amount', op: 'gt', value: 1000 }] } },
      },
      { id: 'e_9', source: 'n_amount', target: 'n_clerk', sourceHandle: 'b', targetHandle: 'l', data: { isDefault: true, order: 2 } },
      { id: 'e_10', source: 'n_controller', target: 'n_split', sourceHandle: 'r', targetHandle: 't', data: { outcomeId: 'o_c_ok' } },
      { id: 'e_11', source: 'n_controller', target: 'n_notify', sourceHandle: 'r', targetHandle: 't', data: { outcomeId: 'o_c_no' } },
      { id: 'e_12', source: 'n_manager', target: 'n_split', sourceHandle: 'r', targetHandle: 'l', data: { outcomeId: 'o_m_ok' } },
      { id: 'e_13', source: 'n_manager', target: 'n_notify', sourceHandle: 'r', targetHandle: 't', data: { outcomeId: 'o_m_no' } },
      { id: 'e_15', source: 'n_clerk', target: 'n_split', sourceHandle: 'r', targetHandle: 'b', data: { outcomeId: 'o_k_ok' } },
      { id: 'e_16', source: 'n_clerk', target: 'n_notify', sourceHandle: 'b', targetHandle: 't', data: { outcomeId: 'o_k_no' } },
      { id: 'e_s1', source: 'n_split', target: 'n_post', sourceHandle: 't', targetHandle: 'l', data: {} },
      { id: 'e_s2', source: 'n_split', target: 'n_remit', sourceHandle: 'r', targetHandle: 'l', data: {} },
      { id: 'e_s3', source: 'n_split', target: 'n_archive', sourceHandle: 'b', targetHandle: 'l', data: {} },
      { id: 'e_j1', source: 'n_post', target: 'n_join', sourceHandle: 'r', targetHandle: 't', data: {} },
      { id: 'e_j2', source: 'n_remit', target: 'n_join', sourceHandle: 'r', targetHandle: 'l', data: {} },
      { id: 'e_j3', source: 'n_archive', target: 'n_join', sourceHandle: 'r', targetHandle: 'b', data: {} },
      { id: 'e_17', source: 'n_join', target: 'n_paid', sourceHandle: 'r', targetHandle: 'l', data: {} },
      { id: 'e_18', source: 'n_notify', target: 'n_rejected', sourceHandle: 'r', targetHandle: 'l', data: {} },
    ],
  }

  return {
    id: 'app_invoice',
    name: 'Invoice Processing',
    description: 'Accounts payable: capture, PO match, approvals by amount, and payment.',
    color: '#4f46e5',
    objectTypes: [invoice],
    lists,
    workflows: [wf, exceptionSubflow(allRead)],
  }
}

/** The "Resolve exception" step, blown out into its own subflow. */
function exceptionSubflow(allRead: Record<string, 'read'>): Workflow {
  const fix = { ...allRead, f_po: 'edit' as const, f_vendor: 'edit' as const, f_amount: 'edit' as const, f_desc: 'edit' as const, f_email: 'edit' as const, f_bank: 'edit' as const }
  return {
    id: 'w_exception',
    name: 'Exception Handling',
    description: 'Runs inside the “Resolve exception” step of Invoice Approval.',
    kind: 'subflow',
    objectTypeId: 't_invoice',
    arrivalsPerHour: 0,
    nodes: [
      { id: 'x_start', type: 'start', position: { x: 0, y: 206 }, data: { label: 'Exception raised' } },
      {
        id: 'x_triage',
        type: 'user',
        position: { x: 230, y: 176 },
        data: {
          label: 'Triage exception',
          description: 'Work out why the PO did not match.',
          distribution: 'queue',
          groupId: 'g_exceptions',
          autoDistribute: true,
          distributeEveryMinutes: 30,
          avgMinutes: 8,
          slaHours: 8,
          outcomes: [outcome('o_x_po', 'PO missing', 45), outcome('o_x_data', 'Data error', 40), outcome('o_x_rej', 'Reject invoice', 15, { requireComment: true })],
          fieldAccess: { ...allRead, f_desc: 'edit' },
        },
      },
      {
        id: 'x_request',
        type: 'user',
        position: { x: 620, y: 30 },
        data: {
          label: 'Get PO from requester',
          description: 'Chase the department for a purchase order.',
          distribution: 'load-balance',
          groupId: 'g_exceptions',
          autoDistribute: true,
          distributeEveryMinutes: 30,
          avgMinutes: 40,
          slaHours: 48,
          outcomes: [outcome('o_x_got', 'PO received', 85), outcome('o_x_nopo', 'No PO', 15, { requireComment: true })],
          fieldAccess: fix,
        },
      },
      {
        id: 'x_fix',
        type: 'user',
        position: { x: 620, y: 330 },
        data: {
          label: 'Correct invoice data',
          description: 'Four eyes: whoever triaged the exception may not also correct the data.',
          distribution: 'queue',
          separateFrom: ['x_triage'],
          groupId: 'g_exceptions',
          autoDistribute: true,
          distributeEveryMinutes: 30,
          avgMinutes: 20,
          slaHours: 24,
          outcomes: [outcome('o_x_fixed', 'Fixed', 100)],
          fieldAccess: fix,
        },
      },
      { id: 'x_resolved', type: 'end', position: { x: 1010, y: 130 }, data: { label: 'Resolved', result: 'completed', outcome: 'Resolved' } },
      { id: 'x_rejected', type: 'end', position: { x: 1010, y: 340 }, data: { label: 'Rejected', result: 'rejected', outcome: 'Rejected' } },
    ],
    edges: [
      { id: 'xe_1', source: 'x_start', target: 'x_triage', sourceHandle: 'r', targetHandle: 'l', data: {} },
      { id: 'xe_2', source: 'x_triage', target: 'x_request', sourceHandle: 't', targetHandle: 'l', data: { outcomeId: 'o_x_po' } },
      { id: 'xe_3', source: 'x_triage', target: 'x_fix', sourceHandle: 'b', targetHandle: 'l', data: { outcomeId: 'o_x_data' } },
      { id: 'xe_4', source: 'x_triage', target: 'x_rejected', sourceHandle: 'r', targetHandle: 'l', data: { outcomeId: 'o_x_rej' } },
      { id: 'xe_5', source: 'x_request', target: 'x_resolved', sourceHandle: 'r', targetHandle: 'l', data: { outcomeId: 'o_x_got' } },
      { id: 'xe_6', source: 'x_request', target: 'x_rejected', sourceHandle: 'r', targetHandle: 't', data: { outcomeId: 'o_x_nopo' } },
      { id: 'xe_7', source: 'x_fix', target: 'x_resolved', sourceHandle: 'r', targetHandle: 'b', data: { outcomeId: 'o_x_fixed' } },
    ],
  }
}

// ---------- Fleet Vehicle Requests ----------

function fleetApp(): App {
  const lists: ListDef[] = [
    treeList('l_vehicles', 'Vehicles (Model Year / Make / Model)', ['Model Year', 'Make', 'Model'], {
      '2025': {
        Ford: ['F-150', 'Escape', 'Transit Connect'],
        Toyota: ['Camry', 'RAV4', 'Tacoma'],
        Chevrolet: ['Silverado 1500', 'Equinox'],
      },
      '2026': {
        Ford: ['F-150 Lightning', 'Maverick', 'Explorer'],
        Toyota: ['Prius', 'Tundra', 'Highlander'],
        Honda: ['CR-V', 'Civic', 'Ridgeline'],
        Tesla: ['Model Y', 'Model 3'],
      },
      '2027': {
        Ford: ['Ranger', 'Bronco Sport'],
        Hyundai: ['Ioniq 5', 'Santa Fe'],
        Rivian: ['R2', 'R1T'],
        Toyota: ['bZ4X', 'Corolla Cross'],
      },
    }),
    flatList('l_fleetdept', 'Requesting Department', 'Department', ['Public Works', 'Parks & Recreation', 'Water Utility', 'Inspections', 'Transit']),
    flatList('l_use', 'Vehicle Use', 'Use', ['Replacement', 'Fleet expansion', 'Pool vehicle', 'Specialty']),
  ]

  const fields: FieldDef[] = [
    { id: 'v_req', label: 'Requestor', type: 'user', required: true, width: 'half', summary: true },
    { id: 'v_dept', label: 'Department', type: 'choice', listId: 'l_fleetdept', level: 0, required: true, width: 'half', summary: true },
    { id: 'v_year', label: 'Model Year', type: 'choice', listId: 'l_vehicles', level: 0, required: true, width: 'half', summary: true },
    {
      id: 'v_make',
      label: 'Make',
      type: 'choice',
      listId: 'l_vehicles',
      level: 1,
      parentFieldId: 'v_year',
      required: true,
      width: 'half',
      helpText: 'Only manufacturers offered in the chosen model year.',
    },
    { id: 'v_model', label: 'Model', type: 'choice', listId: 'l_vehicles', level: 2, parentFieldId: 'v_make', required: true, width: 'half', summary: true },
    { id: 'v_use', label: 'Vehicle Use', type: 'choice', listId: 'l_use', level: 0, width: 'half' },
    { id: 'v_cost', label: 'Estimated Cost', type: 'currency', required: true, width: 'half', min: 24000, max: 82000, summary: true },
    { id: 'v_need', label: 'Needed By', type: 'date', width: 'half' },
    { id: 'v_quote', label: 'Dealer Quote', type: 'attachment', width: 'half' },
    { id: 'v_just', label: 'Justification', type: 'textarea', width: 'full' },
    { id: 'v_po', label: 'PO Number', type: 'text', width: 'half', system: true },
  ]

  const request: ObjectType = {
    id: 't_vehicle',
    name: 'Vehicle Request',
    pluralName: 'Vehicle Requests',
    icon: 'car',
    color: '#0891b2',
    numberPrefix: 'VR-',
    fields,
    titleFieldId: 'v_model',
    permissions: {
      g_requesters: P(true, true, false, false),
      g_fleet: P(true, true, true, false),
      g_procure: P(false, true, true, false),
      g_fleetlead: P(true, true, true, true),
    },
  }

  const allRead = Object.fromEntries(fields.map((f) => [f.id, 'read' as const]))

  const wf: Workflow = {
    id: 'w_vehicle',
    name: 'Vehicle Acquisition',
    kind: 'process',
    objectTypeId: 't_vehicle',
    arrivalsPerHour: 3,
    targetHours: 120,
    fieldLocks: [
      { id: 'lk_y', fieldId: 'v_year', access: 'read', when: 'after', afterNodeId: 'v_review', exemptGroupIds: ['g_fleetlead'] },
      { id: 'lk_mk', fieldId: 'v_make', access: 'read', when: 'after', afterNodeId: 'v_review', exemptGroupIds: ['g_fleetlead'] },
      { id: 'lk_md', fieldId: 'v_model', access: 'read', when: 'after', afterNodeId: 'v_review', exemptGroupIds: ['g_fleetlead'] },
    ],
    nodes: [
      { id: 'v_start', type: 'start', position: { x: 0, y: 190 }, data: { label: 'Request submitted' } },
      {
        id: 'v_review',
        type: 'user',
        position: { x: 220, y: 160 },
        data: {
          label: 'Fleet review',
          description: 'Fleet Dispatch decides which coordinator reviews each request.',
          distribution: 'manager',
          groupId: 'g_fleet',
          supervisorId: 'u_dana',
          distributorGroupId: 'g_fleetdispatch',
          autoDistribute: true,
          distributeEveryMinutes: 60,
          avgMinutes: 25,
          slaHours: 24,
          outcomes: [
            outcome('v_o_ok', 'Approve', 82),
            outcome('v_o_no', 'Deny', 18, { requireComment: true }),
          ],
          fieldAccess: { ...allRead, v_use: 'edit', v_cost: 'edit', v_just: 'edit' },
        },
      },
      { id: 'v_cost', type: 'decision', position: { x: 580, y: 155 }, data: { label: 'Over $45k?' } },
      {
        id: 'v_director',
        type: 'user',
        position: { x: 780, y: 0 },
        data: {
          label: 'Director approval',
          distribution: 'direct',
          groupId: 'g_fleetlead',
          userId: 'u_gloria',
          autoDistribute: true,
          distributeEveryMinutes: 30,
          avgMinutes: 15,
          slaHours: 48,
          outcomes: [outcome('v_d_ok', 'Approve', 80), outcome('v_d_no', 'Deny', 20, { requireComment: true })],
          fieldAccess: { ...allRead },
        },
      },
      {
        id: 'v_procure',
        type: 'subflow',
        position: { x: 1100, y: 160 },
        data: {
          label: 'Purchase vehicle',
          description: 'Ask three dealers for quotes in parallel, continue once two reply, then order.',
          workflowId: 'w_purchase',
        },
      },
      {
        id: 'v_issue',
        type: 'auto',
        position: { x: 1440, y: 186 },
        data: {
          label: 'Issue PO',
          description: 'Create the purchase order and email the requestor.',
          avgMinutes: 2,
          actions: [
            { id: 'v_a_po', kind: 'setField', fieldId: 'v_po', value: 'PO-{seq}' },
            { id: 'v_a_n', kind: 'notify', to: 'Requestor', message: 'Your vehicle {number} has been ordered' },
          ],
        },
      },
      { id: 'v_ordered', type: 'end', position: { x: 1760, y: 190 }, data: { label: 'Vehicle ordered', result: 'completed' } },
      { id: 'v_denied', type: 'end', position: { x: 831, y: 420 }, data: { label: 'Denied', result: 'rejected' } },
    ],
    edges: [
      { id: 've_1', source: 'v_start', target: 'v_review', sourceHandle: 'r', targetHandle: 'l', data: {} },
      { id: 've_2', source: 'v_review', target: 'v_cost', sourceHandle: 'r', targetHandle: 'l', data: { outcomeId: 'v_o_ok' } },
      { id: 've_3', source: 'v_review', target: 'v_denied', sourceHandle: 'b', targetHandle: 'l', data: { outcomeId: 'v_o_no' } },
      {
        id: 've_4',
        source: 'v_cost',
        target: 'v_director',
        sourceHandle: 't',
        targetHandle: 'l',
        data: { order: 0, condition: { match: 'all', rules: [{ id: 'v_r1', fieldId: 'v_cost', op: 'gt', value: 45000 }] } },
      },
      { id: 've_5', source: 'v_cost', target: 'v_procure', sourceHandle: 'r', targetHandle: 'l', data: { isDefault: true, order: 1 } },
      { id: 've_6', source: 'v_director', target: 'v_procure', sourceHandle: 'r', targetHandle: 't', data: { outcomeId: 'v_d_ok' } },
      { id: 've_7', source: 'v_director', target: 'v_denied', sourceHandle: 'b', targetHandle: 't', data: { outcomeId: 'v_d_no' } },
      { id: 've_8', source: 'v_procure', target: 'v_issue', sourceHandle: 'r', targetHandle: 'l', data: { outcomeId: 'Ordered' } },
      { id: 've_9', source: 'v_issue', target: 'v_ordered', sourceHandle: 'r', targetHandle: 'l', data: {} },
    ],
  }

  return {
    id: 'app_fleet',
    name: 'Fleet Vehicle Requests',
    description: 'Departments request vehicles; fleet, leadership and procurement act on them.',
    color: '#0891b2',
    objectTypes: [request],
    lists,
    workflows: [wf, purchaseSubflow(allRead)],
  }
}

/** Quotes from three dealers at once; the first two replies are enough. */
function purchaseSubflow(allRead: Record<string, 'read'>): Workflow {
  const quote = (id: string, label: string, y: number) => ({
    id,
    type: 'auto' as const,
    position: { x: 430, y },
    data: {
      label,
      avgMinutes: 50,
      serviceId: 'svc_dealers',
      operationId: 'op_quote',
      inputs: { model: '{field:v_model}', year: '{field:v_year}' },
      retries: 1,
      onFailure: 'manual' as const,
      fallbackGroupId: 'g_procure',
      actions: [],
    },
  })
  return {
    id: 'w_purchase',
    name: 'Purchase Vehicle',
    description: 'Runs inside the “Purchase vehicle” step of Vehicle Acquisition.',
    kind: 'subflow',
    objectTypeId: 't_vehicle',
    arrivalsPerHour: 0,
    nodes: [
      { id: 'p_start', type: 'start', position: { x: 0, y: 206 }, data: { label: 'Approved to buy' } },
      { id: 'p_split', type: 'split', position: { x: 240, y: 190 }, data: { label: 'Request quotes', mode: 'all' } },
      quote('p_q1', 'Quote: Capital Ford', 30),
      quote('p_q2', 'Quote: Metro Toyota', 200),
      quote('p_q3', 'Quote: Valley Honda', 370),
      { id: 'p_join', type: 'join', position: { x: 740, y: 190 }, data: { label: 'Two quotes in', mode: 'count', count: 2, cancelRemaining: true } },
      {
        id: 'p_select',
        type: 'user',
        position: { x: 900, y: 176 },
        data: {
          label: 'Compare quotes & order',
          description: 'Procurement officers fetch the next request from the queue.',
          distribution: 'queue',
          groupId: 'g_procure',
          autoDistribute: true,
          distributeEveryMinutes: 30,
          avgMinutes: 40,
          slaHours: 72,
          outcomes: [outcome('p_o_ok', 'Ordered', 92), outcome('p_o_cancel', 'Cancel request', 8, { requireComment: true })],
          fieldAccess: { ...allRead, v_cost: 'edit' },
        },
      },
      { id: 'p_ordered', type: 'end', position: { x: 1270, y: 120 }, data: { label: 'Ordered', result: 'completed', outcome: 'Ordered' } },
      { id: 'p_cancelled', type: 'end', position: { x: 1270, y: 330 }, data: { label: 'Cancelled', result: 'cancelled', outcome: 'Cancelled' } },
    ],
    edges: [
      { id: 'pe_1', source: 'p_start', target: 'p_split', sourceHandle: 'r', targetHandle: 'l', data: {} },
      { id: 'pe_2', source: 'p_split', target: 'p_q1', sourceHandle: 't', targetHandle: 'l', data: {} },
      { id: 'pe_3', source: 'p_split', target: 'p_q2', sourceHandle: 'r', targetHandle: 'l', data: {} },
      { id: 'pe_4', source: 'p_split', target: 'p_q3', sourceHandle: 'b', targetHandle: 'l', data: {} },
      { id: 'pe_5', source: 'p_q1', target: 'p_join', sourceHandle: 'r', targetHandle: 't', data: {} },
      { id: 'pe_6', source: 'p_q2', target: 'p_join', sourceHandle: 'r', targetHandle: 'l', data: {} },
      { id: 'pe_7', source: 'p_q3', target: 'p_join', sourceHandle: 'r', targetHandle: 'b', data: {} },
      { id: 'pe_8', source: 'p_join', target: 'p_select', sourceHandle: 'r', targetHandle: 'l', data: {} },
      { id: 'pe_9', source: 'p_select', target: 'p_ordered', sourceHandle: 'r', targetHandle: 'l', data: { outcomeId: 'p_o_ok' } },
      { id: 'pe_10', source: 'p_select', target: 'p_cancelled', sourceHandle: 'b', targetHandle: 'l', data: { outcomeId: 'p_o_cancel' } },
    ],
  }
}

export function seedDesign(): Design {
  return { apps: [invoiceApp(), fleetApp(), socApp()], users: seedUsers(), groups: seedGroups(), services: seedServices(), templates: seedTemplates() }
}

// ---------- Blank templates used by "New ..." buttons ----------

export function blankObjectType(name: string): ObjectType {
  const titleId = uid('f')
  return {
    id: uid('t'),
    name,
    pluralName: `${name}s`,
    icon: 'file',
    color: '#4f46e5',
    numberPrefix: `${name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'OBJ'}-`,
    fields: [{ id: titleId, label: 'Title', type: 'text', required: true, width: 'full', summary: true }],
    titleFieldId: titleId,
    permissions: {},
  }
}

export function blankWorkflow(name: string, objectTypeId: string): Workflow {
  const s = uid('n')
  const e = uid('n')
  return {
    id: uid('w'),
    name,
    kind: 'process',
    objectTypeId,
    arrivalsPerHour: 6,
    nodes: [
      { id: s, type: 'start', position: { x: 0, y: 100 }, data: { label: 'Created' } },
      { id: e, type: 'end', position: { x: 520, y: 100 }, data: { label: 'Done', result: 'completed' } },
    ],
    edges: [],
  }
}

export function blankApp(name: string): App {
  const type = blankObjectType('Request')
  return {
    id: uid('app'),
    name,
    description: '',
    color: '#7c3aed',
    objectTypes: [type],
    lists: [],
    workflows: [blankWorkflow(`${name} workflow`, type.id)],
  }
}
