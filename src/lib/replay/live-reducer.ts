import type { DriverState, ErrorBody, RaceState, Replay } from "@/lib/api/types"
import type { ClockPayload, ServerMessage } from "@/lib/ws/messages"

export interface LiveState {
  replay: Replay | null
  state: RaceState | null
  clock: ClockPayload | null
  runId: string | null
  lastSequence: number | null
  /** Set when deltas cannot be trusted; the caller sends RESYNC. Cleared by the next SNAPSHOT. */
  needsResync: boolean
  lastError: ErrorBody | null
}

export const initialLiveState: LiveState = {
  replay: null,
  state: null,
  clock: null,
  runId: null,
  lastSequence: null,
  needsResync: false,
  lastError: null,
}

const STATE_TYPES: ReadonlySet<ServerMessage["type"]> = new Set([
  "RACE_STATE_SNAPSHOT", "RACE_STATE_UPDATE", "DRIVER_UPDATE", "LAP_COMPLETED",
  "POSITION_CHANGED", "PIT_STATUS_CHANGED", "TRACK_STATUS_CHANGED",
])

const byPosition = (a: DriverState, b: DriverState) =>
  (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER)

function withDriver(state: RaceState, id: string, update: (d: DriverState | undefined) => DriverState): RaceState {
  const exists = state.drivers.some((d) => d.driver_id === id)
  const drivers = exists
    ? state.drivers.map((d) => (d.driver_id === id ? update(d) : d))
    : [...state.drivers, update(undefined)]
  return { ...state, drivers: drivers.sort(byPosition) }
}

export function liveReducer(live: LiveState, msg: ServerMessage): LiveState {
  switch (msg.type) {
    case "SNAPSHOT": {
      const { replay, state, state_error } = msg.payload
      return {
        ...live,
        replay,
        state,
        runId: msg.run_id ?? state?.run_id ?? null,
        lastSequence: msg.sequence ?? state?.last_sequence ?? null,
        needsResync: false,
        lastError: state_error,
      }
    }
    case "REPLAY_STATUS":
    case "REPLAY_COMPLETED":
      return { ...live, replay: msg.payload.replay }
    case "REPLAY_CLOCK":
      return { ...live, clock: msg.payload }
    case "ERROR":
      return { ...live, lastError: msg.payload }
    case "PONG":
    case "DETECTED_EVENT": // not race state; never stored here
      return live
  }

  // Remaining types are run-scoped (state deltas and detections).
  if (msg.type === "RACE_STATE_SNAPSHOT") {
    // Announces a (possibly new) run: adopt it wholesale.
    const { state } = msg.payload
    return {
      ...live,
      state,
      runId: msg.run_id ?? state.run_id,
      lastSequence: msg.sequence ?? state.last_sequence,
      needsResync: false,
    }
  }
  if (live.state === null || live.runId === null || msg.run_id !== live.runId) {
    return live.needsResync ? live : { ...live, needsResync: true }
  }
  if (msg.sequence !== null && live.lastSequence !== null && msg.sequence < live.lastSequence) return live // stale

  const lastSequence = msg.sequence ?? live.lastSequence
  const base = { ...live, lastSequence }
  const state = live.state
  switch (msg.type) {
    case "RACE_STATE_UPDATE":
      return { ...base, state: { ...state, ...msg.payload.race, last_sequence: msg.payload.last_sequence } }
    case "DRIVER_UPDATE": {
      const d = msg.payload.driver
      return {
        ...base,
        state: withDriver(state, d.driver_id, (old) => ({ ...d, recent_laps: old?.recent_laps ?? [] })),
      }
    }
    case "LAP_COMPLETED": {
      const { driver_id, lap } = msg.payload
      const cur = state.drivers.find((d) => d.driver_id === driver_id)
      if (!cur) return { ...base, needsResync: true } // lap for unknown driver: state is incomplete
      const recent_laps = [...(cur.recent_laps ?? []).filter((l) => l.lap_number !== lap.lap_number), lap].sort(
        (x, y) => x.lap_number - y.lap_number,
      )
      return { ...base, state: withDriver(state, driver_id, () => ({ ...cur, recent_laps })) }
    }
    default:
      // Notifications (POSITION_CHANGED, PIT_STATUS_CHANGED, TRACK_STATUS_CHANGED) are already in the updates;
      // DETECTED_EVENT is not part of race state.
      return STATE_TYPES.has(msg.type) ? base : live
  }
}
