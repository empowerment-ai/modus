/*
THESIS: The front door is a set of real doors. Modus proves itself by letting the visitor walk
into a working organization, not by describing one; it refuses the hero-plus-feature-grid page.
OWN-WORLD: The studio's own materials: dot-grid canvas, white step cards with count badges, slate
type, indigo actions, each sample app in its own color; one dark slate band for the open-source close.
STORY: In one viewport the visitor learns what Modus is (one model that runs, simulates and is
monitored) and sees it working; then picks a sample organization or a role and walks in.
FIRST VIEWPORT: The three-beat headline across the top; below it, left, the offer with Open the
Studio as the primary action and the Workspace and GitHub beside it; right, the live invoice map
with its bottleneck.
FORM: Choose-your-door, third of six grounded structures; seed bba636b2.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
*/

import { ArrowRight, ArrowUpRight, Camera, Car, Check, FlaskConical, GitBranch, Inbox, type LucideIcon, Receipt } from 'lucide-react'
import type { MouseEvent, ReactNode } from 'react'
import type { Id } from '@modus-bpm/core/model/types'
import { DOCS, PRODUCT } from '../../brand'
import { GitHubMark } from '../../components/GitHubMark'
import { enterApp } from '../../store/route'
import { FleetSketch, InvoiceSketch, SecuritySketch } from './AppSketches'
import { HeroMap } from './HeroMap'

const container = 'mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8'

function PrimaryAction({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group inline-flex h-11 items-center gap-2 rounded-lg bg-brand-600 px-5 text-[15px] font-semibold text-white shadow-[0_6px_16px_-6px_rgb(79_70_229/0.6)] transition-colors hover:bg-brand-700"
    >
      {children}
      <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
    </button>
  )
}

function SecondaryAction({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 text-[15px] font-semibold text-slate-800 transition-colors hover:border-slate-400 hover:bg-slate-50"
    >
      {children}
    </button>
  )
}

