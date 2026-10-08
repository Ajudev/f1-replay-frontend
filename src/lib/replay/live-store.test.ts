import { describe, expect, it } from "vitest"
import { createLiveStore } from "./live-store"
import { msg, raceState, replay, REPLAY_ID } from "@/lib/test-fixtures"

describe("live store", () => {
  it("applies messages for the active replay only", () => {
    const store = createLiveStore()
    const snap = msg("SNAPSHOT", { replay: replay(), state: raceState(), state_error: null })
    store.getState().apply(snap)
    expect(store.getState().state).toBeNull() // no replay selected yet
    store.getState().reset(REPLAY_ID)
    store.getState().apply(snap)
    expect(store.getState().state?.drivers).toHaveLength(2)
    store.getState().apply({ ...snap, replay_id: "other" })
    expect(store.getState().replay?.id).toBe(REPLAY_ID)
  })
  it("reset clears everything for the new replay", () => {
    const store = createLiveStore()
    store.getState().reset(REPLAY_ID)
    store.getState().apply(msg("SNAPSHOT", { replay: replay(), state: raceState(), state_error: null }))
    store.getState().selectDriver("ver")
    store.getState().setConnectionStatus("open")
    store.getState().reset("next")
    expect(store.getState()).toMatchObject({
      replayId: "next", state: null, replay: null, clock: null, runId: null, lastSequence: null,
      selectedDriverId: null, connectionStatus: "idle", needsResync: false, lastError: null,
    })
  })
})
