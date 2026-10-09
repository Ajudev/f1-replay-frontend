import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Profiler } from "react"
import { act, render, renderHook, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { api } from "@/lib/api/endpoints"
import type { ReplayTiming } from "@/lib/api/types"
import { liveStore } from "@/lib/replay/live-store"
import { evt, EVIDENCE, msg, raceState, replay, REPLAY_ID, RUN_B, series, tp } from "@/lib/test-fixtures"
import { useVisible } from "@/lib/analytics/use-replay-timing"
import { Analytics } from "./analytics"

const LAPS = [1, 2, 3, 4, 5]
// ver completes lap n at n*90s; ham 5s later, so at one race time they are on different laps.
const ver = series("ver", LAPS.map((l) => tp(l, { lap_time_ms: 80_000 + l * 1000, gap_to_leader_ms: 0, position: 1 })))
const ham = series("ham", LAPS.map((l) => tp(l, { race_time_ms: l * 90_000 + 5_000, lap_time_ms: 90_000 + l * 1000, gap_to_leader_ms: 5_000 + l * 100, position: 2 })))
const full = (): ReplayTiming => ({ replay_id: REPLAY_ID, session_id: "s", upto_sequence: 9, lap_from: null, lap_to: null, drivers: [ver, ham] })

const clock = (ms: number, seq = 7) => act(() => liveStore.getState().apply(msg("REPLAY_CLOCK", { status: "RUNNING", current_race_time_ms: ms, current_lap: 3, total_laps: 5, playback_speed: 1, emitted_event_count: 0, total_events: null }, { sequence: seq })))
const view = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Analytics replayId={REPLAY_ID} /></QueryClientProvider>)
const lapTable = async () => within(await screen.findByRole("table", { name: /Lap time/ }))

