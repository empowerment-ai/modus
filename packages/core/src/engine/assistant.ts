// "Ask Modus": answers questions about the work in plain language. This is the
// built-in, offline interpreter — it turns a question into the search language
// (and shows the query it ran, so people learn it and can trust the answer),
// looks things up, and explains features. A server can put a language model in
// front of the same tools (search, item, my work, metrics, help); see
// docs/ARCHITECTURE.md › Assistant.

import { formatDuration } from '../model/util'
import type { Id, ObjectType } from '../model/types'
import { activeTokens, buildIndex, type Ctx, describeTokenText, type Index, indexFor, type SimObject, type SimState, stepOf, urgencyRank } from './engine'
import { queuesFor } from './view'
import { computeView } from './view'
import { canReadItem, type SearchHit, searchItems, visibleHistory } from './search'

export interface AssistantReply {
  /** Plain sentences; `**bold**` marks names. */
  text: string
  kind: 'results' | 'item' | 'metrics' | 'help' | 'fallback'
  /** The search it ran, in the search language. */
  query?: string
  /** Lines explaining how the question was understood. */
  understood?: string[]
  hits?: SearchHit[]
  total?: number
  itemId?: Id
  suggestions: string[]
}

// ---------- Help ----------

interface Topic {
  keys: RegExp
  answer: string
}

const TOPICS: Topic[] = [
  {
    keys: /expedit|rush|faster|fast lane|jump the queue/,
    answer:
      'Expedite flags an item to go faster: it moves ahead of every queue and basket (even urgent work), its due dates tighten (by default twice as fast), it escalates sooner, and rules can send it down a fast lane. Who may expedite is set per process — often the requester or a supervisor — and a reason may be required. Use **Expedite** on the item.',
  },
  {
    keys: /delegat|hand (it )?(to|off)|colleague/,
    answer: 'Open the item in **My work** and choose **Delegate**: pick a colleague in the same group. It moves to their basket and the history records it. Some steps turn delegation off.',
  },
  {
    keys: /return|give (it )?back|send (it )?back/,
    answer: '**Return** sends an item back where it came from at that step: to the queue, to the dispatchers, or to the pool for load balancing. Direct-assignment steps can’t be returned; ask a supervisor to reassign.',
  },
  {
    keys: /get next|claim|queue|fetch|pick up/,
    answer: 'Queues hold work any member of a group can take. **Get next** pulls the most urgent, oldest item from all your queues; **Claim** takes a specific one. Expedited and urgent items come first.',
  },
  {
    keys: /distribut|dispatch|hand out/,
    answer: 'Dispatchers (a distribution group) hand each item at their steps to someone in the team: drag it onto a person on the **Distribute** board, pick from its menu, or **Distribute evenly**. The bars show everyone’s current load.',
  },
  {
    keys: /supervis|reassign|oversee|escalat/,
    answer:
      'Supervisors oversee a whole process or particular steps. In **Supervise** they see everything at their steps, reassign within the group, return work, release on someone’s behalf with a comment, expedite, and receive escalations when work sits too long.',
  },
  {
    keys: /lock|can.?t edit|read.?only|hidden|security|why can/,
    answer:
      'Three layers decide what you can change: sensitive fields only some groups may see, workflow locks (for example, the amount is locked once an invoice is routed), and what each step allows. The strictest wins. Open **Why can’t I edit some fields?** on the item to see the reason for each.',
  },
  {
    keys: /line item|rows?|table|multi/,
    answer: 'Some fields hold rows, like an invoice’s line items. Add or remove rows in the form; calculated columns (Quantity × Unit Price) and totals (the invoice Amount) update by themselves and can’t be typed over. Rules can test them, for example “any line in category Software”.',
  },
  {
    keys: /search|find|filter|syntax|query/,
    answer:
      'Type words to match any field, line item or comment. Add filters: `priority:urgent`, `is:overdue`, `is:expedited`, `is:mine`, `step:"manager approval"`, `assignee:me`, `creator:me`, `amount>10k`, `vendor:acme`, `created:<2d`, `due:<4h`. Put `-` before a word to exclude it. Or just ask me in plain words.',
  },
  {
    keys: /priority|urgent|due|sla|deadline|overdue/,
    answer:
      'Each item has a priority (low, normal, high, urgent) and due dates: one for the step (its service level) and one for the whole item (the process’s target time). Baskets and queues are ordered by urgency, then age. Items sitting too long can escalate.',
  },
  {
    keys: /subflow|parallel|split|join|branch/,
    answer: 'An item can be in more than one place at once: a parallel split sends it down several paths and a join waits for them. A subflow is a step that runs a whole smaller process. Your item shows every place it is right now.',
  },
]

