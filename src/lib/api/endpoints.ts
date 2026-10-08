import { request, type RequestOptions } from "./client"
import type {
  DetectedEvent,
  DetectedEventPage,
  DriverStateResponse,
  DriverSummary,
  DriverTiming,
  LapPage,
  RaceDetail,
  RaceState,
  RaceSummary,
  Replay,
  ReplayCreateRequest,
  ReplaySpeedRequest,
  ReplayTiming,
  SeasonSummary,
  SessionDetail,
  StintOut,
  TrackStatusOut,
} from "./types"

type Opts = Pick<RequestOptions, "signal">
export interface LapQuery {
  driver?: string
  limit?: number
  offset?: number
  lap_from?: number
  lap_to?: number
}
export interface RaceQuery {
  season?: number
  round?: number
  event?: string
  session_type?: string
}
export interface EventQuery extends LapQuery {
  event_type?: string[] // repeatable query param
  run_id?: string
}
export interface TimingQuery {
  driver?: string
  lap_from?: number
  lap_to?: number
}

const enc = encodeURIComponent
const replayCommand = (id: string, action: string, o?: Opts) =>
  request<Replay>(`/replays/${enc(id)}/${action}`, { method: "POST", ...o })

export const api = {
  seasons: (o?: Opts) => request<SeasonSummary[]>("/seasons", o),
  races: (query?: RaceQuery, o?: Opts) => request<RaceSummary[]>("/races", { query, ...o }),
  race: (raceId: string, o?: Opts) => request<RaceDetail>(`/races/${enc(raceId)}`, o),
  raceDrivers: (raceId: string, session_type?: string, o?: Opts) =>
    request<DriverSummary[]>(`/races/${enc(raceId)}/drivers`, { query: { session_type }, ...o }),
  raceLaps: (raceId: string, query?: LapQuery & { session_type?: string }, o?: Opts) =>
    request<LapPage>(`/races/${enc(raceId)}/laps`, { query, ...o }),

  session: (sessionId: string, o?: Opts) => request<SessionDetail>(`/sessions/${enc(sessionId)}`, o),
  sessionLaps: (sessionId: string, query?: LapQuery, o?: Opts) =>
    request<LapPage>(`/sessions/${enc(sessionId)}/laps`, { query, ...o }),
  sessionStints: (sessionId: string, driver?: string, o?: Opts) =>
    request<StintOut[]>(`/sessions/${enc(sessionId)}/stints`, { query: { driver }, ...o }),
  sessionTrackStatus: (sessionId: string, o?: Opts) =>
    request<TrackStatusOut[]>(`/sessions/${enc(sessionId)}/track-status`, o),

  createReplay: (body: ReplayCreateRequest, o?: Opts) => request<Replay>("/replays", { method: "POST", body, ...o }),
  replay: (id: string, o?: Opts) => request<Replay>(`/replays/${enc(id)}`, o),
  startReplay: (id: string, o?: Opts) => replayCommand(id, "start", o),
  pauseReplay: (id: string, o?: Opts) => replayCommand(id, "pause", o),
  resumeReplay: (id: string, o?: Opts) => replayCommand(id, "resume", o),
  stopReplay: (id: string, o?: Opts) => replayCommand(id, "stop", o),
  restartReplay: (id: string, o?: Opts) => replayCommand(id, "restart", o),
  setReplaySpeed: (id: string, body: ReplaySpeedRequest, o?: Opts) =>
    request<Replay>(`/replays/${enc(id)}/speed`, { method: "PATCH", body, ...o }),

  replayState: (id: string, o?: Opts) => request<RaceState>(`/replays/${enc(id)}/state`, o),
  replayDriver: (id: string, driver: string, o?: Opts) =>
    request<DriverStateResponse>(`/replays/${enc(id)}/drivers/${enc(driver)}`, o),
  replayEvents: (id: string, query?: EventQuery, o?: Opts) =>
    request<DetectedEventPage>(`/replays/${enc(id)}/events`, { query: { ...query }, ...o }),
  replayEvent: (id: string, eventId: string, o?: Opts) =>
    request<DetectedEvent>(`/replays/${enc(id)}/events/${enc(eventId)}`, o),
  replayTiming: (id: string, query?: TimingQuery, o?: Opts) =>
    request<ReplayTiming>(`/replays/${enc(id)}/timing`, { query: { ...query }, ...o }),
  replayDriverTiming: (id: string, driver: string, query?: Omit<TimingQuery, "driver">, o?: Opts) =>
    request<DriverTiming>(`/replays/${enc(id)}/drivers/${enc(driver)}/timing`, { query: { ...query }, ...o }),
}
