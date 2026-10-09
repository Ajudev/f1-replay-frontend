import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api, type RaceQuery } from "@/lib/api/endpoints"
import type { ReplayCreateRequest } from "@/lib/api/types"
import type { ReplayAction } from "@/lib/replay/playback"
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

/** Poll interval while RUNNING; remove when WebSocket updates drive the dashboard. */
export const REPLAY_POLL_MS = 1500

export const useReplay = (replayId: string) =>
  useQuery({
    queryKey: queryKeys.replay(replayId),
    queryFn: ({ signal }) => api.replay(replayId, { signal }),
    refetchInterval: (q) => (q.state.data?.status === "RUNNING" ? REPLAY_POLL_MS : false),
  })

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
    },
    onError: () => qc.invalidateQueries({ queryKey: key }),
  })
}

export const useCreateReplay = () => useMutation({ mutationFn: (body: ReplayCreateRequest) => api.createReplay(body) })
