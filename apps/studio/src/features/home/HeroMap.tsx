// The landing page's picture: a small process map in the studio's style, with
// work moving along it and piling up at one step. Illustrative, not live data.

import { useEffect, useState } from 'react'

const ROUTES = {
  controller: 'M62 150 H318 V62 H600 V150 H676',
  manager: 'M62 150 H676',
  clerk: 'M62 150 H318 V238 H600 V150 H676',
}

// Tokens on their way: [route, seconds per trip, start offset].
const TOKENS: Array<[keyof typeof ROUTES, number, number]> = [
  ['manager', 7, 0],
  ['clerk', 8, 1.6],
  ['controller', 11, 0.8],
  ['manager', 7, 3.4],
  ['clerk', 8, 5.2],
  ['controller', 11, 6.1],
  ['manager', 7, 5.9],
]

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

function Step({
  x,
  y,
  w,
  title,
  sub,
  count,
  tone = 'slate',
  kind = 'user',
}: {
  x: number
  y: number
  w: number
  title: string
  sub: string
  count?: number
  tone?: 'slate' | 'red'
  kind?: 'user' | 'auto'
}) {
  const red = tone === 'red'
  return (
    <g>
      <rect x={x} y={y} width={w} height={48} rx={10} fill="#fff" stroke={red ? '#f43f5e' : '#e2e8f0'} strokeWidth={red ? 1.6 : 1} />
      <rect x={x + 10} y={y + 12} width={24} height={24} rx={6} fill={kind === 'auto' ? '#f5f3ff' : '#eef2ff'} />
      {kind === 'auto' ? (
        <path d={`M${x + 17} ${y + 20} h10 v10 h-10 z M${x + 20} ${y + 17} v3 M${x + 24} ${y + 17} v3`} stroke="#7c3aed" strokeWidth={1.5} fill="none" strokeLinecap="round" />
      ) : (
        <>
          <circle cx={x + 22} cy={y + 21} r={3.4} stroke="#4f46e5" strokeWidth={1.5} fill="none" />
          <path d={`M${x + 16} ${y + 31} a6 6 0 0 1 12 0`} stroke="#4f46e5" strokeWidth={1.5} fill="none" strokeLinecap="round" />
        </>
      )}
      <text x={x + 42} y={y + 21} fontSize={12.5} fontWeight={600} fill="#0f172a">
        {title}
      </text>
      <text x={x + 42} y={y + 37} fontSize={12} fill="#64748b">
        {sub}
      </text>
      {count !== undefined && (
        <g>
          <circle cx={x + w} cy={y} r={12} fill={red ? '#e11d48' : '#4f46e5'} />
          <text x={x + w} y={y + 4} fontSize={11.5} fontWeight={700} fill="#fff" textAnchor="middle">
            {count}
          </text>
        </g>
      )}
    </g>
  )
}

