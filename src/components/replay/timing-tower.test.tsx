import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"
import type { RaceState } from "@/lib/api/types"

type TrackStatus = NonNullable<RaceState["track_status"]>
import { liveStore } from "@/lib/replay/live-store"
import { driver, lap, msg, raceState, replay, REPLAY_ID } from "@/lib/test-fixtures"
import { LiveTiming } from "./timing-tower"

const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
let seq = 10
const send = (m: Parameters<ReturnType<typeof liveStore.getState>["apply"]>[0]) => act(() => liveStore.getState().apply(m))
const upd = (id: string, over: Parameters<typeof driver>[2], pos = 1) => {
  const { recent_laps: _r, ...d } = driver(id, pos, over)
  void _r
  return send(msg("DRIVER_UPDATE", { driver: d }, { sequence: ++seq }))
}
const load = (drivers = [driver("ver", 1, { driver_number: 1 }), driver("ham", 2, { driver_number: 44 })], over = {}) => {
  act(() => {
    liveStore.getState().reset(REPLAY_ID)
    liveStore.getState().setConnectionStatus("open")
    liveStore.getState().apply(msg("SNAPSHOT", { replay: replay(), state: raceState({ drivers, ...over }), state_error: null }, { sequence: 5 }))
  })
}
const rows = () => within(screen.getByRole("table", { name: /timing tower/i })).getAllByRole("row").slice(1)
const order = () => rows().map((r) => within(r).getAllByRole("cell")[1].textContent?.slice(0, 3))

beforeEach(() => { seq = 10; act(() => liveStore.getState().reset(null)) })

describe("timing tower", () => {
  it("renders rows in position order, reorders, no duplicates", () => {
    load()
    render(<LiveTiming />)
    expect(order()).toEqual(["VER", "HAM"])
    upd("ham", { driver_number: 44 }, 1)
    upd("ver", { driver_number: 1 }, 2)
    expect(order()).toEqual(["HAM", "VER"])
    expect(rows()).toHaveLength(2)
  })
  it("null position goes last with dash; nulls show dash not 0", () => {
    load([driver("zzz", 1, { position: null }), driver("ver", 1)])
    upd("ver", {}, 1) // deltas sort by position
    render(<LiveTiming />)
    expect(order()).toEqual(["VER", "ZZZ"])
    const cells = within(rows()[1]).getAllByRole("cell")
    expect(cells[0]).toHaveTextContent("—")
    expect(cells[4]).toHaveTextContent("—")
    expect(cells[3]).toHaveTextContent("—")
    expect(rows()[1]).not.toHaveTextContent("0:00")
  })
  it("shows gap, lap time, compound letter and label, IN PIT then cleared, DNF", () => {
    load([driver("ver", 1), driver("ham", 2, { gap_to_leader_ms: 1240, last_lap_time_ms: 85421, compound: "MEDIUM", tyre_age_laps: 14, pit_status: "IN_PIT" }), driver("sai", 3, { race_status: "DID_NOT_FINISH" })])
    render(<LiveTiming />)
    expect(screen.getByText("LEADER")).toBeInTheDocument()
    expect(screen.getByText("+1.240")).toBeInTheDocument()
    expect(screen.getByText("1:25.421")).toBeInTheDocument()
    expect(screen.getByText("Medium")).toBeInTheDocument()
    expect(screen.getByText("M")).toBeInTheDocument()
    expect(screen.getByText("·14L")).toBeInTheDocument()
    expect(screen.getByText("IN PIT")).toBeInTheDocument()
    expect(screen.getAllByText("DNF")).toHaveLength(2) // status column + mobile badge
    expect(screen.getByText("Did not finish")).toBeInTheDocument()
    expect(screen.getByText("In pit")).toBeInTheDocument()
    upd("ham", { pit_status: "ON_TRACK" }, 2)
    expect(screen.queryByText("IN PIT")).toBeNull()
    expect(screen.queryByText("In pit")).toBeNull()
  })
  it("position change indicator appears from deltas only", () => {
    load()
    render(<LiveTiming />)
    expect(screen.queryByText("Gained")).toBeNull()
    upd("ham", {}, 1)
    expect(screen.getByText("Gained")).toBeInTheDocument()
    expect(screen.queryByText("Lost")).toBeNull()
  })
  it.each<[TrackStatus | null, string]>([
    ["GREEN", "Green flag"], ["YELLOW", "Yellow flag"], ["SAFETY_CAR", "Safety car"], ["VIRTUAL_SAFETY_CAR", "Virtual safety car"],
    ["VIRTUAL_SAFETY_CAR_ENDING", "VSC ending"], ["RED_FLAG", "Red flag"], ["UNKNOWN", "Unknown"], [null, "Track status unavailable"],
  ])("track status %s", (ts, text) => {
    load(undefined, { track_status: ts })
    render(<LiveTiming />)
    expect(screen.getByText(text)).toBeInTheDocument()
  })
  it("finished shows FIN badge text", () => {
    load([driver("ver", 1, { race_status: "FINISHED" }), driver("ham", 2)])
    render(<LiveTiming />)
    expect(screen.getByText("Finished", { selector: ".sr-only" })).toBeInTheDocument()
  })
  it("fastest lap and dash", () => {
    load(undefined, { fastest_lap: { driver_id: "ver", abbreviation: "VER", lap_number: 7, lap_time_ms: 85421, race_time_ms: 1 } })
    render(<LiveTiming />)
    expect(screen.getByText("VER · L7 · 1:25.421")).toBeInTheDocument()
  })
  it("states: created, connecting, stale marker", () => {
    act(() => liveStore.getState().apply(msg("SNAPSHOT", { replay: replay({ status: "CREATED" }), state: null, state_error: null }, { run_id: null, sequence: null })))
    act(() => liveStore.getState().reset(REPLAY_ID))
    act(() => liveStore.getState().apply(msg("SNAPSHOT", { replay: replay({ status: "CREATED" }), state: null, state_error: null }, { run_id: null, sequence: null })))
    const { unmount } = render(<LiveTiming />)
    expect(screen.getByText("Standings appear once the replay starts")).toBeInTheDocument()
    unmount()
    load()
    render(<LiveTiming />)
    expect(screen.queryByText("Timing may be stale")).toBeNull()
    act(() => liveStore.getState().setConnectionStatus("reconnecting"))
    expect(screen.getByText("Timing may be stale")).toBeInTheDocument()
  })
})

