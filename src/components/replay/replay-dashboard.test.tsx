import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api/client"
import { api } from "@/lib/api/endpoints"
import type { Replay } from "@/lib/api/types"
import { REPLAY_POLL_MS } from "@/lib/query/hooks"
import { liveStore } from "@/lib/replay/live-store"
import { FakeWS, msg, raceState, raceSummary, replay, REPLAY_ID } from "@/lib/test-fixtures"
import { ReplayDashboard } from "./replay-dashboard"

vi.mock("@/lib/api/endpoints", () => ({
  api: {
    replay: vi.fn(), race: vi.fn(), startReplay: vi.fn(), pauseReplay: vi.fn(), resumeReplay: vi.fn(),
    stopReplay: vi.fn(), restartReplay: vi.fn(), setReplaySpeed: vi.fn(), replayEvents: vi.fn(),
  },
}))
const m = vi.mocked(api, true)
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

const mount = (id = REPLAY_ID) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const ui = (rid: string) => <QueryClientProvider client={client}><ReplayDashboard replayId={rid} /></QueryClientProvider>
  const r = render(ui(id))
  return { ...r, switchTo: (rid: string) => r.rerender(ui(rid)) }
}
const btn = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) })
const live = (over: Partial<Replay> = {}) => replay({ current_lap: 27, total_laps: 53, current_race_time_ms: 3_723_000, ...over })

