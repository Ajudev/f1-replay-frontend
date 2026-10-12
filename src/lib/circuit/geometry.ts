import type { CircuitLayout } from "@/lib/api/types"

export type Point = readonly [number, number]

export interface Projector {
  /** Raw FastF1 x/y to SVG user units: rotated by rotation_deg around the bounds centre, Y flipped (screen Y points down). */
  project: (x: number, y: number) => Point
  viewBox: string
  /** Larger side of the viewBox; scales strokes and labels to the circuit size. */
  size: number
}

const round = (n: number) => Math.round(n * 10) / 10

export function makeProjector(c: Pick<CircuitLayout, "bounds" | "rotation_deg">): Projector {
  const { min_x, max_x, min_y, max_y } = c.bounds
  const cx = (min_x + max_x) / 2
  const cy = (min_y + max_y) / 2
  const t = ((c.rotation_deg ?? 0) * Math.PI) / 180
  const cos = Math.cos(t)
  const sin = Math.sin(t)
  const project = (x: number, y: number): Point => {
    const dx = x - cx
    const dy = y - cy
    return [round(dx * cos - dy * sin), round(-(dx * sin + dy * cos))]
  }
  // Bounds cover the outline and every stored car position, so the rotated corners bound everything drawn.
  const pts = [project(min_x, min_y), project(min_x, max_y), project(max_x, min_y), project(max_x, max_y)]
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const w = Math.max(...xs) - Math.min(...xs)
  const h = Math.max(...ys) - Math.min(...ys)
  const size = Math.max(w, h, 1)
  const pad = size * 0.06
  const viewBox = [Math.min(...xs) - pad, Math.min(...ys) - pad, w + 2 * pad, h + 2 * pad].map(round).join(" ")
  return { project, viewBox, size }
}

export const FALLBACK_TEAM_COLOR = "#9ca3af"
const HEX6 = /^[0-9a-f]{6}$/i

/** Backend sends six hex digits without `#` (or null). Anything else falls back, since it ends up in a style. */
export const teamColor = (hex: string | null | undefined) => (hex && HEX6.test(hex) ? `#${hex}` : FALLBACK_TEAM_COLOR)
