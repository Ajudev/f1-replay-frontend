import type { EventQuery, LapQuery, RaceQuery, TimingQuery } from "@/lib/api/endpoints"

/** Every replay-scoped key starts with ["replays", replayId] so one invalidation/removal covers a replay. */
export const queryKeys = {
  seasons: () => ["seasons"] as const,
  races: (q?: RaceQuery) => ["races", "list", q ?? {}] as const,
  race: (raceId: string) => ["races", raceId] as const,
  raceDrivers: (raceId: string, sessionType?: string) => ["races", raceId, "drivers", sessionType ?? null] as const,
  raceLaps: (raceId: string, q?: LapQuery & { session_type?: string }) => ["races", raceId, "laps", q ?? {}] as const,
  session: (sessionId: string) => ["sessions", sessionId] as const,
  sessionLaps: (sessionId: string, q?: LapQuery) => ["sessions", sessionId, "laps", q ?? {}] as const,
  sessionStints: (sessionId: string, driver?: string) => ["sessions", sessionId, "stints", driver ?? null] as const,
  sessionTrackStatus: (sessionId: string) => ["sessions", sessionId, "track-status"] as const,

  replay: (replayId: string) => ["replays", replayId] as const,
  replayState: (replayId: string) => ["replays", replayId, "state"] as const,
  replayDriver: (replayId: string, driver: string) => ["replays", replayId, "drivers", driver] as const,
  replayEvents: (replayId: string, q?: EventQuery) => ["replays", replayId, "events", q ?? {}] as const,
  replayEvent: (replayId: string, eventId: string) => ["replays", replayId, "events", "detail", eventId] as const,
  replayTiming: (replayId: string, q?: TimingQuery) => ["replays", replayId, "timing", q ?? {}] as const,
  replayDriverTiming: (replayId: string, driver: string, q?: Omit<TimingQuery, "driver">) =>
    ["replays", replayId, "drivers", driver, "timing", q ?? {}] as const,
}
