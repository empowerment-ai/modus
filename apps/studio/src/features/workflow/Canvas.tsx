import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  ConnectionMode,
  Controls,
  type Edge,
  MarkerType,
  MiniMap,
  type Node,
  type OnBeforeDelete,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
} from '@xyflow/react'
import { Bot, GitFork, GitMerge, Hourglass, Layers, LibraryBig, type LucideIcon, Play, Plus, Square, UserRound } from 'lucide-react'
import { type DragEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { cx } from '../../components/ui'
import type { App, WfNodeType, Workflow, XY } from '@modus-bpm/core/model/types'
import { useDesign } from '../../store/design'
import { useSim, useSimView } from '../../store/sim'
import { useUi } from '../../store/ui'
import { edgeLabel } from './edgeLabels'
import { edgeTypes, type FlowEdgeData, STROKE } from './FlowEdge'
import { canConnect, newEdge, newNode } from './model'
import { type FlowNodeData, nodeTypes } from './nodes'
import { InsertTemplateModal } from './TemplateModals'
import { VersionBanners } from '../versions/VersionControls'

const PALETTE: Array<{ type: WfNodeType; label: string; hint: string; more?: string; icon: LucideIcon; tone: string }> = [
  { type: 'user', label: 'User step', hint: 'A person does the work', icon: UserRound, tone: 'bg-sky-50 text-sky-600' },
  { type: 'auto', label: 'Automated step', hint: 'A system or service does it', icon: Bot, tone: 'bg-violet-50 text-violet-600' },
  { type: 'subflow', label: 'Subflow', hint: 'Run a reusable subflow', icon: Layers, tone: 'bg-teal-50 text-teal-600' },
  { type: 'decision', label: 'Decision', hint: 'Route on field values', icon: GitFork, tone: 'bg-amber-50 text-amber-600' },
  { type: 'split', label: 'Parallel split', hint: 'Run paths at the same time', more: 'broadcast', icon: Plus, tone: 'bg-indigo-50 text-indigo-600' },
  { type: 'join', label: 'Join', hint: 'Wait for branches to meet', more: 'rendezvous', icon: GitMerge, tone: 'bg-indigo-50 text-indigo-600' },
  { type: 'wait', label: 'Timer', hint: 'Wait for a while', icon: Hourglass, tone: 'bg-orange-50 text-orange-600' },
  { type: 'end', label: 'End', hint: 'Finish the process', icon: Square, tone: 'bg-slate-100 text-slate-600' },
  { type: 'start', label: 'Start', hint: 'Where new items enter', icon: Play, tone: 'bg-emerald-50 text-emerald-600' },
]

// Fit the map beside the palette (top left), not under it.
const FIT_PADDING = { top: '40px', right: '40px', bottom: '56px', left: '216px' } as const

const DND_TYPE = 'application/x-bpm-node'

export function Canvas({ app, wf }: { app: App; wf: Workflow }) {
  return (
    <ReactFlowProvider>
      <CanvasInner app={app} wf={wf} />
    </ReactFlowProvider>
  )
}

function CanvasInner({ app, wf }: { app: App; wf: Workflow }) {
  const users = useDesign((s) => s.design.users)
  const groups = useDesign((s) => s.design.groups)
  const selection = useUi((s) => s.selection)
  const { screenToFlowPosition, fitView } = useReactFlow()
  const [fromTemplate, setFromTemplate] = useState(false)
  const updateWorkflow = useDesign((s) => s.updateWorkflow)
  const update = useCallback((fn: (w: Workflow) => void) => updateWorkflow(app.id, wf.id, fn), [updateWorkflow, app.id, wf.id])

  // Nodes live in local state while dragging; positions are committed on drag stop.
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  useEffect(() => {
    setNodes((prev) =>
      wf.nodes.map((n) => {
        const old = prev.find((p) => p.id === n.id)
        const data: FlowNodeData = { node: n, workflowId: wf.id }
        return old ? { ...old, type: n.type, position: n.position, data } : { id: n.id, type: n.type, position: n.position, data }
      }),
    )
  }, [wf.nodes, wf.id, setNodes])

  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: FIT_PADDING, duration: 0 }), 30)
    return () => clearTimeout(t)
  }, [wf.id, fitView])

  const displayNodes = useMemo(
    () =>
      nodes.map((n) => {
        const sel = selection?.kind === 'node' && selection.id === n.id
        return n.selected === sel ? n : { ...n, selected: sel }
      }),
    [nodes, selection],
  )

  const edges: Edge[] = useMemo(
    () =>
      wf.edges.map((e) => {
        const label = edgeLabel(app, wf, e, users)
        const selected = selection?.kind === 'edge' && selection.id === e.id
        const color = selected ? '#4f46e5' : STROKE[label?.tone ?? 'plain']
        const data: FlowEdgeData = { edge: e, label }
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? undefined,
          targetHandle: e.targetHandle ?? undefined,
          type: 'flow',
          selected,
          data,
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
        }
      }),
    [wf, app, users, selection],
  )

  const onBeforeDelete: OnBeforeDelete = async ({ nodes: doomed, edges: doomedEdges }) => {
    // The map is a draft: items at a removed step stay on their version until they are moved.
    const view = useSim.getState().views[app.id]
    const busy = doomed.find((n) => (view?.nodes[n.id]?.total ?? 0) > 0)
    if (busy) {
      const label = wf.nodes.find((n) => n.id === busy.id)?.data.label
      const n = view!.nodes[busy.id]!.total
      useUi.getState().toast(`“${label}” is gone from the draft. Its ${n} item${n === 1 ? '' : 's'} stay${n === 1 ? 's' : ''} on ${n === 1 ? 'its' : 'their'} version until you move them.`)
    }
    return { nodes: doomed, edges: doomedEdges }
  }

  const onDelete = ({ nodes: doomed, edges: doomedEdges }: { nodes: Node[]; edges: Edge[] }) => {
    const nodeIds = new Set(doomed.map((n) => n.id))
    const edgeIds = new Set(doomedEdges.map((e) => e.id))
    update((w) => {
      w.nodes = w.nodes.filter((n) => !nodeIds.has(n.id))
      w.edges = w.edges.filter((e) => !edgeIds.has(e.id) && !nodeIds.has(e.source) && !nodeIds.has(e.target))
    })
    useUi.getState().select(null)
  }

  /** Where a dropped or clicked palette item lands, in flow coordinates (canvas center by default). */
  const flowPoint = (clientX?: number, clientY?: number): XY => {
    const rect = document.querySelector('.react-flow')?.getBoundingClientRect()
    return screenToFlowPosition({
      x: clientX ?? (rect ? rect.left + rect.width / 2 : 400),
      y: clientY ?? (rect ? rect.top + rect.height / 2 : 300),
    })
  }

  const addNode = (type: WfNodeType, clientX?: number, clientY?: number) => {
    if (type === 'start' && wf.nodes.some((n) => n.type === 'start')) {
      useUi.getState().toast('This workflow already has a Start step.', 'warn')
      return
    }
    const point = flowPoint(clientX, clientY)
    const node = newNode(type, { x: Math.round(point.x - 100), y: Math.round(point.y - 30) }, groups)
    update((w) => {
      w.nodes.push(node)
    })
    useUi.getState().select({ kind: 'node', id: node.id })
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    const type = e.dataTransfer.getData(DND_TYPE) as WfNodeType
    if (type) addNode(type, e.clientX, e.clientY)
  }

  const started = (useSimView()?.clock ?? 0) > 0

  return (
    <div className="h-full w-full" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      <ReactFlow
        nodes={displayNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={(_, __, dragged) => {
          const moved = new Map(dragged.map((n) => [n.id, n.position]))
          update((w) => {
            for (const n of w.nodes) {
              const p = moved.get(n.id)
              if (p) n.position = { x: Math.round(p.x), y: Math.round(p.y) }
            }
          })
        }}
        onNodeClick={(_, n) => useUi.getState().select({ kind: 'node', id: n.id })}
        onNodeDoubleClick={(_, n) => {
          // Double-click a subflow step to open the subflow it runs.
          const node = wf.nodes.find((x) => x.id === n.id)
          const childId = node?.type === 'subflow' ? node.data.workflowId : undefined
          if (childId && app.workflows.some((w) => w.id === childId)) useUi.getState().drillInto(childId)
        }}
        onEdgeClick={(_, e) => useUi.getState().select({ kind: 'edge', id: e.id })}
        onPaneClick={() => useUi.getState().select(null)}
        onConnect={(c) => {
          if (!canConnect(wf, c.source, c.target)) return
          const edge = newEdge(wf, app, c.source, c.target, c.sourceHandle, c.targetHandle)
          update((w) => {
            w.edges.push(edge)
          })
          useUi.getState().select({ kind: 'edge', id: edge.id })
        }}
        isValidConnection={(c) => canConnect(wf, c.source, c.target)}
        onBeforeDelete={onBeforeDelete}
        onDelete={onDelete}
        deleteKeyCode={['Backspace', 'Delete']}
        connectionMode={ConnectionMode.Loose}
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionLineStyle={{ stroke: '#6366f1', strokeWidth: 2 }}
        snapToGrid
        snapGrid={[10, 10]}
        zoomOnDoubleClick={false}
        minZoom={0.3}
        maxZoom={1.75}
        fitView
        fitViewOptions={{ padding: FIT_PADDING }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#cbd5e1" />
        <Controls position="bottom-left" showInteractive={false} />
        <MiniMap position="bottom-right" pannable zoomable nodeColor={(n) => MINIMAP[n.type ?? ''] ?? '#cbd5e1'} maskColor="rgb(246 247 251 / 0.7)" />
        <Panel position="top-left">
          <div className="w-[176px] rounded-xl border border-slate-200 bg-white/95 p-1.5 shadow-sm backdrop-blur">
            <div className="px-1.5 pt-0.5 pb-1.5 text-[10px] font-semibold tracking-wide text-slate-400 uppercase">Drag onto the map</div>
            {PALETTE.map((p) => {
              const disabled = p.type === 'start' && wf.nodes.some((n) => n.type === 'start')
              return (
                <button
                  key={p.type}
                  type="button"
                  draggable={!disabled}
                  disabled={disabled}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DND_TYPE, p.type)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  // Steps land on the map only when dropped there. A mouse click just says so;
                  // Enter or Space (a click with no pointer) still adds one, for keyboard users.
                  onClick={(e) => (e.detail === 0 ? addNode(p.type) : useUi.getState().toast(`Drag “${p.label}” onto the map to add it.`))}
                  title={disabled ? 'A workflow has one Start step' : `Drag onto the map to add a ${p.label.toLowerCase()}${p.more ? ` (${p.more})` : ''}`}
                  className={cx('flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left', disabled ? 'cursor-not-allowed opacity-40' : 'cursor-grab hover:bg-slate-50 active:cursor-grabbing')}
                >
                  <span className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', p.tone)}>
                    <p.icon size={15} />
                  </span>
                  <span className="leading-tight">
                    <span className="block text-[12px] font-medium text-slate-800">{p.label}</span>
                    <span className="block text-[10.5px] text-slate-500">{p.hint}</span>
                  </span>
                </button>
              )
            })}
            <button
              type="button"
              onClick={() => setFromTemplate(true)}
              title="Add a step that runs a copy of a template from the library"
              className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-slate-100 px-1.5 pt-2 pb-1 text-left hover:bg-slate-50"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-600">
                <LibraryBig size={15} />
              </span>
              <span className="leading-tight">
                <span className="block text-[12px] font-medium text-slate-800">From template…</span>
                <span className="block text-[10.5px] text-slate-500">Reuse a proven subflow</span>
              </span>
            </button>
          </div>
        </Panel>
        <VersionBanners app={app} wf={wf} />
        {!started && (
          <Panel position="bottom-center">
            <div className="mb-2 rounded-full border border-slate-200 bg-white/95 px-4 py-1.5 text-xs text-slate-600 shadow-sm">
              Press <b className="font-semibold text-slate-800">Run simulation</b> (or Space) to watch work move through this map.
            </div>
          </Panel>
        )}
      </ReactFlow>
      {fromTemplate && <InsertTemplateModal app={app} wf={wf} at={() => flowPoint()} onClose={() => setFromTemplate(false)} />}
    </div>
  )
}

const MINIMAP: Record<string, string> = {
  start: '#34d399',
  end: '#94a3b8',
  decision: '#fbbf24',
  split: '#818cf8',
  join: '#818cf8',
  subflow: '#5eead4',
  wait: '#fdba74',
  auto: '#a78bfa',
  user: '#7dd3fc',
}
