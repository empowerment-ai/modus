// A run's results folder: its name, and the note a run that didn't finish leaves in it.

const p = (n: number) => String(n).padStart(2, '0')

/** `YYYYMMDD-HHMMSS-<profile>-<n>srv`, local time: two runs in the same minute get their own folders. */
export function folderName(started: Date, profile: string, servers: number): string {
  const d = started
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${profile}-${servers}srv`
}

export type Ending = 'INTERRUPTED' | 'FAILED'

/** The file a run that didn't finish leaves in its folder (named after `kind`): what stopped it and when. */
export function endingNote(kind: Ending, why: string, at: Date): string {
  const what = kind === 'INTERRUPTED' ? 'was interrupted' : 'failed'
  return `This run ${what} at ${at.toISOString()}: ${why}\nIts numbers, if any, are partial: don't compare them with a finished run.\n`
}
