// The design's traffic table (docs/plans/2026-10-13-load-tests-design.md): smoke ~1 min,
// baseline ~10 min, full ~20 min. Live screens are the observer's, not k6's.

const items = {
  smoke: { executor: 'constant-arrival-rate', rate: 2, timeUnit: '1s', duration: '1m', preAllocatedVUs: 5, maxVUs: 50 },
  baseline: { executor: 'constant-arrival-rate', rate: 10, timeUnit: '1s', duration: '10m', preAllocatedVUs: 20, maxVUs: 200 },
  full: {
    executor: 'ramping-arrival-rate',
    startRate: 10,
    timeUnit: '1s',
    stages: [
      { target: 100, duration: '15m' },
      { target: 100, duration: '5m' },
    ],
    preAllocatedVUs: 100,
    maxVUs: 1000,
  },
}

const people = {
  smoke: [
    { target: 10, duration: '10s' },
    { target: 10, duration: '50s' },
  ],
  baseline: [
    { target: 100, duration: '1m' },
    { target: 100, duration: '9m' },
  ],
  full: [
    { target: 1000, duration: '15m' },
    { target: 1000, duration: '5m' },
  ],
}

const workers = { smoke: 2, baseline: 4, full: 8 }

/** One load clerk per simulated person at the peak, so no two VUs share a basket. setup.ts makes them. */
export const CLERKS = { smoke: 10, baseline: 100, full: 1000 }
const duration = { smoke: '1m', baseline: '10m', full: '20m' }

export const PROFILES = Object.keys(duration)

export function scenarios(profile) {
  if (!PROFILES.includes(profile)) throw new Error(`PROFILE must be one of ${PROFILES.join(', ')}, not ${profile}`)
  return {
    items: { ...items[profile], exec: 'items', gracefulStop: '10s' },
    people: { executor: 'ramping-vus', startVUs: 0, stages: people[profile], exec: 'people', gracefulRampDown: '10s', gracefulStop: '10s' },
    workers: { executor: 'constant-vus', vus: workers[profile], duration: duration[profile], exec: 'workers', gracefulStop: '10s' },
  }
}
