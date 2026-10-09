import { describe, expect, it } from "vitest"
import { formatDelta, formatGap, formatLapTime } from "./timing-format"

describe("timing-format", () => {
  it("formats lap times", () => {
    expect(formatLapTime(85421)).toBe("1:25.421")
    expect(formatLapTime(60000)).toBe("1:00.000")
    expect(formatLapTime(0)).toBe("0:00.000")
    expect(formatLapTime(null)).toBe("—")
    expect(formatLapTime(undefined)).toBe("—")
  })
  it("formats deltas", () => {
    expect(formatDelta(1240)).toBe("+1.240")
    expect(formatDelta(75_500)).toBe("+75.500")
    expect(formatDelta(null)).toBe("—")
  })
  it("formats gap", () => {
    const g = (o: object) => ({ position: 3, gap_to_leader_ms: 5000, laps_behind_leader: null, ...o })
    expect(formatGap(g({ position: 1 }), null, "a")).toBe("LEADER")
    expect(formatGap(g({ position: 1 }), "x", "a")).toBe("+5.000") // leaderId wins
    expect(formatGap(g({}), "a", "a")).toBe("LEADER")
    expect(formatGap(g({}), "x", "a")).toBe("+5.000")
    expect(formatGap(g({ laps_behind_leader: 1 }), "x", "a")).toBe("+1 LAP")
    expect(formatGap(g({ laps_behind_leader: 2 }), "x", "a")).toBe("+2 LAPS")
    expect(formatGap(g({ gap_to_leader_ms: null }), "x", "a")).toBe("—")
  })
})
