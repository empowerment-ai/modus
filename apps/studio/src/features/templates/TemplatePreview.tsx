import type { WfEdge, WfNode, XY } from '@modus-bpm/core/model/types'

// A thumbnail of a template's map: each step drawn at its canvas position with
// a simple shape per type, scaled to fit. Labels are left to the hover title.

type Side = 't' | 'r' | 'b' | 'l'

const SIZE: Record<WfNode['type'], { w: number; h: number }> = {
  start: { w: 184, h: 48 },
  end: { w: 156, h: 48 },
  decision: { w: 120, h: 120 },
  split: { w: 72, h: 72 },
  join: { w: 72, h: 72 },
  user: { w: 258, h: 118 },
  auto: { w: 228, h: 90 },
  subflow: { w: 228, h: 90 },
  wait: { w: 150, h: 48 },
}

const DIR: Record<Side, XY> = { t: { x: 0, y: -1 }, r: { x: 1, y: 0 }, b: { x: 0, y: 1 }, l: { x: -1, y: 0 } }

function anchor(n: WfNode, side: Side): XY {
  const { w, h } = SIZE[n.type]
  const { x, y } = n.position
  if (side === 't') return { x: x + w / 2, y }
  if (side === 'b') return { x: x + w / 2, y: y + h }
  if (side === 'l') return { x, y: y + h / 2 }
  return { x: x + w, y: y + h / 2 }
}

const side = (h: string | null | undefined, fallback: Side): Side => (h === 't' || h === 'r' || h === 'b' || h === 'l' ? h : fallback)

function edgePath(e: WfEdge, byId: Map<string, WfNode>): string | undefined {
  const s = byId.get(e.source)
  const t = byId.get(e.target)
  if (!s || !t) return undefined
  const ss = side(e.sourceHandle, 'r')
  const ts = side(e.targetHandle, 'l')
  const a = anchor(s, ss)
  const b = anchor(t, ts)
  const k = Math.round(Math.max(40, Math.hypot(b.x - a.x, b.y - a.y) * 0.35))
  return `M${a.x},${a.y} C${a.x + DIR[ss].x * k},${a.y + DIR[ss].y * k} ${b.x + DIR[ts].x * k},${b.y + DIR[ts].y * k} ${b.x},${b.y}`
}

const STROKE = { vectorEffect: 'non-scaling-stroke' as const, strokeWidth: 1.25 }

function Shape({ n }: { n: WfNode }) {
  const { w, h } = SIZE[n.type]
  const { x, y } = n.position
  const diamond = (fill: string, stroke: string) => <polygon points={`${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`} fill={fill} stroke={stroke} {...STROKE} />
  switch (n.type) {
    case 'start':
      return <rect x={x} y={y} width={w} height={h} rx={h / 2} fill="#ecfdf5" stroke="#10b981" {...STROKE} />
    case 'end': {
      const tone = n.data.result === 'completed' ? ['#f1f5f9', '#64748b'] : n.data.result === 'rejected' ? ['#fff1f2', '#f43f5e'] : ['#f8fafc', '#94a3b8']
      return <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={tone[0]} stroke={tone[1]} {...STROKE} />
    }
    case 'decision':
      return diamond('#fffbeb', '#f59e0b')
    case 'split':
    case 'join':
      return diamond('#f5f3ff', '#8b5cf6')
    case 'user':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={14} fill="#ffffff" stroke="#6366f1" {...STROKE} />
          <rect x={x + 18} y={y + 24} width={w * 0.55} height={14} rx={7} fill="#c7d2fe" />
          <rect x={x + 18} y={y + 52} width={w * 0.35} height={10} rx={5} fill="#e2e8f0" />
        </g>
      )
    case 'auto':
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={14} fill="#f0f9ff" stroke="#0ea5e9" {...STROKE} />
          <rect x={x + 18} y={y + 24} width={w * 0.5} height={14} rx={7} fill="#bae6fd" />
        </g>
      )
    case 'subflow':
      return (
        <g>
          <rect x={x + 8} y={y + 8} width={w} height={h} rx={14} fill="#f5f3ff" stroke="#a78bfa" {...STROKE} />
          <rect x={x} y={y} width={w} height={h} rx={14} fill="#ffffff" stroke="#8b5cf6" {...STROKE} />
        </g>
      )
    case 'wait':
      return <rect x={x} y={y} width={w} height={h} rx={10} fill="#f8fafc" stroke="#94a3b8" strokeDasharray="4 3" {...STROKE} />
  }
}

export function TemplatePreview({ nodes, edges, className }: { nodes: WfNode[]; edges: WfEdge[]; className?: string }) {
  if (!nodes.length) return <div className={className} />
  const pad = 40
  const minX = Math.min(...nodes.map((n) => n.position.x)) - pad
  const minY = Math.min(...nodes.map((n) => n.position.y)) - pad
  const maxX = Math.max(...nodes.map((n) => n.position.x + SIZE[n.type].w)) + pad
  const maxY = Math.max(...nodes.map((n) => n.position.y + SIZE[n.type].h)) + pad
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const steps = nodes.filter((n) => n.type !== 'start' && n.type !== 'end').map((n) => n.data.label)
  return (
    <svg className={className} viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Map: ${steps.join(', ')}`}>
      <title>{steps.join(' → ')}</title>
      <g fill="none" stroke="#94a3b8">
        {edges.map((e) => {
          const d = edgePath(e, byId)
          return d ? <path key={e.id} d={d} {...STROKE} /> : null
        })}
      </g>
      {nodes.map((n) => (
        <Shape key={n.id} n={n} />
      ))}
    </svg>
  )
}
