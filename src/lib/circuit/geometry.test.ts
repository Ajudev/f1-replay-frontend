import { describe, expect, it } from "vitest"
import { FALLBACK_TEAM_COLOR, makeProjector, teamColor } from "./geometry"

const bounds = { min_x: 0, max_x: 200, min_y: 0, max_y: 100 }

describe("makeProjector", () => {
  it("centres on the bounds and flips Y without rotation", () => {
    const { project } = makeProjector({ bounds, rotation_deg: null })
    expect(project(100, 50)).toEqual([0, -0])
    expect(project(200, 100)).toEqual([100, -50]) // up in FastF1 is up on screen
  })
  it("rotates counter-clockwise by rotation_deg before flipping", () => {
    const { project } = makeProjector({ bounds, rotation_deg: 90 })
    const [x, y] = project(200, 50) // +100 on x, rotated 90° -> +100 on y, flipped -> -100
    expect(x).toBeCloseTo(0)
    expect(y).toBeCloseTo(-100)
  })
  it("viewBox contains every rotated bounds corner", () => {
    const p = makeProjector({ bounds, rotation_deg: 37 })
    const [vx, vy, vw, vh] = p.viewBox.split(" ").map(Number)
    for (const [x, y] of [[0, 0], [0, 100], [200, 0], [200, 100]]) {
      const [sx, sy] = p.project(x, y)
      expect(sx).toBeGreaterThanOrEqual(vx)
      expect(sx).toBeLessThanOrEqual(vx + vw)
      expect(sy).toBeGreaterThanOrEqual(vy)
      expect(sy).toBeLessThanOrEqual(vy + vh)
    }
  })
})

describe("teamColor", () => {
  it("prefixes valid hex and falls back otherwise", () => {
    expect(teamColor("3671C6")).toBe("#3671C6")
    for (const bad of [null, undefined, "", "#3671C6", "red", "3671C6;background:url(x)"]) expect(teamColor(bad)).toBe(FALLBACK_TEAM_COLOR)
  })
})
