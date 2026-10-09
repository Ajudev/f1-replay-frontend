import type { Replay, ReplayStatus } from "@/lib/api/types"

export const PLAYBACK_SPEEDS = [1, 2, 5, 10, 20] as const

export type ReplayAction = "start" | "pause" | "resume" | "stop" | "restart"

// Mirrors the backend transition table (backend/app/replay/state.py); the backend stays authoritative.
const ALLOWED: Record<ReplayStatus, readonly ReplayAction[]> = {
  CREATED: ["start"],
  RUNNING: ["pause", "stop", "restart"],
  PAUSED: ["resume", "stop", "restart"],
  STOPPED: ["restart"],
  COMPLETED: ["restart"],
  FAILED: ["restart"],
}
export const canDo = (status: ReplayStatus, action: ReplayAction) => ALLOWED[status].includes(action)

/** Race clock as HH:MM:SS; unavailable for missing or negative input. */
export function formatRaceClock(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—"
  const s = Math.floor(ms / 1000)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`
}

/** Lap-based progress 0-100, or null when totals are unavailable. */
export function lapProgress(r: Pick<Replay, "current_lap" | "total_laps" | "status" | "is_completed">): number | null {
  if (r.is_completed || r.status === "COMPLETED") return 100
  if (r.current_lap == null || !r.total_laps) return null
  return Math.min(100, Math.max(0, Math.round((r.current_lap / r.total_laps) * 100)))
}
