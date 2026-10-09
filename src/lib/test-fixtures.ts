import type { DetectedEvent, DriverState, DriverSummary, RaceState, RaceSummary, RecentLap, Replay } from "@/lib/api/types"
import type { ServerMessage } from "@/lib/ws/messages"

export const REPLAY_ID = "11111111-1111-4111-8111-111111111111"
export const RUN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
export const RUN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

export const lap = (n: number, over: Partial<RecentLap> = {}): RecentLap => ({
  lap_number: n, lap_time_ms: 90_000, position: 1, compound: "SOFT", tyre_age_laps: n, stint_number: 1,
  is_pit_in_lap: false, is_pit_out_lap: false, is_deleted: false, is_accurate: true, track_status: "1",
  race_time_ms: n * 90_000, completion_time_source: null, ...over,
})

export const driver = (id: string, position: number, over: Partial<DriverState> = {}): DriverState =>
  ({
    driver_id: id, abbreviation: id.toUpperCase().slice(0, 3), driver_number: null, full_name: null, team_name: null,
    grid_position: position, position, previous_position: null, laps_completed: 0, current_lap: 1,
    last_lap_time_ms: null, last_lap_race_time_ms: null, best_lap_time_ms: null, best_lap_number: null,
    gap_to_leader_ms: null, interval_to_ahead_ms: null, gap_basis: null, laps_behind_leader: null, compound: null,
    tyre_age_laps: null, stint_number: null, tyre_info_lap: null, pit_status: "ON_TRACK", pit_stop_count: 0,
    last_pit_entry_lap: null, last_pit_entry_race_time_ms: null, last_pit_exit_race_time_ms: null,
    last_pit_lane_duration_ms: null, race_status: "RUNNING", recent_laps: [], ...over,
  }) as DriverState

export const raceState = (over: Partial<RaceState> = {}): RaceState =>
  ({
    replay_id: REPLAY_ID, replay_status: "RUNNING", source: "LIVE", run_id: RUN_A, session_id: "s", race_id: null,
    season: 2024, round: 1, session_type: "R", phase: "RACING", current_race_time_ms: 0, current_lap: 1,
    total_laps: 50, leader_laps_completed: 0, leader_driver_id: "ver", leader_driver_abbreviation: "VER",
    track_status: null, fastest_lap: null, last_sequence: 5, last_event_id: null, total_events: 100,
    updated_at: null, drivers: [driver("ver", 1), driver("ham", 2)], ...over,
  }) as RaceState

export const replay = (over: Partial<Replay> = {}): Replay =>
  ({
    id: REPLAY_ID, session_id: "s", race_id: "r", status: "RUNNING", is_completed: false, status_reason: null,
    playback_speed: 1, current_race_time_ms: 0, current_sequence: null, emitted_event_count: 0, total_events: null,
    current_lap: null, total_laps: null, created_at: "2024-01-01T00:00:00Z", started_at: null, paused_at: null,
    ended_at: null, ...over,
  }) as Replay

/** Builds a typed server message; payload shape is checked by the caller's cast. */
export function msg<T extends ServerMessage["type"]>(
  type: T,
  payload: Extract<ServerMessage, { type: T }>["payload"],
  env: { run_id?: string | null; sequence?: number | null; replay_id?: string } = {},
): Extract<ServerMessage, { type: T }> {
  return {
    type, schema_version: 1, replay_id: env.replay_id ?? REPLAY_ID, run_id: env.run_id === undefined ? RUN_A : env.run_id,
    sequence: env.sequence === undefined ? 6 : env.sequence, race_time_ms: null, lap_number: null,
    emitted_at: "2024-01-01T00:00:00Z", payload,
  } as Extract<ServerMessage, { type: T }>
}

export const RACE_ID = "22222222-2222-4222-8222-222222222222"
export const RACE_SESSION_ID = "33333333-3333-4333-8333-333333333333"
export const QUALI_SESSION_ID = "44444444-4444-4444-8444-444444444444"

export const raceSummary = (over: Partial<RaceSummary> = {}): RaceSummary => ({
  id: RACE_ID, season: 2026, round: 1, name: "Australian Grand Prix", official_name: "Formula 1 Australian Grand Prix 2026",
  country: "Australia", location: "Melbourne", event_date: "2026-03-08",
  sessions: [
    { id: QUALI_SESSION_ID, session_type: "QUALIFYING", name: "Qualifying", start_time: "2026-03-07T05:00:00Z", end_time: null },
    { id: RACE_SESSION_ID, session_type: "RACE", name: "Race", start_time: "2026-03-08T04:00:00Z", end_time: null },
  ],
  ...over,
})

