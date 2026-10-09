import { describe, expect, it } from "vitest"
import { replay } from "@/lib/test-fixtures"
import type { ReplayStatus } from "@/lib/api/types"
import { canDo, formatRaceClock, lapProgress, type ReplayAction } from "./playback"

describe("formatRaceClock", () => {
  it("formats HH:MM:SS", () => {
    expect(formatRaceClock(0)).toBe("00:00:00")
    expect(formatRaceClock(3_723_999)).toBe("01:02:03")
    expect(formatRaceClock(null)).toBe("—")
  })
})

describe("lapProgress", () => {
  it("is lap based, null without totals, 100 when completed", () => {
    expect(lapProgress(replay({ current_lap: 27, total_laps: 54 }))).toBe(50)
    expect(lapProgress(replay({ current_lap: null, total_laps: null }))).toBeNull()
    expect(lapProgress(replay({ current_lap: 53, total_laps: 53, status: "COMPLETED", is_completed: true }))).toBe(100)
    expect(lapProgress(replay({ status: "COMPLETED", is_completed: true, total_laps: null }))).toBe(100)
  })
})

describe("canDo", () => {
  const matrix: Record<ReplayStatus, ReplayAction[]> = {
    CREATED: ["start"], RUNNING: ["pause", "stop", "restart"], PAUSED: ["resume", "stop", "restart"],
    STOPPED: ["restart"], COMPLETED: ["restart"], FAILED: ["restart"],
  }
  it.each(Object.entries(matrix))("%s", (status, allowed) => {
    for (const a of ["start", "pause", "resume", "stop", "restart"] as const)
      expect(canDo(status as ReplayStatus, a)).toBe(allowed.includes(a))
  })
})
