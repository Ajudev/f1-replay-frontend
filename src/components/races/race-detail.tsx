"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useRef, useState } from "react"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ApiError } from "@/lib/api/client"
import { errorMessage } from "@/lib/api/error-message"
import { useCreateReplay, useRace, useRaceDrivers } from "@/lib/query/hooks"

// Mirrors backend SUPPORTED_SESSION_TYPES (timeline builder); anything else is shown as unavailable.
const REPLAYABLE = new Set(["RACE", "SPRINT"])
const dash = (v: string | number | null | undefined) => v ?? "—"

export function RaceDetail({ raceId }: { raceId: string }) {
  const router = useRouter()
  const season = useSearchParams().get("season")
  const race = useRace(raceId)
  const [picked, setPicked] = useState<string | null>(null)
  const create = useCreateReplay()
  const inFlight = useRef(false) // blocks repeat clicks until failure; success navigates away

  const sessions = race.data?.sessions ?? []
  const replayable = sessions.filter((s) => REPLAYABLE.has(s.session_type))
  const sessionId = picked ?? (replayable.length === 1 ? replayable[0].id : null)
  const selected = sessions.find((s) => s.id === sessionId)
  const drivers = useRaceDrivers(raceId, selected?.session_type ?? sessions[0]?.session_type)
  const back = <Link href={season && /^\d+$/.test(season) ? `/races?season=${season}` : "/races"} className="text-sm text-primary hover:underline">← Back to races</Link>

  if (race.isPending) return <div role="status" aria-busy="true" aria-label="Loading race"><Skeleton className="h-64" /></div>
  if (race.isError) {
    const missing = race.error instanceof ApiError && race.error.status === 404
    return (
      <div className="space-y-4">
        {back}
        {missing ? <EmptyState title="Race not found" description="This race is not imported into the backend." /> : <ErrorState title="Could not load race" message={errorMessage(race.error)} onRetry={() => race.refetch()} />}
      </div>
    )
  }

  const r = race.data
  const submit = () => {
    if (!sessionId || inFlight.current) return
    inFlight.current = true
    create.mutate(
      { session_id: sessionId, playback_speed: 1 },
      { onSuccess: (replay) => router.push(`/replays/${replay.id}`), onError: () => { inFlight.current = false } },
    )
  }

  return (
    <section className="space-y-6">
      {back}
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">{r.name}</h1>
        {r.official_name && <p className="text-sm text-muted-foreground">{r.official_name}</p>}
        <p className="tabular text-sm">{r.season} · Round {r.round} · {[r.location, r.country].filter(Boolean).join(", ") || "—"} · {dash(r.event_date)}</p>
      </header>

      <fieldset className="space-y-2" disabled={create.isPending}>
        <legend className="text-sm font-medium">Session</legend>
        {sessions.length === 0 && <p className="text-sm text-muted-foreground">No sessions imported for this race.</p>}
        {sessions.map((s) => {
          const ok = REPLAYABLE.has(s.session_type)
          return (
            <label key={s.id} className={`flex items-center gap-2 text-sm ${ok ? "" : "text-muted-foreground"}`}>
              <input type="radio" name="session" value={s.id} disabled={!ok} checked={sessionId === s.id} onChange={() => setPicked(s.id)} />
              {s.name}
              {!ok && <span className="text-xs">(replay not available for this session type)</span>}
            </label>
          )
        })}
      </fieldset>

      <div className="space-y-2">
        <Button onClick={submit} disabled={!sessionId || create.isPending}>{create.isPending ? "Creating replay…" : "Create Replay"}</Button>
        {create.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(create.error)}</p>}
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Drivers{drivers.data ? ` (${drivers.data.length})` : ""}</h2>
        {drivers.isPending ? <div role="status" aria-busy="true" aria-label="Loading drivers"><Skeleton className="h-40" /></div>
          : drivers.isError ? <ErrorState title="Could not load drivers" message={errorMessage(drivers.error)} onRetry={() => drivers.refetch()} />
          : drivers.data.length === 0 ? <p className="text-sm text-muted-foreground">No drivers imported.</p>
          : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader><TableRow><TableHead>No.</TableHead><TableHead>Code</TableHead><TableHead>Driver</TableHead><TableHead>Team</TableHead></TableRow></TableHeader>
                <TableBody>
                  {drivers.data.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="tabular">{dash(d.driver_number)}</TableCell>
                      <TableCell>{d.abbreviation}</TableCell>
                      <TableCell>{d.full_name}</TableCell>
                      <TableCell>{dash(d.team_name)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
      </div>
    </section>
  )
}
