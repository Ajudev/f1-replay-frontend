import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api/client"
import { api } from "@/lib/api/endpoints"
import type { CircuitLayout } from "@/lib/api/types"
import { liveStore } from "@/lib/replay/live-store"
import type { SnapshotPayload } from "@/lib/ws/messages"
import { battle, car, driver, msg, raceState, replay, REPLAY_ID, RUN_A } from "@/lib/test-fixtures"
import { CircuitMap } from "./circuit-map"

vi.mock("@/lib/api/endpoints", () => ({ api: { replayCircuit: vi.fn(), replayBattles: vi.fn() } }))
const m = vi.mocked(api, true)

const circuit: CircuitLayout = {
  session_id: "s", circuit_name: "Test Circuit", rotation_deg: 90, bounds: { min_x: 0, max_x: 1000, min_y: 0, max_y: 500 },
  outline: [[0, 0], [1000, 0], [1000, 500], [0, 500]], corners: [{ number: 1, letter: "", x: 1000, y: 0, angle_deg: 45 }],
  sample_interval_ms: 500, warnings: [],
}
const drivers = [driver("ver", 1, { team_color: "3671C6" }), driver("ham", 2, { team_color: null }), driver("nor", 3)]

const load = (over: Partial<SnapshotPayload> = {}) =>
  act(() => {
    const s = liveStore.getState()
    s.reset(REPLAY_ID)
    s.setConnectionStatus("open")
    s.apply(msg("SNAPSHOT", { replay: replay(), state: raceState({ drivers }), state_error: null, positions_available: true, telemetry_available: true, battles: [], ...over }, { sequence: 5 }))
    s.apply(msg("CAR_FRAME", { race_time_ms: 1000, cars: [car("ver", 100, 100), car("ham", 200, 100, { off_track: true }), car("nor", null, null)] }, { run_id: null, sequence: null }))
  })
const mount = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><CircuitMap replayId={REPLAY_ID} /></QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  m.replayCircuit.mockResolvedValue(circuit)
})

describe("CircuitMap", () => {
  it("shows a clear empty state when track data is not imported", async () => {
    m.replayCircuit.mockRejectedValue(new ApiError(404, "TRACK_DATA_NOT_IMPORTED", "not imported"))
    load()
    mount()
    expect(await screen.findByText("Track data not imported")).toBeInTheDocument()
  })
  it("draws markers labelled from race state, hides cars without a position, flags off-track", async () => {
    load()
    mount()
    expect(await screen.findByRole("button", { name: "P1 VER" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "P2 HAM, off track" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /NOR/ })).toBeNull()
    expect(screen.getByText("1")).toBeInTheDocument() // corner label
  })
  it("selects a driver from the map with click or keyboard", async () => {
    load()
    mount()
    const ver = await screen.findByRole("button", { name: "P1 VER" })
    await userEvent.click(ver)
    expect(liveStore.getState().selectedDriverId).toBe("ver")
    ver.focus()
    await userEvent.keyboard("{Enter}")
    expect(liveStore.getState().selectedDriverId).toBeNull()
  })
  it("highlights battle pairs and lists them as text", async () => {
    load({ battles: [battle("ham", "ver")] })
    mount()
    expect(await screen.findByRole("button", { name: "P1 VER, defending in battle" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "P2 HAM, off track, attacking in battle" })).toBeInTheDocument()
    expect(screen.getByText(/HAM attacking VER · gap \+0\.640s/)).toBeInTheDocument()
  })
  it("fetches /battles once when the snapshot could not read them", async () => {
    m.replayBattles.mockResolvedValue({ replay_id: REPLAY_ID, run_id: RUN_A, battles: [battle("ham", "ver")] })
    load({ battles: null })
    mount()
    await waitFor(() => expect(liveStore.getState().battlesStale).toBe(false))
    expect(m.replayBattles).toHaveBeenCalledTimes(1)
    expect(Object.keys(liveStore.getState().battles)).toEqual(["ham:ver"])
  })
  it("says so when the session has no car data", async () => {
    load({ positions_available: false, telemetry_available: false })
    mount()
    expect(await screen.findByText("No car position data for this session.")).toBeInTheDocument()
  })
})
