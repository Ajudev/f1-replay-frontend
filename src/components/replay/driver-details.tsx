"use client"

import { EmptyState } from "@/components/empty-state"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { DriverState, RecentLap } from "@/lib/api/types"
import { useLiveStore } from "@/lib/replay/live-store"
import { formatDelta, formatGap, formatLapTime } from "@/lib/replay/timing-format"
import { Tyre } from "./tyre"

const v = (x: string | number | null | undefined) => (x == null || x === "" ? "—" : x)

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular text-sm font-medium">{children}</dd>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  )
}

function stints(laps: RecentLap[]) {
  const m = new Map<number, RecentLap[]>()
  for (const l of laps) if (l.stint_number != null) m.set(l.stint_number, [...(m.get(l.stint_number) ?? []), l])
  return [...m.entries()].sort((a, b) => a[0] - b[0])
}

export function DriverDetails() {
  const selectedId = useLiveStore((s) => s.selectedDriverId)
  const hasState = useLiveStore((s) => s.state !== null)
  const d = useLiveStore((s) => s.state?.drivers.find((x) => x.driver_id === s.selectedDriverId))
  const leaderId = useLiveStore((s) => s.state?.leader_driver_id)
  if (!hasState) return null
  if (!selectedId) return <EmptyState title="Select a driver" description="Choose a row in the timing tower to see details." />
  if (!d) return <EmptyState title="Driver not in current state" />
  return <Details d={d} leaderId={leaderId} />
}

function Details({ d, leaderId }: { d: DriverState; leaderId: string | null | undefined }) {
  const laps = [...(d.recent_laps ?? [])].sort((a, b) => b.lap_number - a.lap_number)
  return (
    <section aria-label="Driver details" className="space-y-4 rounded-lg border bg-panel p-4">
      <Section title="Overview">
        <p className="text-lg font-semibold">{v(d.full_name ?? d.abbreviation)} <span className="tabular text-muted-foreground">{d.driver_number != null && `#${d.driver_number}`}</span></p>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Team">{v(d.team_name)}</Field>
          <Field label="Position">{v(d.position)}</Field>
          <Field label="Grid">{v(d.grid_position)}</Field>
          <Field label="Gap">{formatGap(d, leaderId, d.driver_id)}</Field>
          <Field label="Interval">{formatDelta(d.interval_to_ahead_ms)}</Field>
        </dl>
      </Section>
      <Section title="Timing">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Current lap">{v(d.current_lap)}</Field>
          <Field label="Laps completed">{v(d.laps_completed)}</Field>
          <Field label="Last lap">{formatLapTime(d.last_lap_time_ms)}</Field>
          <Field label="Best lap">{formatLapTime(d.best_lap_time_ms)}{d.best_lap_number != null && ` (L${d.best_lap_number})`}</Field>
        </dl>
      </Section>
      <Section title="Tyre">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Compound"><Tyre compound={d.compound} age={d.tyre_age_laps} /></Field>
          <Field label="Stint">{v(d.stint_number)}</Field>
          <Field label="Pit status">{d.pit_status === "IN_PIT" ? "IN PIT" : d.pit_status === "ON_TRACK" ? "On track" : "—"}</Field>
          <Field label="Pit stops">{v(d.pit_stop_count)}</Field>
          <Field label="Last pit lane">{d.last_pit_lane_duration_ms == null ? "—" : `${(d.last_pit_lane_duration_ms / 1000).toFixed(3)}s`}</Field>
        </dl>
      </Section>
      <Section title="Recent laps">
        {laps.length === 0 ? <p className="text-sm text-muted-foreground">No laps recorded yet.</p> : (
          <Table>
            <TableHeader>
              <TableRow><TableHead>Lap</TableHead><TableHead>Time</TableHead><TableHead>Pos</TableHead><TableHead>Tyre</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {laps.map((l) => (
                <TableRow key={l.lap_number}>
                  <TableCell className="tabular">{l.lap_number}</TableCell>
                  <TableCell className="tabular">
                    {formatLapTime(l.lap_time_ms)}
                    {l.is_pit_in_lap && <Badge variant="outline" className="ml-1">Pit in</Badge>}
                    {l.is_pit_out_lap && <Badge variant="outline" className="ml-1">Pit out</Badge>}
                    {l.is_deleted && <Badge variant="outline" className="ml-1">Deleted</Badge>}
                  </TableCell>
                  <TableCell className="tabular">{v(l.position)}</TableCell>
                  <TableCell><Tyre compound={l.compound} age={l.tyre_age_laps} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="text-xs text-muted-foreground">History covers only the most recent laps kept by the backend.</p>
      </Section>
      <Section title="Stints so far">
        {stints(laps).length === 0 ? <p className="text-sm text-muted-foreground">No stint data.</p> : (
          <ul className="space-y-1 text-sm">
            {stints(laps).map(([n, ls]) => (
              <li key={n} className="flex items-center gap-2">
                <span className="tabular">Stint {n}</span>
                <Tyre compound={ls[0].compound} age={null} />
                <span className="tabular text-muted-foreground">L{Math.min(...ls.map((l) => l.lap_number))}–L{Math.max(...ls.map((l) => l.lap_number))} ({ls.length} recent)</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </section>
  )
}
