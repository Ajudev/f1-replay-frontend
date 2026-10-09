import { describe, expect, it } from "vitest"
import { initialLiveState, liveReducer, type LiveState } from "./live-reducer"
import { driver, lap, msg, raceState, replay, RUN_A, RUN_B } from "@/lib/test-fixtures"

const seeded = (over: Partial<LiveState> = {}): LiveState => ({
  ...initialLiveState, replay: replay(), state: raceState(), runId: RUN_A, lastSequence: 5, ...over,
})

describe("liveReducer", () => {
  it("SNAPSHOT replaces state and sets run/sequence, recording state_error", () => {
    const s = liveReducer(initialLiveState, msg("SNAPSHOT", { replay: replay(), state: raceState(), state_error: null }, { sequence: 5 }))
    expect(s).toMatchObject({ runId: RUN_A, lastSequence: 5, needsResync: false })
    const none = liveReducer(s, msg("SNAPSHOT", { replay: replay(), state: null, state_error: { code: "REPLAY_NOT_STARTED", message: "m", details: null } }, { run_id: null, sequence: null }))
    expect(none.state).toBeNull()
    expect(none.lastError?.code).toBe("REPLAY_NOT_STARTED")
  })
  it("SNAPSHOT of the same run with a lower sequence is ignored", () => {
    const s = liveReducer(initialLiveState, msg("SNAPSHOT", { replay: replay(), state: raceState(), state_error: null }, { sequence: 9 }))
    expect(liveReducer(s, msg("SNAPSHOT", { replay: replay(), state: raceState(), state_error: null }, { sequence: 5 }))).toBe(s)
  })

  it("RACE_STATE_SNAPSHOT replaces state and adopts a new run", () => {
    const s = liveReducer(seeded(), msg("RACE_STATE_SNAPSHOT", { reason: "STATE_INITIALIZED", state: raceState({ run_id: RUN_B, last_sequence: 0 }) }, { run_id: RUN_B, sequence: 0 }))
    expect(s).toMatchObject({ runId: RUN_B, lastSequence: 0, needsResync: false })
  })
  it("RACE_STATE_UPDATE shallow-merges race fields", () => {
    const s = liveReducer(seeded(), msg("RACE_STATE_UPDATE", { kinds: ["LAP"], race: { current_lap: 7 }, last_sequence: 6 }))
    expect(s.state).toMatchObject({ current_lap: 7, last_sequence: 6, total_laps: 50 })
    expect(s.state!.drivers).toHaveLength(2)
  })
  it("DRIVER_UPDATE merges keeping recent_laps and re-sorts by position", () => {
    const base = seeded({ state: raceState({ drivers: [driver("ver", 1, { recent_laps: [lap(1)] }), driver("ham", 2)] }) })
    const { recent_laps: _ignored, ...upd } = driver("ver", 3, { laps_completed: 4 })
    void _ignored
    const s = liveReducer(base, msg("DRIVER_UPDATE", { driver: upd }))
    expect(s.state!.drivers.map((d) => d.driver_id)).toEqual(["ham", "ver"])
    expect(s.state!.drivers[1]).toMatchObject({ laps_completed: 4, position: 3 })
    expect(s.state!.drivers[1].recent_laps ?? []).toHaveLength(1)
  })
  it("LAP_COMPLETED upserts by lap_number", () => {
    let s = liveReducer(seeded(), msg("LAP_COMPLETED", { driver_id: "ver", abbreviation: "VER", lap: lap(1), laps_completed: 1 }))
    s = liveReducer(s, msg("LAP_COMPLETED", { driver_id: "ver", abbreviation: "VER", lap: lap(1, { lap_time_ms: 80_000 }), laps_completed: 1 }))
    s = liveReducer(s, msg("LAP_COMPLETED", { driver_id: "ver", abbreviation: "VER", lap: lap(2), laps_completed: 2 }))
    const laps = s.state!.drivers.find((d) => d.driver_id === "ver")!.recent_laps ?? []
    expect(laps.map((l) => [l.lap_number, l.lap_time_ms])).toEqual([[1, 80_000], [2, 90_000]])
  })
  it("lifecycle messages update replay/clock and are never sequence-filtered", () => {
    const base = seeded({ lastSequence: 100 })
    expect(liveReducer(base, msg("REPLAY_STATUS", { replay: replay({ status: "PAUSED" }) }, { run_id: null, sequence: null })).replay?.status).toBe("PAUSED")
    expect(liveReducer(base, msg("REPLAY_COMPLETED", { replay: replay({ status: "COMPLETED" }) }, { run_id: null, sequence: null })).replay?.status).toBe("COMPLETED")
    const clock = { status: "RUNNING" as const, current_race_time_ms: 5, current_lap: 1, total_laps: 50, playback_speed: 1, emitted_event_count: 1, total_events: 9 }
    expect(liveReducer(base, msg("REPLAY_CLOCK", clock, { run_id: null, sequence: null })).clock).toEqual(clock)
  })
  it("drops stale sequence, applies equal sequence", () => {
    const base = seeded({ lastSequence: 10 })
    const stale = msg("RACE_STATE_UPDATE", { kinds: [], race: { current_lap: 99 }, last_sequence: 9 }, { sequence: 9 })
    expect(liveReducer(base, stale)).toBe(base)
    const equal = liveReducer(base, msg("RACE_STATE_UPDATE", { kinds: [], race: { current_lap: 99 }, last_sequence: 10 }, { sequence: 10 }))
    expect(equal.state!.current_lap).toBe(99)
  })
  it("flags needsResync and does not apply on run_id change", () => {
    const base = seeded()
    const s = liveReducer(base, msg("RACE_STATE_UPDATE", { kinds: [], race: { current_lap: 99 }, last_sequence: 1 }, { run_id: RUN_B, sequence: 1 }))
    expect(s.needsResync).toBe(true)
    expect(s.state).toBe(base.state)
  })
  it("flags needsResync for deltas arriving before any state", () => {
    const s = liveReducer(initialLiveState, msg("DRIVER_UPDATE", { driver: driver("ver", 1) }))
    expect(s.needsResync).toBe(true)
  })
  it("notifications advance sequence only; unknown-driver lap requests resync", () => {
    const base = seeded()
    const s = liveReducer(base, msg("POSITION_CHANGED", { driver_id: "ver", abbreviation: "VER", position: 1, previous_position: 2 }, { sequence: 8 }))
    expect(s.lastSequence).toBe(8)
    expect(s.state).toBe(base.state)
    expect(liveReducer(seeded(), msg("LAP_COMPLETED", { driver_id: "zzz", abbreviation: "ZZZ", lap: lap(1), laps_completed: 1 })).needsResync).toBe(true)
  })
  it("DETECTED_EVENT never sets needsResync", () => {
    const e = msg("DETECTED_EVENT", { event: {} as never })
    expect(liveReducer(initialLiveState, e).needsResync).toBe(false)
  })
  describe("detected events", () => {
    const ev = (id: string, seq = 1, run = RUN_A) =>
      ({ detected_event_id: id, run_id: run, source_sequence: seq, event_type: "OVERTAKE", evidence: { x: 1 } }) as never
    const feed = (s: LiveState, e: ReturnType<typeof ev>, sequence = 6) => liveReducer(s, msg("DETECTED_EVENT", { event: e }, { sequence }))
    it("stores as-is and dedups by id", () => {
      let s = feed(seeded(), ev("a"))
      s = feed(s, ev("a"))
      expect(s.events).toEqual([ev("a")])
    })
    it("accepts an event with a lower sequence without moving the cursor", () => {
      const s = feed(seeded({ lastSequence: 10 }), ev("a"), 3)
      expect(s.events).toHaveLength(1)
      expect(s.lastSequence).toBe(10)
    })
    it("is bounded to the newest 200", () => {
      let s = seeded()
      for (let i = 0; i < 250; i++) s = feed(s, ev(`e${i}`, i))
      expect(s.events).toHaveLength(200)
      expect(s.events[0].detected_event_id).toBe("e50")
    })
    it("clears on a new run, keeps on same-run SNAPSHOT", () => {
      const s = feed(seeded(), ev("a"))
      const same = liveReducer(s, msg("SNAPSHOT", { replay: replay(), state: raceState(), state_error: null }, { sequence: 9 }))
      expect(same.events).toHaveLength(1)
      const next = liveReducer(s, msg("RACE_STATE_SNAPSHOT", { reason: "STATE_INITIALIZED", state: raceState({ run_id: RUN_B, last_sequence: 0 }) }, { run_id: RUN_B, sequence: 0 }))
      expect(next.events).toEqual([])
    })
    it("old-run events are not stored", () => {
      const s = liveReducer(seeded(), msg("DETECTED_EVENT", { event: ev("z", 1, RUN_B) }, { run_id: RUN_B }))
      expect(s.events).toEqual([])
    })
  })
})
