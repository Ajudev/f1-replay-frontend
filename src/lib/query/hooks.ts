import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api, type RaceQuery } from "@/lib/api/endpoints"
import type { ReplayCreateRequest } from "@/lib/api/types"
import type { ReplayAction } from "@/lib/replay/playback"
import { liveStore, useLiveStore } from "@/lib/replay/live-store"
import { queryKeys } from "./query-keys"

// Imported historical data is near-static.
const STATIC_STALE_MS = 5 * 60_000

export const useSeasons = () =>
  useQuery({ queryKey: queryKeys.seasons(), queryFn: ({ signal }) => api.seasons({ signal }), staleTime: STATIC_STALE_MS })

export const useRaces = (query: RaceQuery, enabled = true) =>
  useQuery({
    queryKey: queryKeys.races(query),
    queryFn: ({ signal }) => api.races(query, { signal }),
    staleTime: STATIC_STALE_MS,
    enabled,
  })

export const useRace = (raceId: string) =>
  useQuery({ queryKey: queryKeys.race(raceId), queryFn: ({ signal }) => api.race(raceId, { signal }), staleTime: STATIC_STALE_MS })

export const useRaceDrivers = (raceId: string, sessionType?: string) =>
  useQuery({
    queryKey: queryKeys.raceDrivers(raceId, sessionType),
    queryFn: ({ signal }) => api.raceDrivers(raceId, sessionType, { signal }),
    staleTime: STATIC_STALE_MS,
  })

/** Fallback poll interval while the socket is down and the replay is not terminal; off whenever the replay's socket is open. */
export const REPLAY_POLL_MS = 1500

const TERMINAL: ReadonlySet<string> = new Set(["COMPLETED", "FAILED", "STOPPED"])

export function useReplay(replayId: string) {
  const socketOpen = useLiveStore((s) => s.replayId === replayId && s.connectionStatus === "open")
  return useQuery({
    queryKey: queryKeys.replay(replayId),
    queryFn: ({ signal }) => api.replay(replayId, { signal }),
    refetchInterval: (q) => (!socketOpen && !TERMINAL.has(q.state.data?.status ?? "") ? REPLAY_POLL_MS : false),
  })
}

export type ReplayCommand = ReplayAction | { speed: number }

const sendCommand = (id: string, c: ReplayCommand) => {
  if (typeof c !== "string") return api.setReplaySpeed(id, { playback_speed: c.speed })
  return { start: api.startReplay, pause: api.pauseReplay, resume: api.resumeReplay, stop: api.stopReplay, restart: api.restartReplay }[c](id)
}

/** Lifecycle and speed commands for one replay. The backend response is written to the cache, never a guess. */
export function useReplayControl(replayId: string) {
  const qc = useQueryClient()
  const key = queryKeys.replay(replayId)
  return useMutation({
    mutationKey: [...key, "command"],
    mutationFn: (c: ReplayCommand) => sendCommand(replayId, c),
    onSuccess: async (data) => {
      await qc.cancelQueries({ queryKey: key }) // a poll started earlier must not overwrite this result
      qc.setQueryData(key, data)
      liveStore.getState().confirmReplay(data)
    },
    onError: () => qc.invalidateQueries({ queryKey: key }),
  })
}

export const useCreateReplay = () => useMutation({ mutationFn: (body: ReplayCreateRequest) => api.createReplay(body) })

/** Track outline and corners; static per session. 404 TRACK_DATA_NOT_IMPORTED is not retried (4xx). */
export const useReplayCircuit = (replayId: string) =>
  useQuery({
    queryKey: queryKeys.replayCircuit(replayId),
    queryFn: ({ signal }) => api.replayCircuit(replayId, { signal }),
    staleTime: Infinity,
  })

/** REST fallback while SNAPSHOT.battles was null; writes the result into the live store for the requesting run. */
export function useBattlesFallback(replayId: string) {
  const runId = useLiveStore((s) => (s.replayId === replayId && s.battlesStale ? s.runId : null))
  useQuery({
    queryKey: [...queryKeys.replayBattles(replayId), runId] as const,
    queryFn: async ({ signal }) => {
      const res = await api.replayBattles(replayId, { signal })
      liveStore.getState().setBattles(replayId, runId!, res.battles)
      return res
    },
    enabled: runId !== null,
    staleTime: 0,
  })
}

/**
 * One lap's telemetry, limited by the backend to the replay clock. While the lap is being driven the key carries the
 * driver's laps_completed, so the driver's LAP_COMPLETED refetches the full lap once.
 */
export function useLapTelemetry(replayId: string, driverId: string | null, lap: number | null) {
  const runId = useLiveStore((s) => (s.replayId === replayId ? s.runId : null))
  const done = useLiveStore((s) => {
    const d = driverId ? s.state?.drivers.find((x) => x.driver_id === driverId) : undefined
    return Math.min(d?.laps_completed ?? 0, lap ?? 0)
  })
  return useQuery({
    queryKey: [...queryKeys.replayLapTelemetry(replayId, driverId ?? "", lap ?? 0), runId, done] as const,
    queryFn: ({ signal }) => api.replayLapTelemetry(replayId, driverId!, lap!, { signal }),
    enabled: runId !== null && driverId !== null && lap !== null,
    staleTime: Infinity,
  })
}
