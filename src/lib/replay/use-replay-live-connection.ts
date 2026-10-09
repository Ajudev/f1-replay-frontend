"use client"

import { useCallback, useEffect, useRef } from "react"
import { api } from "@/lib/api/endpoints"
import type { DetectedEvent } from "@/lib/api/types"
import { ReplaySocket } from "@/lib/ws/replay-socket"
import { MAX_EVENTS } from "./live-reducer"
import { liveStore } from "./live-store"

/** The backend lists events oldest first, so the newest page is the tail. */
async function fetchRecentEvents(replayId: string, runId: string, signal: AbortSignal): Promise<DetectedEvent[]> {
  const first = await api.replayEvents(replayId, { run_id: runId, limit: MAX_EVENTS }, { signal })
  if (first.total <= first.items.length) return first.items
  const tail = await api.replayEvents(replayId, { run_id: runId, limit: MAX_EVENTS, offset: first.total - MAX_EVENTS }, { signal })
  return tail.items
}

/**
 * Connects the live store to a replay's WebSocket; resets and tears down on unmount or replay change.
 * Returns `retry`, for reconnecting after the socket gave up. Mount once per page (the store is global).
 */
export function useReplayLiveConnection(replayId: string | null): { retry: () => void; retryEvents: () => void } {
  const socketRef = useRef<ReplaySocket | null>(null)
  useEffect(() => {
    if (!replayId) return
    const { reset, apply, setConnectionStatus } = liveStore.getState()
    reset(replayId)
    let backfill: AbortController | null = null
    const socket = new ReplaySocket({
      onMessage: (m) => {
        const before = liveStore.getState().needsResync
        apply(m)
        // Only the false -> true transition sends RESYNC; a SNAPSHOT clears the flag.
        if (!before && liveStore.getState().needsResync) socket.resync()
        if (m.type !== "SNAPSHOT") return
        // Events published while disconnected are never replayed over the socket; recover them over REST.
        const runId = liveStore.getState().runId
        backfill?.abort()
        if (!runId) return
        const ctl = (backfill = new AbortController())
        fetchRecentEvents(replayId, runId, ctl.signal)
          .then((events) => {
            if (!ctl.signal.aborted) liveStore.getState().mergeEvents(replayId, runId, events)
          })
          .catch((e) => {
            if (ctl.signal.aborted) return
            liveStore.getState().setEventsBackfillError(replayId, runId)
            if (process.env.NODE_ENV !== "production") console.warn("[ws] event backfill failed", e)
          })
      },
      onStatus: (s) => {
        setConnectionStatus(s)
        if (s === "open") liveStore.setState({ needsResync: false })
      },
    })
    socketRef.current = socket
    socket.connect(replayId)
    return () => {
      backfill?.abort()
      socket.disconnect()
      socketRef.current = null
      reset(null)
    }
  }, [replayId])
  return {
    retry: useCallback(() => socketRef.current?.retry(), []),
    // A RESYNC yields a fresh SNAPSHOT, which re-runs the backfill; no second fetch path.
    retryEvents: useCallback(() => socketRef.current?.resync(), []),
  }
}
