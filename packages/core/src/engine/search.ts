// Search across items: free text plus filters, ranked, with snippets, scoped to
// what the person searching may see. The same function backs the Workspace
// search box, the assistant, and (later) the API; a server swaps the in-memory
// scan for an index (see docs/ARCHITECTURE.md) without changing the query language.
//
// Query language (all optional, combine freely):
//   acme laptop "net 30"        words and phrases, matched in any field, line items, comments
//   -freight                    exclude a word
//   priority:urgent             low / normal / high / urgent
//   is:overdue is:expedited is:mine is:stuck is:unassigned is:escalated is:open is:closed
//   status:completed            active / completed / rejected / cancelled
//   step:"manager approval"     where it is now (also at:)
//   assignee:me  assignee:maya  who holds it now (also who:)
//   creator:me                  who created it (also by:)
//   type:invoice workflow:fleet number=INV-1042 (number:INV-10 matches part of it)
//   created:<2d  due:<4h        within the last 2 days / due within 4 hours (m, h, d, w)
//   amount>10k  "line total">=500  vendor:acme  category:software   any field or line-item column, by label

import { rowsOf } from '../model/tables'
import { fieldVerdicts } from '../model/security'
import type { ColumnDef, FieldDef, Id, ObjectType, Priority, TableRow } from '../model/types'
import { formatFieldValue } from '../model/format'
import type { AuditEntry } from './state'
import { activeTokens, buildIndex, type Ctx, describeTokenText, hasRole, type Index, PRIORITY_RANK, type SimObject, type SimState, supervisesProcess, urgencyRank } from './engine'

// ---------- Parsing ----------

export type Comparison = ':' | '=' | '>' | '>=' | '<' | '<='

export interface Filter {
  key: string
  op: Comparison
  value: string
  negate?: boolean
}

export interface ParsedQuery {
  terms: string[]
  phrases: string[]
  excluded: string[]
  filters: Filter[]
}

const KEY_ALIASES: Record<string, string> = { at: 'step', who: 'assignee', assigned: 'assignee', by: 'creator', process: 'workflow', '#': 'number' }

