import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api/client"
import { api } from "@/lib/api/endpoints"
import { driverSummary, QUALI_SESSION_ID, RACE_ID, RACE_SESSION_ID, raceSummary, replay, REPLAY_ID } from "@/lib/test-fixtures"
import { RaceDetail } from "./race-detail"
import { RaceExplorer } from "./race-explorer"

vi.mock("@/lib/api/endpoints", () => ({
  api: { seasons: vi.fn(), races: vi.fn(), race: vi.fn(), raceDrivers: vi.fn(), createReplay: vi.fn(), replay: vi.fn() },
}))
const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), search: "" }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => "/races",
  useSearchParams: () => new URLSearchParams(nav.search),
}))

const m = vi.mocked(api, true)
const wrap = (ui: ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  nav.search = ""
  m.seasons.mockResolvedValue([{ season: 2025, race_count: 1 }, { season: 2026, race_count: 2 }])
  m.races.mockImplementation(async (q) =>
    q?.season === 2025 ? [] : [raceSummary(), raceSummary({ id: "x", round: 2, name: "Chinese Grand Prix", country: "China", location: "Shanghai" })],
  )
  m.race.mockResolvedValue(raceSummary())
  m.raceDrivers.mockResolvedValue([driverSummary(), driverSummary({ id: "d2", driver_number: null, abbreviation: "HAM", full_name: "Lewis Hamilton", team_name: null })])
})

describe("RaceExplorer", () => {
  it("lists races for newest season with links preserving season", async () => {
    wrap(<RaceExplorer />)
    expect(await screen.findByText("Australian Grand Prix")).toBeInTheDocument()
    expect(m.races).toHaveBeenCalledWith({ season: 2026 }, expect.anything())
    expect(screen.getByRole("combobox", { name: "Season" })).toHaveValue("2026")
    expect(screen.getAllByText("Qualifying").length).toBeGreaterThan(0)
    expect(screen.getByRole("link", { name: /Australian/ })).toHaveAttribute("href", `/races/${RACE_ID}?season=2026`)
  })
  it("season change pushes URL", async () => {
    wrap(<RaceExplorer />)
    await screen.findByText("Australian Grand Prix")
    await userEvent.selectOptions(screen.getByLabelText("Season"), "2025")
    expect(nav.push).toHaveBeenCalledWith("/races?season=2025")
  })
  it("uses season from URL and shows empty season state", async () => {
    nav.search = "season=2025"
    wrap(<RaceExplorer />)
    expect(await screen.findByText("No imported races for 2025")).toBeInTheDocument()
  })
  it("falls back from an unknown season", async () => {
    nav.search = "season=1999"
    wrap(<RaceExplorer />)
    expect(await screen.findByText(/Season 1999 is not available/)).toBeInTheDocument()
    expect(m.races).toHaveBeenCalledWith({ season: 2026 }, expect.anything())
  })
  it("filters by search and shows no-results", async () => {
    wrap(<RaceExplorer />)
    await screen.findByText("Australian Grand Prix")
    await userEvent.type(screen.getByLabelText("Search races"), "shanghai")
    expect(screen.queryByText("Australian Grand Prix")).toBeNull()
    expect(screen.getByText("Chinese Grand Prix")).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText("Search races"), "zzz")
    expect(screen.getByText("No races match your search")).toBeInTheDocument()
  })
  it("shows empty state with no seasons", async () => {
    m.seasons.mockResolvedValue([])
    wrap(<RaceExplorer />)
    expect(await screen.findByText("No imported races")).toBeInTheDocument()
  })
  it("shows error and retries", async () => {
    m.races.mockRejectedValueOnce(new ApiError(503, "X", "down"))
    wrap(<RaceExplorer />)
    expect(await screen.findByRole("alert")).toHaveTextContent("backend is unavailable")
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(await screen.findByText("Australian Grand Prix")).toBeInTheDocument()
  })
})

describe("RaceDetail", () => {
  it("renders details and drivers with dashes for nulls", async () => {
    wrap(<RaceDetail raceId={RACE_ID} />)
    expect(await screen.findByRole("heading", { name: "Australian Grand Prix" })).toBeInTheDocument()
    expect(await screen.findByText("Lewis Hamilton")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Drivers (2)" })).toBeInTheDocument()
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2)
  })
  it("disables unsupported sessions and creates replay with session id only", async () => {
    m.createReplay.mockResolvedValue(replay())
    wrap(<RaceDetail raceId={RACE_ID} />)
    const quali = await screen.findByRole("radio", { name: /Qualifying/ })
    expect(quali).toBeDisabled()
    expect(screen.getByText(/replay not available/)).toBeInTheDocument()
    const btn = screen.getByRole("button", { name: "Create Replay" })
    await waitFor(() => expect(btn).toBeEnabled())
    await userEvent.dblClick(btn)
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`/replays/${REPLAY_ID}`))
    expect(m.createReplay).toHaveBeenCalledTimes(1)
    expect(m.createReplay.mock.calls[0][0]).toEqual({ session_id: RACE_SESSION_ID, playback_speed: 1 })
    expect(QUALI_SESSION_ID).not.toBe(RACE_SESSION_ID)
  })
  it("offers sprint sessions for replay", async () => {
    const sprint = { ...raceSummary().sessions[1], id: QUALI_SESSION_ID, session_type: "SPRINT" as const, name: "Sprint" }
    m.race.mockResolvedValue(raceSummary({ sessions: [sprint] }))
    wrap(<RaceDetail raceId={RACE_ID} />)
    expect(await screen.findByRole("radio", { name: /Sprint/ })).toBeEnabled()
  })
  it("disabled without selectable session", async () => {
    m.race.mockResolvedValue(raceSummary({ sessions: [raceSummary().sessions[0]] }))
    wrap(<RaceDetail raceId={RACE_ID} />)
    await screen.findByRole("radio", { name: /Qualifying/ })
    expect(screen.getByRole("button", { name: "Create Replay" })).toBeDisabled()
  })
  it("shows error and does not navigate on failure", async () => {
    m.createReplay.mockRejectedValue(new ApiError(409, "X", "Timeline not generated"))
    wrap(<RaceDetail raceId={RACE_ID} />)
    const btn = await screen.findByRole("button", { name: "Create Replay" })
    await waitFor(() => expect(btn).toBeEnabled())
    await userEvent.click(btn)
    expect(await screen.findByRole("alert")).toHaveTextContent("Timeline not generated")
    expect(nav.push).not.toHaveBeenCalled()
  })
  it("shows not found on 404", async () => {
    m.race.mockRejectedValue(new ApiError(404, "NF", "nope"))
    wrap(<RaceDetail raceId={RACE_ID} />)
    expect(await screen.findByText("Race not found")).toBeInTheDocument()
  })
})
