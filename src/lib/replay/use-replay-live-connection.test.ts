import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { api } from "@/lib/api/endpoints"
import type { DetectedEvent } from "@/lib/api/types"
import { driver, FakeWS, msg, raceState, replay, REPLAY_ID, RUN_A, RUN_B } from "@/lib/test-fixtures"
import { liveStore } from "./live-store"
import { useReplayLiveConnection } from "./use-replay-live-connection"

vi.mock("@/lib/api/endpoints", () => ({ api: { replayEvents: vi.fn() } }))
const events = vi.mocked(api.replayEvents)
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const ev = (id: string, seq = 1, run = RUN_A) =>
  ({ detected_event_id: id, run_id: run, source_sequence: seq, event_type: "OVERTAKE", evidence: { k: 1 } }) as unknown as DetectedEvent
const page = (items: DetectedEvent[], total = items.length) => ({ replay_id: REPLAY_ID, run_id: RUN_A, items, total, limit: 200, offset: 0 })
const snapshot = (over = {}) => msg("SNAPSHOT", { replay: replay(), state: raceState(), state_error: null }, { sequence: 5, ...over })

beforeEach(() => {
  FakeWS.instances = []
  events.mockReset().mockResolvedValue(page([]))
  vi.stubGlobal("WebSocket", FakeWS)
})
afterEach(() => vi.unstubAllGlobals())

describe("useReplayLiveConnection", () => {
  it("sends exactly one RESYNC for many mismatched deltas", () => {
    const { unmount } = renderHook(() => useReplayLiveConnection(REPLAY_ID))
    const ws = FakeWS.last
    act(() => {
      ws.open()
      ws.push(msg("SNAPSHOT", { replay: replay(), state: null, state_error: null }, { run_id: null, sequence: null }))
      for (let i = 0; i < 5; i++) ws.push(msg("DRIVER_UPDATE", { driver: driver("ver", 1) }, { run_id: RUN_B, sequence: i }))
    })
    expect(ws.sent.filter((s) => JSON.parse(s).type === "RESYNC")).toHaveLength(1)
    unmount()
  })

  it("drops invalid frames before the store", () => {
    const { unmount } = renderHook(() => useReplayLiveConnection(REPLAY_ID))
    vi.spyOn(console, "warn").mockImplementation(() => {})
    act(() => {
      FakeWS.last.open()
      FakeWS.last.push({ ...snapshot(), payload: { replay: { id: 1 } } })
    })
    expect(liveStore.getState().replay).toBeNull()
    unmount()
  })

  it("Strict Mode double mount leaves one live socket; unmount closes it", () => {
    const { unmount } = renderHook(() => useReplayLiveConnection(REPLAY_ID), { reactStrictMode: true })
    const open = FakeWS.instances.filter((w) => !w.closed)
    expect(open).toHaveLength(1)
    unmount()
    expect(FakeWS.instances.every((w) => w.closed)).toBe(true)
  })

  it("backfills events on every SNAPSHOT, dedups with live events, keeps the event as-is", async () => {
    events.mockResolvedValue(page([ev("a", 1), ev("b", 2)]))
    const { unmount } = renderHook(() => useReplayLiveConnection(REPLAY_ID))
    act(() => {
      FakeWS.last.open()
      FakeWS.last.push(snapshot())
      FakeWS.last.push(msg("DETECTED_EVENT", { event: ev("b", 2) }))
    })
    await waitFor(() => expect(liveStore.getState().events.map((e) => e.detected_event_id)).toEqual(["a", "b"]))
    expect(liveStore.getState().events[0]).toEqual(ev("a", 1))
    expect(events).toHaveBeenCalledWith(REPLAY_ID, { run_id: RUN_A, limit: 200 }, expect.anything())
    unmount()
  })

  it("reconnect: new SNAPSHOT replaces state, backfills again, keeps same-run events", async () => {
    vi.useFakeTimers()
    const { unmount } = renderHook(() => useReplayLiveConnection(REPLAY_ID))
    act(() => {
      FakeWS.last.open()
      FakeWS.last.push(snapshot())
    })
    await act(async () => {})
    expect(liveStore.getState().state?.last_sequence).toBe(5)
    act(() => FakeWS.last.drop())
    expect(liveStore.getState().connectionStatus).toBe("reconnecting")
    act(() => vi.advanceTimersByTime(1000))
    expect(FakeWS.instances).toHaveLength(2)
    events.mockResolvedValue(page([ev("c", 3)]))
    await act(async () => {
      FakeWS.last.open()
      FakeWS.last.push(snapshot({ sequence: 40 }))
    })
    expect(liveStore.getState().lastSequence).toBe(40)
    expect(events).toHaveBeenCalledTimes(2)
    expect(liveStore.getState().events.map((e) => e.detected_event_id)).toEqual(["c"])
    unmount()
    vi.useRealTimers()
  })

  it("fetches the tail page when more events exist than the cap", async () => {
    events.mockResolvedValueOnce(page([ev("a")], 450)).mockResolvedValueOnce(page([ev("z", 9)], 450))
    const { unmount } = renderHook(() => useReplayLiveConnection(REPLAY_ID))
    act(() => {
      FakeWS.last.open()
      FakeWS.last.push(snapshot())
    })
    await waitFor(() => expect(liveStore.getState().events.map((e) => e.detected_event_id)).toEqual(["z"]))
    expect(events).toHaveBeenLastCalledWith(REPLAY_ID, { run_id: RUN_A, limit: 200, offset: 250 }, expect.anything())
    unmount()
  })

  it("ignores a backfill that resolves after switching replays", async () => {
    let resolve!: (p: ReturnType<typeof page>) => void
    events.mockReturnValueOnce(new Promise((r) => (resolve = r)))
    const { rerender, unmount } = renderHook(({ id }) => useReplayLiveConnection(id), { initialProps: { id: REPLAY_ID } })
    act(() => {
      FakeWS.last.open()
      FakeWS.last.push(snapshot())
    })
    rerender({ id: OTHER })
    await act(async () => resolve(page([ev("late")])))
    expect(liveStore.getState().replayId).toBe(OTHER)
    expect(liveStore.getState().events).toEqual([])
    unmount()
  })

  it("replay A frames never reach replay B", () => {
    const { rerender, unmount } = renderHook(({ id }) => useReplayLiveConnection(id), { initialProps: { id: REPLAY_ID } })
    const a = FakeWS.last
    rerender({ id: OTHER })
    act(() => {
      a.push(snapshot())
      FakeWS.last.open()
    })
    expect(liveStore.getState().replay).toBeNull()
    expect(a.closed).toBe(true)
    unmount()
  })

  it("retry reopens a failed socket without sending any command", () => {
    const { result, unmount } = renderHook(() => useReplayLiveConnection(REPLAY_ID))
    act(() => FakeWS.last.drop(4404))
    expect(liveStore.getState().connectionStatus).toBe("failed")
    act(() => result.current.retry())
    expect(FakeWS.instances).toHaveLength(2)
    expect(liveStore.getState().connectionStatus).toBe("connecting")
    unmount()
  })
})
