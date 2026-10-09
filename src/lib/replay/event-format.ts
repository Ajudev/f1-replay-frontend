import type { DetectedEvent } from "@/lib/api/types"
import { compoundStyle } from "@/lib/domain-styles"
import { formatLapTime } from "./timing-format"

export type EventCategory = "battles" | "overtakes" | "pace" | "performance" | "stints"

export const CATEGORIES: { id: EventCategory; label: string }[] = [
  { id: "battles", label: "Battles" },
  { id: "overtakes", label: "Overtakes" },
  { id: "pace", label: "Pace" },
  { id: "performance", label: "Performance" },
  { id: "stints", label: "Stints" },
]

const TYPES: Record<string, { category: EventCategory; label: string }> = {
  BATTLE_FORMING: { category: "battles", label: "Battle forming" },
  RAPIDLY_CLOSING: { category: "battles", label: "Rapidly closing" },
  OVERTAKE: { category: "overtakes", label: "Overtake" },
  PACE_DEGRADATION: { category: "pace", label: "Pace degradation" },
  PACE_ANOMALY: { category: "pace", label: "Pace anomaly" },
  PERSONAL_BEST: { category: "performance", label: "Personal best" },
  NEW_STINT: { category: "stints", label: "New stint" },
}

/** Unknown types (newer backend) get a generic label and no category, so they only show under "all". */
export const eventLabel = (type: string): string => TYPES[type]?.label ?? "Detected event"
export const eventCategory = (type: string): EventCategory | null => TYPES[type]?.category ?? null

export interface EvidenceLine { label: string; value: string }

// Evidence is free-form and untrusted: every reader returns null for a missing or wrongly typed key.
type Ev = Record<string, unknown>
const num = (e: Ev, k: string): number | null => (typeof e[k] === "number" && Number.isFinite(e[k]) ? (e[k] as number) : null)
const str = (e: Ev, k: string): string | null => (typeof e[k] === "string" && e[k] ? (e[k] as string) : null)
const words = (s: string) => s.toLowerCase().replace(/_/g, " ")

const secs = (ms: number | null, digits = 2) => (ms == null ? null : `${(ms / 1000).toFixed(digits)}s`)
const signed = (ms: number | null) => (ms == null ? null : `${ms < 0 ? "-" : "+"}${(Math.abs(ms) / 1000).toFixed(3)}s`)
const lapTime = (ms: number | null) => (ms == null ? null : formatLapTime(ms))
const pos = (n: number | null) => (n == null ? null : `P${n}`)
const move = (from: number | null, to: number | null) => (from == null || to == null ? null : `P${from} → P${to}`)
const tyre = (e: Ev) => {
  const c = str(e, "compound"), age = num(e, "tyre_age_laps")
  const name = c ? compoundStyle(c).label : null
  return name && age != null ? `${name}, ${age} laps old` : name
}

function gapHistory(e: Ev): string | null {
  const h = e.gap_history
  if (!Array.isArray(h)) return null
  const gaps = h.map((o) => (o && typeof o === "object" ? (o as Ev) : null)).map((o) => (o ? secs(num(o, "gap_ms")) : null))
  return gaps.length > 0 && gaps.every((g) => g !== null) ? gaps.join(" → ") : null
}

