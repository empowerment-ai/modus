import { ArrowRight, ArrowUp, RotateCcw, Search, Sparkles, X } from 'lucide-react'
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { IconButton } from '../../components/ui'
import { ask, type AssistantReply, type Ctx, parseQuery, searchItems, type SimState, translateQuestion } from '@modus-bpm/core'
import type { App, Id, User } from '@modus-bpm/core/model/types'
import { openFound } from './actions'
import type { WorkData } from './live'
import { highlightWords, SearchHitRow } from './searchParts'
import { type ChatMessage, useWorkspace } from './store'

// Ask Modus: questions about the work in plain words. The answers come from the
// engine's built-in interpreter (core/assistant), which turns a question into a
// search and shows the search it ran. Nothing leaves the browser.

const NO_MESSAGES: ChatMessage[] = []
const CARDS = 5
const TYPING_MS = 280

/** "Only the expedited ones", "and overdue": narrows the previous answer rather than starting over. */
const FOLLOW_UP = /^(only|just|and|but|now|of (those|these|them)|which of (those|these|them))\b[\s,]*/i

/** The engine's answer, or a narrower search when the question builds on the previous one. */
function answer(sim: SimState, ctx: Ctx, question: string, userId: Id, previous: AssistantReply | undefined): AssistantReply {
  const lead = FOLLOW_UP.exec(question)
  if (lead && previous?.query) {
    const t = translateQuestion(question.slice(lead[0].length), ctx, userId)
    if (t.query) {
      const query = `${previous.query} ${t.query}`
      const res = searchItems(sim, ctx, query, { userId, sort: query.includes('is:') ? 'priority' : 'relevance', limit: 8 })
      const what = t.understood.map((u) => u.replace(/^mentions /, 'mentioning ')).join(', ')
      return {
        kind: res.total ? 'results' : 'fallback',
        text: res.total ? `Of those, **${res.total}** ${res.total === 1 ? 'is' : 'are'} ${what}.` : `None of those are ${what}.`,
        query,
        understood: [...(previous.understood ?? []), ...t.understood],
        hits: res.hits,
        total: res.total,
        suggestions: ['What should I work on next?', 'What’s the bottleneck right now?'],
      }
    }
  }
  return ask(sim, ctx, question, { userId })
}

interface Props {
  me: User
  app: App
  ctx: Ctx
  sim: SimState | undefined
  data: WorkData
  onClose: () => void
}

