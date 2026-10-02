import { type InputHTMLAttributes, useEffect, useState } from 'react'
import { Input } from '../../components/ui'

const show = (v?: number) => (v === undefined ? '' : String(v))

/**
 * Free typing, committed on blur or Enter. Empty commits `undefined`; `normalize`
 * can clamp or round (return undefined to clear).
 */
export function NumberInput({
  value,
  onCommit,
  normalize,
  ...rest
}: { value?: number; onCommit: (v: number | undefined) => void; normalize?: (v: number) => number | undefined } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(show(value))
  useEffect(() => setText(show(value)), [value])
  const commit = () => {
    const raw = text.trim()
    const parsed = raw === '' ? undefined : Number(raw)
    if (parsed !== undefined && Number.isNaN(parsed)) return setText(show(value))
    const next = parsed === undefined || !normalize ? parsed : normalize(parsed)
    setText(show(next))
    if (next !== value) onCommit(next)
  }
  return (
    <Input
      inputMode="decimal"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
      {...rest}
    />
  )
}
