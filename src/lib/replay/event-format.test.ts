import { describe, expect, it } from "vitest"
import { EVIDENCE, evt } from "@/lib/test-fixtures"
import { evidenceLines, eventCategory, eventLabel, eventSummary, filterEvents, newestFirst } from "./event-format"

const lines = (t: string, ev = EVIDENCE[t]) => Object.fromEntries(evidenceLines(evt(t, ev)).map((l) => [l.label, l.value]))

describe("event-format", () => {
  it("maps types to categories and labels, unknown to generic", () => {
    expect(eventCategory("RAPIDLY_CLOSING")).toBe("battles")
    expect(eventCategory("PACE_ANOMALY")).toBe("pace")
    expect(eventLabel("NEW_STINT")).toBe("New stint")
    expect(eventLabel("WHATEVER")).toBe("Detected event")
    expect(eventCategory("WHATEVER")).toBeNull()
  })
  it("formats battle evidence exactly", () => {
    expect(lines("BATTLE_FORMING")).toMatchObject({
      Gap: "1.50s", "Closing rate": "0.85s/lap", "Gap history": "3.20s → 2.40s → 1.50s", Attacker: "P3", Defender: "P2", Observed: "3 of 4 laps", "Gap threshold": "2.00s", Basis: "lap end",
    })
    expect(lines("RAPIDLY_CLOSING")).toMatchObject({ "Max gap": "3.00s", "Min closing rate": "1.00s/lap" })
  })
  it("shows overtake classification as given, not upgraded", () => {
    expect(lines("OVERTAKE")).toMatchObject({ Overtaker: "P3 → P2", Overtaken: "P2 → P3", Classification: "on track likely", "Confirmed by": "LEC" })
  })
  it("formats pace, personal best and stint evidence exactly", () => {
    expect(lines("PACE_DEGRADATION")).toMatchObject({ "Baseline median": "1:30.000", "Recent median": "1:30.610", Delta: "+0.610s", Tyre: "Medium, 18 laps old", "Slower recent laps": "3 of 3" })
    expect(lines("PACE_ANOMALY")).toMatchObject({ "Lap time": "1:35.421", Expected: "1:30.000", Deviation: "+5.421s", "Robust score": "4.57", MAD: "0.300s" })
    expect(lines("PERSONAL_BEST")).toMatchObject({ "Lap time": "1:25.421", "Previous best": "1:25.900 (lap 5)", Improvement: "0.479s" })
    expect(lines("NEW_STINT")).toMatchObject({ Compound: "Hard", Previous: "Stint 1, Medium", "Compound changed": "Yes", "Starting lap": "21", "Pit lane time": "22.345s", Source: "pit exit" })
  })
  it("omits missing and malformed keys without throwing", () => {
    expect(evidenceLines(evt("OVERTAKE", {}))).toEqual([])
    const l = lines("BATTLE_FORMING", { gap_ms: "1500", gap_history: "x", attacker_position: null, defender_position: NaN, closing_rate_ms_per_lap: 1000 })
    expect(l).toEqual({ "Closing rate": "1.00s/lap" })
    expect(lines("BATTLE_FORMING", { gap_history: [{ lap: 1, gap_ms: 1000 }, null] })).toEqual({})
    expect(evidenceLines({ event_type: "OVERTAKE", evidence: null as never })).toEqual([])
    expect(evidenceLines({ event_type: "OVERTAKE", evidence: [] as never })).toEqual([])
    expect(evidenceLines(evt("FUTURE_TYPE", { a: 1 }))).toEqual([])
  })
  it("summarises in at most two parts", () => {
    expect(eventSummary(evt("BATTLE_FORMING", EVIDENCE.BATTLE_FORMING))).toBe("Gap 1.50s · Closing rate 0.85s/lap")
    expect(eventSummary(evt("OVERTAKE", {}))).toBe("")
  })
  it("filters by category and either driver without mutating", () => {
    const a = evt("OVERTAKE", {}, { detected_event_id: "a" })
    const b = evt("NEW_STINT", {}, { detected_event_id: "b", primary_driver_id: "ver", secondary_driver_id: null })
    const input = [a, b]
    expect(filterEvents(input, "all", null)).toEqual([a, b])
    expect(filterEvents(input, "stints", null)).toEqual([b])
    expect(filterEvents(input, "all", "lec")).toEqual([a])
    expect(filterEvents(input, "all", "ver")).toEqual([b])
    expect(filterEvents(input, "stints", "lec")).toEqual([])
    expect(newestFirst(input)).toEqual([b, a])
    expect(input).toEqual([a, b])
  })
})