/** A slide-over conversation, kept per person and application while the page is open. */
export function AskPanel({ me, app, ctx, sim, data, onClose }: Props) {
  const key = `${app.id}:${me.id}`
  const messages = useWorkspace((s) => s.chats[key]) ?? NO_MESSAGES
  const pending = useWorkspace((s) => s.askQuestion)
  const [draft, setDraft] = useState('')
  const [typing, setTyping] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const ws = useWorkspace.getState()
  const starters = useMemo(() => (sim ? ask(sim, ctx, '').suggestions : []), [sim, ctx])
  const held = useMemo(() => new Set(data.basket.map((i) => i.obj.id)), [data.basket])

  const send = (text: string) => {
    const q = text.trim()
    if (!q || !sim) return
    ws.addMessage(key, { role: 'user', text: q })
    setDraft('')
    setTyping(true)
    // The answer is instant; a short pause reads as a reply rather than a page refresh.
    setTimeout(() => {
      const history = useWorkspace.getState().chats[key] ?? []
      const previous = [...history].reverse().find((m) => m.reply)?.reply
      const reply = answer(sim, ctx, q, me.id, previous)
      useWorkspace.getState().addMessage(key, { role: 'assistant', text: reply.text, reply })
      setTyping(false)
    }, TYPING_MS)
  }

  // A question handed over from Search or quick search. Read from the store so it is sent once.
  useEffect(() => {
    const q = useWorkspace.getState().askQuestion
    if (!q) return
    useWorkspace.setState({ askQuestion: null })
    send(q)
  }, [pending])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, typing])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[aria-modal="true"]')) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const openItem = (objectId: Id) => {
    onClose()
    openFound(objectId, data.basket)
  }
  const openSearch = (query: string) => {
    onClose()
    ws.search(query)
  }
  const byNumber = (n: string) => (sim ? Object.values(sim.objects).find((o) => o.number === n)?.id : undefined)
  const lastReply = [...messages].reverse().find((m) => m.role === 'assistant')

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label="Ask Modus"
      className="animate-slide-in absolute inset-y-0 right-0 z-30 flex w-[420px] max-w-full flex-col border-l border-slate-200 bg-white shadow-2xl"
    >
      <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-slate-200 px-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <Sparkles size={15} />
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-sm font-semibold text-slate-900">Ask Modus</span>
          <span className="block truncate text-[11px] text-slate-500">
            As {me.name} in {app.name}
          </span>
        </span>
        <IconButton label="Start over" disabled={!messages.length} onClick={() => ws.clearChat(key)}>
          <RotateCcw size={15} />
        </IconButton>
        <IconButton label="Close (Esc)" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </header>
      <p className="shrink-0 border-b border-slate-100 bg-slate-50/80 px-4 py-2 text-[11px] leading-snug text-slate-500">
        Runs locally. Answers come from Modus’s own search; connect an AI model on the server for open-ended questions.
      </p>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !typing && (
          <div className="pt-6 text-center">
            <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand-600">
              <Sparkles size={18} />
            </span>
            <p className="mt-3 text-sm font-medium text-slate-800">Hi {me.name.split(' ')[0]}. What would you like to know?</p>
            <p className="mx-auto mt-1 max-w-[300px] text-xs leading-snug text-slate-500">
              Ask about items, your work, bottlenecks or how something works. I show the search I ran, so you can check it and reuse it.
            </p>
            <div className="mt-4 flex flex-col items-center gap-1.5">
              {starters.map((s) => (
                <Chip key={s} onClick={() => send(s)}>
                  {s}
                </Chip>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-brand-600 px-3 py-2 text-[13px] leading-snug whitespace-pre-wrap text-white">{m.text}</p>
            </div>
          ) : (
            <Reply key={m.id} m={m} ctx={ctx} userId={me.id} sim={sim} held={held} last={m === lastReply && !typing} onItem={openItem} onSearch={openSearch} onSuggest={send} byNumber={byNumber} />
          ),
        )}

        {typing && (
          <div className="flex items-start gap-2.5" aria-live="polite" aria-label="Modus is answering">
            <Avatar />
            <span className="flex items-center gap-1 rounded-2xl rounded-tl-sm bg-slate-100 px-3 py-3">
              {[0, 150, 300].map((d) => (
                <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: `${d}ms` }} />
              ))}
            </span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="shrink-0 border-t border-slate-200 p-3"
        onSubmit={(e) => {
          e.preventDefault()
          send(draft)
        }}
      >
        <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white py-1 pr-1 pl-3 shadow-xs focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`e.g. ${app.objectTypes[0]?.pluralName.toLowerCase() ?? 'items'} that are overdue`}
            aria-label="Your question"
            className="h-7 min-w-0 flex-1 bg-transparent text-[13px] text-slate-900 outline-none! placeholder:text-slate-400"
          />
          <button
            type="submit"
            aria-label="Send"
            title="Send (Enter)"
            disabled={!draft.trim() || typing}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-400"
          >
            <ArrowUp size={15} />
          </button>
        </div>
      </form>
    </aside>
  )
}

function Avatar() {
  return (
    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
      <Sparkles size={12} />
    </span>
  )
}

function Chip({ children, onClick, title }: { children: ReactNode; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="hover:border-brand-300 rounded-full border border-brand-200 bg-white px-2.5 py-1 text-left text-xs font-medium text-brand-700 transition-colors hover:bg-brand-50"
    >
      {children}
    </button>
  )
}

