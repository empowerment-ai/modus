import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'
import { useUi } from '../store/ui'
import { cx } from './ui'

export function Toaster() {
  const toasts = useUi((s) => s.toasts)
  const dismiss = useUi((s) => s.dismiss)
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-80 flex-col gap-2" aria-live="polite">
      {toasts.map((t) => {
        const Icon = t.tone === 'success' ? CheckCircle2 : t.tone === 'warn' ? TriangleAlert : Info
        return (
          <div key={t.id} className="animate-slide-in pointer-events-auto flex items-start gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-lg">
            <Icon size={16} className={cx('mt-0.5 shrink-0', t.tone === 'success' ? 'text-emerald-600' : t.tone === 'warn' ? 'text-amber-600' : 'text-brand-600')} />
            <span className="flex-1 text-slate-700">
              {t.text}
              {t.action && (
                <button
                  type="button"
                  onClick={() => {
                    dismiss(t.id)
                    t.action!.run()
                  }}
                  className="mt-1.5 block font-semibold text-brand-700 hover:text-brand-800"
                >
                  {t.action.label}
                </button>
              )}
            </span>
            <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="text-slate-400 hover:text-slate-700">
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
