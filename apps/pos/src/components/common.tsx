import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, Inbox, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useApp } from '@/lib/app-context'
import { cn } from '@/lib/utils'

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function Loading({ label = 'กำลังโหลด…', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground', className)}>
      <Loader2 className="size-4 animate-spin" /> {label}
    </div>
  )
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm sm:flex-row sm:items-center">
      <AlertTriangle className="size-5 shrink-0 text-destructive" />
      <p className="flex-1">{message}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" className="cursor-pointer" onClick={onRetry}>
          <RefreshCw /> ลองใหม่
        </Button>
      ) : null}
    </div>
  )
}

export function Empty({ title, hint, icon }: { title: string; hint?: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-10 text-center">
      <div className="text-muted-foreground">{icon ?? <Inbox className="size-8" />}</div>
      <p className="font-medium">{title}</p>
      {hint ? <p className="max-w-sm text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function Field({ label, htmlFor, children, hint, className }: { label: string; htmlFor?: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <div className={cn('grid gap-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/**
 * Numeric text input that keeps what the user types ("1,2" mid-edit) and reports a number.
 * Uses inputMode=decimal so phones/tablets open the number pad.
 */
export function NumberInput({
  value,
  onChange,
  className,
  id,
  placeholder,
  disabled,
  autoFocus,
  onEnter,
}: {
  value: number | null
  onChange: (v: number | null) => void
  className?: string
  id?: string
  placeholder?: string
  disabled?: boolean
  autoFocus?: boolean
  onEnter?: () => void
}) {
  const [text, setText] = useState(value === null || Number.isNaN(value) ? '' : String(value))
  useEffect(() => {
    const current = Number(text.replace(/,/g, ''))
    if (value === null && text !== '') setText('')
    else if (value !== null && current !== value) setText(String(value))
    // Only react to outside changes of `value`, not to every keystroke.
  }, [value])
  return (
    <Input
      id={id}
      inputMode="decimal"
      autoComplete="off"
      className={cn('tabular text-right', className)}
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onEnter) {
          e.preventDefault()
          onEnter()
        }
      }}
      onChange={(e) => {
        const t = e.target.value
        if (!/^[0-9.,]*$/.test(t)) return
        setText(t)
        const cleaned = t.replace(/,/g, '')
        if (cleaned === '') onChange(null)
        else if (!Number.isNaN(Number(cleaned))) onChange(Number(cleaned))
      }}
    />
  )
}

export function LocationSelect({
  value,
  onChange,
  placeholder = 'เลือกสาขา/โซน',
  exclude,
  className,
}: {
  value: string
  onChange: (id: string) => void
  placeholder?: string
  exclude?: string
  className?: string
}) {
  const { activeLocations } = useApp()
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger className={cn('w-full cursor-pointer', className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {activeLocations
          .filter((l) => l.id !== exclude)
          .map((l) => (
            <SelectItem key={l.id} value={l.id} className="cursor-pointer">
              {l.name} <span className="text-muted-foreground">({l.kind === 'warehouse' ? 'โกดัง' : 'หน้าร้าน'})</span>
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  )
}

export function Stat({ label, value, tone, sub }: { label: string; value: ReactNode; tone?: 'good' | 'bad' | 'warn'; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-3 sm:p-4">
      <p className="text-xs text-muted-foreground sm:text-sm">{label}</p>
      <p
        className={cn(
          'tabular mt-1 text-lg font-semibold sm:text-2xl',
          tone === 'good' && 'text-primary',
          tone === 'bad' && 'text-destructive',
          tone === 'warn' && 'text-amber-700 dark:text-amber-400',
        )}
      >
        {value}
      </p>
      {sub ? <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  )
}

/** Horizontal scroll wrapper so wide tables never push the page sideways on phones. */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto rounded-lg border bg-card">{children}</div>
}
