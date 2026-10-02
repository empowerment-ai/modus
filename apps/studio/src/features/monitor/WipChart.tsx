import { useEffect, useMemo, useRef, useState } from 'react'
import type { SimState } from '@throughline/core/engine/engine'
import { formatClock } from '@throughline/core/model/util'

const HEIGHT = 210
const PAD = { left: 34, right: 12, top: 12, bottom: 24 }
const MAX_POINTS = 320

interface Point {
  t: number
  wip: number
  /** Completed + rejected per hour over the trailing hour. */
  rate: number
}

/** "Day 2 14:00"-style label for a sim minute (clock starts Monday 08:00). */
function axisLabel(t: number, spanMinutes: number): string {
  const total = Math.floor(t) + 8 * 60
  const day = Math.floor(total / 1440) + 1
  const h = Math.floor((total % 1440) / 60)
  const m = total % 60
  if (spanMinutes > 3 * 1440) return `Day ${day}`
  const hh = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  return spanMinutes > 20 * 60 ? `D${day} ${hh}` : hh
}

function niceMax(v: number): number {
  if (v <= 4) return 4
  const pow = 10 ** Math.floor(Math.log10(v))
  for (const step of [1, 2, 2.5, 5, 10]) if (step * pow >= v) return step * pow
  return 10 * pow
}

function derive(series: SimState['series']): Point[] {
  if (series.length === 0) return []
  const pts: Point[] = []
  let j = 0
  for (const p of series) {
    // Trailing one-hour window for throughput.
    while (j < series.length - 1 && series[j + 1]!.t <= p.t - 60) j++
    const back = series[j]!
    const span = p.t - back.t
    const rate = span > 0 ? ((p.done - back.done) / span) * 60 : 0
    pts.push({ t: p.t, wip: p.wip, rate })
  }
  if (pts.length <= MAX_POINTS) return pts
  const stride = Math.ceil(pts.length / MAX_POINTS)
  const out = pts.filter((_, i) => i % stride === 0)
  if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]!)
  return out
}

export function WipChart({ series }: { series: SimState['series'] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w) setWidth(Math.max(240, Math.floor(w)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // The engine appends to `series` in place every 15 sim-minutes (and trims the
  // front at its cap), so its length and last sample identify a change.
  const len = series.length
  const last = series[len - 1]
  const points = useMemo(() => derive(series), [series, len, last?.t, last?.wip, last?.done])

  const t0 = points[0]?.t ?? 0
  const t1 = Math.max(t0 + 60, points[points.length - 1]?.t ?? 60)
  const span = t1 - t0
  const yMax = niceMax(Math.max(1, ...points.map((p) => Math.max(p.wip, p.rate))))
  const innerW = width - PAD.left - PAD.right
  const innerH = HEIGHT - PAD.top - PAD.bottom
  const x = (t: number) => PAD.left + ((t - t0) / span) * innerW
  const y = (v: number) => PAD.top + innerH - (v / yMax) * innerH

  const wipLine = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.wip).toFixed(1)}`).join('')
  const wipArea = points.length ? `${wipLine}L${x(points[points.length - 1]!.t).toFixed(1)},${y(0)}L${x(points[0]!.t).toFixed(1)},${y(0)}Z` : ''
  const rateLine = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.rate).toFixed(1)}`).join('')

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(yMax * f * 10) / 10)
  const stepOptions = [30, 60, 120, 240, 480, 720, 1440, 2880, 5760]
  const xStep = stepOptions.find((s) => span / s <= 6) ?? 11520
  const xTicks: number[] = []
  for (let t = Math.ceil(t0 / xStep) * xStep; t <= t1; t += xStep) xTicks.push(t)

  const hovered = hover !== null ? points[hover] : undefined

  return (
    <div ref={ref} className="relative w-full select-none">
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label="Work in flight and throughput over simulated time"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          if (!points.length) return
          const rect = e.currentTarget.getBoundingClientRect()
          const t = t0 + ((e.clientX - rect.left - PAD.left) / innerW) * span
          let best = 0
          for (let i = 1; i < points.length; i++) if (Math.abs(points[i]!.t - t) < Math.abs(points[best]!.t - t)) best = i
          setHover(best)
        }}
      >
        <defs>
          <linearGradient id="wip-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--color-brand-500)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--color-brand-500)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} stroke="#e2e8f0" strokeDasharray={v === 0 ? undefined : '3 3'} />
            <text x={PAD.left - 6} y={y(v) + 3.5} textAnchor="end" className="fill-slate-400 text-[10px] tabular-nums">
              {v}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={x(t)} y={HEIGHT - 6} textAnchor="middle" className="fill-slate-400 text-[10px] tabular-nums">
            {axisLabel(t, span)}
          </text>
        ))}
        {points.length > 1 && (
          <>
            <path d={wipArea} fill="url(#wip-fill)" />
            <path d={wipLine} fill="none" stroke="var(--color-brand-600)" strokeWidth={1.75} strokeLinejoin="round" />
            <path d={rateLine} fill="none" stroke="#059669" strokeWidth={1.5} strokeDasharray="4 3" strokeLinejoin="round" />
          </>
        )}
        {hovered && (
          <g>
            <line x1={x(hovered.t)} x2={x(hovered.t)} y1={PAD.top} y2={PAD.top + innerH} stroke="#94a3b8" strokeDasharray="2 2" />
            <circle cx={x(hovered.t)} cy={y(hovered.wip)} r={3.5} fill="var(--color-brand-600)" stroke="#fff" strokeWidth={1.5} />
            <circle cx={x(hovered.t)} cy={y(hovered.rate)} r={3} fill="#059669" stroke="#fff" strokeWidth={1.5} />
          </g>
        )}
      </svg>
      {hovered && (
        <div
          className="pointer-events-none absolute top-2 rounded-md border border-slate-200 bg-white/95 px-2.5 py-1.5 text-[11px] shadow-md"
          style={{ left: Math.min(width - 170, Math.max(0, x(hovered.t) + 10)) }}
        >
          <div className="font-medium text-slate-700">{formatClock(hovered.t)}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-slate-600 tabular-nums">
            <span className="h-2 w-2 rounded-full bg-brand-600" /> In flight: <b className="text-slate-900">{hovered.wip}</b>
          </div>
          <div className="flex items-center gap-1.5 text-slate-600 tabular-nums">
            <span className="h-2 w-2 rounded-full bg-emerald-600" /> Finished / hr: <b className="text-slate-900">{hovered.rate.toFixed(1)}</b>
          </div>
        </div>
      )}
      <div className="mt-1 flex items-center gap-4 pl-[34px] text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-brand-500/40 ring-1 ring-brand-600" /> In flight
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 border-t-2 border-dashed border-emerald-600" /> Finished per hour (trailing hour)
        </span>
      </div>
    </div>
  )
}
