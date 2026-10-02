import type { InputHTMLAttributes } from 'react'
import { cx } from '../../components/ui'

/** Borderless input that looks like text until hovered or focused; used for in-place renames. */
export function InlineInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        'h-7 w-full min-w-0 rounded-md border border-transparent bg-transparent px-1.5 text-sm text-slate-800 placeholder:text-slate-400 hover:border-slate-200 focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-500/20 focus:outline-none',
        className,
      )}
      {...rest}
    />
  )
}