function RepoLink({ className = '' }: { className?: string }) {
  return (
    <a href={PRODUCT.repo} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-2 font-semibold text-slate-700 hover:text-slate-950 ${className}`}>
      <GitHubMark size={17} />
      Source on GitHub
      <ArrowUpRight size={14} className="text-slate-400" />
    </a>
  )
}

// ---------- Header ----------

function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur-md">
      <div className={`${container} flex h-16 items-center gap-6`}>
        <a href="#/" className="flex items-center gap-2.5" aria-label={`${PRODUCT.name} home`}>
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm">
            <GitBranch size={17} strokeWidth={2.4} />
          </span>
          <span className="text-[17px] font-semibold tracking-tight text-slate-900">{PRODUCT.name}</span>
        </a>
        <nav className="hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex" aria-label="Page sections">
          <a href="#samples" onClick={scrollTo('samples')} className="hover:text-slate-950">
            Sample organizations
          </a>
          <a href="#roles" onClick={scrollTo('roles')} className="hover:text-slate-950">
            Who it’s for
          </a>
          <a href="#model" onClick={scrollTo('model')} className="hover:text-slate-950">
            How it works
          </a>
          <a href="#open-source" onClick={scrollTo('open-source')} className="hover:text-slate-950">
            Open source
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-2 sm:gap-4">
          <a
            href={PRODUCT.repo}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-950"
          >
            <GitHubMark size={17} />
            <span className="hidden sm:inline">GitHub</span>
            <span className="sr-only sm:hidden">{PRODUCT.name} on GitHub</span>
          </a>
          <button
            type="button"
            onClick={() => enterApp('studio', { view: 'workflow' })}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-800 hover:border-slate-400 hover:bg-slate-50"
          >
            Open the Studio
            <ArrowRight size={15} className="text-slate-500" />
          </button>
        </div>
      </div>
    </header>
  )
}

/** In-page links scroll the page without touching the #/ route. */
function scrollTo(id: string) {
  return (e: MouseEvent) => {
    e.preventDefault()
    document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  }
}

// ---------- First viewport ----------

function PrototypeNote({ className }: { className: string }) {
  return (
    <p className={`max-w-[34rem] border-t border-slate-200 pt-5 text-sm leading-relaxed text-slate-500 ${className}`}>
      This is the in-browser prototype: a simulated organization of about fifty people at work in three sample applications. No sign-in, nothing to install, and nothing leaves your browser.
    </p>
  )
}

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-slate-200 bg-canvas">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(#d5dbe5_1px,transparent_1px)] [background-size:20px_20px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" />
      <div className={`${container} relative pt-10 pb-16 sm:pt-16 sm:pb-20 lg:pt-16 lg:pb-24`}>
        <h1 className="text-[40px] leading-[1.04] font-semibold tracking-[-0.035em] text-slate-950 sm:text-[56px] lg:text-[68px]">
          <span className="block text-balance">Draw the process.</span>
          <span className="block text-balance">Watch it run.</span>
          <span className="block text-balance">Change it while it works.</span>
        </h1>
        <div className="mt-8 grid items-start gap-10 lg:mt-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-14">
          <div>
            <p className="max-w-[34rem] text-lg leading-relaxed text-pretty text-slate-600">
              {PRODUCT.name} is an open-source process manager where the model is the system. The map you draw is what runs, what’s simulated and what’s monitored, so you see every bottleneck as it
              forms and test a fix before you make it.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <PrimaryAction onClick={() => enterApp('studio', { view: 'workflow' })}>Open the Studio</PrimaryAction>
              <SecondaryAction onClick={() => enterApp('workspace')}>
                <Inbox size={16} className="text-slate-500" />
                Try the Workspace
              </SecondaryAction>
            </div>
            <RepoLink className="mt-6 text-[15px]" />
            <PrototypeNote className="mt-9 hidden lg:block" />
          </div>
          <div className="lg:-mr-6">
            <HeroMap />
            <PrototypeNote className="mt-12 lg:hidden" />
          </div>
        </div>
      </div>
    </section>
  )
}

// ---------- Sample organizations ----------

interface Sample {
  appId: Id
  name: string
  tint: string
  icon: LucideIcon
  story: string
  shows: string[]
  person: { id: Id; name: string; role: string }
  sketch: (tint: string) => ReactNode
}

const SAMPLES: Sample[] = [
  {
    appId: 'app_invoice',
    name: 'Invoice Processing',
    tint: '#4f46e5',
    icon: Receipt,
    story: 'Fourteen invoices an hour: ERP matching, routing by amount, approvals, payment. Jump ahead a working day and watch the controller fall behind.',
    shows: ['Line items with calculated totals', 'Routing by amount, with a fast lane', 'An exception subflow', 'Pay and file in parallel'],
    person: { id: 'u_maya', name: 'Maya Patel', role: 'AP clerk' },
    sketch: (t) => <InvoiceSketch tint={t} />,
  },
  {
    appId: 'app_fleet',
    name: 'Fleet Vehicle Requests',
    tint: '#0891b2',
    icon: Car,
    story: 'Departments ask for vehicles; dispatchers hand out the reviews. Buying one asks three dealers for quotes at once and moves on when two reply.',
    shows: ['Cascading lists: year, make, model', 'Dispatchers handing out work', 'Two-of-three join', 'A purchase subflow'],
    person: { id: 'u_dana', name: 'Dana Whitaker', role: 'fleet manager' },
    sketch: (t) => <FleetSketch tint={t} />,
  },
  {
    appId: 'app_soc',
    name: 'Video Security Operations',
    tint: '#0d9488',
    icon: Camera,
    story: 'Not a business process at all: 120 camera events an hour, screened by AI on a GPU pool, checked four ways at once, and routed to the officer who should look.',
    shows: ['A GPU worker pool that becomes the bottleneck', 'A watchlist check over MCP', 'Escalation to watch commanders', 'Fields hidden from officers'],
    person: { id: 'u_elena', name: 'Elena Vasquez', role: 'watch commander' },
    sketch: (t) => <SecuritySketch tint={t} />,
  },
]

function Samples() {
  return (
    <section id="samples" className="scroll-mt-16 bg-white py-20 sm:py-28">
      <div className={container}>
        <div className="max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-[-0.02em] text-balance text-slate-950 sm:text-[40px] sm:leading-[1.1]">Walk into an organization that’s already working</h2>
          <p className="mt-4 text-lg leading-relaxed text-slate-600">
            Each sample is a complete application with people, rules and systems in motion. Open it in the Studio to see the whole picture, or step into the Workspace as one of the people in it.
          </p>
        </div>
        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {SAMPLES.map((s) => (
            <article key={s.appId} className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-5 pt-5 pb-4" style={{ background: `linear-gradient(180deg, ${s.tint}0f, transparent)` }}>
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg text-white" style={{ background: s.tint }}>
                    <s.icon size={16} />
                  </span>
                  <h3 className="text-[17px] font-semibold tracking-tight text-slate-950">{s.name}</h3>
                </div>
                <div className="mt-5 mb-1">{s.sketch(s.tint)}</div>
              </div>
              <div className="flex flex-1 flex-col px-5 pt-4 pb-5">
                <p className="text-[15px] leading-relaxed text-slate-700">{s.story}</p>
                <ul className="mt-4 space-y-1.5 text-sm text-slate-600">
                  {s.shows.map((x) => (
                    <li key={x} className="flex gap-2.5">
                      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: s.tint }} />
                      {x}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto flex flex-col gap-2 pt-6">
                  <button
                    type="button"
                    onClick={() => enterApp('studio', { appId: s.appId, view: 'workflow' })}
                    className="inline-flex h-10 items-center justify-between rounded-lg px-4 text-sm font-semibold text-white transition-[filter] hover:brightness-110"
                    style={{ background: s.tint }}
                  >
                    Open in the Studio
                    <ArrowRight size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => enterApp('workspace', { appId: s.appId, actingAs: s.person.id })}
                    className="inline-flex min-h-10 items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-2 text-left text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                  >
                    <span className="leading-snug">
                      <span className="block">
                        Work as <span className="font-semibold text-slate-900">{s.person.name}</span>
                      </span>
                      <span className="block text-xs text-slate-500">in the Workspace, as the {s.person.role}</span>
                    </span>
                    <ArrowRight size={15} className="text-slate-400" />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

// ---------- Roles ----------

function StudioFragment() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-[12px] shadow-sm">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-slate-900">Controller approval</span>
        <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10.5px] font-semibold text-rose-700">Bottleneck · 14</span>
      </div>
      <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-slate-600">
        <dt className="text-slate-400">Handed out</dt>
        <dd>Load balanced across Finance Leadership</dd>
        <dt className="text-slate-400">Supervisors</dt>
        <dd>Carla Mendes</dd>
        <dt className="text-slate-400">Escalate</dt>
        <dd>after 16 hours, raise priority</dd>
      </dl>
      <div className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-amber-800">
        <FlaskConical size={13} />
        What-if: add two approvers, compare both futures
      </div>
    </div>
  )
}

function WorkspaceFragment() {
  const rows: Array<[string, string, string, string]> = [
    ['Expedited', 'bg-orange-500 text-white', 'INV-1006', 'Harbor Freight Partners'],
    ['Urgent', 'bg-rose-50 text-rose-700', 'INV-1081', 'Initech Software'],
    ['High', 'bg-amber-50 text-amber-700', 'INV-1104', 'Contoso Facilities'],
  ]
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-[12px] shadow-sm">
      <div className="font-semibold text-slate-900">My work</div>
      <ul className="mt-2 divide-y divide-slate-100">
        {rows.map(([badge, tone, num, title]) => (
          <li key={num} className="flex items-center gap-2 py-1.5">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${tone}`}>{badge}</span>
            <span className="font-mono text-[11px] text-brand-700">{num}</span>
            <span className="truncate text-slate-700">{title}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2.5 flex justify-end">
        <span className="rounded-2xl rounded-br-md bg-brand-600 px-3 py-1.5 text-white">what should I work on next?</span>
      </div>
    </div>
  )
}

