import { cn } from "@/lib/utils"
import type { Treatment } from "@/lib/domain-styles"

/** Icon + text label so color is never the only signal. */
export function StatusIndicator({ treatment, className }: { treatment: Treatment; className?: string }) {
  const Icon = treatment.icon
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium", treatment.className, className)}>
      <Icon aria-hidden className="size-3.5" />
      {treatment.label}
    </span>
  )
}
