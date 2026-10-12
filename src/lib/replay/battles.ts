import type { ActiveBattle, DetectedEvent } from "@/lib/api/types"
import { formatDelta } from "./timing-format"

/** Active battles keyed by `attacker:defender`. Source of truth: SNAPSHOT.battles, then BATTLE_FORMING / BATTLE_ENDED. */
export type BattleMap = Record<string, ActiveBattle>

export const battleKey = (attackerId: string, defenderId: string) => `${attackerId}:${defenderId}`

export const toBattleMap = (list: ActiveBattle[]): BattleMap =>
  Object.fromEntries(list.map((b) => [battleKey(b.attacker_id, b.defender_id), b]))

export const isBattleEvent = (e: DetectedEvent) => e.event_type === "BATTLE_FORMING" || e.event_type === "BATTLE_ENDED"

/** Applies a battle detection; other event types return `battles` unchanged. Idempotent for repeated deliveries. */
export function applyBattleEvent(battles: BattleMap, e: DetectedEvent): BattleMap {
  const { primary_driver_id: att, secondary_driver_id: def } = e
  if (!att || !def) return battles
  const key = battleKey(att, def)
  if (e.event_type === "BATTLE_ENDED") {
    if (!(key in battles)) return battles
    const rest = { ...battles }
    delete rest[key]
    return rest
  }
  if (e.event_type !== "BATTLE_FORMING" || key in battles) return battles
  const gap = e.evidence?.gap_ms
  return {
    ...battles,
    [key]: {
      attacker_id: att,
      attacker_abbreviation: e.primary_driver_abbreviation ?? "",
      defender_id: def,
      defender_abbreviation: e.secondary_driver_abbreviation ?? "",
      started_lap: e.lap_number,
      last_gap_ms: typeof gap === "number" ? gap : null,
      last_observed_lap: e.lap_number,
    },
  }
}

export interface BattleRoles { attacking: ActiveBattle | null; defending: ActiveBattle | null }

/** Per-driver roles; a driver in a train can attack one car and defend from another. Rebuild only when `battles` changes. */
export function battleRoles(battles: BattleMap): Map<string, BattleRoles> {
  const out = new Map<string, BattleRoles>()
  const get = (id: string) => out.get(id) ?? out.set(id, { attacking: null, defending: null }).get(id)!
  for (const b of Object.values(battles)) {
    get(b.attacker_id).attacking ??= b
    get(b.defender_id).defending ??= b
  }
  return out
}

/** Gap is the one the backend last observed (lap end), not a live value, so the lap is part of the text. */
export const battleGapText = (b: ActiveBattle) =>
  b.last_gap_ms == null ? "gap unknown" : `gap ${formatDelta(b.last_gap_ms)}s${b.last_observed_lap != null ? ` (lap ${b.last_observed_lap})` : ""}`
