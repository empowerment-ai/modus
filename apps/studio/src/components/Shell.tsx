import {
  Activity,
  AppWindow,
  Check,
  ChevronDown,
  Download,
  FastForward,
  FileStack,
  FlaskConical,
  GitBranch,
  Inbox,
  LayoutTemplate,
  ListTree,
  Pause,
  PencilRuler,
  Play,
  Plug,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Upload,
} from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { PRODUCT } from '../brand'
import { GitHubMark } from './GitHubMark'
import { blankApp } from '@modus-bpm/core/model/seed'
import type { Design } from '@modus-bpm/core/model/types'
import { formatClock, formatDuration } from '@modus-bpm/core/model/util'
import { useApp, useDesign } from '../store/design'
import { SPEEDS, useSim, useSimView } from '../store/sim'
import { type Mode, useUi, type View } from '../store/ui'
import { Button, cx, Field, Input, Modal, Segmented, Textarea, Toggle } from './ui'

const NAV: Array<{ view: View; label: string; icon: typeof GitBranch }> = [
  { view: 'workflow', label: 'Workflows', icon: GitBranch },
  { view: 'types', label: 'Object Types', icon: FileStack },
  { view: 'lists', label: 'Lists', icon: ListTree },
  { view: 'org', label: 'People & Security', icon: ShieldCheck },
  { view: 'integrations', label: 'Integrations', icon: Plug },
  { view: 'templates', label: 'Templates', icon: LayoutTemplate },
  { view: 'monitor', label: 'Monitor', icon: Activity },
  { view: 'scenarios', label: 'What-if', icon: FlaskConical },
]

export function Shell({ children }: { children: ReactNode }) {
  const view = useUi((s) => s.view)
  const mode = useUi((s) => s.mode)
  const setView = useUi((s) => s.setView)
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        {mode === 'studio' && (
          <nav className="flex w-[76px] shrink-0 flex-col items-center gap-1 border-r border-slate-200 bg-white py-3" aria-label="Designer sections">
            {NAV.map(({ view: v, label, icon: Icon }) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-current={view === v ? 'page' : undefined}
                className={cx(
                  'flex w-[64px] flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10.5px] leading-tight font-medium transition-colors',
                  view === v ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800',
                )}
              >
                <Icon size={19} strokeWidth={view === v ? 2.2 : 1.8} />
                <span className="text-center">{label}</span>
              </button>
            ))}
            <div className="flex-1" />
            <SettingsMenu />
          </nav>
        )}
        <main className="relative min-w-0 flex-1">{children}</main>
      </div>
    </div>
  )
}

function TopBar() {
  return (
    <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3">
      <a href="#/" title={`${PRODUCT.name} home`} aria-label={`${PRODUCT.name} home`} className="flex items-center gap-3 rounded-lg">
        <span className="flex w-[52px] items-center justify-center">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm">
            <GitBranch size={17} strokeWidth={2.4} />
          </span>
        </span>
        <span className="hidden leading-tight min-[1200px]:block">
          <span className="block text-sm font-semibold text-slate-900">{PRODUCT.name}</span>
          <span className="hidden text-[10.5px] font-medium tracking-wide text-slate-400 uppercase min-[1520px]:block">{PRODUCT.tagline}</span>
        </span>
      </a>
      <div className="mx-2 hidden h-6 w-px bg-slate-200 min-[1200px]:block" />
      <ModeSwitch />
      <AppSwitcher />
      <div className="flex-1" />
      <a
        href={PRODUCT.repo}
        target="_blank"
        rel="noreferrer"
        title={`${PRODUCT.name} on GitHub: source code, docs and issues`}
        className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      >
        <GitHubMark size={16} />
        <span className="hidden min-[1600px]:inline">GitHub</span>
        <span className="sr-only min-[1600px]:hidden">{PRODUCT.name} on GitHub</span>
      </a>
      <SimControls />
    </header>
  )
}

/** Studio (design and administer) vs Workspace (do the work). */
function ModeSwitch() {
  const mode = useUi((s) => s.mode)
  const setMode = useUi((s) => s.setMode)
  const options: Array<{ value: Mode; label: string; icon: typeof Inbox }> = [
    { value: 'studio', label: 'Studio', icon: PencilRuler },
    { value: 'workspace', label: 'Workspace', icon: Inbox },
  ]
  return (
    <div className="flex h-9 items-center rounded-lg bg-slate-100 p-0.5" role="tablist" aria-label="Mode">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={mode === o.value}
          onClick={() => setMode(o.value)}
          title={o.value === 'studio' ? 'Design processes and administer the work' : 'Do the work: your basket, queues and requests'}
          className={cx(
            'flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors',
            mode === o.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800',
          )}
        >
          <o.icon size={14} className="max-[1199px]:hidden" />
          {o.label}
        </button>
      ))}
    </div>
  )
}

