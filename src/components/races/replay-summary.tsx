"use client"

import Link from "next/link"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { StatusIndicator } from "@/components/status-indicator"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api/client"
import { errorMessage } from "@/lib/api/error-message"
import { replayStatusStyle } from "@/lib/domain-styles"
import { useReplay } from "@/lib/query/hooks"

export function ReplaySummary({ replayId }: { replayId: string }) {
  const q = useReplay(replayId)
  if (q.isPending) return <div role="status" aria-busy="true" aria-label="Loading replay"><Skeleton className="h-24" /></div>
  if (q.isError) {
    if (q.error instanceof ApiError && q.error.status === 404) return <EmptyState title="Replay not found" description="This replay does not exist."><Link href="/races" className="text-sm text-primary hover:underline">Browse races</Link></EmptyState>
    return <ErrorState title="Could not load replay" message={errorMessage(q.error)} onRetry={() => q.refetch()} />
  }
  const r = q.data
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <StatusIndicator treatment={replayStatusStyle(r.status)} />
        <span className="tabular text-sm text-muted-foreground">{r.id}</span>
      </div>
      <p className="text-sm">Race <Link className="text-primary hover:underline" href={`/races/${r.race_id}`}>{r.race_id}</Link> · Session <span className="tabular">{r.session_id}</span> · Speed {r.playback_speed}x</p>
      <EmptyState title="Live visualisation is not available yet" description="Playback controls and live timing will appear here in a later update." />
    </div>
  )
}
