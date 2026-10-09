import { compoundStyle } from "@/lib/domain-styles"
import { cn } from "@/lib/utils"

export function Tyre({ compound, age }: { compound: string | null | undefined; age: number | null | undefined }) {
  const c = compoundStyle(compound)
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-flex size-5 items-center justify-center rounded-full border text-xs font-bold", c.className)} aria-hidden>{c.short}</span>
      <span>{compound ? c.label : "—"}</span>
      {age != null && <span className="tabular text-muted-foreground">·{age}L</span>}
    </span>
  )
}
