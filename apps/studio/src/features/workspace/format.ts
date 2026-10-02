import { PRIORITY_RANK, type WorkItem } from '@modus-bpm/core'
import { formatDuration } from '@modus-bpm/core/model/util'
import type { BasketSort } from './store'

/** "Due soon" means within the next four simulated hours. */
export const DUE_SOON_MINUTES = 240

export type DueTone = 'overdue' | 'soon' | 'later' | 'none'

export function dueTone(due: number | undefined, clock: number): DueTone {
  if (due === undefined) return 'none'
  if (clock > due) return 'overdue'
  return due - clock <= DUE_SOON_MINUTES ? 'soon' : 'later'
}

/** Relative due date: "due in 3h", "overdue 2h", "due now". */
export function dueText(due: number | undefined, clock: number): string {
  if (due === undefined) return 'No due date'
  const diff = due - clock
  if (Math.abs(diff) < 1) return 'due now'
  return diff > 0 ? `due in ${formatDuration(diff)}` : `overdue ${formatDuration(-diff)}`
}

/** "12m ago", "3h ago", "just now". */
export function agoText(minutes: number): string {
  return minutes < 1 ? 'just now' : `${formatDuration(minutes)} ago`
}

/** Outcomes that send work backwards or stop it get the danger style. */
export function isRejectLike(label: string): boolean {
  return /reject|deny|return|cancel|could not|^no\b/i.test(label)
}

const dueKey = (i: WorkItem) => i.due ?? Number.POSITIVE_INFINITY

/** Basket order. Default: most urgent priority, then the earliest due, then the longest waiting. */
export function sortItems(items: WorkItem[], sort: BasketSort): WorkItem[] {
  const out = [...items]
  if (sort === 'due') out.sort((a, b) => dueKey(a) - dueKey(b) || PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || b.age - a.age)
  else if (sort === 'age') out.sort((a, b) => b.age - a.age || PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority])
  else out.sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || dueKey(a) - dueKey(b) || b.age - a.age)
  return out
}

export function greeting(d: Date): string {
  const h = d.getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export function longDate(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

export function timeOfDay(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