/** Lines in display order; a line whose evidence is missing or malformed is omitted, never guessed. */
export function evidenceLines(ev: Pick<DetectedEvent, "event_type" | "evidence">): EvidenceLine[] {
  const e: Ev = ev.evidence && typeof ev.evidence === "object" && !Array.isArray(ev.evidence) ? (ev.evidence as Ev) : {}
  const rate = num(e, "closing_rate_ms_per_lap")
  const rows: [string, string | null][] = (() => {
    switch (ev.event_type) {
      case "BATTLE_FORMING":
      case "RAPIDLY_CLOSING": {
        const laps = num(e, "observed_laps"), win = num(e, "window_laps")
        return [
          ["Gap", secs(num(e, "gap_ms"))],
          ["Closing rate", rate == null ? null : `${(rate / 1000).toFixed(2)}s/lap`],
          ["Gap history", gapHistory(e)],
          ["Attacker", pos(num(e, "attacker_position"))],
          ["Defender", pos(num(e, "defender_position"))],
          ["Observed", laps == null ? null : win == null ? `${laps} laps` : `${laps} of ${win} laps`],
          ["Gap threshold", secs(num(e, "threshold_ms"))],
          ["Max gap", secs(num(e, "max_gap_ms"))],
          ["Min closing rate", num(e, "min_closing_rate_ms") == null ? null : `${(num(e, "min_closing_rate_ms")! / 1000).toFixed(2)}s/lap`],
          ["Basis", str(e, "basis") && words(str(e, "basis")!)],
        ]
      }
      case "OVERTAKE":
        return [
          ["Lap", num(e, "lap") == null ? null : String(num(e, "lap"))],
          ["Overtaker", move(num(e, "overtaker_previous_position"), num(e, "overtaker_new_position"))],
          ["Overtaken", move(num(e, "overtaken_previous_position"), num(e, "overtaken_new_position"))],
          ["Classification", str(e, "classification") && words(str(e, "classification")!)],
          ["Basis", str(e, "basis") && words(str(e, "basis")!)],
          ["Confirmed by", str(e, "confirmed_by")],
        ]
      case "PACE_DEGRADATION": {
        const slower = num(e, "slower_recent_laps"), bw = num(e, "baseline_window_laps"), rw = num(e, "recent_window_laps")
        return [
          ["Stint", num(e, "stint_number") == null ? null : String(num(e, "stint_number"))],
          ["Tyre", tyre(e)],
          ["Baseline median", lapTime(num(e, "baseline_median_ms"))],
          ["Recent median", lapTime(num(e, "recent_median_ms"))],
          ["Delta", signed(num(e, "delta_ms"))],
          ["Slower recent laps", slower == null ? null : rw == null ? String(slower) : `${slower} of ${rw}`],
          ["Baseline window", bw == null ? null : `${bw} laps`],
        ]
      }
      case "PACE_ANOMALY": {
        const score = num(e, "robust_score")
        return [
          ["Stint", num(e, "stint_number") == null ? null : String(num(e, "stint_number"))],
          ["Tyre", tyre(e)],
          ["Lap time", lapTime(num(e, "lap_time_ms"))],
          ["Expected", lapTime(num(e, "expected_ms"))],
          ["Deviation", signed(num(e, "deviation_ms"))],
          ["Robust score", score == null ? null : score.toFixed(2)],
          ["MAD", secs(num(e, "mad_ms"), 3)],
          ["MAD floor", secs(num(e, "mad_floor_ms"), 3)],
        ]
      }
      case "PERSONAL_BEST": {
        const prevLap = num(e, "previous_best_lap")
        const prev = lapTime(num(e, "previous_best_ms"))
        return [
          ["Lap time", lapTime(num(e, "lap_time_ms"))],
          ["Previous best", prev && (prevLap == null ? prev : `${prev} (lap ${prevLap})`)],
          ["Improvement", secs(num(e, "improvement_ms"), 3)],
          ["Previous true best", lapTime(num(e, "previous_true_best_ms"))],
          ["Min improvement", secs(num(e, "min_improvement_ms"), 3)],
          ["Tyre", tyre(e)],
          ["Stint", num(e, "stint_number") == null ? null : String(num(e, "stint_number"))],
        ]
      }
      case "NEW_STINT": {
        const c = str(e, "compound"), pc = str(e, "previous_compound"), changed = e.compound_changed
        return [
          ["Stint", num(e, "stint_number") == null ? null : String(num(e, "stint_number"))],
          ["Compound", c && compoundStyle(c).label],
          ["Previous", num(e, "previous_stint_number") == null ? (pc && compoundStyle(pc).label) : `Stint ${num(e, "previous_stint_number")}${pc ? `, ${compoundStyle(pc).label}` : ""}`],
          ["Compound changed", typeof changed === "boolean" ? (changed ? "Yes" : "No") : null],
          ["Starting lap", num(e, "starting_lap") == null ? null : String(num(e, "starting_lap"))],
          ["Tyre age", num(e, "tyre_age_laps") == null ? null : `${num(e, "tyre_age_laps")} laps`],
          ["Pit lane time", secs(num(e, "pit_lane_duration_ms"), 3)],
          ["Pit stops", num(e, "pit_stop_count") == null ? null : String(num(e, "pit_stop_count"))],
          ["Source", str(e, "source_event_type") && words(str(e, "source_event_type")!)],
        ]
      }
      default:
        return []
    }
  })()
  return rows.flatMap(([label, value]) => (value ? [{ label, value }] : []))
}

/** Short collapsed-card text: the first lines that carry the headline numbers. Empty when evidence is unusable. */
const SUMMARY_LABELS: Record<string, string[]> = {
  BATTLE_FORMING: ["Gap", "Closing rate"],
  RAPIDLY_CLOSING: ["Gap", "Closing rate"],
  OVERTAKE: ["Overtaker", "Classification"],
  PACE_DEGRADATION: ["Delta", "Tyre"],
  PACE_ANOMALY: ["Lap time", "Expected"],
  PERSONAL_BEST: ["Lap time", "Improvement"],
  NEW_STINT: ["Compound", "Stint"],
}
export function eventSummary(ev: Pick<DetectedEvent, "event_type" | "evidence">): string {
  const wanted = SUMMARY_LABELS[ev.event_type] ?? []
  return evidenceLines(ev).filter((l) => wanted.includes(l.label)).map((l) => `${l.label} ${l.value}`).join(" · ")
}

/** Newest first, from the store's ascending order. Does not mutate. */
export const newestFirst = (events: readonly DetectedEvent[]): DetectedEvent[] => [...events].reverse()

/** Derived view; a driver matches as primary or secondary. Does not mutate. */
export function filterEvents(events: readonly DetectedEvent[], category: EventCategory | "all", driverId: string | null): DetectedEvent[] {
  return events.filter(
    (e) =>
      (category === "all" || eventCategory(e.event_type) === category) &&
      (driverId === null || e.primary_driver_id === driverId || e.secondary_driver_id === driverId),
  )
}
