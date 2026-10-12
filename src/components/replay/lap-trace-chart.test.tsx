import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api/client"
import { api } from "@/lib/api/endpoints"
import type { LapTelemetry, TelemetrySample } from "@/lib/api/types"
import { liveStore } from "@/lib/replay/live-store"
import { driver, msg, raceState, replay, REPLAY_ID } from "@/lib/test-fixtures"
import { LapTraceChart, traceRows } from "./lap-trace-chart"

vi.mock("@/lib/api/endpoints", () => ({ api: { replayLapTelemetry: vi.fn() } }))
const m = vi.mocked(api, true)

const trace = (samples: TelemetrySample[], complete = true): LapTelemetry => ({
  replay_id: REPLAY_ID, session_id: "s", driver_id: "ver", abbreviation: "VER", lap_number: 3, upto_race_time_ms: 0, complete, samples, warnings: [],
})
const sample = (t: number, over: Partial<TelemetrySample> = {}): TelemetrySample => ({
  race_time_ms: t, x: 0, y: 0, off_track: false, speed_kph: 300, rpm: 11000, gear: 8, throttle_pct: 100, brake: false, drs: "OFF", ...over,
})

const mount = () => {
  act(() => {
    const s = liveStore.getState()
    s.reset(REPLAY_ID)
    s.apply(msg("SNAPSHOT", { replay: replay(), state: raceState({ drivers: [driver("ver", 1, { laps_completed: 3, current_lap: 4 })] }), state_error: null }, { sequence: 5 }))
    s.selectDriver("ver")
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><LapTraceChart replayId={REPLAY_ID} /></QueryClientProvider>)
}

beforeEach(() => vi.clearAllMocks())

describe("LapTraceChart", () => {
  it("offers only reached laps, defaulting to the last completed one", async () => {
    m.replayLapTelemetry.mockResolvedValue(trace([sample(1000), sample(1500)]))
    mount()
    const select = screen.getByRole("combobox", { name: "Lap" })
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["4 (in progress)", "3", "2", "1"])
    expect(select).toHaveValue("3")
    expect(m.replayLapTelemetry).toHaveBeenCalledWith(REPLAY_ID, "ver", 3, expect.anything())
    expect(await screen.findByText("Speed (km/h)")).toBeInTheDocument()
  })
  it("handles 409 LAP_NOT_REACHED", async () => {
    m.replayLapTelemetry.mockRejectedValue(new ApiError(409, "LAP_NOT_REACHED", "not reached"))
    mount()
    expect(await screen.findByText("The replay has not reached lap 3 yet.")).toBeInTheDocument()
  })
  it("handles a lap without samples", async () => {
    m.replayLapTelemetry.mockResolvedValue(trace([]))
    mount()
    expect(await screen.findByText("No telemetry for this lap.")).toBeInTheDocument()
  })
})

describe("traceRows", () => {
  it("measures time from lap start, keeps nulls, clamps throttle for drawing only", () => {
    const rows = traceRows([sample(10_000), sample(10_500, { speed_kph: null, throttle_pct: 104, brake: null })])
    expect(rows[1]).toMatchObject({ t: 0.5, speed: null, throttle: 100, throttleRaw: 104, brake: null })
  })
})
