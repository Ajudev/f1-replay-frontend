import type { DetectedEvent, DriverState, ErrorBody, RaceState, Replay } from "@/lib/api/types"
import type { CarFrameCar, ClockPayload, ServerMessage } from "@/lib/ws/messages"
import { applyBattleEvent, isBattleEvent, toBattleMap, type BattleMap } from "./battles"

export const MAX_EVENTS = 200
/** CAR_FRAMEs come every ~250 ms of wall time; a bigger race-time step than this (scaled by speed) is a jump, not motion. */
export const SNAP_AFTER_WALL_MS = 1000

const byOrder = (a: DetectedEvent, b: DetectedEvent) =>
  a.source_sequence - b.source_sequence || a.race_time_ms - b.race_time_ms || (a.detected_event_id < b.detected_event_id ? -1 : a.detected_event_id > b.detected_event_id ? 1 : 0)

/** Adds unseen events (by detected_event_id), keeps (source_sequence, race_time_ms, id) order, drops the oldest beyond MAX_EVENTS. */
export function mergeEvents(current: DetectedEvent[], incoming: DetectedEvent[]): DetectedEvent[] {
  const seen = new Set(current.map((e) => e.detected_event_id))
  const fresh = incoming.filter((e) => !seen.has(e.detected_event_id) && seen.add(e.detected_event_id))
  if (fresh.length === 0) return current
  return [...current, ...fresh].sort(byOrder).slice(-MAX_EVENTS)
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
  /**
   * Latest CAR_FRAME, cars keyed by driver_id. `epoch` is the frameEpoch it arrived in. `snap`: draw without animating
   * (first frame of an epoch, or a race-time jump such as a seek).
   */
  carFrame: { epoch: number; race_time_ms: number; snap: boolean; cars: Record<string, CarFrameCar> } | null
  /** Bumped by every snapshot and run change: frames may jump (restart, resync), so markers snap instead of animating. */
  frameEpoch: number
  /** From SNAPSHOT; null until a snapshot that carries the flags. Both false = no CAR_FRAME will arrive. */
  trackAvailability: { positions: boolean; telemetry: boolean } | null
  battles: BattleMap
  /** SNAPSHOT.battles was null: the set may be outdated until a REST fetch of /battles. */
  battlesStale: boolean
  /** Battle detections received while stale; replayed over the REST result so in-flight deltas are not lost. */
  pendingBattleEvents: DetectedEvent[]
  /** Battle detection ids already applied in this run, so a redelivered FORMING cannot revive an ended battle. */
  appliedBattleEventIds: Record<string, true>
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
  carFrame: null,
  frameEpoch: 0,
  trackAvailability: null,
  battles: {},
  battlesStale: false,
  pendingBattleEvents: [],
  appliedBattleEventIds: {},
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
      const { replay, state, state_error, battles, positions_available, telemetry_available } = msg.payload
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
        frameEpoch: live.frameEpoch + 1,
        trackAvailability:
          positions_available === undefined && telemetry_available === undefined
            ? null
            : { positions: positions_available ?? false, telemetry: telemetry_available ?? false },
        // null = unreadable: keep the current run's set and ask for a REST refresh.
        battles: battles ? toBattleMap(battles) : runId === live.runId ? live.battles : {},
        battlesStale: battles === null,
        pendingBattleEvents: [],
        appliedBattleEventIds: runId === live.runId ? live.appliedBattleEventIds : {},
      }
    }
    case "CAR_FRAME": {
      // Envelope run_id is null for frames, so order by race time within the current frame epoch only.
      const { race_time_ms, cars } = msg.payload
      const prev = live.carFrame
      const sameEpoch = prev?.epoch === live.frameEpoch
      const jump = SNAP_AFTER_WALL_MS * (live.clock?.playback_speed ?? live.replay?.playback_speed ?? 1)
      const step = prev ? race_time_ms - prev.race_time_ms : 0
      // A small step back is a reordered frame; a big one is a restart whose snapshot has not arrived yet.
      if (prev && sameEpoch && step < 0 && -step <= jump) return live
      const snap = !prev || !sameEpoch || Math.abs(step) > jump
      return {
        ...live,
        carFrame: { epoch: live.frameEpoch, race_time_ms, snap, cars: Object.fromEntries(cars.map((c) => [c.driver_id, c])) },
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
    const sameRun = runId === live.runId
    return {
      ...live,
      state: sortedState(state),
      events: sameRun ? live.events : [],
      battles: sameRun ? live.battles : {},
      pendingBattleEvents: sameRun ? live.pendingBattleEvents : [],
      appliedBattleEventIds: sameRun ? live.appliedBattleEventIds : {},
      frameEpoch: sameRun ? live.frameEpoch : live.frameEpoch + 1,
      runId,
      lastSequence: msg.sequence ?? state.last_sequence,
      needsResync: false,
      positionChanges: {},
    }
  }
  // Events dedup by id, so they skip the sequence check, never advance the state cursor and never request a resync.
  if (msg.type === "DETECTED_EVENT") {
    const { event } = msg.payload
    if (event.run_id !== live.runId) return live
    const events = mergeEvents(live.events, [event])
    if (!isBattleEvent(event) || live.appliedBattleEventIds[event.detected_event_id]) return { ...live, events }
    return {
      ...live,
      events,
      battles: applyBattleEvent(live.battles, event),
      appliedBattleEventIds: { ...live.appliedBattleEventIds, [event.detected_event_id]: true },
      pendingBattleEvents: live.battlesStale ? [...live.pendingBattleEvents, event] : live.pendingBattleEvents,
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
