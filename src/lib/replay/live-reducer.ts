import type { DetectedEvent, DriverState, ErrorBody, RaceState, Replay } from "@/lib/api/types"
import type { ClockPayload, ServerMessage } from "@/lib/ws/messages"

export const MAX_EVENTS = 200

/** Adds unseen events (by detected_event_id), keeps source_sequence order, drops the oldest beyond MAX_EVENTS. */
export function mergeEvents(current: DetectedEvent[], incoming: DetectedEvent[]): DetectedEvent[] {
  const seen = new Set(current.map((e) => e.detected_event_id))
  const fresh = incoming.filter((e) => !seen.has(e.detected_event_id) && seen.add(e.detected_event_id))
  if (fresh.length === 0) return current
  // Array.sort is stable, so ties keep arrival order.
  return [...current, ...fresh].sort((a, b) => a.source_sequence - b.source_sequence).slice(-MAX_EVENTS)
}

export interface LiveState {
  replay: Replay | null
  /** Recent detected events of the current run, as received. */
  events: DetectedEvent[]
  state: RaceState | null
  clock: ClockPayload | null
  runId: string | null
  lastSequence: number | null
  /** Set when deltas cannot be trusted; the caller sends RESYNC. Cleared by the next SNAPSHOT. */
  needsResync: boolean
  lastError: ErrorBody | null
  /** Transient position movement seen in DRIVER_UPDATE deltas; cleared by any snapshot. */
  positionChanges: Record<string, "gain" | "loss">
}

export const initialLiveState: LiveState = {
  replay: null,
  events: [],
  state: null,
  clock: null,
  runId: null,
  lastSequence: null,
  needsResync: false,
  lastError: null,
  positionChanges: {},
}

const STATE_TYPES: ReadonlySet<ServerMessage["type"]> = new Set([
  "RACE_STATE_SNAPSHOT", "RACE_STATE_UPDATE", "DRIVER_UPDATE", "LAP_COMPLETED",
  "POSITION_CHANGED", "PIT_STATUS_CHANGED", "TRACK_STATUS_CHANGED",
])

const byPosition = (a: DriverState, b: DriverState) =>
  (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER)

const sortedState = <T extends RaceState | null>(state: T): T =>
  (state ? { ...state, drivers: [...state.drivers].sort(byPosition) } : state) as T

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
      const runId = msg.run_id ?? state?.run_id ?? null
      const seq = msg.sequence ?? state?.last_sequence ?? null
      if (runId !== null && runId === live.runId && seq !== null && live.lastSequence !== null && seq < live.lastSequence) return live
      return {
        ...live,
        replay,
        events: runId === live.runId ? live.events : [],
        state: sortedState(state),
        runId,
        lastSequence: seq,
        needsResync: false,
        lastError: state_error,
        positionChanges: {},
      }
    }
    case "REPLAY_STATUS":
    case "REPLAY_COMPLETED":
      // The replay object carries the clock fields, so an older REPLAY_CLOCK must not override it.
      return { ...live, replay: msg.payload.replay, clock: null }
    case "REPLAY_CLOCK":
      return { ...live, clock: msg.payload }
    case "ERROR":
      return { ...live, lastError: msg.payload }
    case "PONG":
      return live
  }

  // Remaining types are run-scoped (state deltas and detections).
  if (msg.type === "RACE_STATE_SNAPSHOT") {
    // Announces a (possibly new) run: adopt it wholesale.
    const { state } = msg.payload
    const runId = msg.run_id ?? state.run_id
    return {
      ...live,
      state: sortedState(state),
      events: runId === live.runId ? live.events : [],
      runId,
      lastSequence: msg.sequence ?? state.last_sequence,
      needsResync: false,
      positionChanges: {},
    }
  }
  // Events dedup by id, so they skip the sequence check, never advance the state cursor and never request a resync.
  if (msg.type === "DETECTED_EVENT") {
    const { event } = msg.payload
    return event.run_id === live.runId ? { ...live, events: mergeEvents(live.events, [event]) } : live
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
      const prev = state.drivers.find((x) => x.driver_id === d.driver_id)?.position
      const moved = prev != null && d.position != null && prev !== d.position
      return {
        ...base,
        positionChanges: moved
          ? { ...live.positionChanges, [d.driver_id]: d.position! < prev ? "gain" : "loss" }
          : prev === d.position && d.driver_id in live.positionChanges
            ? Object.fromEntries(Object.entries(live.positionChanges).filter(([k]) => k !== d.driver_id))
            : live.positionChanges,
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
      // Notifications (POSITION_CHANGED, PIT_STATUS_CHANGED, TRACK_STATUS_CHANGED) are already in the updates.
      return STATE_TYPES.has(msg.type) ? base : live
  }
}
