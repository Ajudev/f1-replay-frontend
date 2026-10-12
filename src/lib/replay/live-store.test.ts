import { describe, expect, it } from "vitest"
import { createLiveStore } from "./live-store"
import { battle, evt, msg, raceState, replay, REPLAY_ID, RUN_A, RUN_B } from "@/lib/test-fixtures"

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

describe("setBattles (REST fallback)", () => {
  it("replays battle deltas received during the fetch over the REST result, and ignores other runs", () => {
    const store = createLiveStore()
    const s = () => store.getState()
    s().reset(REPLAY_ID)
    s().apply(msg("SNAPSHOT", { replay: replay(), state: raceState(), state_error: null, battles: null }, { sequence: 5 }))
    expect(s().battlesStale).toBe(true)
    s().apply(msg("DETECTED_EVENT", { event: evt("BATTLE_ENDED", {}, { run_id: RUN_A, primary_driver_id: "ham", secondary_driver_id: "ver", detected_event_id: "e1" }) }))
    s().setBattles(REPLAY_ID, RUN_B, [battle("nor", "lec")])
    expect(s().battlesStale).toBe(true) // other run: ignored
    s().setBattles(REPLAY_ID, RUN_A, [battle("ham", "ver"), battle("nor", "lec")]) // computed before the end
    expect(Object.keys(s().battles)).toEqual(["nor:lec"])
    expect(s()).toMatchObject({ battlesStale: false, pendingBattleEvents: [] })
  })
})
