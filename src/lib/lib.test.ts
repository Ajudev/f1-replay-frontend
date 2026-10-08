import { describe, expect, it } from "vitest"
import { compoundStyle, positionChangeStyle, replayStatusStyle, severityStyle, trackStatusStyle } from "@/lib/domain-styles"
import { isUuid } from "@/lib/uuid"

describe("domain-styles", () => {
  it("maps known values", () => {
    expect(replayStatusStyle("RUNNING").label).toBe("Running")
    expect(trackStatusStyle("SAFETY_CAR").label).toBe("Safety car")
    expect(severityStyle("HIGH").label).toBe("High")
    expect(compoundStyle("soft").short).toBe("S")
    expect(positionChangeStyle("gain").label).toBe("Gained")
  })
  it("falls back to Unknown", () => {
    for (const t of [replayStatusStyle("NOPE"), trackStatusStyle(null), severityStyle(undefined), compoundStyle("X"), positionChangeStyle("toString")]) {
      expect(t.label).toBe("Unknown")
    }
  })
})

describe("isUuid", () => {
  it("validates", () => {
    expect(isUuid("123e4567-e89b-12d3-a456-426614174000")).toBe(true)
    expect(isUuid("not-a-uuid")).toBe(false)
    expect(isUuid("123e4567-e89b-12d3-a456-42661417400")).toBe(false)
  })
})
