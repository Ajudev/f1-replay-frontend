import type { DetectedEvent, DriverState, ErrorBody, RaceState, RecentLap, Replay } from "@/lib/api/types"

export const WS_SCHEMA_VERSION = 1

interface Envelope<T extends string, P> {
  type: T
  schema_version: 1
  replay_id: string
  run_id: string | null
  sequence: number | null
  race_time_ms: number | null
  lap_number: number | null
  emitted_at: string
  payload: P
}

export interface ClockPayload {
  status: Replay["status"]
  current_race_time_ms: number
  current_lap: number | null
  total_laps: number | null
  playback_speed: number
  emitted_event_count: number
  total_events: number | null
}

export type RaceLevelFields = Partial<Omit<RaceState, "drivers">>

export type ServerMessage =
  | Envelope<"SNAPSHOT", { replay: Replay; state: RaceState | null; state_error: ErrorBody | null }>
  | Envelope<"PONG", Record<string, never>>
  | Envelope<"ERROR", ErrorBody>
  | Envelope<"REPLAY_STATUS", { replay: Replay }>
  | Envelope<"REPLAY_COMPLETED", { replay: Replay }>
  | Envelope<"REPLAY_CLOCK", ClockPayload>
  | Envelope<
      "RACE_STATE_SNAPSHOT",
      { reason: "STATE_INITIALIZED" | "STATE_REBUILT" | "STATE_COMPLETED"; state: RaceState }
    >
  | Envelope<"RACE_STATE_UPDATE", { kinds: string[]; race: RaceLevelFields; last_sequence: number }>
  | Envelope<"DRIVER_UPDATE", { driver: Omit<DriverState, "recent_laps"> }>
  | Envelope<"LAP_COMPLETED", { driver_id: string; abbreviation: string; lap: RecentLap; laps_completed: number }>
  | Envelope<
      "POSITION_CHANGED",
      { driver_id: string; abbreviation: string; position: number | null; previous_position: number | null }
    >
  | Envelope<
      "PIT_STATUS_CHANGED",
      {
        driver_id: string
        abbreviation: string
        pit_status: DriverState["pit_status"]
        pit_stop_count: number
        last_pit_lane_duration_ms: number | null
      }
    >
  | Envelope<"TRACK_STATUS_CHANGED", { track_status: RaceState["track_status"] }>
  | Envelope<"DETECTED_EVENT", { event: DetectedEvent }>

export type ServerMessageType = ServerMessage["type"]

export type ClientMessage = { type: "PING" } | { type: "RESYNC" }

const KNOWN_TYPES: ReadonlySet<string> = new Set<ServerMessageType>([
  "SNAPSHOT", "PONG", "ERROR", "REPLAY_STATUS", "REPLAY_COMPLETED", "REPLAY_CLOCK", "RACE_STATE_SNAPSHOT",
  "RACE_STATE_UPDATE", "DRIVER_UPDATE", "LAP_COMPLETED", "POSITION_CHANGED", "PIT_STATUS_CHANGED",
  "TRACK_STATUS_CHANGED", "DETECTED_EVENT",
])

export type ParseResult =
  | { kind: "message"; message: ServerMessage }
  | { kind: "unknown"; type: string }
  | { kind: "invalid"; reason: string }

/** Validates the envelope only; payload shapes are trusted per the backend contract. */
export function parseServerMessage(raw: string): ParseResult {
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return { kind: "invalid", reason: "not JSON" }
  }
  if (typeof v !== "object" || v === null) return { kind: "invalid", reason: "not an object" }
  const m = v as Record<string, unknown>
  if (typeof m.type !== "string") return { kind: "invalid", reason: "missing type" }
  if (m.schema_version !== WS_SCHEMA_VERSION) return { kind: "invalid", reason: `unsupported schema_version ${String(m.schema_version)}` }
  if (typeof m.replay_id !== "string") return { kind: "invalid", reason: "missing replay_id" }
  if (typeof m.payload !== "object" || m.payload === null || Array.isArray(m.payload)) {
    return { kind: "invalid", reason: "missing payload" }
  }
  if (!KNOWN_TYPES.has(m.type)) return { kind: "unknown", type: m.type }
  return { kind: "message", message: v as ServerMessage }
}
