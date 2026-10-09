import type { DriverState } from "@/lib/api/types"

const DASH = "—"

/** 85421 -> 1:25.421 */
export function formatLapTime(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return DASH
  const m = Math.floor(ms / 60000)
  const s = ((ms % 60000) / 1000).toFixed(3).padStart(6, "0")
  return `${m}:${s}`
}

/** 1240 -> +1.240; minutes are not split out (gaps stay in seconds). */
export function formatDelta(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return DASH
  return `+${(ms / 1000).toFixed(3)}`
}

export function formatGap(d: Pick<DriverState, "position" | "gap_to_leader_ms" | "laps_behind_leader">, leaderId: string | null | undefined, id: string): string {
  if (leaderId ? id === leaderId : d.position === 1) return "LEADER"
  if (d.laps_behind_leader != null && d.laps_behind_leader >= 1) return `+${d.laps_behind_leader} ${d.laps_behind_leader === 1 ? "LAP" : "LAPS"}`
  return formatDelta(d.gap_to_leader_ms)
}
