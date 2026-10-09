import { describe, expect, it } from "vitest"
import type { DriverTimingSeries, ReplayTiming } from "@/lib/api/types"
import { createLiveStore, MAX_COMPARISON } from "@/lib/replay/live-store"
import { evt, EVIDENCE, msg, raceState, replay, REPLAY_ID, series, tp } from "@/lib/test-fixtures"
import {
  applyCursor, buildRows, deriveStints, eventLapRange, gapDifference, lapFlags, metricValue, selectCursor, slotStyle, visibleEvents,
} from "./timing"

const timing = (...drivers: DriverTimingSeries[]): ReplayTiming => ({ replay_id: "r", session_id: "s", upto_sequence: 1, lap_from: null, lap_to: null, drivers })

describe("cursor guard", () => {
  const ver = series("ver", [1, 2, 3, 4].map((l) => tp(l)))
  const ham = series("ham", [1, 2, 3, 4].map((l) => tp(l, { race_time_ms: l * 90_000 + 5_000, position: 2, gap_to_leader_ms: 5_000 })))
  it("filters per point by race time, not by lap number", () => {
    const out = applyCursor(timing(ver, ham), 3 * 90_000 + 2_000)
    expect(out[0].points.map((p) => p.lap_number)).toEqual([1, 2, 3])
    expect(out[1].points.map((p) => p.lap_number)).toEqual([1, 2]) // ham completes lap 3 at +5s
  })
  it("includes a point exactly at the cursor and shows nothing without one", () => {
    expect(applyCursor(timing(ver), 90_000)[0].points).toHaveLength(1)
    expect(applyCursor(timing(ver), null)).toEqual([])
    expect(applyCursor(undefined, 1e9)).toEqual([])
  })
  it("does not mutate the cached response", () => {
    const t = timing(ver)
    applyCursor(t, 1)
    expect(t.drivers[0].points).toHaveLength(4)
  })
  it("hides events beyond the cursor", () => {
    const e = [evt("OVERTAKE", {}, { race_time_ms: 100 }), evt("OVERTAKE", {}, { race_time_ms: 200, detected_event_id: "x" })]
    expect(visibleEvents(e, 150)).toHaveLength(1)
    expect(visibleEvents(e, null)).toEqual([])
  })
  it("reads the authoritative clock, then replay, then state", () => {
    const s = createLiveStore()
    s.getState().reset(REPLAY_ID)
    expect(selectCursor(s.getState())).toBeNull()
    s.getState().apply(msg("SNAPSHOT", { replay: replay({ current_race_time_ms: 10 }), state: raceState({ current_race_time_ms: 20 }), state_error: null }))
    expect(selectCursor(s.getState())).toBe(10)
    s.getState().apply(msg("REPLAY_CLOCK", { status: "RUNNING", current_race_time_ms: 30, current_lap: 1, total_laps: 5, playback_speed: 1, emitted_event_count: 0, total_events: null }))
    expect(selectCursor(s.getState())).toBe(30)
  })
})

describe("series transforms", () => {
  it("keeps nulls as gaps, converts gaps to seconds, never invents values", () => {
    const d = series("ver", [tp(1), tp(2, { lap_time_ms: null, gap_to_leader_ms: null }), tp(3, { lap_time_ms: Number.NaN, gap_to_leader_ms: 1500 })])
    expect(buildRows([d], "lapTime").map((r) => r.ver)).toEqual([90_001, null, null])
    expect(buildRows([d], "gap").map((r) => r.ver)).toEqual([0, null, 1.5])
    expect(metricValue(tp(1, { position: null }), "position")).toBeNull()
  })
  it("orders by lap and leaves a retired driver null after his last lap", () => {
    const rows = buildRows([series("a", [tp(3), tp(1), tp(2)]), series("b", [tp(1), tp(2)])], "position")
    expect(rows.map((r) => r.lap)).toEqual([1, 2, 3])
    expect(rows[2].b).toBeNull()
  })
  it("flags deleted, pit and non-green laps without dropping them", () => {
    expect(lapFlags(tp(1, { is_deleted: true, is_pit_in_lap: true, is_pit_out_lap: true, track_status: "SAFETY_CAR" }))).toEqual(["Deleted lap", "Pit in", "Pit out", "Track status SAFETY_CAR"])
    expect(lapFlags(tp(1))).toEqual([])
    expect(buildRows([series("a", [tp(1, { is_deleted: true })])], "lapTime")[0].a).toBe(90_001)
  })
  it("formats lap time and gap values", () => {
    expect(buildRows([series("a", [tp(1, { lap_time_ms: 85_421 })])], "lapTime")[0].a).toBe(85_421)
  })
})

