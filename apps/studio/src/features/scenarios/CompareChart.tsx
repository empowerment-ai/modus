import { useEffect, useRef, useState } from 'react'
import { formatClock } from '@modus-bpm/core/model/util'
import { axisLabel, niceMax } from '../monitor/WipChart'

type Series = Array<{ t: number; wip: number }>

const HEIGHT = 230
const PAD = { left: 40, right: 104, top: 12, bottom: 26 }
// Baseline recedes (gray, dashed); the scenario carries the brand color. Identity
// never rests on color alone: dash pattern, legend and direct end labels.
const BASE = '#94a3b8'
const WHAT = 'var(--color-brand-600)'

/** Work in flight over the run: as designed vs with the changes, on one axis. */
export function CompareChart({ baseline, scenario }: { baseline: Series; scenario: Series }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w) setWidth(Math.max(280, Math.floor(w)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const all = [...baseline, ...scenario]
  const t0 = Math.min(...all.map((p) => p.t), all[0]?.t ?? 0)
  const t1 = Math.max(t0 + 60, ...all.map((p) => p.t))
  const span = t1 - t0
  const yMax = niceMax(Math.max(1, ...all.map((p) => p.wip)))
  const innerW = width - PAD.left - PAD.right
  const innerH = HEIGHT - PAD.top - PAD.bottom
  const x = (t: number) => PAD.left + ((t - t0) / span) * innerW
  const y = (v: number) => PAD.top + innerH - (v / yMax) * innerH
  const line = (s: Series) => s.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.wip).toFixed(1)}`).join('')

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(yMax * f * 10) / 10)
  const xStep = [30, 60, 120, 240, 480, 720, 1440, 2880].find((s) => span / s <= 6) ?? 5760
  const xTicks: number[] = []
  for (let t = Math.ceil(t0 / xStep) * xStep; t <= t1; t += xStep) xTicks.push(t)

  // End labels, nudged apart when the lines finish close together.
  const lastB = baseline[baseline.length - 1]
  const lastS = scenario[scenario.length - 1]
  let yB = lastB ? y(lastB.wip) : 0
  let yS = lastS ? y(lastS.wip) : 0
  if (Math.abs(yB - yS) < 24) {
    const mid = (yB + yS) / 2
    const up = yS <= yB ? -1 : 1
    yS = mid + up * 12
    yB = mid - up * 12
  }

  const hb = hover !== null ? baseline[hover] : undefined
  const hs = hb ? nearest(scenario, hb.t) : undefined

  return (
    <div ref={ref} className="relative w-full select-none">
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label="Items in flight over the run, as designed and with the changes"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          if (!baseline.length) return
          const rect = e.currentTarget.getBoundingClientRect()
          const t = t0 + ((e.clientX - rect.left - PAD.left) / innerW) * span
          let best = 0
          for (let i = 1; i < baseline.length; i++) if (Math.abs(baseline[i]!.t - t) < Math.abs(baseline[best]!.t - t)) best = i
          setHover(best)
        }}
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={PAD.left + innerW} y1={y(v)} y2={y(v)} stroke="#e2e8f0" strokeDasharray={v === 0 ? undefined : '3 3'} />
            <text x={PAD.left - 6} y={y(v) + 3.5} textAnchor="end" className="fill-slate-400 text-[10px] tabular-nums">
              {v}
            </text>
          </g>
        ))}
        <text x={10} y={PAD.top + innerH / 2} transform={`rotate(-90 10 ${PAD.top + innerH / 2})`} textAnchor="middle" className="fill-slate-400 text-[10px]">
          Items in flight
        </text>
        {xTicks.map((t) => (
          <text key={t} x={x(t)} y={HEIGHT - 8} textAnchor="middle" className="fill-slate-400 text-[10px] tabular-nums">
            {axisLabel(t, span)}
          </text>
        ))}
        {baseline.length > 1 && <path d={line(baseline)} fill="none" stroke={BASE} strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" />}
        {scenario.length > 1 && <path d={line(scenario)} fill="none" stroke={WHAT} strokeWidth={2} strokeLinejoin="round" />}
        {lastB && (
          <text x={x(lastB.t) + 8} y={yB + 3.5} className="fill-slate-500 text-[10.5px] tabular-nums">
            As designed · <tspan className="fill-slate-800 font-semibold">{lastB.wip}</tspan>
          </text>
        )}
        {lastS && (
          <text x={x(lastS.t) + 8} y={yS + 3.5} className="fill-slate-500 text-[10.5px] tabular-nums">
            With changes · <tspan className="fill-slate-800 font-semibold">{lastS.wip}</tspan>
          </text>
        )}
        {hb && (
          <g>
            <line x1={x(hb.t)} x2={x(hb.t)} y1={PAD.top} y2={PAD.top + innerH} stroke="#94a3b8" strokeDasharray="2 2" />
            <circle cx={x(hb.t)} cy={y(hb.wip)} r={4} fill={BASE} stroke="#fff" strokeWidth={2} />
            {hs && <circle cx={x(hs.t)} cy={y(hs.wip)} r={4} fill={WHAT} stroke="#fff" strokeWidth={2} />}
          </g>
        )}
      </svg>
      {hb && (
        <div
          className="pointer-events-none absolute top-2 rounded-md border border-slate-200 bg-white/95 px-2.5 py-1.5 text-[11px] shadow-md"
          style={{ left: Math.min(width - 190, Math.max(0, x(hb.t) + 10)) }}
        >
          <div className="font-medium text-slate-700">{formatClock(hb.t)}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-slate-600 tabular-nums">
            <span className="w-3 border-t-2 border-dashed border-slate-400" /> As designed: <b className="text-slate-900">{hb.wip}</b>
          </div>
          {hs && (
            <div className="flex items-center gap-1.5 text-slate-600 tabular-nums">
              <span className="w-3 border-t-2 border-brand-600" /> With changes: <b className="text-slate-900">{hs.wip}</b>
              <span className="text-slate-500">
                ({hs.wip - hb.wip > 0 ? '+' : ''}
                {hs.wip - hb.wip})
              </span>
            </div>
          )}
        </div>
      )}
      <div className="mt-1 flex items-center gap-4 pl-[40px] text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="w-4 border-t-2 border-dashed border-slate-400" /> As designed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 border-t-2 border-brand-600" /> With your changes
        </span>
      </div>
    </div>
  )
}

function nearest(s: Series, t: number) {
  let best = s[0]
  for (const p of s) if (best && Math.abs(p.t - t) < Math.abs(best.t - t)) best = p
  return best
}
