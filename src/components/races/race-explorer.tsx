"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { errorMessage } from "@/lib/api/error-message"
import type { RaceSummary } from "@/lib/api/types"
import { useRaces, useSeasons } from "@/lib/query/hooks"

const fmtDate = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "UTC" }) : "—")
const matches = (r: RaceSummary, q: string) =>
  [r.name, r.official_name, r.country, r.location].some((v) => v?.toLowerCase().includes(q))

function Loading({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((i) => <Skeleton key={i} className="h-36" />)}
    </div>
  )
}

export function RaceExplorer() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const seasons = useSeasons()
  const [q, setQ] = useState(params.get("q") ?? "")

  const requested = params.get("season")
  const available = (seasons.data ?? []).map((s) => s.season).sort((a, b) => b - a)
  const season = requested && available.includes(Number(requested)) ? Number(requested) : available[0]
  const unknownSeason = !!requested && seasons.isSuccess && season !== Number(requested)
  const races = useRaces({ season }, season !== undefined)

  const setParam = (key: string, value: string, push: boolean) => {
    const next = new URLSearchParams(params.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    const url = `${pathname}${next.size ? `?${next}` : ""}`
    if (push) router.push(url)
    else router.replace(url)
  }

  const query = q.trim().toLowerCase()
  const visible = (races.data ?? []).filter((r) => !query || matches(r, query)).sort((a, b) => a.round - b.round)
  const detailQs = season !== undefined ? `?season=${season}` : ""

  let body
  if (seasons.isError) body = <ErrorState title="Could not load seasons" message={errorMessage(seasons.error)} onRetry={() => seasons.refetch()} />
  else if (seasons.isPending) body = <Loading label="Loading seasons" />
  else if (available.length === 0) body = <EmptyState title="No imported races" description="The backend has no imported races yet. Only races already imported into the backend can be replayed." />
  else if (races.isError) body = <ErrorState title="Could not load races" message={errorMessage(races.error)} onRetry={() => races.refetch()} />
  else if (races.isPending) body = <Loading label={`Loading ${season} races`} />
  else if (races.data.length === 0) body = <EmptyState title={`No imported races for ${season}`} description="Choose another season." />
  else if (visible.length === 0) body = <EmptyState title="No races match your search" description="Try a different name, country or location." />
  else
    body = (
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((r) => (
          <li key={r.id}>
            <Link href={`/races/${r.id}${detailQs}`} className="block h-full rounded-lg border bg-panel p-4 transition-colors hover:border-primary/60 focus-visible:outline-2 focus-visible:outline-ring">
              <p className="tabular text-xs text-muted-foreground">Round {r.round}</p>
              <h2 className="mt-1 text-lg font-semibold">{r.name}</h2>
              <p className="text-sm text-muted-foreground">{[r.location, r.country].filter(Boolean).join(", ") || "—"}</p>
              <p className="tabular mt-1 text-sm">{fmtDate(r.event_date)}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {r.sessions.length === 0 ? <span className="text-xs text-muted-foreground">No sessions</span> : r.sessions.map((s) => <Badge key={s.id} variant="outline">{s.name}</Badge>)}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    )

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Races</h1>
        <p className="text-sm text-muted-foreground">Historical races imported into the backend. Pick one to create a replay.</p>
      </header>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="space-y-1">
          <label htmlFor="season" className="text-sm font-medium">Season</label>
          <select
            id="season"
            value={season ?? ""}
            disabled={available.length === 0}
            onChange={(e) => setParam("season", e.target.value, true)}
            className="block h-9 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring sm:w-40"
          >
            {available.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="space-y-1 sm:flex-1 sm:max-w-sm">
          <label htmlFor="race-search" className="text-sm font-medium">Search races</label>
          <input
            id="race-search"
            type="search"
            value={q}
            placeholder="Name, country or location"
            onChange={(e) => { setQ(e.target.value); setParam("q", e.target.value, false) }}
            className="block h-9 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
          />
        </div>
      </div>
      {unknownSeason && <p role="status" className="text-sm text-warning">Season {requested} is not available; showing {season}.</p>}
      {body}
    </section>
  )
}