describe("driver selection and details", () => {
  const pick = (abbr: string) => screen.getByRole("button", { name: new RegExp(abbr) })
  it("selects by click and keyboard, shows the right driver, survives reorder", async () => {
    load([driver("ver", 1, { full_name: "Max Verstappen" }), driver("ham", 2, { full_name: "Lewis Hamilton" })])
    render(<LiveTiming />)
    expect(screen.getByText("Select a driver")).toBeInTheDocument()
    await userEvent.click(pick("VER"))
    expect(pick("VER")).toHaveAttribute("aria-pressed", "true")
    expect(within(screen.getByRole("region", { name: "Driver details" })).getByText(/Max Verstappen/)).toBeInTheDocument()
    pick("HAM").focus()
    await userEvent.keyboard("{Enter}")
    expect(screen.getByRole("region", { name: "Driver details" })).toHaveTextContent("Lewis Hamilton")
    upd("ham", { full_name: "Lewis Hamilton" }, 1)
    upd("ver", { full_name: "Max Verstappen" }, 2)
    expect(screen.getByRole("region", { name: "Driver details" })).toHaveTextContent("Lewis Hamilton")
    expect(pick("HAM")).toHaveAttribute("aria-pressed", "true")
  })
  it("updates on DRIVER_UPDATE and LAP_COMPLETED, sorted laps and flags", async () => {
    load()
    render(<LiveTiming />)
    await userEvent.click(pick("VER"))
    upd("ver", { last_lap_time_ms: 84000, best_lap_time_ms: 84000, best_lap_number: 3 }, 1)
    const panel = screen.getByRole("region", { name: "Driver details" })
    expect(panel).toHaveTextContent("1:24.000 (L3)")
    act(() => {
      liveStore.getState().apply(msg("LAP_COMPLETED", { driver_id: "ver", abbreviation: "VER", laps_completed: 1, lap: lap(1) }, { sequence: ++seq }))
      liveStore.getState().apply(msg("LAP_COMPLETED", { driver_id: "ver", abbreviation: "VER", laps_completed: 2, lap: lap(2, { is_pit_in_lap: true }) }, { sequence: ++seq }))
    })
    const t = within(screen.getByRole("region", { name: "Recent laps" })).getAllByRole("row").slice(1)
    expect(t[0]).toHaveTextContent("2")
    expect(t[0]).toHaveTextContent("Pit in")
    expect(screen.getByRole("region", { name: "Stints so far" })).toHaveTextContent("Stint 1")
  })
  it("shows fallback when selected driver is gone, and reset clears", async () => {
    load()
    render(<LiveTiming />)
    await userEvent.click(pick("VER"))
    act(() => liveStore.getState().apply(msg("SNAPSHOT", { replay: replay(), state: raceState({ drivers: [driver("ham", 1)] }), state_error: null }, { sequence: 50 })))
    expect(screen.getByText("Driver not in current state")).toBeInTheDocument()
    act(() => liveStore.getState().reset(OTHER))
    expect(liveStore.getState()).toMatchObject({ selectedDriverId: null, state: null, replayId: OTHER, positionChanges: {} })
    expect(screen.queryByText("HAM")).toBeNull()
  })
})
