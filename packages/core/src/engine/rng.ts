/** Seeded PRNG (mulberry32) whose state lives on the simulation, so runs are repeatable. */
export interface HasRng {
  rng: number
}

export function rand(s: HasRng): number {
  s.rng = (s.rng + 0x6d2b79f5) | 0
  let t = s.rng
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export function pick<T>(s: HasRng, arr: readonly T[]): T | undefined {
  if (arr.length === 0) return undefined
  return arr[Math.floor(rand(s) * arr.length)]
}

export function randInt(s: HasRng, min: number, max: number): number {
  return Math.floor(min + rand(s) * (max - min + 1))
}

/** Exponential inter-arrival time in minutes for a Poisson process. */
export function expMinutes(s: HasRng, perHour: number): number {
  const u = Math.max(1e-9, rand(s))
  return (-Math.log(u) / perHour) * 60
}

export function weightedPick<T>(s: HasRng, items: readonly T[], weight: (t: T) => number): T | undefined {
  const total = items.reduce((sum, i) => sum + Math.max(0, weight(i)), 0)
  if (total <= 0) return items[0]
  let r = rand(s) * total
  for (const i of items) {
    r -= Math.max(0, weight(i))
    if (r <= 0) return i
  }
  return items[items.length - 1]
}
