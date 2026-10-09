"use client"

import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useRef } from "react"
import { api } from "@/lib/api/endpoints"
import { queryKeys } from "@/lib/query/query-keys"
import type { DetectedEvent, DriverTimingSeries, ReplayTiming } from "@/lib/api/types"
import { applyCursor, visibleEvents, type Cursor } from "./timing"
import { useLiveStore } from "@/lib/replay/live-store"

export const TIMING_MIN_INTERVAL_MS = 1000

/** Sum of laps completed: only rises when a lap is released, so it is the refetch watermark. Ignores clock ticks. */
const releasedLaps = (s: { state: { drivers: { laps_completed?: number | null }[] } | null }) =>
  s.state ? s.state.drivers.reduce((n, d) => n + (d.laps_completed ?? 0), 0) : 0

/**
 * Released timing for all drivers. The key carries runId (restart starts clean; the previous run's data is never
 * a placeholder). Refetches only when the lap watermark advances, at most once per TIMING_MIN_INTERVAL_MS.
 */
export function useReplayTiming(replayId: string) {
  const runId = useLiveStore((s) => (s.replayId === replayId ? s.runId : null))
  const watermark = useLiveStore((s) => (s.replayId === replayId ? releasedLaps(s) : 0))
  const q = useQuery({
    queryKey: [...queryKeys.replayTiming(replayId), runId] as const,
    queryFn: ({ signal }) => api.replayTiming(replayId, undefined, { signal }),
    enabled: runId !== null,
    staleTime: Infinity, // refreshed by the watermark below, not by mount or focus
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[4] === runId ? keepPreviousData(prev) : undefined),
  })
  const last = useRef(0)
  const { refetch } = q
  useEffect(() => {
    if (runId === null || watermark === 0) return
    const wait = Math.max(0, TIMING_MIN_INTERVAL_MS - (Date.now() - last.current))
    const t = setTimeout(() => { last.current = Date.now(); void refetch({ cancelRefetch: false }) }, wait)
    return () => clearTimeout(t)
  }, [watermark, runId, refetch])
  return { ...q, runId }
}

/**
 * applyCursor/visibleEvents output that keeps its reference while the visible set is unchanged, so clock ticks
 * that reveal nothing re-render nothing. The signature is the visible count per driver (and for events).
 */
export function useVisible(data: ReplayTiming | undefined, events: readonly DetectedEvent[], cursor: Cursor) {
  const seriesSig = cursor == null || !data ? "" : data.drivers.map((d) => d.points.filter((p) => p.race_time_ms <= cursor).length).join(",")
  const eventSig = cursor == null ? -1 : events.filter((e) => e.race_time_ms <= cursor).length
  // cursor is deliberately not a dependency: the signatures capture everything it changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const series: DriverTimingSeries[] = useMemo(() => applyCursor(data, cursor), [data, seriesSig])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shown = useMemo(() => visibleEvents(events, cursor), [events, eventSig])
  return { series, shown }
}
