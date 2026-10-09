import { createStore, useStore } from "zustand"
import type { DetectedEvent, Replay } from "@/lib/api/types"
import type { ServerMessage } from "@/lib/ws/messages"
import type { SocketStatus } from "@/lib/ws/replay-socket"
import { initialLiveState, liveReducer, mergeEvents, type LiveState } from "./live-reducer"

export interface LiveStore extends LiveState {
  replayId: string | null
  connectionStatus: SocketStatus
  selectedDriverId: string | null
  /** Drivers compared in the analytics charts; slot = index and is fixed (removal leaves a null hole). Survives a restart; cleared by reset. */
  comparisonDriverIds: (string | null)[]
  /** Event picked in the feed to highlight on the charts; ignored when it is no longer in `events`. */
  highlightedEventId: string | null
  /** The last event backfill for the current replay and run failed; cleared by the next success. */
  eventsBackfillError: boolean
  apply: (msg: ServerMessage) => void
  /** Writes the REST-confirmed replay; later frames (ordered per replay by the gateway) supersede it. */
  confirmReplay: (replay: Replay) => void
  /** Merges backfilled events; ignored unless replay and run are still the ones requested. */
  mergeEvents: (replayId: string, runId: string, events: DetectedEvent[]) => void
  setEventsBackfillError: (replayId: string, runId: string) => void
  setConnectionStatus: (s: SocketStatus) => void
  selectDriver: (id: string | null) => void
  addComparison: (id: string) => void
  removeComparison: (id: string) => void
  /** Highlights an event and adds its drivers to the comparison while slots remain. */
  highlightEvent: (e: Pick<DetectedEvent, "detected_event_id" | "primary_driver_id" | "secondary_driver_id">) => void
  reset: (replayId: string | null) => void
}

const blank = { ...initialLiveState, replayId: null, connectionStatus: "idle" as SocketStatus, selectedDriverId: null, comparisonDriverIds: [] as string[], highlightedEventId: null as string | null, eventsBackfillError: false }

export const MAX_COMPARISON = 4

/** Puts each new id in the first free slot (a hole, else the end) while fewer than MAX_COMPARISON are used. */
export function fillSlots(cur: (string | null)[], ids: (string | null)[]): (string | null)[] {
  const out = [...cur]
  for (const id of ids) {
    if (!id || out.includes(id)) continue
    const hole = out.indexOf(null)
    if (hole >= 0) out[hole] = id
    else if (out.length < MAX_COMPARISON) out.push(id)
  }
  return out
}

export function createLiveStore() {
  return createStore<LiveStore>()((set) => ({
    ...blank,
    apply: (msg) =>
      set((s) => {
        if (msg.replay_id !== s.replayId) return s // never mix replays
        const next = liveReducer(s, msg)
        return next === s ? s : { ...s, ...next }
      }),
    confirmReplay: (replay) =>
      set((s) =>
        replay.id !== s.replayId
          ? s
          : { replay, clock: null },
      ),
    mergeEvents: (replayId, runId, events) =>
      set((s) => {
        if (s.replayId !== replayId || s.runId !== runId) return s
        const next = mergeEvents(s.events, events)
        return next === s.events && !s.eventsBackfillError ? s : { events: next, eventsBackfillError: false }
      }),
    setEventsBackfillError: (replayId, runId) =>
      set((s) => (s.replayId !== replayId || s.runId !== runId || s.eventsBackfillError ? s : { eventsBackfillError: true })),
    setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
    selectDriver: (selectedDriverId) => set({ selectedDriverId }),
    addComparison: (id) =>
      set((s) => {
        const next = fillSlots(s.comparisonDriverIds, [id])
        return next.length === s.comparisonDriverIds.length && next.every((x, i) => x === s.comparisonDriverIds[i]) ? s : { comparisonDriverIds: next }
      }),
    removeComparison: (id) =>
      set((s) => {
        const next = s.comparisonDriverIds.map((x) => (x === id ? null : x))
        while (next.length && next[next.length - 1] === null) next.pop()
        return { comparisonDriverIds: next }
      }),
    highlightEvent: (e) =>
      set((s) => ({ highlightedEventId: e.detected_event_id, comparisonDriverIds: fillSlots(s.comparisonDriverIds, [e.primary_driver_id, e.secondary_driver_id]) })),
    reset: (replayId) => set({ ...blank, replayId }),
  }))
}

export const liveStore = createLiveStore()

export const useLiveStore = <T,>(selector: (s: LiveStore) => T): T => useStore(liveStore, selector)
