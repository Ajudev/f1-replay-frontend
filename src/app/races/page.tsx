import type { Metadata } from "next"
import { EmptyState } from "@/components/empty-state"

export const metadata: Metadata = { title: "Races" }

export default function RacesPage() {
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Races</h1>
      <EmptyState title="Race browsing is not available yet" description="Season and race selection will appear here once it is connected to the backend." />
    </section>
  )
}
