"use client"

import { useEffect } from "react"
import { ReplaySocket } from "@/lib/ws/replay-socket"
import { liveStore } from "./live-store"

/** Connects the live store to a replay's WebSocket; resets and tears down on unmount or replay change. */
export function useReplayLiveConnection(replayId: string | null): void {
  useEffect(() => {
    if (!replayId) return
    const { reset, apply, setConnectionStatus } = liveStore.getState()
    reset(replayId)
    const socket = new ReplaySocket({
      onMessage: (m) => {
        const before = liveStore.getState().needsResync
        apply(m)
        // Only the false -> true transition sends RESYNC; a SNAPSHOT clears the flag.
        if (!before && liveStore.getState().needsResync) socket.resync()
      },
      onStatus: (s) => {
        setConnectionStatus(s)
        if (s === "open") liveStore.setState({ needsResync: false })
      },
    })
    socket.connect(replayId)
    return () => {
      socket.disconnect()
      reset(null)
    }
  }, [replayId])
}
