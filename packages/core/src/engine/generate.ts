import type { ColumnDef, FieldDef, ListDef, ObjectType, TableRow, User } from '../model/types'
import { optionsForField } from '../model/lists'
import { normalizeData } from '../model/tables'
import { isoDay, simDate } from '../model/util'
import { type HasRng, pick, rand, randInt } from './rng'

const INVOICE_LINES = [
  'Monthly janitorial service, October.',
  'Replacement filters and belts for rooftop HVAC units.',
  'Cloud hosting — production cluster, monthly usage.',
  'Annual renewal of design software licenses (25 seats).',
  'Catering for quarterly all-hands meeting.',
  'Freight charges for warehouse transfer.',
  'Emergency electrical repair, Building C.',
  'Consulting hours for ERP upgrade, phase 2.',
  'Laptop refresh: 12 units with docking stations.',
  'Office supplies restock for 3rd floor.',
]

const JUSTIFICATIONS = [
  'Replaces unit #4412, which has 182,000 miles and failed inspection.',
  'New inspector position approved in this year’s budget needs a vehicle.',
  'Pool vehicle demand exceeds availability three days a week.',
  'Crew truck needed for the new water main replacement program.',
  'Current vehicle is out of warranty and repair costs exceed its value.',
  'Electric replacement supports the fleet emissions reduction goal.',
]

const LINE_DESCRIPTIONS = [
  'Laptop, 14-inch business model',
  'Docking station',
  'Janitorial service, weekly',
  'HVAC filter set',
  'Cloud compute hours',
  'Software license seat (annual)',
  'Freight, pallet transfer',
  'Electrical repair labor (hours)',
  'Consulting hours',
  'Printer paper, case',
  'Catering, per person',
  'Toner cartridge',
  'Network switch, 24-port',
  'Safety vests, box of 10',
]

const GENERIC = ['Routine request.', 'See attached details.', 'Requested by the department lead.', 'Follow-up to last month’s request.']

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24) || 'vendor'
}

/**
 * Random but plausible values for every non-system field, honoring linked lists
 * (a child is only drawn from the children of the parent value already chosen).
 */
export function generateData(
  s: HasRng,
  type: ObjectType,
  lists: ListDef[],
  users: User[],
  clock: number,
  objectNumber: string,
): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  const today = simDate(clock)
  const pending = type.fields.filter((f) => !f.system)
  // Parents before children so cascading options resolve.
  const ordered: FieldDef[] = []
  const placed = new Set<string>()
  let guard = 0
  while (ordered.length < pending.length && guard++ < 20) {
    for (const f of pending) {
      if (placed.has(f.id)) continue
      if (!f.parentFieldId || placed.has(f.parentFieldId) || !pending.some((p) => p.id === f.parentFieldId)) {
        ordered.push(f)
        placed.add(f.id)
      }
    }
  }

  for (const f of ordered) {
    const label = f.label.toLowerCase()
    switch (f.type) {
      case 'text': {
        if (label.includes('invoice') && label.includes('number')) data[f.id] = `${randInt(s, 10, 99)}-${randInt(s, 10000, 99999)}`
        else if (label.includes('po')) data[f.id] = rand(s) < 0.88 ? `PO-${randInt(s, 40000, 49999)}` : ''
        else data[f.id] = `${type.name} ${objectNumber}`
        break
      }
      case 'textarea':
        data[f.id] = label.includes('justif') ? pick(s, JUSTIFICATIONS) : type.name.toLowerCase().includes('invoice') ? pick(s, INVOICE_LINES) : pick(s, GENERIC)
        break
      case 'number': {
        const min = f.min ?? 1
        const max = f.max ?? 100
        data[f.id] = randInt(s, min, max)
        break
      }
      case 'currency': {
        // Log-uniform: many small amounts, a long tail of large ones.
        const min = Math.max(1, f.min ?? 50)
        const max = Math.max(min + 1, f.max ?? 25000)
        const v = Math.exp(Math.log(min) + rand(s) * (Math.log(max) - Math.log(min)))
        data[f.id] = Math.round(v * 100) / 100
        break
      }
      case 'date': {
        let offset = randInt(s, -3, 30)
        if (label.includes('invoice')) offset = -randInt(s, 0, 20)
        else if (label.includes('due')) offset = randInt(s, 10, 40)
        else if (label.includes('need')) offset = randInt(s, 20, 120)
        data[f.id] = isoDay(new Date(today.getTime() + offset * 86_400_000))
        break
      }
      case 'boolean':
        data[f.id] = rand(s) < 0.5
        break
      case 'choice': {
        const list = lists.find((l) => l.id === f.listId)
        const opts = optionsForField(f, list, data)
        // Priority-like lists skew to the first (usually "Normal") option.
        const first = opts[0]
        data[f.id] = label.includes('priority') && first && rand(s) < 0.7 ? first.id : pick(s, opts)?.id
        break
      }
      case 'user':
        data[f.id] = pick(s, users)?.id
        break
      case 'email': {
        const vendorField = type.fields.find((x) => x.type === 'choice' && x.label.toLowerCase().includes('vendor'))
        const vendorList = lists.find((l) => l.id === vendorField?.listId)
        const vendor = vendorList?.items.find((i) => i.id === data[vendorField?.id ?? ''])?.label
        data[f.id] = `billing@${slug(vendor ?? 'example')}.com`
        break
      }
      case 'table':
        break // filled in after the loop, so a total (an invoice's Amount) can drive the rows
      case 'attachment':
        if (rand(s) < 0.92) {
          const ext = rand(s) < 0.8 ? 'pdf' : 'png'
          data[f.id] = [{ name: `${f.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${objectNumber}.${ext}`, size: randInt(s, 60, 900) * 1024, kind: ext === 'pdf' ? 'application/pdf' : 'image/png' }]
        }
        break
    }
  }
  for (const f of type.fields) {
    if (f.type !== 'table' || f.system) continue
    const totalField = type.fields.find((t) => t.total?.tableFieldId === f.id)
    const target = totalField ? Number(data[totalField.id]) || undefined : undefined
    data[f.id] = generateRows(s, f, lists, users, today, target, totalField?.total?.columnId)
  }
  return normalizeData(type, data)
}

