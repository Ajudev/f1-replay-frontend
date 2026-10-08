import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useReplayLiveConnection } from "./use-replay-live-connection"
import { driver, msg, replay, REPLAY_ID, RUN_B } from "@/lib/test-fixtures"

class FakeWS {
  static last: FakeWS
  readyState = 0
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) { FakeWS.last = this }
  send(d: string) { this.sent.push(d) }
  close() {}
}
afterEach(() => vi.unstubAllGlobals())

describe("useReplayLiveConnection", () => {
  it("sends exactly one RESYNC for many mismatched deltas", () => {
    vi.stubGlobal("WebSocket", FakeWS)
    const { unmount } = renderHook(() => useReplayLiveConnection(REPLAY_ID))
    const ws = FakeWS.last
    act(() => {
      ws.readyState = 1
      ws.onopen?.()
      const send = (m: unknown) => ws.onmessage?.({ data: JSON.stringify(m) })
      send(msg("SNAPSHOT", { replay: replay(), state: null, state_error: null }, { run_id: null, sequence: null }))
      for (let i = 0; i < 5; i++) send(msg("DRIVER_UPDATE", { driver: driver("ver", 1) }, { run_id: RUN_B, sequence: i }))
    })
    expect(ws.sent.filter((s) => JSON.parse(s).type === "RESYNC")).toHaveLength(1)
    unmount()
  })
})
