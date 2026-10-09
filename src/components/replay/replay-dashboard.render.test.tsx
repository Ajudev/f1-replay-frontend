import { render } from "@testing-library/react"
import { act } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { liveStore } from "@/lib/replay/live-store"
import { msg, replay, REPLAY_ID } from "@/lib/test-fixtures"

const renders = { timing: 0, analytics: 0 }
vi.mock("./timing-tower", () => ({ LiveTiming: () => { renders.timing++; return null } }))
vi.mock("./analytics", () => ({ Analytics: () => { renders.analytics++; return null } }))
vi.mock("@/lib/replay/use-replay-live-connection", () => ({ useReplayLiveConnection: () => ({ retry: () => {}, retryEvents: () => {} }) }))
vi.mock("@/lib/query/hooks", () => ({
  useReplay: () => ({ data: replay(), isPending: false, isRefetchError: false }),
  useRace: () => ({ data: undefined }),
  useReplayControl: () => ({ isPending: false, isError: false, mutate: () => {} }),
}))

import { ReplayDashboard } from "./replay-dashboard"

describe("render isolation", () => {
  beforeEach(() => { act(() => liveStore.getState().reset(REPLAY_ID)) })
  it("a clock frame does not re-render LiveTiming or Analytics", () => {
    const { getByLabelText } = render(<ReplayDashboard replayId={REPLAY_ID} />)
    act(() => {
      liveStore.getState().setConnectionStatus("open")
      liveStore.getState().apply(msg("SNAPSHOT", { replay: replay(), state: null, state_error: null }, { sequence: 1 }))
    })
    const before = { ...renders }
    act(() => liveStore.getState().apply(msg("REPLAY_CLOCK", { current_race_time_ms: 5000, current_lap: 2, total_laps: 50, playback_speed: 1, emitted_event_count: 0, total_events: 0, status: "RUNNING" }, { sequence: 2 })))
    expect(getByLabelText("Race clock")).toHaveTextContent("0:05")
    expect(renders).toEqual(before)
  })
})
