import { useMutation, useQuery } from "@tanstack/react-query"
import { api, type RaceQuery } from "@/lib/api/endpoints"
import type { ReplayCreateRequest } from "@/lib/api/types"
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

export const useReplay = (replayId: string) =>
  useQuery({ queryKey: queryKeys.replay(replayId), queryFn: ({ signal }) => api.replay(replayId, { signal }) })

export const useCreateReplay = () => useMutation({ mutationFn: (body: ReplayCreateRequest) => api.createReplay(body) })