beforeEach(() => {
  vi.clearAllMocks()
  FakeWS.instances = []
  vi.stubGlobal("WebSocket", FakeWS)
  m.replayEvents.mockResolvedValue({ replay_id: REPLAY_ID, run_id: null, items: [], total: 0, limit: 200, offset: 0 })
  m.race.mockResolvedValue(raceSummary())
  m.replay.mockResolvedValue(live())
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("ReplayDashboard display", () => {
  it("shows header, status, clock, lap and progress", async () => {
    mount()
    expect(await screen.findByText("Running")).toBeInTheDocument()
    expect(await screen.findByText("Australian Grand Prix")).toBeInTheDocument()
    expect(screen.getByText("01:02:03")).toBeInTheDocument()
    expect(screen.getByText("Lap 27 / 53")).toBeInTheDocument()
    expect(screen.getByRole("progressbar", { name: "Lap progress" })).toHaveAttribute("aria-valuenow", "51")
  })
  it("handles null laps before start", async () => {
    m.replay.mockResolvedValue(replay({ status: "CREATED" }))
    mount()
    expect(await screen.findByText("Not started")).toBeInTheDocument()
    expect(screen.getByText("Lap progress unavailable")).toBeInTheDocument()
    expect(screen.queryByRole("progressbar")).toBeNull()
  })
  it("null total with lap shows dash; completed is 100%; reason shown", async () => {
    m.replay.mockResolvedValue(replay({ status: "FAILED", current_lap: 3, total_laps: null, status_reason: "boom" }))
    mount()
    expect(await screen.findByText("Lap 3 / —")).toBeInTheDocument()
    expect(screen.getByText(/boom/)).toBeInTheDocument()
  })
  it("completed shows 100%", async () => {
    m.replay.mockResolvedValue(live({ status: "COMPLETED", is_completed: true }))
    mount()
    expect(await screen.findByRole("progressbar")).toHaveAttribute("aria-valuenow", "100")
  })
  it("404 shows not found", async () => {
    m.replay.mockRejectedValue(new ApiError(404, "NF", "nope"))
    mount()
    expect(await screen.findByText("Replay not found")).toBeInTheDocument()
  })
  it("other error shows ErrorState", async () => {
    m.replay.mockRejectedValue(new ApiError(503, "X", "down"))
    mount()
    expect(await screen.findByText("Could not load replay")).toBeInTheDocument()
  })
})

describe("controls matrix", () => {
  const matrix = {
    CREATED: ["Start"], RUNNING: ["Pause", "Stop", "Restart"], PAUSED: ["Resume", "Stop", "Restart"],
    STOPPED: ["Restart"], COMPLETED: ["Restart"], FAILED: ["Restart"],
  } as const
  it.each(Object.entries(matrix))("%s", async (status, enabled) => {
    m.replay.mockResolvedValue(replay({ status: status as Replay["status"] }))
    mount()
    await screen.findByRole("group", { name: "Playback speed" })
    for (const n of ["Start", "Pause", "Resume", "Stop", "Restart"]) {
      if ((enabled as readonly string[]).includes(n)) expect(btn(n)).toBeEnabled()
      else expect(btn(n)).toBeDisabled()
    }
    expect(screen.getByText(/only Restart can play it again/)).toBeInTheDocument()
  })
})

describe("commands", () => {
  it("409 shows error, refetches, keeps dashboard", async () => {
    m.replay.mockResolvedValue(replay({ status: "PAUSED" }))
    m.resumeReplay.mockRejectedValue(new ApiError(409, "INVALID", "Cannot resume"))
    mount()
    await userEvent.click(await screen.findByRole("button", { name: /^Resume/ }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot resume")
    await waitFor(() => expect(m.replay).toHaveBeenCalledTimes(2))
    expect(screen.getByText("Paused")).toBeInTheDocument()
  })
  it("full flow", async () => {
    let cur = replay({ status: "CREATED" })
    m.replay.mockImplementation(async () => cur)
    const to = (status: Replay["status"]) => async () => (cur = { ...cur, status })
    m.startReplay.mockImplementation(to("RUNNING"))
    m.pauseReplay.mockImplementation(to("PAUSED"))
    m.resumeReplay.mockImplementation(to("RUNNING"))
    m.stopReplay.mockImplementation(to("STOPPED"))
    m.restartReplay.mockImplementation(to("RUNNING"))
    m.setReplaySpeed.mockImplementation(async (_i, b) => (cur = { ...cur, playback_speed: Number(b.playback_speed) }))
    mount()
    const click = async (n: string, status: string) => {
      await userEvent.click(await screen.findByRole("button", { name: new RegExp(`^${n}`) }))
      await screen.findByText(status)
    }
    await click("Start", "Running")
    expect(m.startReplay).toHaveBeenCalledWith(REPLAY_ID)
    await userEvent.click(screen.getByRole("button", { name: "5x" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "5x" })).toHaveAttribute("aria-pressed", "true"))
    expect(m.setReplaySpeed).toHaveBeenCalledWith(REPLAY_ID, { playback_speed: 5 })
    await click("Pause", "Paused")
    await click("Resume", "Running")
    await click("Stop", "Stopped")
    await click("Restart", "Running")
    expect(m.restartReplay).toHaveBeenCalledWith(REPLAY_ID)
  })
})

describe("speed", () => {
  it("renders all speeds, selected is backend value; failure keeps it and clock", async () => {
    m.replay.mockResolvedValue(live({ playback_speed: 2 }))
    m.setReplaySpeed.mockRejectedValue(new ApiError(422, "BAD", "Unsupported speed"))
    mount()
    const group = await screen.findByRole("group", { name: "Playback speed" })
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["1x", "2x", "5x", "10x", "20x"])
    expect(within(group).getByRole("button", { name: "2x" })).toHaveAttribute("aria-pressed", "true")
    await userEvent.click(within(group).getByRole("button", { name: "20x" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Unsupported speed")
    expect(within(group).getByRole("button", { name: "2x" })).toHaveAttribute("aria-pressed", "true")
    expect(within(group).getByRole("button", { name: "20x" })).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByText("01:02:03")).toBeInTheDocument()
    expect(screen.getByText("Lap 27 / 53")).toBeInTheDocument()
  })
  it("success keeps clock and lap from response", async () => {
    m.setReplaySpeed.mockResolvedValue(live({ playback_speed: 10 }))
    mount()
    await userEvent.click(await screen.findByRole("button", { name: "10x" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "10x" })).toHaveAttribute("aria-pressed", "true"))
    expect(screen.getByText("01:02:03")).toBeInTheDocument()
    expect(screen.getByText("Lap 27 / 53")).toBeInTheDocument()
  })
  it("disables all controls while a command is pending", async () => {
    let done!: (r: Replay) => void
    m.pauseReplay.mockReturnValue(new Promise<Replay>((r) => (done = r)))
    mount()
    await userEvent.click(await screen.findByRole("button", { name: /^Pause/ }))
    expect(btn("Stop")).toBeDisabled()
    expect(screen.getByRole("button", { name: "5x" })).toBeDisabled()
    await act(async () => done(live({ status: "PAUSED" })))
    expect(await screen.findByText("Paused")).toBeInTheDocument()
  })
})

describe("polling and isolation", () => {
  it("polls while the socket is down, stops when terminal, and keeps data on poll error", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mount()
    await screen.findByText("Running")
    m.replay.mockRejectedValue(new ApiError(503, "X", "down"))
    await act(() => vi.advanceTimersByTimeAsync(REPLAY_POLL_MS + 50))
    expect(await screen.findByText(/Live updates interrupted/)).toBeInTheDocument()
    expect(screen.getByText("Lap 27 / 53")).toBeInTheDocument()
    m.replay.mockResolvedValue(live({ status: "COMPLETED" }))
    await act(() => vi.advanceTimersByTimeAsync(REPLAY_POLL_MS + 50))
    await screen.findByText("Completed")
    const calls = m.replay.mock.calls.length
    await act(() => vi.advanceTimersByTimeAsync(REPLAY_POLL_MS * 4))
    expect(m.replay.mock.calls.length).toBe(calls)
  })
  it("switching replay resets error and uses own data", async () => {
    m.replay.mockImplementation(async (id) => (id === OTHER ? live({ id: OTHER, status: "PAUSED" }) : live({ status: "PAUSED" })))
    m.resumeReplay.mockRejectedValue(new ApiError(409, "INVALID", "Cannot resume"))
    const { switchTo } = mount()
    await userEvent.click(await screen.findByRole("button", { name: /^Resume/ }))
    await screen.findByRole("alert")
    switchTo(OTHER)
    await waitFor(() => expect(m.replay).toHaveBeenCalledWith(OTHER, expect.anything()))
    await screen.findByRole("button", { name: /^Resume/ })
    expect(screen.queryByRole("alert")).toBeNull()
  })
})

describe("live connection", () => {
  const snap = (over: Partial<Replay> = {}) => msg("SNAPSHOT", { replay: live(over), state: raceState(), state_error: null }, { sequence: 5 })
  const clock = (ms: number, over = {}) =>
    msg("REPLAY_CLOCK", { status: "RUNNING", current_race_time_ms: ms, current_lap: 30, total_laps: 53, playback_speed: 1, emitted_event_count: 0, total_events: null, ...over }, { run_id: null, sequence: null })
  const status = (r: Replay) => msg("REPLAY_STATUS", { replay: r }, { run_id: null, sequence: null })
  const connect = async () => {
    mount()
    await screen.findByText("Running")
    act(() => FakeWS.last.open())
  }

  it("shows Connecting, then Live from the socket clock; no local interpolation", async () => {
    await connect()
    expect(screen.getByRole("status", { name: "Connection" })).toHaveTextContent("Connecting")
    act(() => FakeWS.last.push(snap()))
    expect(screen.getByRole("status", { name: "Connection" })).toHaveTextContent("Live")
    act(() => FakeWS.last.push(clock(7_200_000)))
    expect(screen.getByText("02:00:00")).toBeInTheDocument()
    expect(screen.getByText("Lap 30 / 53")).toBeInTheDocument()
  })

  it("stops polling while the socket is open and resumes when it is not", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await connect()
    act(() => FakeWS.last.push(snap()))
    m.replay.mockClear()
    await act(async () => vi.advanceTimersByTimeAsync(REPLAY_POLL_MS * 3))
    expect(m.replay).not.toHaveBeenCalled()
    act(() => FakeWS.last.drop())
    expect(screen.getByRole("status", { name: "Connection" })).toHaveTextContent("Reconnecting")
    expect(screen.getByRole("status", { name: "Connection" })).toHaveTextContent("may be stale")
    await act(async () => vi.advanceTimersByTimeAsync(REPLAY_POLL_MS * 2))
    expect(m.replay).toHaveBeenCalled()
  })

  it("failed socket shows Disconnected with Retry, which reconnects without any replay command", async () => {
    await connect()
    act(() => FakeWS.last.drop(4404))
    expect(screen.getByRole("status", { name: "Connection" })).toHaveTextContent("Disconnected")
    await userEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(FakeWS.instances).toHaveLength(2)
    for (const f of [m.startReplay, m.pauseReplay, m.resumeReplay, m.stopReplay, m.restartReplay, m.setReplaySpeed]) expect(f).not.toHaveBeenCalled()
  })

  it("shows Sync error when a resync is needed", async () => {
    await connect()
    act(() => FakeWS.last.push(snap()))
    act(() => liveStore.setState({ needsResync: true }))
    expect(screen.getByRole("status", { name: "Connection" })).toHaveTextContent("Sync error")
  })

  it("the latest frame wins over an earlier REST confirmation", async () => {
    await connect()
    act(() => FakeWS.last.push(snap()))
    m.pauseReplay.mockResolvedValue(live({ status: "PAUSED" }))
    await userEvent.click(screen.getByRole("button", { name: /^Pause/ }))
    expect(await screen.findByText("Paused")).toBeInTheDocument()
    act(() => FakeWS.last.push(clock(9_000_000)))
    act(() => FakeWS.last.push(status(live({ status: "PAUSED", current_race_time_ms: 3_800_000 }))))
    expect(screen.getByText("Paused")).toBeInTheDocument()
    expect(screen.getByText("01:03:20")).toBeInTheDocument()
  })

  it("switching replays closes the old socket and ignores its frames", async () => {
    const { switchTo } = mount()
    await screen.findByText("Running")
    const a = FakeWS.last
    act(() => a.open())
    switchTo(OTHER)
    await screen.findByText("Running")
    expect(a.closed).toBe(true)
    act(() => a.push(snap({ current_lap: 40 })))
    expect(liveStore.getState().replay).toBeNull()
  })
})