function AppSwitcher() {
  const appId = useUi((s) => s.appId)
  const setApp = useUi((s) => s.setApp)
  const apps = useDesign((s) => s.design.apps)
  const app = useApp(appId)
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false))

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white pr-2 pl-2.5 text-left hover:border-slate-300 hover:bg-slate-50"
      >
        <AppWindow size={15} style={{ color: app?.color }} />
        <span className="leading-tight">
          <span className="block text-[10px] font-medium tracking-wide text-slate-400 uppercase">Application</span>
          <span className="block max-w-[140px] truncate text-sm font-semibold text-slate-800 min-[1200px]:max-w-[190px]" title={app?.name}>
            {app?.name}
          </span>
        </span>
        <ChevronDown size={14} className="ml-1 text-slate-400" />
      </button>
      {open && (
        <div className="animate-slide-in absolute top-11 left-0 z-40 w-80 rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl">
          {apps.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                setApp(a.id)
                setOpen(false)
              }}
              className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-slate-50"
            >
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: a.color }} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-slate-800">{a.name}</span>
                <span className="block truncate text-xs text-slate-500">{a.description || `${a.objectTypes.length} object types · ${a.workflows.length} workflows`}</span>
              </span>
              {a.id === appId && <Check size={15} className="mt-0.5 text-brand-600" />}
            </button>
          ))}
          <div className="my-1 h-px bg-slate-100" />
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              setCreating(true)
            }}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50"
          >
            <Plus size={15} /> New application
          </button>
        </div>
      )}
      <NewAppModal open={creating} onClose={() => setCreating(false)} />
    </div>
  )
}

function NewAppModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const create = () => {
    const app = blankApp(name.trim() || 'New application')
    app.description = description.trim()
    useDesign.getState().update((d) => {
      d.apps.push(app)
    })
    useUi.getState().setApp(app.id)
    useUi.getState().setView('types')
    useUi.getState().toast(`Created “${app.name}”. Start by designing its object type.`, 'success')
    setName('')
    setDescription('')
    onClose()
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New application"
      subtitle="An application bundles object types, lists and the workflows that move them."
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={create}>
            Create application
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name">
          <Input autoFocus value={name} placeholder="e.g. Contract Review" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
        </Field>
        <Field label="Description">
          <Textarea value={description} placeholder="What business process does it automate?" onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

function SimControls() {
  const running = useSim((s) => s.running)
  const speed = useSim((s) => s.speed)
  const toggle = useSim((s) => s.toggle)
  const setSpeed = useSim((s) => s.setSpeed)
  const fastForward = useSim((s) => s.fastForward)
  const reset = useSim((s) => s.reset)
  const view = useSimView()
  const appId = useUi((s) => s.appId)
  const arrivals = useSim((s) => s.sims[appId]?.arrivals ?? true)
  useSim((s) => s.version)

  // Space bar toggles the simulation when focus is not in a form control.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.code !== 'Space' || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(t.tagName) || t.isContentEditable) return
      e.preventDefault()
      useSim.getState().toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex items-center gap-2.5">
      <div className="hidden items-center gap-3 pr-1 text-xs min-[1800px]:flex">
        <Kpi label="In flight" value={view?.active ?? 0} />
        <Kpi label="Completed" value={view?.completed ?? 0} tone="green" />
        <Kpi label="Rejected" value={view?.rejected ?? 0} tone="red" />
        <Kpi label="Avg cycle" value={formatDuration(view?.avgCycle ?? 0)} />
        {(view?.stuck ?? 0) > 0 && <Kpi label="Stuck" value={view!.stuck} tone="red" />}
      </div>
      <div className="h-6 w-px bg-slate-200" />
      <div className="rounded-md bg-slate-900 px-2.5 py-1 font-mono text-xs whitespace-nowrap text-slate-100 tabular-nums" title="Simulated time">
        {/* Narrow screens drop the weekday: "Day 1 · 08:00". */}
        <span className="max-[1199px]:hidden">{formatClock(view?.clock ?? 0)}</span>
        <span className="min-[1200px]:hidden">{formatClock(view?.clock ?? 0).replace(/^\w+ · /, '')}</span>
      </div>
      <div className="hidden min-[1440px]:block">
        <Segmented size="sm" value={speed} onChange={setSpeed} options={SPEEDS.map((s) => ({ value: s.value, label: s.label, title: `${s.label} of simulated time` }))} />
      </div>
      {/* Narrower screens: the same choice as a compact menu. */}
      <select
        value={speed}
        onChange={(e) => setSpeed(Number(e.target.value))}
        aria-label="Simulation speed"
        className="h-7 rounded-md border border-slate-200 bg-white px-1.5 text-xs text-slate-700 min-[1440px]:hidden"
      >
        {SPEEDS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <Button variant="ghost" size="sm" icon={<FastForward size={14} />} onClick={() => fastForward(60)} title="Jump ahead one simulated hour">
        1h
      </Button>
      <Button variant="ghost" size="sm" icon={<FastForward size={14} />} onClick={() => fastForward(8 * 60)} title="Jump ahead a simulated working day">
        8h
      </Button>
      <Toggle checked={arrivals} onChange={(on) => useSim.getState().setArrivals(on)} label={<span className="text-xs text-slate-600 max-[1199px]:sr-only">Arrivals</span>} />
      <Button
        variant="ghost"
        size="sm"
        icon={<RotateCcw size={14} />}
        title="Reset: clear all simulated work for this application"
        aria-label="Reset the simulation"
        onClick={() => {
          reset()
          useUi.getState().toast('Simulation reset: all simulated work cleared.')
        }}
      >
        <span className="hidden min-[1520px]:inline">Reset</span>
      </Button>
      <Button variant={running ? 'secondary' : 'primary'} onClick={toggle} icon={running ? <Pause size={14} /> : <Play size={14} />} className="min-[1200px]:w-[118px]" title="Space bar">
        {running ? (
          'Pause'
        ) : (
          <>
            <span className="min-[1200px]:hidden">Run</span>
            <span className="hidden min-[1200px]:inline">Run simulation</span>
          </>
        )}
      </Button>
    </div>
  )
}

function Kpi({ label, value, tone }: { label: string; value: ReactNode; tone?: 'green' | 'red' }) {
  return (
    <div className="leading-tight">
      <div className="text-[10px] font-medium tracking-wide whitespace-nowrap text-slate-400 uppercase">{label}</div>
      <div className={cx('text-sm font-semibold whitespace-nowrap tabular-nums', tone === 'green' ? 'text-emerald-700' : tone === 'red' ? 'text-rose-600' : 'text-slate-800')}>{value}</div>
    </div>
  )
}

function SettingsMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  useClickOutside(ref, () => setOpen(false))

  const exportDesign = () => {
    const blob = new Blob([JSON.stringify(useDesign.getState().design, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `bpm-design-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    setOpen(false)
  }

  const importDesign = async (file: File) => {
    try {
      const d = JSON.parse(await file.text()) as Design
      if (!Array.isArray(d.apps) || !Array.isArray(d.users) || !Array.isArray(d.groups)) throw new Error('Not a design file')
      useSim.getState().pause()
      useDesign.getState().replace(d)
      useSim.setState({ sims: {}, views: {}, flights: [] })
      if (d.apps[0]) useUi.getState().setApp(d.apps[0].id)
      useUi.getState().toast(`Imported ${d.apps.length} application(s).`, 'success')
    } catch {
      useUi.getState().toast('That file is not a valid design export.', 'warn')
    }
    setOpen(false)
  }

  const resetAll = () => {
    if (!window.confirm('Replace all applications, people and groups with the sample data? Your changes will be lost.')) return
    useSim.getState().pause()
    useDesign.getState().reset()
    useSim.setState({ sims: {}, views: {}, flights: [] })
    useUi.getState().setApp('app_invoice')
    useUi.getState().toast('Sample data restored.', 'success')
    setOpen(false)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-[64px] flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10.5px] font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-800"
      >
        <Settings2 size={19} strokeWidth={1.8} />
        Settings
      </button>
      {open && (
        <div className="animate-slide-in absolute bottom-0 left-[70px] z-40 w-60 rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl">
          <MenuItem icon={<Download size={15} />} onClick={exportDesign}>
            Export design (JSON)
          </MenuItem>
          <MenuItem icon={<Upload size={15} />} onClick={() => fileRef.current?.click()}>
            Import design…
          </MenuItem>
          <div className="my-1 h-px bg-slate-100" />
          <MenuItem icon={<RotateCcw size={15} />} onClick={resetAll} danger>
            Restore sample data
          </MenuItem>
          <p className="px-2.5 pt-1.5 pb-1 text-[11px] leading-snug text-slate-400">Designs are saved in this browser automatically.</p>
          <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importDesign(e.target.files[0])} />
        </div>
      )}
    </div>
  )
}

function MenuItem({ icon, children, onClick, danger }: { icon: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx('flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm', danger ? 'text-rose-600 hover:bg-rose-50' : 'text-slate-700 hover:bg-slate-50')}
    >
      {icon}
      {children}
    </button>
  )
}

export function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOutside: () => void) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [ref, onOutside])
}
