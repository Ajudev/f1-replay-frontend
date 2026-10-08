import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function HomePage() {
  return (
    <section className="flex flex-col items-start gap-4">
      <h1 className="text-3xl font-bold tracking-tight">F1 Historical Race Replay</h1>
      <p className="max-w-prose text-muted-foreground">
        Relive completed Formula 1 races as though they are live, with timing, race state and detected events driven by the replay backend.
      </p>
      <Button asChild>
        <Link href="/races">Browse races</Link>
      </Button>
    </section>
  )
}
