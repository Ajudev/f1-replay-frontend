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

type Check = (v: unknown) => boolean
type Rec = Record<string, unknown>
const isObj = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v)
const str: Check = (v) => typeof v === "string"
const num: Check = (v) => typeof v === "number" && Number.isFinite(v)
const nullable = (c: Check): Check => (v) => v === null || c(v)
const arr: Check = Array.isArray
/** Required keys with checked primitive types; extra keys are preserved untouched. A missing key fails. */
const shape = (spec: Record<string, Check>): Check => (v) => isObj(v) && Object.entries(spec).every(([k, c]) => c(v[k]))

const replayOk = shape({
  id: str, status: str, playback_speed: num, current_race_time_ms: num,
  current_lap: nullable(num), total_laps: nullable(num),
})
const stateOk = shape({ run_id: str, drivers: arr, last_sequence: num })
const driverRef = shape({ driver_id: str })

const PAYLOAD_CHECKS: Record<ServerMessageType, Check> = {
  SNAPSHOT: (p) => shape({ replay: replayOk, state: nullable(stateOk), state_error: nullable(shape({ code: str, message: str })) })(p),
  PONG: isObj,
  ERROR: shape({ code: str, message: str }),
  REPLAY_STATUS: shape({ replay: replayOk }),
  REPLAY_COMPLETED: shape({ replay: replayOk }),
  REPLAY_CLOCK: shape({
    status: str, current_race_time_ms: num, current_lap: nullable(num), total_laps: nullable(num), playback_speed: num,
  }),
  RACE_STATE_SNAPSHOT: shape({ reason: str, state: stateOk }),
  RACE_STATE_UPDATE: shape({ kinds: arr, race: isObj, last_sequence: num }),
  DRIVER_UPDATE: shape({ driver: driverRef }),
  LAP_COMPLETED: shape({ driver_id: str, lap: shape({ lap_number: num }) }),
  POSITION_CHANGED: driverRef,
  PIT_STATUS_CHANGED: driverRef,
  TRACK_STATUS_CHANGED: (p) => isObj(p) && "track_status" in p,
  DETECTED_EVENT: shape({ event: shape({ detected_event_id: str, run_id: str, source_sequence: num, event_type: str }) }),
}

/** Parses and validates a frame: envelope plus per-type payload shape. Nulls are kept; malformed frames never pass. */
export function parseServerMessage(raw: string): ParseResult {
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return { kind: "invalid", reason: "not JSON" }
  }
  if (!isObj(v)) return { kind: "invalid", reason: "not an object" }
  if (typeof v.type !== "string") return { kind: "invalid", reason: "missing type" }
  if (v.schema_version !== WS_SCHEMA_VERSION) return { kind: "invalid", reason: `unsupported schema_version ${String(v.schema_version)}` }
  if (typeof v.replay_id !== "string") return { kind: "invalid", reason: "missing replay_id" }
  if (!nullable(str)(v.run_id) || !nullable(num)(v.sequence)) return { kind: "invalid", reason: "bad run_id/sequence" }
  if (!isObj(v.payload)) return { kind: "invalid", reason: "missing payload" }
  if (!KNOWN_TYPES.has(v.type)) return { kind: "unknown", type: v.type }
  if (!PAYLOAD_CHECKS[v.type as ServerMessageType](v.payload)) return { kind: "invalid", reason: `bad ${v.type} payload` }
  return { kind: "message", message: v as unknown as ServerMessage }
}