export const driverSummary = (over: Partial<DriverSummary> = {}): DriverSummary => ({
  id: "d1", driver_number: 1, abbreviation: "VER", full_name: "Max Verstappen", first_name: "Max", last_name: "Verstappen",
  team_name: "Red Bull Racing", grid_position: 1, finish_position: 1, result_status: "Finished", ...over,
})

/** Minimal controllable WebSocket for tests; stub with vi.stubGlobal("WebSocket", FakeWS). */
export class FakeWS {
  static instances: FakeWS[] = []
  static get last(): FakeWS { return FakeWS.instances[FakeWS.instances.length - 1] }
  readyState = 0
  sent: string[] = []
  closed = false
  onopen: (() => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) { FakeWS.instances.push(this) }
  send(d: string) { this.sent.push(d) }
  close() { this.closed = true }
  open() { this.readyState = 1; this.onopen?.() }
  push(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }) }
  drop(code = 1006) { this.readyState = 3; this.onclose?.({ code }) }
}

/** Detected events shaped like the backend's DetectedEventOut, with real detector evidence keys. */
export const evt = (event_type: string, evidence: Record<string, unknown> = {}, over: Partial<DetectedEvent> = {}): DetectedEvent =>
  ({
    detected_event_id: `id-${event_type}`, event_type, schema_version: 1, replay_id: "r", run_id: "run", session_id: "s", race_id: null,
    race_time_ms: 3_723_000, lap_number: 12, primary_driver_id: "nor", primary_driver_abbreviation: "NOR",
    secondary_driver_id: "lec", secondary_driver_abbreviation: "LEC", severity: null, confidence: null, evidence,
    source_event_ids: [], source_sequence: 1, detector_name: "d", detector_version: 1, detected_at: "2024-01-01T00:00:00Z", ...over,
  }) as DetectedEvent

export const EVIDENCE: Record<string, Record<string, unknown>> = {
  BATTLE_FORMING: { gap_ms: 1500, gap_history: [{ lap: 8, gap_ms: 3200 }, { lap: 9, gap_ms: 2400 }, { lap: 10, gap_ms: 1500 }], closing_rate_ms_per_lap: 850.5, observed_laps: 3, window_laps: 4, attacker_position: 3, defender_position: 2, basis: "LAP_END", threshold_ms: 2000 },
  RAPIDLY_CLOSING: { gap_ms: 2800, gap_history: [{ lap: 9, gap_ms: 4000 }, { lap: 10, gap_ms: 2800 }], closing_rate_ms_per_lap: 1200, observed_laps: 2, window_laps: 4, attacker_position: 5, defender_position: 4, basis: "LAP_END", max_gap_ms: 3000, min_closing_rate_ms: 1000 },
  OVERTAKE: { lap: 12, overtaker_previous_position: 3, overtaker_new_position: 2, overtaken_previous_position: 2, overtaken_new_position: 3, classification: "ON_TRACK_LIKELY", basis: "LAP_END", confirmed_by: "LEC" },
  PACE_DEGRADATION: { stint_number: 2, compound: "MEDIUM", tyre_age_laps: 18, baseline_median_ms: 90000, recent_median_ms: 90610, delta_ms: 610, slower_recent_laps: 3, baseline_window_laps: 5, recent_window_laps: 3 },
  PACE_ANOMALY: { stint_number: 1, compound: "SOFT", tyre_age_laps: 7, lap_time_ms: 95421, expected_ms: 90000, deviation_ms: 5421, robust_score: 4.567, mad_ms: 300, mad_floor_ms: 250 },
  PERSONAL_BEST: { lap_time_ms: 85421, previous_best_ms: 85900, previous_best_lap: 5, improvement_ms: 479, previous_true_best_ms: 85900, min_improvement_ms: 100, compound: "HARD", tyre_age_laps: 3, stint_number: 2 },
  NEW_STINT: { stint_number: 2, compound: "HARD", previous_stint_number: 1, previous_compound: "MEDIUM", compound_changed: true, starting_lap: 21, tyre_age_laps: 0, pit_lane_duration_ms: 22345, pit_stop_count: 1, source_event_type: "PIT_EXIT" },
}

