import type { Metadata } from "next"
import { Suspense } from "react"
import { RaceExplorer } from "@/components/races/race-explorer"

export const metadata: Metadata = { title: "Races" }

export default function RacesPage() {
  return (
    <Suspense fallback={<div role="status" aria-busy="true" aria-label="Loading races" className="h-40" />}>
      <RaceExplorer />
    </Suspense>
  )
}