/**
 * Plausible rows for a table field. When a total drives it (Amount = sum of
 * Line Total), the target is split across the rows: quantities are whole
 * numbers and unit prices make up the rest.
 */
function generateRows(s: HasRng, f: FieldDef, lists: ListDef[], users: User[], today: Date, target?: number, totalColumnId?: string): TableRow[] {
  const cols = f.columns ?? []
  const n = randInt(s, Math.max(1, f.minRows ?? 1), Math.max(1, Math.min(f.maxRows ?? 5, 5)))
  const totalCol = cols.find((c) => c.id === totalColumnId)
  const factors = new Set(totalCol?.formula?.of ?? [])
  const weights = Array.from({ length: n }, () => 0.3 + rand(s))
  const sum = weights.reduce((a, b) => a + b, 0)
  const shares = target !== undefined ? weights.map((w) => (target * w) / sum) : undefined
  const qtyCol = cols.find((c) => factors.has(c.id) && c.type === 'number')
  return Array.from({ length: n }, (_, i) => {
    const row: TableRow = { id: `row_${i + 1}` }
    const qty = qtyCol ? randInt(s, Math.max(1, qtyCol.min ?? 1), Math.min(qtyCol.max ?? 12, 12)) : 1
    for (const c of cols) {
      if (c.formula) continue
      if (shares && c === qtyCol) row[c.id] = qty
      else if (shares && factors.has(c.id)) row[c.id] = Math.max(0.01, Math.round((shares[i]! / qty) * 100) / 100)
      else if (shares && c.id === totalColumnId) row[c.id] = Math.round(shares[i]! * 100) / 100
      else row[c.id] = cellValue(s, c, lists, users, today)
    }
    return row
  })
}

function cellValue(s: HasRng, c: ColumnDef, lists: ListDef[], users: User[], today: Date): unknown {
  const label = c.label.toLowerCase()
  switch (c.type) {
    case 'text':
      return label.includes('desc') || label.includes('item') ? pick(s, LINE_DESCRIPTIONS) : `${c.label} ${randInt(s, 100, 999)}`
    case 'number':
      return randInt(s, c.min ?? 1, c.max ?? 10)
    case 'currency': {
      const min = Math.max(1, c.min ?? 20)
      const max = Math.max(min + 1, c.max ?? 2000)
      return Math.round(Math.exp(Math.log(min) + rand(s) * (Math.log(max) - Math.log(min))) * 100) / 100
    }
    case 'date':
      return isoDay(new Date(today.getTime() + randInt(s, -10, 20) * 86_400_000))
    case 'boolean':
      return rand(s) < 0.5
    case 'choice':
      return pick(s, (lists.find((l) => l.id === c.listId)?.items ?? []).filter((i) => i.parentId === null))?.id
    case 'user':
      return pick(s, users)?.id
    case 'email':
      return `contact${randInt(s, 1, 99)}@example.com`
  }
}

const COMMENT_BANK: Array<[RegExp, string[]]> = [
  [/approv/i, ['Approved — matches the PO and receiving report.', 'Looks good.', 'Within budget. Approved.', 'Approved; GL coding verified.', 'OK to pay.', 'Approved for this fiscal year.']],
  [/reject/i, ['Duplicate of an invoice already paid.', 'Pricing does not match the contract rate.', 'Services were not received.', 'Vendor is not on the approved list.']],
  [/return/i, ['Need the receiving report before I can approve.', 'Cost center looks wrong — please re-code.', 'Missing PO reference.']],
  [/resol/i, ['Vendor sent a corrected PO number.', 'Matched to blanket PO manually.', 'Confirmed with requester; PO updated.']],
  [/deny/i, ['An existing pool vehicle can cover this need.', 'Not in this year’s capital plan.', 'Please resubmit with a second quote.']],
  [/order/i, ['Ordered through the state contract.', 'Dealer confirmed delivery in 6 weeks.', 'PO sent to dealer.']],
]

export function commentFor(s: HasRng, outcomeLabel: string): string {
  for (const [re, lines] of COMMENT_BANK) if (re.test(outcomeLabel)) return pick(s, lines) ?? ''
  return pick(s, ['Done.', 'Reviewed and released.', 'Completed.']) ?? ''
}
