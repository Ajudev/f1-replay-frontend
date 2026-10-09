"use client"

import { memo } from "react"
import { EmptyState } from "@/components/empty-state"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { DriverState } from "@/lib/api/types"
import { positionChangeStyle } from "@/lib/domain-styles"
import { liveStore, useLiveStore } from "@/lib/replay/live-store"
import { formatDelta, formatGap, formatLapTime } from "@/lib/replay/timing-format"
import { cn } from "@/lib/utils"
import { DriverDetails } from "./driver-details"
import { RaceStatusBar } from "./race-status-bar"
import { Tyre } from "./tyre"

export function LiveTiming() {
  return (
    <div className="space-y-4">
      <RaceStatusBar />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <TimingTower />
        <DriverDetails />
      </div>
    </div>
  )
}

function TimingTower() {
  const drivers = useLiveStore((s) => s.state?.drivers)
  const hasState = useLiveStore((s) => s.state !== null)
  const created = useLiveStore((s) => s.replay?.status === "CREATED")
  const connected = useLiveStore((s) => s.connectionStatus === "open")
  const stale = useLiveStore((s) => s.connectionStatus !== "open" || s.needsResync)
  const changes = useLiveStore((s) => s.positionChanges)
  const leaderId = useLiveStore((s) => s.state?.leader_driver_id)
  const selected = useLiveStore((s) => s.selectedDriverId)

  if (!hasState) {
    if (created) return <EmptyState title="Standings appear once the replay starts" />
    if (!connected) return <div role="status" aria-busy="true" aria-label="Loading standings"><Skeleton className="h-64" /></div>
    return <EmptyState title="Standings unavailable" description="No race state received yet." />
  }
  if (!drivers?.length) return <EmptyState title="No drivers in the current state" />
  return (
    <section aria-label="Timing tower" className="space-y-2 rounded-lg border bg-panel p-2">
      {stale && <p role="status" className="px-2 text-sm text-warning">Timing may be stale</p>}
      <Table>
        <TableCaption className="sr-only">Live timing tower</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Pos</TableHead>
            <TableHead>Driver</TableHead>
            <TableHead>Gap</TableHead>
            <TableHead className="hidden sm:table-cell">Interval</TableHead>
            <TableHead>Last lap</TableHead>
            <TableHead className="hidden sm:table-cell">Best lap</TableHead>
            <TableHead>Tyre</TableHead>
            <TableHead className="hidden sm:table-cell">Pit</TableHead>
            <TableHead className="hidden sm:table-cell">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {drivers.map((d) => (
            <Row key={d.driver_id} d={d} leaderId={leaderId} change={changes[d.driver_id]} selected={d.driver_id === selected} />
          ))}
        </TableBody>
      </Table>
    </section>
  )
}

const Row = memo(function Row({ d, leaderId, change, selected }: { d: DriverState; leaderId: string | null | undefined; change?: "gain" | "loss"; selected: boolean }) {
  const dnf = d.race_status === "DID_NOT_FINISH"
  const badge = dnf ? ["DNF", "Did not finish"] : d.pit_status === "IN_PIT" ? ["PIT", "In pit"] : d.race_status === "FINISHED" ? ["FIN", "Finished"] : null
  const ch = change ? positionChangeStyle(change) : null
  return (
    <TableRow className={cn(selected && "bg-muted", dnf && "opacity-60")}>
      <TableCell className="tabular font-semibold">
        <span className="inline-flex items-center gap-1">
          {d.position ?? "—"}
          {ch && <span className={cn("inline-flex items-center text-xs", ch.className.split(" ")[0])}><ch.icon aria-hidden className="size-3.5" /><span className="sr-only">{ch.label}</span></span>}
        </span>
      </TableCell>
      <TableCell>
        <button
          type="button"
          aria-pressed={selected}
          onClick={() => liveStoreSelect(d.driver_id, selected)}
          className="rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="font-semibold">{d.abbreviation}</span>
          {d.driver_number != null && <span className="tabular ml-1.5 text-muted-foreground">#{d.driver_number}</span>}
          {(d.full_name || d.team_name) && (
            <span className="hidden text-xs text-muted-foreground xl:block">{[d.full_name, d.team_name].filter(Boolean).join(" · ")}</span>
          )}
          {badge && (
            <span className="ml-1.5 rounded border px-1 text-xs font-medium sm:hidden"><span aria-hidden>{badge[0]}</span><span className="sr-only">{badge[1]}</span></span>
          )}
        </button>
      </TableCell>
      <TableCell className="tabular">{formatGap(d, leaderId, d.driver_id)}</TableCell>
      <TableCell className="tabular hidden sm:table-cell">{formatDelta(d.interval_to_ahead_ms)}</TableCell>
      <TableCell className="tabular">{formatLapTime(d.last_lap_time_ms)}</TableCell>
      <TableCell className="tabular hidden sm:table-cell">{formatLapTime(d.best_lap_time_ms)}</TableCell>
      <TableCell><Tyre compound={d.compound} age={d.tyre_age_laps} /></TableCell>
      <TableCell className="hidden sm:table-cell">{d.pit_status === "IN_PIT" && <Badge variant="outline">IN PIT</Badge>}</TableCell>
      <TableCell className="hidden sm:table-cell">{dnf ? "DNF" : d.race_status === "FINISHED" ? "Finished" : ""}</TableCell>
    </TableRow>
  )
})

const liveStoreSelect = (id: string, selected: boolean) => liveStore.getState().selectDriver(selected ? null : id)