describe("gapDifference", () => {
  const a = series("a", [tp(1, { gap_to_leader_ms: 1000 }), tp(2, { gap_to_leader_ms: null }), tp(3, { gap_to_leader_ms: 2000 })])
  const b = series("b", [tp(1, { gap_to_leader_ms: 3500 }), tp(2, { gap_to_leader_ms: 4000 }), tp(4, { gap_to_leader_ms: 9000 })])
  it("uses only laps where both gaps are known; positive means A ahead", () => {
    expect(gapDifference(a, b)).toEqual([{ lap: 1, diff: 2.5 }])
  })
  it("is empty when no lap qualifies", () => {
    expect(gapDifference(series("a", [tp(1, { gap_to_leader_ms: null })]), b)).toEqual([])
  })
})

describe("deriveStints", () => {
  it("groups by stint, clips to released laps, records pit-in", () => {
    const pts = [tp(1), tp(2), tp(3, { is_pit_in_lap: true }), tp(4, { stint_number: 2, compound: "HARD" }), tp(5, { stint_number: 2, compound: "HARD" })]
    expect(deriveStints(pts)).toEqual([
      { key: "s1", stint: 1, compound: "SOFT", startLap: 1, endLap: 3, pitInLap: 3 },
      { key: "s2", stint: 2, compound: "HARD", startLap: 4, endLap: 5, pitInLap: null },
    ])
    expect(deriveStints(pts.slice(0, 4)).at(-1)?.endLap).toBe(4) // no future stint laps
  })
  it("handles unknown compound and missing stint numbers", () => {
    const s = deriveStints([tp(1, { stint_number: null, compound: null }), tp(2, { stint_number: null, compound: null }), tp(3, { stint_number: null, compound: "WET" })])
    expect(s.map((x) => [x.compound, x.startLap, x.endLap])).toEqual([[null, 1, 2], ["WET", 3, 3]])
  })
})

describe("eventLapRange", () => {
  it("uses the degradation recent window", () => {
    const e = evt("PACE_DEGRADATION", { ...EVIDENCE.PACE_DEGRADATION, recent_laps: [{ lap: 8, lap_time_ms: 1 }, { lap: 10, lap_time_ms: 1 }] })
    expect(eventLapRange(e)).toEqual([8, 10])
  })
  it("falls back to the event lap and tolerates missing or malformed evidence", () => {
    expect(eventLapRange(evt("PACE_ANOMALY", EVIDENCE.PACE_ANOMALY, { lap_number: 7 }))).toEqual([7, 7])
    expect(eventLapRange(evt("PACE_DEGRADATION", { recent_laps: "bad" }, { lap_number: null }))).toBeNull()
    expect(eventLapRange({ event_type: "PACE_DEGRADATION", evidence: null as never, lap_number: 3 })).toEqual([3, 3])
  })
})

describe("comparison selection", () => {
  const fresh = () => { const s = createLiveStore(); s.getState().reset(REPLAY_ID); return s }
  it("adds, removes, dedupes and caps at the maximum", () => {
    const s = fresh()
    for (const id of ["a", "b", "c", "d", "e", "a"]) s.getState().addComparison(id)
    expect(s.getState().comparisonDriverIds).toEqual(["a", "b", "c", "d"])
    expect(MAX_COMPARISON).toBe(4)
    s.getState().removeComparison("b")
    expect(s.getState().comparisonDriverIds).toEqual(["a", null, "c", "d"]) // others keep their slot and style
    s.getState().addComparison("e")
    expect(s.getState().comparisonDriverIds).toEqual(["a", "e", "c", "d"]) // new driver fills the hole
  })
  it("styles are stable per slot and distinct by dash and marker", () => {
    expect(slotStyle(1)).toBe(slotStyle(1))
    expect(new Set([0, 1, 2, 3].map((i) => slotStyle(i).marker)).size).toBe(4)
    expect(new Set([0, 1, 2, 3].map((i) => slotStyle(i).dash)).size).toBe(4)
  })
  it("resets on replay switch, keeps across a restart snapshot, leaves selectDriver alone", () => {
    const s = fresh()
    s.getState().selectDriver("ver")
    s.getState().addComparison("ham")
    s.getState().apply(msg("SNAPSHOT", { replay: replay(), state: raceState(), state_error: null }))
    s.getState().apply(msg("RACE_STATE_SNAPSHOT", { reason: "STATE_REBUILT", state: raceState({ run_id: "new" }) }, { run_id: "new", sequence: 1 }))
    expect(s.getState().comparisonDriverIds).toEqual(["ham"])
    expect(s.getState().selectedDriverId).toBe("ver")
    s.getState().reset("other")
    expect(s.getState().comparisonDriverIds).toEqual([])
    expect(s.getState().highlightedEventId).toBeNull()
  })
  it("highlighting an event adds its drivers while slots remain", () => {
    const s = fresh()
    s.getState().addComparison("x")
    s.getState().addComparison("y")
    s.getState().addComparison("z")
    s.getState().highlightEvent({ detected_event_id: "e1", primary_driver_id: "nor", secondary_driver_id: "lec" })
    expect(s.getState().comparisonDriverIds).toEqual(["x", "y", "z", "nor"])
    expect(s.getState().highlightedEventId).toBe("e1")
    expect(s.getState().selectedDriverId).toBe("nor")
  })
})
