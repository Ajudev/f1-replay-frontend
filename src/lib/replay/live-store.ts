import { createStore, useStore } from "zustand"
import type { ServerMessage } from "@/lib/ws/messages"
import type { SocketStatus } from "@/lib/ws/replay-socket"
import { initialLiveState, liveReducer, type LiveState } from "./live-reducer"

export interface LiveStore extends LiveState {
  replayId: string | null
  connectionStatus: SocketStatus
  selectedDriverId: string | null
  apply: (msg: ServerMessage) => void
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
    setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
    selectDriver: (selectedDriverId) => set({ selectedDriverId }),
    reset: (replayId) => set({ ...blank, replayId }),
  }))
}

export const liveStore = createLiveStore()

export const useLiveStore = <T,>(selector: (s: LiveStore) => T): T => useStore(liveStore, selector)
