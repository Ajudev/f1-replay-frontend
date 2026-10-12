import { act, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { liveStore } from "@/lib/replay/live-store"
import type { CarFrameCar } from "@/lib/ws/messages"
import { car, msg, raceState, replay, REPLAY_ID } from "@/lib/test-fixtures"
import { TelemetryPanel } from "./telemetry-panel"

const load = (c: CarFrameCar) =>
  act(() => {
    const s = liveStore.getState()
    s.reset(REPLAY_ID)
    s.apply(msg("SNAPSHOT", { replay: replay(), state: raceState(), state_error: null, positions_available: true, telemetry_available: true }, { sequence: 5 }))
    s.apply(msg("CAR_FRAME", { race_time_ms: 1000, cars: [c] }, { run_id: null, sequence: null }))
    s.selectDriver("ver")
  })

beforeEach(() => act(() => liveStore.getState().reset(null)))

describe("TelemetryPanel", () => {
  it("shows 'No data' for null telemetry, never zeros", () => {
    load(car("ver", 1, 1, { telemetry: null }))
    render(<TelemetryPanel />)
    expect(screen.getByText("No data")).toBeInTheDocument()
    expect(screen.queryByText(/km\/h/)).toBeNull()
  })
  it("shows raw values: unclamped throttle, neutral gear, DRS as text, null field as 'No data'", () => {
    load(car("ver", 1, 1, { telemetry: { speed_kph: 287, rpm: null, gear: 0, throttle_pct: 104, brake: true, drs: "ELIGIBLE" } }))
    render(<TelemetryPanel />)
    expect(screen.getByText("287 km/h")).toBeInTheDocument()
    expect(screen.getByText("104%")).toBeInTheDocument()
    expect(screen.getByText("N")).toBeInTheDocument()
    expect(screen.getByText("DRS eligible")).toBeInTheDocument()
    expect(screen.getByText("ON")).toBeInTheDocument()
    expect(screen.getByText("No data")).toBeInTheDocument() // rpm
  })
})