/** The map itself; drawn once per frame size. */
function MapArt({ moving }: { moving: boolean }) {
  return (
    <>
      <g fill="none" stroke="#cbd5e1" strokeWidth={1.6}>
        <path d="M112 150 H136" />
        <path d="M286 150 H294" />
        <path d="M318 126 V62 H400" />
        <path d="M342 150 H400" />
        <path d="M318 174 V238 H400" />
        <path d="M586 62 H600 V150 H614" />
        <path d="M586 150 H614" />
        <path d="M586 238 H600 V150" />
      </g>
      <g fill="#64748b" fontWeight={500}>
        <text x={324} y={98} fontSize={11.5}>
          &gt; $10,000
        </text>
        <text x={346} y={143} fontSize={11.5}>
          &gt; $1,000
        </text>
        <text x={324} y={212} fontSize={11.5}>
          Otherwise
        </text>
      </g>

      {/* Work moving: each dot appears when its trip begins. */}
      {moving &&
        TOKENS.map(([route, dur, begin], i) => (
          <circle key={i} r={5} fill={route === 'controller' ? '#f43f5e' : '#6366f1'} opacity={0}>
            <animateMotion dur={`${dur}s`} begin={`${begin}s`} repeatCount="indefinite" path={ROUTES[route]} />
            <set attributeName="opacity" to="0.9" begin={`${begin}s`} />
          </circle>
        ))}

      <g>
        <rect x={12} y={128} width={100} height={44} rx={22} fill="#fff" stroke="#a7f3d0" />
        <circle cx={34} cy={150} r={9} fill="#d1fae5" />
        <path d="M31 145.5 L38.5 150 L31 154.5 Z" fill="#059669" />
        <text x={50} y={147} fontSize={12} fontWeight={600} fill="#0f172a">
          Invoice
        </text>
        <text x={50} y={161} fontSize={12} fill="#64748b">
          received
        </text>
      </g>
      <Step x={136} y={126} w={150} title="Capture & match" sub="ERP · automated" kind="auto" count={2} />
      <g>
        <rect x={301} y={133} width={34} height={34} rx={6} transform="rotate(45 318 150)" fill="#fffbeb" stroke="#fbbf24" />
        <path d="M314 146 h8 M318 146 v8 M314 154 h8" stroke="#d97706" strokeWidth={1.4} strokeLinecap="round" />
      </g>
      <Step x={400} y={38} w={186} title="Controller approval" sub="Finance Leadership" count={14} tone="red" />
      <Step x={400} y={126} w={186} title="Manager approval" sub="Budget managers" count={5} />
      <Step x={400} y={214} w={186} title="AP clerk review" sub="Load balanced · 10" count={3} />
      {/* The bottleneck tag and the queue in front of it */}
      <g>
        <rect x={400} y={6} width={82} height={20} rx={10} fill="#ffe4e6" />
        <text x={441} y={20} fontSize={10.5} fontWeight={700} fill="#be123c" textAnchor="middle">
          Bottleneck
        </text>
        <g fill="#fda4af">
          <circle cx={388} cy={62} r={3.6} />
          <circle cx={377} cy={62} r={3.6} />
          <circle cx={366} cy={62} r={3.6} />
        </g>
      </g>
      <g>
        <rect x={614} y={128} width={62} height={44} rx={22} fill="#fff" stroke="#cbd5e1" />
        <circle cx={632} cy={150} r={9} fill="#f1f5f9" />
        <path d="M628 150 l3 3 l5 -6" stroke="#475569" strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <text x={645} y={154} fontSize={12} fontWeight={600} fill="#0f172a">
          Paid
        </text>
      </g>
    </>
  )
}

const LABEL = 'A process map: invoices are captured, routed by amount to the controller, a manager or a clerk, then paid. Work is piling up at Controller approval, which is tagged as the bottleneck.'

export function HeroMap() {
  const reduced = useReducedMotion()
  return (
    <div className="relative rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_24px_60px_-24px_rgb(30_27_75/0.35)]">
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 pt-1.5 pb-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
        <span className="ml-2 text-xs font-medium text-slate-600">Invoice Approval</span>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] font-medium text-emerald-700">
          <span className="relative flex h-2 w-2">
            {!reduced && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Simulating
        </span>
      </div>
      <div className="rounded-xl bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:16px_16px]">
        {/* Wide screens see the whole map; phones see the routing and its bottleneck, large enough to read. */}
        <svg viewBox="0 0 680 300" className="hidden h-auto w-full sm:block" role="img" aria-label={LABEL}>
          <MapArt moving={!reduced} />
        </svg>
        <svg viewBox="292 0 388 300" className="block h-auto w-full sm:hidden" role="img" aria-label={LABEL}>
          <MapArt moving={!reduced} />
        </svg>
      </div>
      <div className="pointer-events-none mx-1 mt-2 mb-1 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg sm:absolute sm:-bottom-5 sm:left-8 sm:m-0">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-amber-50 text-amber-600">
          <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
            <path d="M6 2h4M7 2v4L3.5 12.5A1 1 0 0 0 4.4 14h7.2a1 1 0 0 0 .9-1.5L9 6V2" strokeLinejoin="round" />
          </svg>
        </span>
        <span>
          <span className="font-semibold text-slate-800">What-if:</span> <span className="text-slate-600">add two approvers, run both futures, compare</span>
        </span>
      </div>
    </div>
  )
}