function Reply({
  m,
  ctx,
  userId,
  sim,
  held,
  last,
  onItem,
  onSearch,
  onSuggest,
  byNumber,
}: {
  m: ChatMessage
  ctx: Ctx
  userId: Id
  sim: SimState | undefined
  held: Set<Id>
  last: boolean
  onItem: (objectId: Id) => void
  onSearch: (query: string) => void
  onSuggest: (q: string) => void
  byNumber: (n: string) => Id | undefined
}) {
  const r = m.reply
  const hits = (r?.hits ?? []).filter((h) => sim?.objects[h.obj.id] === h.obj).slice(0, CARDS)
  const words = highlightWords(r?.query ? parseQuery(r.query) : undefined)
  return (
    <div className="flex items-start gap-2.5">
      <Avatar />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-[13px] leading-relaxed text-slate-800">
          <RichText text={m.text} byNumber={byNumber} onItem={onItem} />
        </p>
        {r?.query && (
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => onSearch(r.query!)}
              title="Open this search on the Search page"
              className="group hover:border-brand-300 inline-flex max-w-full items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-left text-[11px] text-slate-600 hover:bg-brand-50"
            >
              <Search size={11} className="shrink-0 text-slate-400 group-hover:text-brand-600" />
              <span className="shrink-0">I searched for:</span>
              <code className="truncate font-mono text-[11px] text-brand-700">{r.query}</code>
            </button>
            {r.understood && r.understood.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {r.understood.map((u, i) => (
                  <span key={`${u}-${i}`} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] text-slate-600">
                    {u}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        {hits.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <ul className="divide-y divide-slate-100">
              {hits.map((h) => (
                <li key={h.obj.id}>
                  <SearchHitRow hit={h} ctx={ctx} userId={userId} words={words} clock={sim?.clock ?? 0} held={held.has(h.obj.id)} compact onOpen={() => onItem(h.obj.id)} />
                </li>
              ))}
            </ul>
            {r?.query && (r.total ?? 0) > hits.length && (
              <button
                type="button"
                onClick={() => onSearch(r.query!)}
                className="flex w-full items-center justify-between border-t border-slate-100 bg-slate-50/60 px-3 py-1.5 text-[11.5px] font-medium text-brand-700 hover:bg-brand-50"
              >
                See all {r.total!.toLocaleString()} in Search <ArrowRight size={12} />
              </button>
            )}
          </div>
        )}
        {last && r && r.suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {r.suggestions.map((s) => (
              <Chip key={s} onClick={() => onSuggest(s)}>
                {s}
              </Chip>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const ITEM_NUMBER = /^[A-Z]{2,5}-\d{3,7}$/

/** The assistant's text: **bold** (item numbers become links) and `code`. */
function RichText({ text, byNumber, onItem }: { text: string; byNumber: (n: string) => Id | undefined; onItem: (objectId: Id) => void }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/)
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**') && p.length > 4) {
          const inner = p.slice(2, -2)
          const id = ITEM_NUMBER.test(inner) ? byNumber(inner) : undefined
          return id ? (
            <button key={i} type="button" onClick={() => onItem(id)} className="decoration-brand-300 font-mono font-semibold text-brand-700 underline underline-offset-2 hover:decoration-brand-600">
              {inner}
            </button>
          ) : (
            <strong key={i} className="font-semibold text-slate-900">
              {inner}
            </strong>
          )
        }
        if (p.startsWith('`') && p.endsWith('`') && p.length > 2)
          return (
            <code key={i} className="rounded bg-slate-100 px-1 py-px font-mono text-[11.5px] text-slate-800">
              {p.slice(1, -1)}
            </code>
          )
        return <Fragment key={i}>{p}</Fragment>
      })}
    </>
  )
}