let spy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {}) // jsdom has no layout, so ResponsiveContainer warns
  spy = vi.spyOn(api, "replayTiming").mockResolvedValue(full())
  liveStore.getState().reset(REPLAY_ID)
  liveStore.getState().setConnectionStatus("open")
  liveStore.getState().apply(msg("SNAPSHOT", { replay: replay(), state: raceState(), state_error: null }))
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe("Analytics", () => {
  it("asks for a driver, then shows nothing past the cursor in tables, summary or events", async () => {
    clock(3 * 90_000 + 2_000)
    view()
    expect(await screen.findByText("Select at least one driver to view lap times.")).toBeInTheDocument()
    act(() => { liveStore.getState().addComparison("ver"); liveStore.getState().addComparison("ham") })
    const t = await lapTable()
    expect(t.getAllByRole("row").map((r) => r.textContent)).toEqual(["LapVERHAM", "11:21.0001:31.000", "21:22.0001:32.000", "31:23.000—"])
    expect(screen.queryByText(/1:24\.000|1:25\.000|1:33\.000/)).toBeNull()
    expect(screen.getByRole("img", { name: /Latest lap 3: VER 1:23\.000, HAM —/ })).toBeInTheDocument()
    // changing the selection does not reveal anything
    act(() => liveStore.getState().removeComparison("ver"))
    expect((await lapTable()).queryByText("1:24.000")).toBeNull()
  })

  it("hides future events, laps, positions, gaps and stints", async () => {
    const future = evt("PACE_ANOMALY", EVIDENCE.PACE_ANOMALY, { detected_event_id: "late", race_time_ms: 4 * 90_000, lap_number: 4, primary_driver_id: "ver" })
    liveStore.setState({ events: [future], comparisonDriverIds: ["ver", "ham"], runId: raceState().run_id })
    clock(2 * 90_000 + 1_000)
    view()
    const user = userEvent.setup()
    await lapTable()
    await user.click(screen.getByRole("tab", { name: "Position" }))
    expect(within(await screen.findByRole("table", { name: /Race position/ })).getAllByRole("row")).toHaveLength(3) // header + laps 1, 2
    await user.click(screen.getByRole("tab", { name: "Gap" }))
    expect(screen.queryByText(/5\.300s/)).toBeNull()
    await user.click(screen.getByRole("tab", { name: "Tyre stints" }))
    expect(screen.getByText(/laps 1–2/)).toBeInTheDocument() // ver
    expect(screen.getByText(/laps 1–1/)).toBeInTheDocument() // ham is still on lap 2
    expect(screen.queryByText(/laps 1–3/)).toBeNull()
    await user.click(screen.getByRole("tab", { name: "Pace evidence" }))
    expect(screen.getByText("No pace events for the selected drivers yet.")).toBeInTheDocument()
    clock(4 * 90_000)
    expect(await screen.findByText(/Pace anomaly/)).toBeInTheDocument()
  })

  it("grows with the cursor, freezes while paused and resets on a new run", async () => {
    liveStore.setState({ comparisonDriverIds: ["ver"] })
    clock(90_000)
    view()
    const rows = async () => (await lapTable()).getAllByRole("row").length
    expect(await rows()).toBe(2)
    clock(90_000, 8) // paused: the same cursor again
    expect(await rows()).toBe(2)
    clock(3 * 90_000, 9)
    expect(await rows()).toBe(4)
    spy.mockResolvedValue({ ...full(), drivers: [] })
    act(() => liveStore.getState().apply(msg("RACE_STATE_SNAPSHOT", { reason: "STATE_REBUILT", state: raceState({ run_id: RUN_B, current_race_time_ms: 0 }) }, { run_id: RUN_B, sequence: 1 })))
    expect(await screen.findByText("Waiting for completed laps")).toBeInTheDocument()
    expect(liveStore.getState().comparisonDriverIds).toEqual(["ver"])
  })

  it("coalesces refetches: clock ticks never fetch, lap bursts fetch at most once a second", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
    liveStore.setState({ comparisonDriverIds: ["ver"] })
    clock(90_000)
    view()
    const settle = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
    await settle(1_500)
    const base = spy.mock.calls.length
    for (let i = 0; i < 30; i++) clock(90_000 + i, 10 + i)
    await settle(5_000)
    expect(spy.mock.calls.length).toBe(base)
    for (let i = 1; i <= 10; i++) {
      act(() => liveStore.getState().apply(msg("DRIVER_UPDATE", { driver: { ...raceState().drivers[0], laps_completed: i } }, { sequence: 100 + i })))
    }
    await settle(1_500)
    expect(spy.mock.calls.length).toBeLessThanOrEqual(base + 1)
    expect(spy.mock.calls.length).toBeGreaterThan(base)
  })

  it("shows an error with retry when the fetch fails and nothing is cached", async () => {
    spy.mockRejectedValue(new Error("boom"))
    clock(90_000)
    view()
    expect(await screen.findByText("Could not load race analytics")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument()
  })

  it("explains an unstarted replay", () => {
    liveStore.getState().apply(msg("SNAPSHOT", { replay: replay({ status: "CREATED" }), state: raceState(), state_error: null }))
    view()
    expect(screen.getByText("Analytics appear once the replay starts")).toBeInTheDocument()
  })

  it("driver picker toggles by keyboard and caps selection", async () => {
    clock(90_000)
    view()
    const user = userEvent.setup()
    const ver = screen.getByRole("button", { name: "VER" })
    ver.focus()
    await user.keyboard("{Enter}")
    expect(liveStore.getState().comparisonDriverIds).toEqual(["ver"])
    expect(ver).toHaveAttribute("aria-pressed", "true")
    await user.keyboard("{Enter}")
    expect(liveStore.getState().comparisonDriverIds).toEqual([])
  })
})

describe("useVisible", () => {
  it("keeps the same references while clock ticks reveal nothing", () => {
    const events = [evt("OVERTAKE", {}, { race_time_ms: 50_000 })]
    const fullData = full()
    const r2 = renderHook(({ c }) => useVisible(fullData, events, c), { initialProps: { c: 90_000 } })
    const a = r2.result.current
    r2.rerender({ c: 90_500 })
    r2.rerender({ c: 91_000 })
    expect(r2.result.current.series).toBe(a.series)
    expect(r2.result.current.shown).toBe(a.shown)
    r2.rerender({ c: 95_000 }) // ham's lap 1 (95s) is now revealed
    expect(r2.result.current.series).not.toBe(a.series)
  })
})

describe("Analytics render cadence", () => {
  it("a clock frame that crosses no point boundary does not re-render; crossing one does", async () => {
    clock(3 * 90_000 + 2_000)
    let commits = 0
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Profiler id="a" onRender={() => { commits++ }}><Analytics replayId={REPLAY_ID} /></Profiler></QueryClientProvider>)
    await screen.findByText("Select at least one driver to view lap times.")
    const before = commits
    clock(3 * 90_000 + 3_000, 8)
    expect(commits).toBe(before)
    clock(3 * 90_000 + 5_000, 9) // ham completes lap 3
    expect(commits).toBeGreaterThan(before)
  })
})