/** Split a query into tokens, keeping "quoted phrases" (and quoted keys) together. */
function tokenize(q: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (const ch of q) {
    if (ch === '"') quoted = !quoted
    if (/\s/.test(ch) && !quoted) {
      if (cur) out.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur) out.push(cur)
  return out
}

const unquote = (s: string) => s.replace(/^"|"$/g, '').replace(/"/g, '')

export function parseQuery(q: string): ParsedQuery {
  const parsed: ParsedQuery = { terms: [], phrases: [], excluded: [], filters: [] }
  for (const raw of tokenize(q.trim())) {
    const negate = raw.startsWith('-') && raw.length > 1
    const tok = negate ? raw.slice(1) : raw
    const m = /^("[^"]+"|[A-Za-z#$][\w$-]*)(>=|<=|:|=|>|<)(.+)$/.exec(tok)
    if (m) {
      const key = unquote(m[1]!).toLowerCase()
      parsed.filters.push({ key: KEY_ALIASES[key] ?? key, op: m[2] as Comparison, value: unquote(m[3]!), negate })
      continue
    }
    const word = unquote(tok).toLowerCase()
    if (!word) continue
    if (negate) parsed.excluded.push(word)
    else if (tok.startsWith('"')) parsed.phrases.push(word)
    else parsed.terms.push(word)
  }
  return parsed
}

/** "10k" → 10000, "$1,250.50" → 1250.5, "1.5m" → 1500000. */
export function parseAmount(s: string): number | undefined {
  const m = /^\$?\s*([\d,]*\.?\d+)\s*([km])?$/i.exec(s.trim())
  if (!m) return undefined
  const n = Number(m[1]!.replace(/,/g, ''))
  return Number.isNaN(n) ? undefined : n * (m[2]?.toLowerCase() === 'k' ? 1_000 : m[2]?.toLowerCase() === 'm' ? 1_000_000 : 1)
}

/** "2d" → 2880 minutes. Units: m, h, d, w. */
export function parseDuration(s: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)\s*(m|min|h|hr|d|w)?$/i.exec(s.trim())
  if (!m) return undefined
  const unit = (m[2] ?? 'd').toLowerCase()
  const per = unit.startsWith('m') ? 1 : unit.startsWith('h') ? 60 : unit === 'w' ? 7 * 1440 : 1440
  return Number(m[1]) * per
}

// ---------- The searchable view of an item ----------

interface Entry {
  fieldId: Id
  label: string
  text: string
}

interface Indexed {
  len: number
  title: string
  entries: Entry[]
}

const cache = new WeakMap<SimObject, Indexed>()

function cellText(c: ColumnDef, v: unknown, idx: Index): string {
  return formatFieldValue({ id: c.id, label: c.label, type: c.type, width: 'half', listId: c.listId, level: 0 }, v, idx.ctx.app.lists, idx.ctx.users)
}

function indexItem(idx: Index, obj: SimObject, type: ObjectType): Indexed {
  const hit = cache.get(obj)
  if (hit && hit.len === obj.history.length + obj.tokens.length) return hit
  const lists = idx.ctx.app.lists
  const users = idx.ctx.users
  const entries: Entry[] = []
  for (const f of type.fields) {
    const v = obj.data[f.id]
    if (f.type === 'table') {
      for (const r of rowsOf(v)) {
        const text = (f.columns ?? []).map((c) => cellText(c, r[c.id], idx)).filter(Boolean).join(' · ')
        if (text) entries.push({ fieldId: f.id, label: f.label, text })
      }
      continue
    }
    const text = formatFieldValue(f, v, lists, users)
    if (text) entries.push({ fieldId: f.id, label: f.label, text })
  }
  for (const h of obj.history) if (h.comment) entries.push({ fieldId: '$comment', label: 'Comment', text: h.comment })
  const titleField = type.fields.find((x) => x.id === type.titleFieldId) ?? type.fields.find((x) => x.summary)
  const title = titleField ? formatFieldValue(titleField, obj.data[titleField.id], lists, users) : ''
  const indexed = { len: obj.history.length + obj.tokens.length, title, entries }
  cache.set(obj, indexed)
  return indexed
}

// ---------- Visibility ----------

/** Can this person find this item at all? Admins and auditors see everything. */
function mayRead(idx: Index, obj: SimObject, type: ObjectType, userId: Id | undefined): boolean {
  if (!userId || hasRole(idx, userId, 'admin') || hasRole(idx, userId, 'auditor')) return true
  if (obj.createdBy === userId) return true
  if (obj.tokens.some((t) => t.userId === userId) || obj.history.some((h) => h.userId === userId)) return true
  if (supervisesProcess(idx, obj.workflowId, userId)) return true
  return Object.entries(type.permissions).some(([gid, p]) => p.read && idx.group.get(gid)?.memberIds.includes(userId))
}

function hiddenFields(idx: Index, obj: SimObject, type: ObjectType, userId: Id | undefined): Set<Id> {
  if (!userId) return new Set()
  const wf = idx.wf.get(obj.workflowId)
  const v = fieldVerdicts({ type, wf, passed: obj.passed, userId, groups: idx.ctx.groups, admin: hasRole(idx, userId, 'admin') })
  return new Set(Object.entries(v).filter(([, x]) => x.access === 'hidden').map(([id]) => id))
}

/** May this person see this item at all? The same rule search uses. */
export function canReadItem(ctx: Ctx, obj: SimObject, userId: Id | undefined): boolean {
  const idx = buildIndex(ctx)
  const type = idx.type.get(obj.typeId)
  return !!type && mayRead(idx, obj, type, userId)
}

/** Fields hidden from this person on this item wherever it is (sensitive fields, workflow locks). */
export function hiddenFieldsOf(ctx: Ctx, obj: SimObject, userId: Id | undefined): Set<Id> {
  const idx = buildIndex(ctx)
  const type = idx.type.get(obj.typeId)
  return type ? hiddenFields(idx, obj, type, userId) : new Set()
}

/** The item's history as this person may read it: entries that show a hidden field's value read their redacted text. */
export function visibleHistory(ctx: Ctx, obj: SimObject, userId: Id | undefined, hidden: Set<Id> = hiddenFieldsOf(ctx, obj, userId)): AuditEntry[] {
  if (!hidden.size) return obj.history
  return obj.history.map((h) => (h.fieldIds?.some((f) => hidden.has(f)) ? { ...h, text: h.redacted ?? 'A restricted field changed' } : h))
}

// ---------- Filters ----------

function compare(a: number, op: Comparison, b: number): boolean {
  switch (op) {
    case '>':
      return a > b
    case '>=':
      return a >= b
    case '<':
      return a < b
    case '<=':
      return a <= b
    default:
      return a === b
  }
}

function matchValue(field: FieldDef | ColumnDef, raw: unknown, f: Filter, idx: Index): boolean {
  if (raw === undefined || raw === null || raw === '') return false
  if (field.type === 'number' || field.type === 'currency') {
    const want = parseAmount(f.value)
    return want !== undefined && compare(Number(raw), f.op === ':' ? '=' : f.op, want)
  }
  if (field.type === 'boolean') return /^(yes|true|1|y)$/i.test(f.value) === (raw === true)
  if (field.type === 'date' && f.op !== ':' && f.op !== '=') {
    const s = String(raw)
    return f.op === '>' ? s > f.value : f.op === '>=' ? s >= f.value : f.op === '<' ? s < f.value : s <= f.value
  }
  const shown = field.type === 'choice' || field.type === 'user' || field.type === 'date'
  const text = shown ? formatFieldValue({ id: field.id, label: field.label, type: field.type, width: 'half', listId: field.listId, level: 0 }, raw, idx.ctx.app.lists, idx.ctx.users) : String(raw)
  const want = f.value.toLowerCase()
  return f.op === '=' ? text.toLowerCase() === want : text.toLowerCase().includes(want)
}

/** A filter on a field or line-item column, found by label (exact, then prefix, then contains). */
function fieldFilter(type: ObjectType, label: string): { field: FieldDef; column?: ColumnDef } | undefined {
  const l = label.toLowerCase()
  const candidates: Array<{ field: FieldDef; column?: ColumnDef; name: string }> = []
  for (const f of type.fields) {
    candidates.push({ field: f, name: f.label.toLowerCase() })
    for (const c of f.columns ?? []) candidates.push({ field: f, column: c, name: c.label.toLowerCase() })
  }
  return candidates.find((c) => c.name === l) ?? candidates.find((c) => c.name.startsWith(l)) ?? candidates.find((c) => c.name.includes(l))
}

function nameMatches(idx: Index, userId: Id | undefined, value: string, me: Id | undefined): boolean {
  if (!userId) return false
  if (value.toLowerCase() === 'me') return userId === me
  return (idx.user.get(userId)?.name ?? userId).toLowerCase().includes(value.toLowerCase())
}

function passes(idx: Index, sim: SimState, obj: SimObject, type: ObjectType, hidden: Set<Id>, f: Filter, me: Id | undefined): boolean | undefined {
  const v = f.value.toLowerCase()
  switch (f.key) {
    case 'status': {
      if (v === 'open' || v === 'active') return obj.status === 'active'
      if (v === 'closed' || v === 'done' || v === 'finished') return obj.status !== 'active'
      return obj.status.startsWith(v)
    }
    case 'is': {
      switch (v) {
        case 'open':
        case 'active':
          return obj.status === 'active'
        case 'closed':
        case 'done':
          return obj.status !== 'active'
        case 'overdue':
        case 'late':
          return obj.status === 'active' && obj.dueBy !== undefined && sim.clock > obj.dueBy
        case 'expedited':
        case 'rush':
          return !!obj.expedite
        case 'mine':
          return !!me && obj.tokens.some((t) => t.userId === me)
        case 'stuck':
          return obj.tokens.some((t) => t.state === 'stuck')
        case 'unassigned':
          return obj.tokens.some((t) => t.state === 'unassigned')
        case 'escalated':
          return obj.tokens.some((t) => t.escalated)
        default:
          return undefined
      }
    }
    case 'priority': {
      const want = (['low', 'normal', 'high', 'urgent'] as Priority[]).find((p) => p.startsWith(v))
      if (!want) return undefined
      if (f.op === '>' || f.op === '>=' || f.op === '<' || f.op === '<=') return compare(PRIORITY_RANK[obj.priority], f.op, PRIORITY_RANK[want])
      return obj.priority === want
    }
    case 'step':
      return obj.tokens.some((t) => (idx.node.get(t.nodeId)?.node.data.label ?? '').toLowerCase().includes(v) || t.calls.some((c) => (idx.node.get(c.nodeId)?.node.data.label ?? '').toLowerCase().includes(v)))
    case 'assignee':
      return obj.tokens.some((t) => nameMatches(idx, t.userId, f.value, me))
    case 'creator':
      return nameMatches(idx, obj.createdBy, f.value, me) || obj.createdBy.toLowerCase().includes(v)
    case 'type':
      return type.name.toLowerCase().includes(v.replace(/s$/, '')) || type.pluralName.toLowerCase().includes(v)
    case 'workflow':
      return (idx.wf.get(obj.workflowId)?.name ?? '').toLowerCase().includes(v)
    case 'number':
      return f.op === '=' ? obj.number.toLowerCase() === v : obj.number.toLowerCase().includes(v)
    case 'created':
    case 'due': {
      const minutes = parseDuration(f.value)
      if (minutes === undefined) return undefined
      if (f.key === 'created') return f.op === '>' || f.op === '>=' ? sim.clock - obj.createdAt > minutes : sim.clock - obj.createdAt <= minutes
      if (obj.dueBy === undefined || obj.status !== 'active') return false
      return f.op === '>' || f.op === '>=' ? obj.dueBy - sim.clock > minutes : obj.dueBy - sim.clock <= minutes
    }
  }
  const target = fieldFilter(type, f.key)
  if (!target || hidden.has(target.field.id)) return false
  if (target.column) return rowsOf(obj.data[target.field.id]).some((r: TableRow) => matchValue(target.column!, r[target.column!.id], f, idx))
  if (target.field.type === 'table') return rowsOf(obj.data[target.field.id]).some((r) => (target.field.columns ?? []).some((c) => matchValue(c, r[c.id], { ...f, op: ':' }, idx)))
  return matchValue(target.field, obj.data[target.field.id], f, idx)
}

// ---------- Search ----------

export interface SearchHit {
  obj: SimObject
  score: number
  title: string
  /** Where it is now, e.g. "Manager approval (with Marcus Hale)". */
  where: string
  /** Why it matched: field label and a snippet. */
  matches: Array<{ label: string; snippet: string }>
}

export interface SearchResult {
  query: ParsedQuery
  hits: SearchHit[]
  total: number
  /** Counts over all matching items, for refining. */
  facets: { status: Record<string, number>; priority: Record<string, number>; step: Record<string, number>; type: Record<string, number> }
}

export interface SearchOptions {
  /** Who is searching: scopes results to what they may read and hides fields they may not see. */
  userId?: Id
  limit?: number
  sort?: 'relevance' | 'newest' | 'due' | 'priority'
}

function snippet(text: string, term: string): string {
  const i = text.toLowerCase().indexOf(term)
  if (i < 0 || text.length <= 80) return text.slice(0, 80)
  const from = Math.max(0, i - 30)
  return `${from > 0 ? '…' : ''}${text.slice(from, from + 80)}${from + 80 < text.length ? '…' : ''}`
}

export function searchItems(sim: SimState, ctx: Ctx, query: string, opts: SearchOptions = {}): SearchResult {
  const idx = buildIndex(ctx)
  const parsed = parseQuery(query)
  const words = [...parsed.terms, ...parsed.phrases]
  const hits: SearchHit[] = []
  const facets: SearchResult['facets'] = { status: {}, priority: {}, step: {}, type: {} }
  for (const obj of Object.values(sim.objects)) {
    const type = idx.type.get(obj.typeId)
    if (!type || !mayRead(idx, obj, type, opts.userId)) continue
    const hidden = hiddenFields(idx, obj, type, opts.userId)
    let ok = true
    for (const f of parsed.filters) {
      const r = passes(idx, sim, obj, type, hidden, f, opts.userId)
      if (r === undefined) continue // unknown filter: ignore rather than hide everything
      if (r === !!f.negate) {
        ok = false
        break
      }
    }
    if (!ok) continue
    const doc = indexItem(idx, obj, type)
    const visible = doc.entries.filter((e) => !hidden.has(e.fieldId))
    const where = obj.tokens.map((t) => describeTokenText(idx, t)).join(' · ')
    const haystack = [obj.number, doc.title, where, ...visible.map((e) => e.text)].join(' \u0001 ').toLowerCase()
    if (parsed.excluded.some((w) => haystack.includes(w))) continue
    let score = 0
    const matches: SearchHit['matches'] = []
    for (const w of words) {
      if (!haystack.includes(w)) {
        ok = false
        break
      }
      if (obj.number.toLowerCase() === w) score += 100
      else if (obj.number.toLowerCase().includes(w)) score += 40
      if (doc.title.toLowerCase().includes(w)) score += 20
      const e = visible.find((x) => x.text.toLowerCase().includes(w))
      if (e) {
        score += parsed.phrases.includes(w) ? 12 : 6
        if (matches.length < 3 && !matches.some((m) => m.label === e.label)) matches.push({ label: e.label, snippet: snippet(e.text, w) })
      } else if (where.toLowerCase().includes(w)) score += 4
    }
    if (!ok) continue
    score += urgencyRank(obj) + (obj.status === 'active' ? 2 : 0) + Math.max(0, 1 - (sim.clock - obj.createdAt) / (7 * 1440))
    hits.push({ obj, score, title: doc.title, where: obj.status === 'active' ? where : `Finished (${obj.status})`, matches })
    const steps = obj.status === 'active' ? [...new Set(obj.tokens.map((t) => idx.node.get(t.nodeId)?.node.data.label ?? '?'))] : ['Finished']
    facets.status[obj.status] = (facets.status[obj.status] ?? 0) + 1
    facets.priority[obj.expedite ? 'expedited' : obj.priority] = (facets.priority[obj.expedite ? 'expedited' : obj.priority] ?? 0) + 1
    for (const s of steps) facets.step[s] = (facets.step[s] ?? 0) + 1
    facets.type[type.name] = (facets.type[type.name] ?? 0) + 1
  }
  const sort = opts.sort ?? (words.length ? 'relevance' : 'priority')
  hits.sort((a, b) => {
    if (sort === 'newest') return b.obj.createdAt - a.obj.createdAt
    if (sort === 'due') return (a.obj.dueBy ?? Infinity) - (b.obj.dueBy ?? Infinity)
    if (sort === 'priority') return (b.obj.status === 'active' ? 1 : 0) - (a.obj.status === 'active' ? 1 : 0) || urgencyRank(b.obj) - urgencyRank(a.obj) || (a.obj.dueBy ?? Infinity) - (b.obj.dueBy ?? Infinity)
    return b.score - a.score || b.obj.createdAt - a.obj.createdAt
  })
  return { query: parsed, hits: hits.slice(0, opts.limit ?? 50), total: hits.length, facets }
}

/** Active items a person holds right now (used by the assistant's "my work" answers). */
export function holdings(sim: SimState, userId: Id): SimObject[] {
  const ids = new Set(activeTokens(sim).filter((t) => t.userId === userId).map((t) => t.objectId))
  return [...ids].map((id) => sim.objects[id]!).filter(Boolean)
}
