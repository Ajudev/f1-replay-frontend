import type { DetectedEvent, DriverTimingSeries, ReplayTiming, TimingPoint } from "@/lib/api/types"
import type { LiveStore } from "@/lib/replay/live-store"

export type Cursor = number | null

/** Authoritative race time from the live store (REPLAY_CLOCK, else the replay/state snapshot); never wall clock. */
export function selectCursor(s: Pick<LiveStore, "clock" | "replay" | "state">): Cursor {
  return s.clock?.current_race_time_ms ?? s.replay?.current_race_time_ms ?? s.state?.current_race_time_ms ?? null
}

/**
 * Defense in depth over the backend's own release filter: keeps points completed at or before the cursor.
 * Per point (race_time_ms), not per lap number, because drivers are on different laps at the same race time.
 * No cursor means nothing is shown.
 */
export function applyCursor(timing: ReplayTiming | undefined, cursor: Cursor): DriverTimingSeries[] {
  if (!timing || cursor == null) return []
  return timing.drivers.map((d) => ({ ...d, points: d.points.filter((p) => p.race_time_ms <= cursor) }))
}

export const visibleEvents = (events: readonly DetectedEvent[], cursor: Cursor): DetectedEvent[] =>
  cursor == null ? [] : events.filter((e) => e.race_time_ms <= cursor)

// Stable per selection slot: colour plus dash plus marker, so teammates differ without colour.
export const SLOT_STYLES = [
  { color: "#38bdf8", dash: undefined, marker: "circle" },
  { color: "#f97316", dash: "6 3", marker: "square" },
  { color: "#a3e635", dash: "2 3", marker: "triangle" },
  { color: "#e879f9", dash: "10 3 2 3", marker: "diamond" },
] as const
export type SlotStyle = (typeof SLOT_STYLES)[number]
export const slotStyle = (slot: number): SlotStyle => SLOT_STYLES[slot % SLOT_STYLES.length]

export type Metric = "lapTime" | "position" | "gap"
export type Row = { lap: number } & Record<string, number | null>

const finite = (n: number | null | undefined): number | null => (n != null && Number.isFinite(n) ? n : null)

export function metricValue(p: TimingPoint, m: Metric): number | null {
  if (m === "lapTime") return finite(p.lap_time_ms)
  if (m === "position") return finite(p.position)
  const g = finite(p.gap_to_leader_ms)
  return g == null ? null : g / 1000 // seconds
}

/** One row per lap number seen for any driver; a driver without a value (or a lap) is null, so lines break instead of bridging. */
export function buildRows(series: DriverTimingSeries[], m: Metric): Row[] {
  const rows = new Map<number, Row>()
  for (const d of series) {
    for (const p of d.points) {
      const row = rows.get(p.lap_number) ?? ({ lap: p.lap_number, ...Object.fromEntries(series.map((x) => [x.driver_id, null])) } as Row)
      row[d.driver_id] = metricValue(p, m)
      rows.set(p.lap_number, row)
    }
  }
  return [...rows.values()].sort((a, b) => a.lap - b.lap)
}

/** Notes for tooltips and tables: deleted laps are flagged, never dropped; non-green track status is named. */
export function lapFlags(p: TimingPoint): string[] {
  const f: string[] = []
  if (p.is_deleted) f.push("Deleted lap")
  if (p.is_pit_in_lap) f.push("Pit in")
  if (p.is_pit_out_lap) f.push("Pit out")
  if (p.track_status && p.track_status !== "GREEN") f.push(`Track status ${p.track_status}`)
  return f
}

export const pointAt = (d: DriverTimingSeries, lap: number): TimingPoint | undefined => d.points.find((p) => p.lap_number === lap)

/**
 * Driver B minus driver A in seconds, only on laps where both have a gap_to_leader_ms. Both gaps share the
 * lap-end reference ("time behind the first driver to complete this lap number"), so the difference is the
 * lap-end gap between them. Positive: A is ahead. Never derived from lap times.
 */
export function gapDifference(a: DriverTimingSeries, b: DriverTimingSeries): { lap: number; diff: number }[] {
  const out: { lap: number; diff: number }[] = []
  for (const p of a.points) {
    const ga = finite(p.gap_to_leader_ms), gb = finite(pointAt(b, p.lap_number)?.gap_to_leader_ms)
    if (ga != null && gb != null) out.push({ lap: p.lap_number, diff: (gb - ga) / 1000 })
  }
  return out.sort((x, y) => x.lap - y.lap)
}

export interface Stint { key: string; stint: number | null; compound: string | null; startLap: number; endLap: number; pitInLap: number | null }

/** Stints from released points only; endLap is the last released lap, so a running stint is clipped to the cursor. */
export function deriveStints(points: TimingPoint[]): Stint[] {
  const out: Stint[] = []
  for (const p of [...points].sort((x, y) => x.lap_number - y.lap_number)) {
    const key = p.stint_number != null ? `s${p.stint_number}` : `c${p.compound ?? "?"}`
    const last = out[out.length - 1]
    if (last && last.key === key) {
      last.endLap = p.lap_number
      last.compound ??= p.compound
      if (p.is_pit_in_lap) last.pitInLap = p.lap_number
    } else {
      out.push({ key, stint: p.stint_number, compound: p.compound, startLap: p.lap_number, endLap: p.lap_number, pitInLap: p.is_pit_in_lap ? p.lap_number : null })
    }
  }
  return out
}

/** Laps an event spans on the chart: degradation's recent window, else the event lap. Missing keys are tolerated. */
export function eventLapRange(e: Pick<DetectedEvent, "event_type" | "evidence" | "lap_number">): [number, number] | null {
  const ev = e.evidence && typeof e.evidence === "object" && !Array.isArray(e.evidence) ? (e.evidence as Record<string, unknown>) : {}
  const recent = ev.recent_laps
  if (e.event_type === "PACE_DEGRADATION" && Array.isArray(recent)) {
    const laps = recent.map((r) => (r && typeof r === "object" ? (r as { lap?: unknown }).lap : null)).filter((n): n is number => typeof n === "number" && Number.isFinite(n))
    if (laps.length) return [Math.min(...laps), Math.max(...laps)]
  }
  return e.lap_number == null ? null : [e.lap_number, e.lap_number]
}

export const PACE_TYPES: ReadonlySet<string> = new Set(["PACE_DEGRADATION", "PACE_ANOMALY"])
