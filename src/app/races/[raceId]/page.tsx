import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { Suspense } from "react"
import { RaceDetail } from "@/components/races/race-detail"
import { isUuid } from "@/lib/uuid"

export const metadata: Metadata = { title: "Race" }

export default async function RaceDetailPage({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params
  if (!isUuid(raceId)) notFound()
  return (
    <Suspense fallback={null}>
      <RaceDetail raceId={raceId} />
    </Suspense>
  )
}
