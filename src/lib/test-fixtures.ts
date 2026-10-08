import type { DriverState, RaceState, RecentLap, Replay } from "@/lib/api/types"
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
