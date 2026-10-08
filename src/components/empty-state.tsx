import type { ReactNode } from "react"

export function EmptyState({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed bg-panel px-6 py-12 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && <p className="max-w-prose text-sm text-muted-foreground">{description}</p>}
      {children}
    </div>
  )
}