function BuildFragment() {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5 font-mono text-[12px] leading-relaxed text-slate-300 shadow-sm">
      <div>
        <span className="text-slate-500">$</span> git clone {PRODUCT.repo.replace('https://', '')}
      </div>
      <div>
        <span className="text-slate-500">$</span> docker compose up
      </div>
      <div className="flex items-center gap-1.5 text-emerald-400">
        <Check size={13} strokeWidth={2.5} />
        API and studio on http://localhost:8787
      </div>
    </div>
  )
}

interface Role {
  title: string
  points: string[]
  fragment: ReactNode
  action: ReactNode
}

const ROLES: Role[] = [
  {
    title: 'Process owners change how the work gets done',
    points: [
      'Draw forms, rules and workflows; edit them while work is in flight',
      'Live counts on every step, the bottleneck tagged, workload per person',
      'Test a change in the what-if lab before you make it',
      'Field security, roles and supervisors, all in one place',
    ],
    fragment: <StudioFragment />,
    action: <PrimaryAction onClick={() => enterApp('studio', { view: 'workflow' })}>Open the Studio</PrimaryAction>,
  },
  {
    title: 'Clerks, approvers and officers do the work',
    points: [
      'A basket ordered by priority and due date, with queues and a dispatch board',
      'Search across everything you’re allowed to see',
      'Ask Modus questions in plain words',
      'Expedite what can’t wait; supervisors see and rebalance it all',
    ],
    fragment: <WorkspaceFragment />,
    action: <SecondaryAction onClick={() => enterApp('workspace')}>Open the Workspace</SecondaryAction>,
  },
  {
    title: 'Engineers build it and run it',
    points: [
      'One deterministic TypeScript engine in the browser and on the server',
      'REST API, worker job protocol, MCP and AI agents as automated steps',
      'One container image, Docker Compose and a Helm chart',
      'Architecture, stack and deployment written down in the repository',
    ],
    fragment: <BuildFragment />,
    action: (
      <a
        href={PRODUCT.repo}
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 text-[15px] font-semibold text-slate-800 transition-colors hover:border-slate-400 hover:bg-slate-50"
      >
        <GitHubMark size={17} />
        Read the code
      </a>
    ),
  },
]

