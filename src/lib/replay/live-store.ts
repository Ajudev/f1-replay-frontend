import { createStore, useStore } from "zustand"
import type { DetectedEvent, Replay } from "@/lib/api/types"
import type { ServerMessage } from "@/lib/ws/messages"
import type { SocketStatus } from "@/lib/ws/replay-socket"
import { initialLiveState, liveReducer, mergeEvents, type LiveState } from "./live-reducer"

export interface LiveStore extends LiveState {
  replayId: string | null
  connectionStatus: SocketStatus
  selectedDriverId: string | null
  apply: (msg: ServerMessage) => void
  /** Writes the REST-confirmed replay; later frames (ordered per replay by the gateway) supersede it. */
  confirmReplay: (replay: Replay) => void
  /** Merges backfilled events; ignored unless replay and run are still the ones requested. */
  mergeEvents: (replayId: string, runId: string, events: DetectedEvent[]) => void
  setConnectionStatus: (s: SocketStatus) => void
  selectDriver: (id: string | null) => void
  reset: (replayId: string | null) => void
}

const blank = { ...initialLiveState, replayId: null, connectionStatus: "idle" as SocketStatus, selectedDriverId: null }

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
        return next === s.events ? s : { events: next }
      }),
    setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
    selectDriver: (selectedDriverId) => set({ selectedDriverId }),
    reset: (replayId) => set({ ...blank, replayId }),
  }))
}

export const liveStore = createLiveStore()

export const useLiveStore = <T,>(selector: (s: LiveStore) => T): T => useStore(liveStore, selector)
