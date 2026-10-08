import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { EmptyState } from "@/components/empty-state"
import { isUuid } from "@/lib/uuid"

export const metadata: Metadata = { title: "Replay" }

export default async function ReplayPage({ params }: { params: Promise<{ replayId: string }> }) {
  const { replayId } = await params
  if (!isUuid(replayId)) notFound()
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Replay</h1>
      <p className="tabular text-sm text-muted-foreground">{replayId}</p>
      <EmptyState title="Replay dashboard is not available yet" description="Live timing and controls will appear here once they are connected to the backend." />
    </section>
  )
}