function Roles() {
  return (
    <section id="roles" className="scroll-mt-16 border-y border-slate-200 bg-canvas py-20 sm:py-28">
      <div className={container}>
        <h2 className="max-w-2xl text-3xl font-semibold tracking-[-0.02em] text-balance text-slate-950 sm:text-[40px] sm:leading-[1.1]">Come in by what you do</h2>
        <div className="mt-12 divide-y divide-slate-200 border-y border-slate-200">
          {ROLES.map((r) => (
            <div key={r.title} className="grid gap-8 py-10 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
              <div>
                <h3 className="text-2xl font-semibold tracking-[-0.015em] text-balance text-slate-950">{r.title}</h3>
                <ul className="mt-5 space-y-2.5 text-[15px] leading-relaxed text-slate-700">
                  {r.points.map((p) => (
                    <li key={p} className="flex gap-3">
                      <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                      {p}
                    </li>
                  ))}
                </ul>
                <div className="mt-7">{r.action}</div>
              </div>
              <div className="self-center">{r.fragment}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ---------- One model ----------

function Model() {
  const outs: Array<[string, string, string]> = [
    ['Simulate', 'In your browser, with simulated people, arrivals and systems, live on the map.', 'Working now'],
    ['What-if', 'The live state run forward twice, as is and with your change, on the same random numbers.', 'Working now'],
    ['Run live', 'On the server, with real people in the Workspace and real systems behind automated steps.', 'Server in progress'],
  ]
  return (
    <section id="model" className="scroll-mt-16 bg-white py-20 sm:py-28">
      <div className={`${container} grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16`}>
        <div>
          <h2 className="text-3xl font-semibold tracking-[-0.02em] text-balance text-slate-950 sm:text-[40px] sm:leading-[1.1]">One model. Three ways to run it.</h2>
          <p className="mt-5 text-lg leading-relaxed text-slate-600">
            Most workflow tools keep the drawing, the running process and the dashboard in different places, and they drift apart. In {PRODUCT.name} they are one design and one engine, so a forecast
            uses production rules and a change is just an edit.
          </p>
          <p className="mt-4 text-[15px] leading-relaxed text-slate-500">
            Edit the map as a draft, then publish it: for new items only, or move the work in flight onto it now. Every version is kept, and you can see which items run on which.
          </p>
        </div>
        <div className="relative">
          <div className="rounded-2xl border border-brand-200 bg-brand-50 px-5 py-4">
            <div className="text-[15px] font-semibold text-brand-700">Your design</div>
            <div className="mt-1 text-sm text-brand-700/80">Applications · forms and line items · lists · workflows · people and groups · services · templates</div>
          </div>
          <div className="ml-8 border-l-2 border-dashed border-brand-200 pt-2 pb-1 pl-6">
            {outs.map(([title, text, status]) => (
              <div key={title} className="relative mt-4 rounded-xl border border-slate-200 bg-white px-5 py-4">
                <span className="absolute top-1/2 -left-[26px] h-0.5 w-6 bg-brand-200" />
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-[15px] font-semibold text-slate-950">{title}</span>
                  <span className={status === 'Working now' ? 'text-xs font-medium text-emerald-700' : 'text-xs font-medium text-amber-700'}>{status}</span>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

// ---------- Open source ----------

function OpenSource() {
  const today: ReactNode[] = [
    'The whole product under Apache-2.0: use it, change it, ship it. No core with the useful parts held back.',
    'One container image serving the API and the studio, with Docker Compose for a laptop or a single server and a Helm chart for Kubernetes.',
    'A REST API, a worker job protocol, and automated steps that call REST services, MCP servers and AI agents.',
    'Ask Modus answers offline; set an Anthropic key on the server and Claude answers too, with the same permissions as the person asking.',
  ]
  const planned: ReactNode[] = [
    'PostgreSQL storage, then SQL Server and Oracle behind the same storage ports. Storage is in memory today.',
    'Sign-in with OIDC and SAML, and group sync, for Entra ID, Okta, Login.gov or Keycloak.',
    'Hosted SaaS with tenants kept apart, and dedicated deployments for organizations that need them.',
    'An air-gapped bundle with signed images and a software bill of materials.',
  ]
  const list = (title: string, items: ReactNode[], tone: string) => (
    <div>
      <h3 className="flex items-center gap-2 text-[15px] font-semibold text-white">
        <span className={`h-2 w-2 rounded-full ${tone}`} />
        {title}
      </h3>
      <ul className="mt-4 space-y-3.5 border-t border-slate-800 pt-4">
        {items.map((x, i) => (
          <li key={i} className="text-[15px] leading-relaxed text-slate-400">
            {x}
          </li>
        ))}
      </ul>
    </div>
  )
  return (
    <section id="open-source" className="scroll-mt-16 bg-slate-950 py-20 text-slate-300 sm:py-28">
      <div className={`${container} grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16`}>
        <div>
          <h2 className="text-3xl font-semibold tracking-[-0.02em] text-balance text-white sm:text-[40px] sm:leading-[1.1]">Open source, built to run where you need it</h2>
          <p className="mt-5 text-lg leading-relaxed text-slate-400">The code, the architecture and the plan to production are public. Read them, run them, and tell us what you need.</p>
          <a
            href={PRODUCT.repo}
            target="_blank"
            rel="noreferrer"
            className="mt-8 inline-flex h-11 items-center gap-2.5 rounded-lg bg-white px-5 text-[15px] font-semibold text-slate-950 transition-colors hover:bg-slate-200"
          >
            <GitHubMark size={18} />
            empowerment-ai/modus
            <ArrowUpRight size={15} className="text-slate-500" />
          </a>
          <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {(
              [
                ['Architecture', DOCS.architecture],
                ['Technology stack', DOCS.stack],
                ['Deployment', DOCS.deployment],
                ['Roadmap', DOCS.roadmap],
              ] as const
            ).map(([label, href]) => (
              <a key={label} href={href} target="_blank" rel="noreferrer" className="text-slate-400 underline decoration-slate-700 underline-offset-4 hover:text-white hover:decoration-slate-400">
                {label}
              </a>
            ))}
          </div>
        </div>
        <div className="grid gap-10 sm:grid-cols-2">
          {list('Works today', today, 'bg-emerald-400')}
          {list('Planned', planned, 'bg-amber-400')}
        </div>
      </div>
    </section>
  )
}

// ---------- Close ----------

function Footer() {
  return (
    <footer className="bg-white">
      <div className={`${container} py-14`}>
        <div className="grid gap-10 lg:grid-cols-[1.3fr_1fr] lg:items-end">
          <div>
            <h2 className="text-2xl font-semibold tracking-[-0.015em] text-slate-950">See it for yourself</h2>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-slate-600">
              Press <span className="font-semibold text-slate-800">Run simulation</span>, jump ahead a working day, and watch where the work piles up. Then fix it.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <PrimaryAction onClick={() => enterApp('studio', { view: 'workflow' })}>Open the Studio</PrimaryAction>
              <a href={DOCS.demo} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-slate-700 hover:text-slate-950">
                Follow the 25-minute demo script
                <ArrowUpRight size={14} className="text-slate-400" />
              </a>
            </div>
          </div>
          <p className="text-sm leading-relaxed text-slate-500 lg:text-right">
            About this prototype: everything runs in your browser against a simulated organization, and your changes are saved in this browser only. The product adds sign-in, a server and a database;
            see the{' '}
            <a href={DOCS.roadmap} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-slate-800">
              roadmap
            </a>
            .
          </p>
        </div>
        <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 pt-6 text-sm text-slate-500">
          <span>
            {PRODUCT.name} · an{' '}
            <a href="https://github.com/empowerment-ai" target="_blank" rel="noreferrer" className="font-medium text-slate-700 hover:text-slate-950">
              Empowerment AI
            </a>{' '}
            open-source project ·{' '}
            <a href={DOCS.license} target="_blank" rel="noreferrer" className="hover:text-slate-800">
              Apache License 2.0
            </a>
          </span>
          <RepoLink />
        </div>
      </div>
    </footer>
  )
}

/** The front page of the browser prototype: what Modus is, and doors into it. */
export function LandingPage() {
  return (
    <div className="h-full overflow-y-auto bg-white" id="top">
      <Header />
      <main>
        <Hero />
        <Samples />
        <Roles />
        <Model />
        <OpenSource />
      </main>
      <Footer />
    </div>
  )
}
