import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { ReplayDashboard } from "@/components/replay/replay-dashboard"
import { isUuid } from "@/lib/uuid"

export const metadata: Metadata = { title: "Replay" }

export default async function ReplayPage({ params }: { params: Promise<{ replayId: string }> }) {
  const { replayId } = await params
  if (!isUuid(replayId)) notFound()
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Replay</h1>
      <ReplayDashboard replayId={replayId} />
    </section>
  )
}
