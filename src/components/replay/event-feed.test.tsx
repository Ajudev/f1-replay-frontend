import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { DetectedEvent } from "@/lib/api/types"
import { MAX_EVENTS } from "@/lib/replay/live-reducer"
import { liveStore } from "@/lib/replay/live-store"
import { EVIDENCE, evt, msg, raceState, replay, REPLAY_ID, RUN_A, RUN_B } from "@/lib/test-fixtures"
import { EventFeed } from "./event-feed"

const TYPES = Object.keys(EVIDENCE)
const ev = (type: string, seq: number, over: Partial<DetectedEvent> = {}) =>
  evt(type, EVIDENCE[type] ?? {}, { detected_event_id: `e${seq}`, source_sequence: seq, run_id: RUN_A, race_time_ms: seq * 1000, ...over })
const send = (...events: DetectedEvent[]) => act(() => { for (const event of events) liveStore.getState().apply(msg("DETECTED_EVENT", { event })) })
const cards = () => screen.queryAllByRole("listitem")

beforeEach(() => {
  liveStore.getState().reset(REPLAY_ID)
  liveStore.getState().setConnectionStatus("open")
  liveStore.getState().apply(msg("SNAPSHOT", { replay: replay(), state: raceState(), state_error: null }))
})

describe("EventFeed", () => {
  it("shows a skeleton before the first snapshot and an empty state after", () => {
    liveStore.getState().reset(REPLAY_ID)
    const { unmount } = render(<EventFeed />)
    expect(screen.getByLabelText("Loading events")).toBeInTheDocument()
    unmount()
    liveStore.getState().apply(msg("SNAPSHOT", { replay: replay(), state: raceState(), state_error: null }))
    liveStore.getState().setConnectionStatus("open")
    render(<EventFeed />)
    expect(screen.getByText("No events detected yet")).toBeInTheDocument()
  })

  it("renders all seven types with evidence in details", async () => {
    render(<EventFeed />)
    send(...TYPES.map((t, i) => ev(t, i + 1)))
    expect(cards()).toHaveLength(7)
    const user = userEvent.setup()
    for (const [label, value] of [["Battle forming", "Gap 1.50s"], ["Overtake", "Overtaker P3 → P2"], ["Pace degradation", "Delta +0.610s"], ["Pace anomaly", "Lap time 1:35.421"], ["Personal best", "Improvement 0.479s"], ["New stint", "Compound Hard"]]) {
      expect(within(cards().find((c) => within(c).queryByText(label))!).getByText(value, { exact: false })).toBeInTheDocument()
    }
    const first = cards()[0]
    await user.click(within(first).getByRole("button", { name: /show details/i }))
    expect(within(first).getByText("Stint")).toBeInTheDocument()
    expect(within(first).getByText(/v1/)).toBeInTheDocument()
    expect(within(first).getByRole("button", { name: /hide details/i })).toHaveAttribute("aria-expanded", "true")
  })

  it("shows severity only when set and confidence only when set", async () => {
    render(<EventFeed />)
    send(ev("PACE_ANOMALY", 1, { severity: "HIGH", confidence: 0.8 }), ev("OVERTAKE", 2))
    expect(screen.getAllByText(/severity/i)).toHaveLength(1)
    const [overtake, anomaly] = cards()
    expect(within(overtake).queryByText(/severity/i)).toBeNull()
    await userEvent.click(within(anomaly).getByRole("button", { name: /show details/i }))
    expect(within(anomaly).getByText(/Confidence 0.8/)).toBeInTheDocument()
  })

  it("renders unknown types and malformed evidence without crashing", async () => {
    render(<EventFeed />)
    send(ev("FUTURE_TYPE", 1, { evidence: { foo: 1 } }), ev("OVERTAKE", 2, { evidence: { classification: 7 } }))
    expect(cards()).toHaveLength(2)
    expect(screen.getByText("Detected event")).toBeInTheDocument()
    await userEvent.click(within(cards()[1]).getByRole("button", { name: /show details/i }))
    expect(within(cards()[1]).getByText("No evidence details available.")).toBeInTheDocument()
  })

  it("lists newest first, ties broken deterministically, null lap shown as a dash", () => {
    render(<EventFeed />)
    send(ev("OVERTAKE", 5, { detected_event_id: "b", race_time_ms: 10 }), ev("NEW_STINT", 5, { detected_event_id: "a", race_time_ms: 10 }), ev("OVERTAKE", 1, { detected_event_id: "old", lap_number: null }))
    expect(cards().map((c) => c.textContent?.match(/Overtake|New stint/)?.[0])).toEqual(["Overtake", "New stint", "Overtake"])
    expect(within(cards()[2]).getByText(/Lap —/)).toBeInTheDocument()
    expect(within(cards()[0]).getByText(/Lap 12 · 00:00:00/)).toBeInTheDocument()
  })

  it("filters by category and driver, combines, resets, and explains empty results", async () => {
    render(<EventFeed />)
    send(ev("OVERTAKE", 1), ev("NEW_STINT", 2, { primary_driver_id: "ver", primary_driver_abbreviation: "VER", secondary_driver_id: null, secondary_driver_abbreviation: null }))
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Stints" }))
    expect(cards()).toHaveLength(1)
    await user.click(screen.getByRole("button", { name: "All" }))
    await user.selectOptions(screen.getByLabelText("Driver"), "lec") // secondary driver matches
    expect(cards()).toHaveLength(1)
    expect(screen.getByText("1 of 2")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Stints" }))
    expect(screen.getByText("No events match these filters")).toBeInTheDocument()
    await user.click(screen.getAllByRole("button", { name: "Reset filters" })[1])
    expect(cards()).toHaveLength(2)
  })

  it("driver buttons select the driver", async () => {
    render(<EventFeed />)
    send(ev("OVERTAKE", 1))
    await userEvent.click(screen.getByRole("button", { name: "Select driver LEC" }))
    expect(liveStore.getState().selectedDriverId).toBe("lec")
    send(ev("NEW_STINT", 2, { secondary_driver_id: null, secondary_driver_abbreviation: null }))
    expect(screen.getAllByRole("button", { name: "Select driver LEC" })).toHaveLength(1)
  })

  it("ignores duplicates, clears on restart, keeps cards when disconnected", () => {
    render(<EventFeed />)
    send(ev("OVERTAKE", 1), ev("OVERTAKE", 1))
    expect(cards()).toHaveLength(1)
    act(() => liveStore.getState().setConnectionStatus("reconnecting"))
    expect(cards()).toHaveLength(1)
    expect(screen.getByText("Live events may be delayed")).toBeInTheDocument()
    act(() => liveStore.getState().setConnectionStatus("open"))
    act(() => liveStore.getState().apply(msg("RACE_STATE_SNAPSHOT", { reason: "STATE_INITIALIZED", state: raceState({ run_id: RUN_B, last_sequence: 0 }) }, { run_id: RUN_B, sequence: 0 })))
    expect(cards()).toHaveLength(0)
    expect(screen.getByText("No events detected yet")).toBeInTheDocument()
  })

  it("collapses the expanded card when its event leaves the list", async () => {
    render(<EventFeed />)
    send(ev("OVERTAKE", 1))
    await userEvent.click(screen.getByRole("button", { name: /show details/i }))
    act(() => liveStore.getState().apply(msg("RACE_STATE_SNAPSHOT", { reason: "STATE_INITIALIZED", state: raceState({ run_id: RUN_B, last_sequence: 0 }) }, { run_id: RUN_B, sequence: 0 })))
    send(ev("OVERTAKE", 1, { run_id: RUN_B, detected_event_id: "new-run" }))
    expect(screen.getByRole("button", { name: /show details/i })).toHaveAttribute("aria-expanded", "false")
  })

  it("stays bounded at 200 and says so", () => {
    render(<EventFeed />)
    send(...Array.from({ length: 250 }, (_, i) => ev("OVERTAKE", i + 1)))
    expect(cards()).toHaveLength(MAX_EVENTS)
    expect(screen.getByText("Showing latest 200 events")).toBeInTheDocument()
  })

  it("shows a notice and Retry when backfill failed, with live cards kept and no false empty state", async () => {
    const retry = vi.fn()
    render(<EventFeed onRetry={retry} />)
    act(() => liveStore.getState().setEventsBackfillError(REPLAY_ID, RUN_A))
    expect(screen.getByText(/Couldn't load earlier events/)).toBeInTheDocument()
    expect(screen.queryByText("No events detected yet")).toBeNull()
    send(ev("OVERTAKE", 1))
    expect(cards()).toHaveLength(1)
    await userEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(retry).toHaveBeenCalled()
    act(() => liveStore.getState().mergeEvents(REPLAY_ID, RUN_A, []))
    expect(screen.queryByText(/Couldn't load/)).toBeNull()
  })

  it("does not claim no events while the socket is not open", () => {
    act(() => liveStore.getState().setConnectionStatus("connecting"))
    render(<EventFeed />)
    expect(screen.queryByText("No events detected yet")).toBeNull()
  })

  it("counts every new event while scrolled down", () => {
    render(<EventFeed />)
    send(ev("OVERTAKE", 1))
    const list = screen.getByLabelText("Event list")
    Object.defineProperty(list, "scrollTop", { value: 100, configurable: true })
    send(ev("OVERTAKE", 2), ev("OVERTAKE", 3))
    expect(screen.getByRole("button", { name: "2 new events" })).toBeInTheDocument()
  })

  it("Show on charts highlights the event and compares its drivers", async () => {
    render(<EventFeed />)
    send(ev("PACE_ANOMALY", 1, { primary_driver_id: "ver", secondary_driver_id: null }))
    await userEvent.setup().click(screen.getByRole("button", { name: "Show on charts" }))
    expect(liveStore.getState()).toMatchObject({ highlightedEventId: "e1", comparisonDriverIds: ["ver"] })
  })
})
