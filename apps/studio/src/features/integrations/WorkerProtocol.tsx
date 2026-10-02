import { Terminal } from 'lucide-react'
import { Badge } from '../../components/ui'

/** The long-poll worker protocol, shown so developers can see how a custom service plugs in. */
export function WorkerProtocol({ topic = 'documents.extract', jobType = 'extract-invoice' }: { topic?: string; jobType?: string }) {
  const t = topic.replace(/^topic:\s*/i, '')
  const code = `# 1. Ask for work. The call waits (up to 30 s) until a job arrives.
POST /api/jobs/poll
{ "topic": "${t}", "workerId": "worker-07" }

→ 200 { "id": "job_8f2c", "type": "${jobType}", "inputs": { … } }
→ 204 (no job yet: poll again)

# 2. Report back when done …
POST /api/jobs/job_8f2c/complete
{ "outputs": { "confidence": 94 } }

# … or when it could not be done (the step's retry and failure rules apply).
POST /api/jobs/job_8f2c/fail
{ "error": "Scan unreadable" }`
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/70">
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
        <Terminal size={14} className="text-slate-500" />
        <span className="text-xs font-semibold text-slate-800">How a worker registers</span>
        <Badge tone="amber">Planned API</Badge>
      </div>
      <div className="space-y-2 px-3 py-2.5">
        <p className="text-[11.5px] leading-snug text-slate-600">
          A worker is any program that can make HTTP calls. It asks for a job on the topic, does the work, and reports the result. Run more workers to raise throughput, up to the pool size set here.
        </p>
        <pre className="overflow-x-auto rounded-md bg-slate-900 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-slate-100">{code}</pre>
      </div>
    </div>
  )
}
