let counter = 0

/** Short readable ids; unique enough for a single-browser prototype. */
export function uid(prefix = 'id'): string {
  counter = (counter + 1) % 1296
  return `${prefix}_${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 6)}${counter.toString(36)}`
}

export const currencyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
export const currencyShort = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
}

/** Sim clock is minutes since the simulation started on a Monday 08:00. */
export function formatClock(minutes: number): string {
  const total = Math.floor(minutes) + 8 * 60
  const day = Math.floor(total / 1440)
  const h = Math.floor((total % 1440) / 60)
  const m = total % 60
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  return `${days[day % 7]} · Day ${day + 1} · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function formatDuration(minutes: number): string {
  if (!isFinite(minutes) || minutes <= 0) return '—'
  if (minutes < 1) return '<1m'
  const total = Math.round(minutes)
  if (total < 60) return `${total}m`
  if (total < 60 * 24) {
    const h = Math.floor(total / 60)
    const m = total % 60
    return m ? `${h}h ${m}m` : `${h}h`
  }
  const hours = Math.round(total / 60)
  const d = Math.floor(hours / 24)
  const h = hours % 24
  return h ? `${d}d ${h}h` : `${d}d`
}

/** Calendar date for a sim minute, anchored to a fixed Monday so demos are repeatable. */
export const SIM_EPOCH = new Date('2026-10-05T08:00:00')
export function simDate(minutes: number): Date {
  return new Date(SIM_EPOCH.getTime() + minutes * 60_000)
}
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? word : pluralWord}`
}
