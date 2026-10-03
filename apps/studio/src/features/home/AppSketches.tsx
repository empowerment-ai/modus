// Small drawings of each sample application's main process, in the studio's
// map grammar (steps, decisions, parallel splits), tinted with the app's color.

const STROKE = '#cbd5e1'

function Box({ x, y, w, label, tint, hot }: { x: number; y: number; w: number; label: string; tint: string; hot?: boolean }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={26} rx={7} fill="#fff" stroke={hot ? '#f43f5e' : '#e2e8f0'} strokeWidth={hot ? 1.4 : 1} />
      <rect x={x + 7} y={y + 9} width={8} height={8} rx={2} fill={tint} opacity={0.85} />
      <text x={x + 20} y={y + 17} fontSize={11} fontWeight={600} fill="#334155">
        {label}
      </text>
    </g>
  )
}

function Diamond({ cx, cy, tint, plus }: { cx: number; cy: number; tint?: string; plus?: boolean }) {
  return (
    <g>
      <rect x={cx - 9} y={cy - 9} width={18} height={18} rx={3} transform={`rotate(45 ${cx} ${cy})`} fill={plus ? '#fff' : '#fffbeb'} stroke={plus ? tint : '#fbbf24'} />
      {plus && <path d={`M${cx - 4.5} ${cy} h9 M${cx} ${cy - 4.5} v9`} stroke={tint} strokeWidth={1.5} strokeLinecap="round" />}
    </g>
  )
}

function Start({ cx, cy }: { cx: number; cy: number }) {
  return <circle cx={cx} cy={cy} r={7} fill="#fff" stroke="#10b981" strokeWidth={1.6} />
}

export function InvoiceSketch({ tint }: { tint: string }) {
  return (
    <svg viewBox="0 0 300 130" className="h-auto w-full" aria-hidden="true">
      <g fill="none" stroke={STROKE} strokeWidth={1.2}>
        <path d="M17 65 H24 M100 65 H110 M122 53 V18 H142 M134 65 H142 M122 77 V107 H142 M236 18 H250 V65 H262 M236 65 H262 M236 107 H250 V65" />
      </g>
      <Start cx={10} cy={65} />
      <Box x={24} y={52} w={76} label="Capture" tint={tint} />
      <Diamond cx={122} cy={65} />
      <Box x={142} y={5} w={94} label="Controller" tint={tint} hot />
      <Box x={142} y={52} w={94} label="Manager" tint={tint} />
      <Box x={142} y={94} w={94} label="AP clerk" tint={tint} />
      <Diamond cx={274} cy={65} tint={tint} plus />
      <path d="M286 65 H292" stroke={STROKE} strokeWidth={1.2} />
      <circle cx={295} cy={65} r={4} fill={tint} opacity={0.5} />
    </svg>
  )
}

export function FleetSketch({ tint }: { tint: string }) {
  return (
    <svg viewBox="0 0 316 130" className="h-auto w-full" aria-hidden="true">
      <g fill="none" stroke={STROKE} strokeWidth={1.2}>
        <path d="M17 65 H24 M100 65 H110 M180 65 H188 M200 53 V18 H212 M212 65 H212 M200 77 V112 H212 M200 65 H212 M282 18 H292 V65 M282 65 H292 M282 112 H292 V65" />
      </g>
      <Start cx={10} cy={65} />
      <Box x={24} y={52} w={76} label="Request" tint={tint} />
      <Box x={110} y={52} w={70} label="Review" tint={tint} />
      <Diamond cx={200} cy={65} tint={tint} plus />
      <Box x={212} y={5} w={70} label="Dealer A" tint={tint} />
      <Box x={212} y={52} w={70} label="Dealer B" tint={tint} />
      <Box x={212} y={99} w={70} label="Dealer C" tint={tint} />
      <g>
        <circle cx={303} cy={65} r={12} fill="#fff" stroke={tint} strokeWidth={1.4} />
        <text x={303} y={69} fontSize={9.5} fontWeight={700} fill={tint} textAnchor="middle">
          2/3
        </text>
      </g>
    </svg>
  )
}

export function SecuritySketch({ tint }: { tint: string }) {
  return (
    <svg viewBox="0 0 330 130" className="h-auto w-full" aria-hidden="true">
      <g fill="none" stroke={STROKE} strokeWidth={1.2}>
        <path d="M17 65 H24 M100 65 H108 M120 53 V15 H132 M120 53 V46 H132 M120 77 V84 H132 M120 77 V115 H132 M220 15 H230 V65 M220 46 H230 M220 84 H230 M220 115 H230 V65 H236 M254 65 H260" />
      </g>
      <Start cx={10} cy={65} />
      <Box x={24} y={52} w={76} label="AI · GPU" tint={tint} hot />
      <Diamond cx={120} cy={65} tint={tint} plus />
      <Box x={132} y={2} w={88} label="Watchlist" tint={tint} />
      <Box x={132} y={33} w={88} label="Cameras" tint={tint} />
      <Box x={132} y={71} w={88} label="Clip" tint={tint} />
      <Box x={132} y={102} w={88} label="AI agent" tint={tint} />
      <Diamond cx={245} cy={65} tint={tint} plus />
      <Box x={260} y={52} w={68} label="Officer" tint={tint} />
    </svg>
  )
}