const CAPABILITIES =
  'I can find items (“urgent invoices from Acme over $10k”), tell you where one is (“where is INV-1042?”), summarize your work (“what should I work on next?”), count things (“how many are overdue?”), point out bottlenecks and who is overloaded, and explain how things work (“how do I expedite?”).'

const STARTERS = ['What should I work on next?', 'Show urgent items that are overdue', 'What’s the bottleneck right now?', 'How do I expedite something?']

// ---------- Understanding a question ----------

const STOP = new Set(
  'a an the me my mine i we our us show find list get give search for of in on at to with and or all any some please can you could would which what that are is be there have has items item things ones stuff look looking up about from by over under above below more less than greater fewer created assigned waiting due today this week ago days day hours hour status where how many much count number who whom whose most least only just'.split(
    ' ',
  ),
)

const quote = (s: string) => (/[\s:]/.test(s) ? `"${s}"` : s)

function moneyField(type: ObjectType | undefined): string | undefined {
  return type?.fields.find((f) => f.type === 'currency' && f.summary)?.label ?? type?.fields.find((f) => f.type === 'currency')?.label
}

/** Turn a question into the search language, with an explanation of each piece. */
export function translateQuestion(question: string, ctx: Ctx, userId?: Id): { query: string; understood: string[] } {
  const idx = buildIndex(ctx)
  let q = ` ${question.toLowerCase().replace(/[?!.,]/g, ' ')} `
  const parts: string[] = []
  const understood: string[] = []
  const take = (re: RegExp, filter: string, why: string) => {
    if (!re.test(q)) return false
    q = q.replace(re, ' ')
    parts.push(filter)
    understood.push(why)
    return true
  }

  // Item types ("invoices", "camera events").
  let type: ObjectType | undefined
  for (const t of ctx.app.objectTypes) {
    const re = new RegExp(`\\b(${escape(t.pluralName.toLowerCase())}|${escape(t.name.toLowerCase())})\\b`)
    if (re.test(q)) {
      type = t
      q = q.replace(re, ' ')
      if (ctx.app.objectTypes.length > 1) {
        parts.push(`type:${quote(t.name)}`)
        understood.push(`${t.pluralName}`)
      }
    }
  }
  type ??= ctx.app.objectTypes[0]

  take(/\b(expedited|expedite|rush(ed)?|fast lane)\b/, 'is:expedited', 'expedited')
  take(/\b(overdue|late|past due|behind)\b/, 'is:overdue', 'overdue')
  take(/\bstuck\b/, 'is:stuck', 'stuck')
  take(/\b(escalated)\b/, 'is:escalated', 'escalated')
  take(/\b(unassigned|not assigned|nobody has)\b/, 'is:unassigned', 'not assigned to anyone')
  take(/\b(urgent|critical)\b/, 'priority:urgent', 'urgent')
  take(/\bhigh[- ]priority\b|\bhigh\b(?= priority)/, 'priority:high', 'high priority')
  take(/\blow[- ]priority\b/, 'priority:low', 'low priority')
  if (!take(/\b(completed|finished|done|closed|paid)\b/, 'status:completed', 'completed')) {
    if (!take(/\b(rejected|denied|declined)\b/, 'status:rejected', 'rejected')) take(/\b(open|active|in progress|pending|outstanding)\b/, 'is:open', 'still open')
  }
  if (userId) {
    if (!take(/\b(i created|i submitted|i requested|my requests?|i started)\b/, 'creator:me', 'that you created')) {
      take(/\b(assigned to me|in my basket|my work|my items|mine|on my plate|i have|i'm working)\b|\bmy\b(?! team)/, 'is:mine', 'in your basket')
    }
  }
  take(/\b(created|submitted|new|received) today\b|\btoday's\b/, 'created:<1d', 'created today')
  take(/\b(this|last) week\b/, 'created:<7d', 'created this week')
  const ago = /\b(?:last|past) (\d+) (day|days|hour|hours)\b/.exec(q)
  if (ago) take(new RegExp(ago[0]), `created:<${ago[1]}${ago[2]!.startsWith('h') ? 'h' : 'd'}`, `created in the last ${ago[1]} ${ago[2]}`)
  take(/\bdue (today|soon|in the next day)\b/, 'due:<24h', 'due within a day')

  // Amounts ("over $10k", "less than 500").
  const money = moneyField(type)
  const amount = /\b(over|above|more than|greater than|at least|under|below|less than|at most)\s*\$?\s*([\d,]*\.?\d+)\s*(k|m|thousand|million)?\b/.exec(q)
  if (amount && money) {
    const op = /over|above|more|greater/.test(amount[1]!) ? '>' : /at least/.test(amount[1]!) ? '>=' : /at most/.test(amount[1]!) ? '<=' : '<'
    const unit = amount[3]?.startsWith('t') ? 'k' : amount[3]?.startsWith('mi') ? 'm' : (amount[3] ?? '')
    take(new RegExp(escape(amount[0])), `${quote(money)}${op}${amount[2]!.replace(/,/g, '')}${unit}`, `${money.toLowerCase()} ${amount[1]} $${amount[2]}${unit}`)
  }

  // People ("assigned to Marcus", "created by Maya").
  for (const u of ctx.users) {
    const first = u.name.split(' ')[0]!.toLowerCase()
    const full = u.name.toLowerCase()
    const assigned = new RegExp(`\\b(assigned to|with|held by|on) (${escape(full)}|${escape(first)})\\b`)
    const created = new RegExp(`\\b(created by|submitted by|requested by|from) (${escape(full)}|${escape(first)})\\b`)
    if (take(assigned, `assignee:${quote(u.name)}`, `assigned to ${u.name}`)) continue
    take(created, `creator:${quote(u.name)}`, `created by ${u.name}`)
  }

  // Steps ("at manager approval", "waiting for controller approval").
  const steps = [...new Set(ctx.app.workflows.flatMap((w) => w.nodes.filter((n) => n.type === 'user' || n.type === 'auto' || n.type === 'subflow').map((n) => n.data.label)))]
  steps.sort((a, b) => b.length - a.length)
  for (const label of steps) {
    const l = label.toLowerCase()
    if (q.includes(l)) take(new RegExp(`\\b(at |in |waiting (at|for) |for )?${escape(l)}\\b`), `step:${quote(label)}`, `at ${label}`)
  }

  // List values in choice fields and line-item columns ("from Acme", "software").
  if (type) {
    const choiceFields = [
      ...type.fields.filter((f) => f.type === 'choice' && f.id !== type!.priorityFieldId).map((f) => ({ label: f.label, listId: f.listId })),
      ...type.fields.flatMap((f) => (f.columns ?? []).filter((c) => c.type === 'choice').map((c) => ({ label: c.label, listId: c.listId }))),
    ]
    for (const cf of choiceFields) {
      const list = idx.ctx.app.lists.find((l) => l.id === cf.listId)
      for (const item of list?.items ?? []) {
        const label = item.label.toLowerCase()
        const lead = label.split(/\s+/)[0]!
        if (q.includes(` ${label} `)) take(new RegExp(`\\b${escape(label)}\\b`), `${quote(cf.label)}:${quote(item.label)}`, `${cf.label.toLowerCase()} ${item.label}`)
        else if (lead.length >= 4 && !STOP.has(lead) && new RegExp(`\\b${escape(lead)}\\b`).test(q)) take(new RegExp(`\\b${escape(lead)}\\b`), `${quote(cf.label)}:${quote(lead)}`, `${cf.label.toLowerCase()} like “${lead}”`)
      }
    }
  }

  // Whatever is left: plain words to match anywhere.
  const words = q.split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w))
  for (const w of words) {
    parts.push(w)
    understood.push(`mentions “${w}”`)
  }
  return { query: parts.join(' '), understood }
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ---------- Answering ----------

function itemLine(idx: Index, sim: SimState, obj: SimObject): string {
  const where = obj.status === 'active' ? obj.tokens.map((t) => describeTokenText(indexFor(idx, obj), t)).join('; ') : `finished (${obj.status})`
  const due = obj.status === 'active' && obj.dueBy !== undefined ? (sim.clock > obj.dueBy ? `, overdue by ${formatDuration(sim.clock - obj.dueBy)}` : `, due in ${formatDuration(obj.dueBy - sim.clock)}`) : ''
  return `**${obj.number}** is at ${where}${due}${obj.expedite ? ' — expedited' : ''}.`
}

export function ask(sim: SimState, ctx: Ctx, question: string, opts: { userId?: Id } = {}): AssistantReply {
  const idx = buildIndex(ctx)
  const q = question.trim()
  const lower = q.toLowerCase()
  if (!q || /^(hi|hello|hey|help|what can you do|\?)\b/.test(lower)) {
    return { kind: 'help', text: CAPABILITIES, suggestions: STARTERS }
  }

  // A specific item.
  const num = /\b([a-z]{2,5}-\d{3,7})\b/i.exec(q)
  if (num) {
    const obj = Object.values(sim.objects).find((o) => o.number.toLowerCase() === num[1]!.toLowerCase())
    if (!obj) return { kind: 'fallback', text: `I couldn’t find **${num[1]!.toUpperCase()}**. It may belong to another application.`, suggestions: STARTERS }
    if (!canReadItem(ctx, obj, opts.userId)) return { kind: 'fallback', text: `You don’t have access to **${obj.number}**.`, suggestions: STARTERS }
    const hits = searchItems(sim, ctx, `number=${obj.number}`, { userId: opts.userId, limit: 1 }).hits
    const last = [...visibleHistory(ctx, obj, opts.userId)].reverse().slice(0, 3).map((h) => h.text)
    const holder = obj.tokens.find((t) => t.userId)
    const text = [itemLine(idx, sim, obj), holder ? `${idx.user.get(holder.userId!)?.name ?? 'Someone'} has it.` : '', `Latest: ${last.join(' · ')}`].filter(Boolean).join(' ')
    return { kind: 'item', text, itemId: obj.id, hits, total: 1, suggestions: [`Show the history of ${obj.number}`, 'What should I work on next?'] }
  }

  // How-to questions.
  if (/\b(how (do|can|should) i|how to|what (is|does|are)|explain|why can|what happens|tell me about)\b/.test(lower)) {
    const topic = TOPICS.find((t) => t.keys.test(lower))
    if (topic) return { kind: 'help', text: topic.answer, suggestions: STARTERS.filter((s) => !s.startsWith('How')) }
  }

  // My work.
  if (opts.userId && /\b(what should i|work on next|my (work|basket|day|queue)|what('s| is) (on my plate|next)|what do i have)\b/.test(lower)) {
    const mine = activeTokens(sim)
      .filter((t) => t.userId === opts.userId)
      .map((t) => ({ t, obj: sim.objects[t.objectId]! }))
      .sort((a, b) => urgencyRank(b.obj) - urgencyRank(a.obj) || (a.obj.dueBy ?? Infinity) - (b.obj.dueBy ?? Infinity))
    const queued = queuesFor(sim, ctx, opts.userId).reduce((n, qs) => n + qs.items.length, 0)
    const overdue = mine.filter((m) => m.obj.dueBy !== undefined && sim.clock > m.obj.dueBy).length
    if (!mine.length) {
      return {
        kind: 'metrics',
        text: queued ? `Your basket is empty, and **${queued}** item${queued === 1 ? ' is' : 's are'} waiting in your queues. Press **Get next** to pull the most urgent.` : 'Your basket and your queues are empty.',
        suggestions: ['Show urgent items that are overdue', 'What’s the bottleneck right now?'],
      }
    }
    const top = mine[0]!
    const res = searchItems(sim, ctx, 'is:mine', { userId: opts.userId, sort: 'priority', limit: 5 })
    return {
      kind: 'results',
      text: `You have **${mine.length}** item${mine.length === 1 ? '' : 's'} in your basket${overdue ? `, **${overdue}** overdue` : ''}${queued ? `, and ${queued} waiting in your queues` : ''}. Start with ${itemLine(idx, sim, top.obj)}`,
      query: 'is:mine',
      hits: res.hits,
      total: res.total,
      suggestions: ['Show my overdue items', 'How do I delegate?'],
    }
  }

  // The big picture.
  if (/\b(bottleneck|backed up|piling up|slowest|holding things up|where.*stuck)\b/.test(lower)) {
    const v = computeView(sim, ctx)
    const busiest = Object.entries(v.nodes)
      .filter(([id]) => ['user', 'auto'].includes(stepOf(idx, id)?.node.type ?? ''))
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 3)
      .map(([id, m]) => `${stepOf(idx, id)!.node.data.label} (${m.total})`)
    const bn = v.bottleneckId ? stepOf(idx, v.bottleneckId)?.node.data.label : undefined
    const m = v.bottleneckId ? v.nodes[v.bottleneckId] : undefined
    return {
      kind: 'metrics',
      text: bn
        ? `The bottleneck is **${bn}**: ${m!.total} items there, the oldest waiting ${formatDuration(m!.oldestAge)}. Busiest steps: ${busiest.join(', ')}.`
        : `Nothing is backed up right now. Busiest steps: ${busiest.join(', ') || 'none'}.`,
      query: bn ? `step:${quote(bn)} is:open` : undefined,
      suggestions: ['Who has the most work?', 'Show items that are overdue'],
    }
  }
  if (/\b(who (has|is carrying) (the )?most|overloaded|busiest (person|people)|workload)\b/.test(lower)) {
    const loads = new Map<Id, number>()
    for (const t of activeTokens(sim)) if (t.userId) loads.set(t.userId, (loads.get(t.userId) ?? 0) + 1)
    const top = [...loads.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    return {
      kind: 'metrics',
      text: top.length ? `Most open work: ${top.map(([id, n]) => `**${idx.user.get(id)?.name ?? id}** (${n})`).join(', ')}.` : 'No one has open work right now.',
      suggestions: ['What’s the bottleneck right now?', 'How do supervisors reassign work?'],
    }
  }

  // Counting and finding.
  const counting = /\b(how many|count|number of)\b/.test(lower)
  const { query, understood } = translateQuestion(q, ctx, opts.userId)
  const res = searchItems(sim, ctx, query, { userId: opts.userId, sort: query.includes('is:') || !query ? 'priority' : 'relevance', limit: 8 })
  const noun = ctx.app.objectTypes.length === 1 ? ctx.app.objectTypes[0]!.pluralName.toLowerCase() : 'items'
  if (!res.total) {
    const conditions = understood.filter((u) => u.toLowerCase() !== noun)
    return {
      kind: 'fallback',
      text: `I didn’t find any ${noun}${conditions.length ? ` matching: ${conditions.join(' · ')}` : ''}. Try fewer conditions, or search by number.`,
      query,
      understood,
      hits: [],
      total: 0,
      suggestions: ['Show urgent items that are overdue', 'How do I search?'],
    }
  }
  const byStep = Object.entries(res.facets.step)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([s, n]) => `${s} ${n}`)
  return {
    kind: 'results',
    text: counting
      ? `**${res.total}** ${noun}${understood.length ? ` ${understood.join(', ')}` : ''}. Most are at: ${byStep.join(', ')}.`
      : `I found **${res.total}** ${noun}${understood.length ? ` ${understood.join(', ')}` : ''}${res.total > res.hits.length ? `; here are the ${res.hits.length} most relevant` : ''}.`,
    query,
    understood,
    hits: res.hits,
    total: res.total,
    suggestions: ['Only the expedited ones', 'What’s the bottleneck right now?'],
  }
}
