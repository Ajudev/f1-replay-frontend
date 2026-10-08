import { CircleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"

export function ErrorState({ title = "Something went wrong", message, onRetry }: { title?: string; message?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-6 py-12 text-center">
      <CircleAlert aria-hidden className="size-6 text-destructive" />
      <h2 className="text-lg font-semibold">{title}</h2>
      {message && <p className="max-w-prose text-sm text-muted-foreground">{message}</p>}
      {onRetry && <Button variant="outline" onClick={onRetry}>Try again</Button>}
    </div>
  )
}
