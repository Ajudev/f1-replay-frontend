import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ReplaySocket, type SocketStatus } from "./replay-socket"
import { msg, replay, REPLAY_ID } from "@/lib/test-fixtures"

class FakeWS {
  static instances: FakeWS[] = []
  readyState = 0
  sent: string[] = []
  closed: number | null = null
  onopen: (() => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) { FakeWS.instances.push(this) }
  send(d: string) { this.sent.push(d) }
  close(code: number) { this.closed = code; this.readyState = 3 }
  open() { this.readyState = 1; this.onopen?.() }
  drop(code: number) { this.readyState = 3; this.onclose?.({ code }) }
  recv(data: unknown) { this.onmessage?.({ data }) }
}

const OTHER = "22222222-2222-4222-8222-222222222222"
function setup(extra = {}) {
  const messages: unknown[] = []
  const statuses: SocketStatus[] = []
  const socket = new ReplaySocket({
    onMessage: (m) => messages.push(m), onStatus: (s) => statuses.push(s),
    WebSocketImpl: FakeWS as unknown as typeof WebSocket, baseUrl: "ws://h", random: () => 1, ...extra,
  })
  return { socket, messages, statuses }
}
const last = () => FakeWS.instances[FakeWS.instances.length - 1]

beforeEach(() => { FakeWS.instances = []; vi.useFakeTimers() })
afterEach(() => vi.useRealTimers())

describe("ReplaySocket", () => {
  it("connects to the stream url and reports open", () => {
    const { socket, statuses } = setup()
    socket.connect(REPLAY_ID)
    expect(last().url).toBe(`ws://h/api/v1/replays/${REPLAY_ID}/stream`)
    last().open()
    expect(statuses).toEqual(["connecting", "open"])
  })
  it("guards duplicate connect, including while a retry is pending", () => {
    const { socket } = setup()
    socket.connect(REPLAY_ID); socket.connect(REPLAY_ID)
    expect(FakeWS.instances).toHaveLength(1)
    last().drop(1011)
    socket.connect(REPLAY_ID)
    vi.advanceTimersByTime(500)
    expect(FakeWS.instances).toHaveLength(2)
  })
  it("grows backoff exponentially up to the cap and fails after max attempts", () => {
    const { socket, statuses } = setup({ maxAttempts: 4, maxDelayMs: 1500 })
    socket.connect(REPLAY_ID)
    for (const delay of [500, 1000, 1500, 1500]) {
      last().drop(1006)
      const n = FakeWS.instances.length
      vi.advanceTimersByTime(delay - 1)
      expect(FakeWS.instances).toHaveLength(n)
      vi.advanceTimersByTime(1)
      expect(FakeWS.instances).toHaveLength(n + 1)
    }
    last().drop(1006)
    expect(statuses[statuses.length - 1]).toBe("failed")
  })
  it("resets backoff only after a SNAPSHOT, not on open", () => {
    const { socket } = setup()
    socket.connect(REPLAY_ID)
    last().drop(1006); vi.advanceTimersByTime(500)
    last().drop(1006); vi.advanceTimersByTime(1000)
    last().open()
    last().recv(JSON.stringify(msg("PONG", {})))
    last().recv(JSON.stringify(msg("SNAPSHOT", { replay: replay(), state: null, state_error: null }, { run_id: null, sequence: null })))
    last().drop(1006)
    const n = FakeWS.instances.length
    vi.advanceTimersByTime(500)
    expect(FakeWS.instances).toHaveLength(n + 1)
  })
  it.each([4404, 1008])("does not reconnect on close %i", (code) => {
    const { socket, statuses } = setup()
    socket.connect(REPLAY_ID)
    last().drop(code)
    vi.advanceTimersByTime(60_000)
    expect(FakeWS.instances).toHaveLength(1)
    expect(statuses[statuses.length - 1]).toBe("failed")
  })
  it("does not reconnect after manual disconnect", () => {
    const { socket, statuses } = setup()
    socket.connect(REPLAY_ID)
    const ws = last()
    ws.open()
    socket.disconnect()
    expect(ws.closed).toBe(1000)
    vi.advanceTimersByTime(60_000)
    expect(FakeWS.instances).toHaveLength(1)
    expect(statuses[statuses.length - 1]).toBe("closed")
  })
  it("switching replay closes the old socket first", () => {
    const { socket } = setup()
    socket.connect(REPLAY_ID)
    const old = last()
    socket.connect(OTHER)
    expect(old.closed).toBe(1000)
    expect(last().url).toContain(OTHER)
  })
  it("ignores foreign replay_id, unknown and garbage messages", () => {
    const { socket, messages } = setup()
    socket.connect(REPLAY_ID)
    last().open()
    last().recv(JSON.stringify(msg("REPLAY_STATUS", { replay: replay() }, { replay_id: OTHER })))
    last().recv("garbage")
    last().recv(JSON.stringify({ ...msg("PONG", {}), type: "NOPE" }))
    expect(messages).toHaveLength(0)
    last().recv(JSON.stringify(msg("PONG", {})))
    expect(messages).toHaveLength(1)
  })
  it("pings on interval and sends RESYNC", () => {
    const { socket } = setup({ pingIntervalMs: 1000 })
    socket.connect(REPLAY_ID)
    last().open()
    vi.advanceTimersByTime(2000)
    socket.resync()
    expect(last().sent.map((s) => JSON.parse(s).type)).toEqual(["PING", "PING", "RESYNC"])
  })
  it("open then 1013 cycles without a SNAPSHOT end in failed", () => {
    const { socket, statuses } = setup({ maxAttempts: 3 })
    socket.connect(REPLAY_ID)
    for (let i = 0; i < 3; i++) {
      last().open(); last().drop(1013)
      vi.advanceTimersByTime(30_000)
    }
    last().open(); last().drop(1013)
    expect(statuses[statuses.length - 1]).toBe("failed")
    expect(FakeWS.instances).toHaveLength(4)
  })
})
