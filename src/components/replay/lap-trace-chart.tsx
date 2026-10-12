"use client"

import { useMemo, useState } from "react"
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { ErrorState } from "@/components/error-state"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api/client"
import { errorMessage } from "@/lib/api/error-message"
import type { TelemetrySample } from "@/lib/api/types"
import { useLapTelemetry } from "@/lib/query/hooks"
import { useLiveStore } from "@/lib/replay/live-store"

type Row = { t: number; speed: number | null; throttle: number | null; throttleRaw: number | null; brake: number | null; gear: number | null }

/** Seconds from the first sample; nulls stay null so lines break instead of dropping to zero. */
export function traceRows(samples: TelemetrySample[]): Row[] {
  const t0 = samples[0]?.race_time_ms ?? 0
  return samples.map((s) => ({
    t: (s.race_time_ms - t0) / 1000,
    speed: s.speed_kph,
    // Raw throttle can exceed 0-100; clamp for drawing only, the tooltip shows the raw value.
    throttle: s.throttle_pct == null ? null : Math.min(100, Math.max(0, s.throttle_pct)),
    throttleRaw: s.throttle_pct,
    brake: s.brake == null ? null : s.brake ? 1 : 0,
    gear: s.gear,
  }))
}

const SERIES: { key: keyof Row; title: string; unit: string; color: string; step?: boolean; domain?: [number, number]; format?: (r: Row) => string }[] = [
  { key: "speed", title: "Speed", unit: "km/h", color: "#38bdf8" },
  { key: "throttle", title: "Throttle", unit: "%", color: "#a3e635", domain: [0, 100], format: (r) => (r.throttleRaw == null ? "—" : `${r.throttleRaw}%`) },
  { key: "brake", title: "Brake", unit: "", color: "#f97316", step: true, domain: [0, 1], format: (r) => (r.brake == null ? "—" : r.brake ? "On" : "Off") },
  { key: "gear", title: "Gear", unit: "", color: "#e879f9", step: true, domain: [0, 8], format: (r) => (r.gear == null ? "—" : r.gear === 0 ? "N" : String(r.gear)) },
]

export function LapTraceChart({ replayId }: { replayId: string }) {
  const id = useLiveStore((s) => s.selectedDriverId)
  if (!id) return null
  // Keyed by driver so the picked lap resets when the selection changes.
  return <Trace key={id} replayId={replayId} driverId={id} />
}

function Trace({ replayId, driverId }: { replayId: string; driverId: string }) {
  const abbr = useLiveStore((s) => s.state?.drivers.find((d) => d.driver_id === driverId)?.abbreviation)
  const done = useLiveStore((s) => s.state?.drivers.find((d) => d.driver_id === driverId)?.laps_completed ?? 0)
  const current = useLiveStore((s) => s.state?.drivers.find((d) => d.driver_id === driverId)?.current_lap ?? null)
  // Only laps the replay has reached are offered; the backend still answers 409 LAP_NOT_REACHED as a guard.
  const maxLap = Math.max(done, current ?? 0)
  const [picked, setPicked] = useState<number | null>(null)
  const lap = maxLap === 0 ? null : Math.min(picked ?? Math.max(done, 1), maxLap)
  const q = useLapTelemetry(replayId, driverId, lap)
  const rows = useMemo(() => traceRows(q.data?.samples ?? []), [q.data])

  let body: React.ReactNode
  if (lap === null) body = <p className="text-sm text-muted-foreground">No laps reached yet.</p>
  else if (q.isPending) body = <div role="status" aria-busy="true" aria-label="Loading lap telemetry"><Skeleton className="h-48" /></div>
  else if (q.error instanceof ApiError && q.error.code === "LAP_NOT_REACHED") body = <p className="text-sm text-muted-foreground">The replay has not reached lap {lap} yet.</p>
  else if (!q.data) body = <ErrorState title="Could not load lap telemetry" message={errorMessage(q.error)} onRetry={() => q.refetch()} />
  else if (rows.length === 0) body = <p className="text-sm text-muted-foreground">No telemetry for this lap.</p>
  else body = (
    <>
      {!q.data.complete && (
        <p role="status" className="flex flex-wrap items-center gap-2 text-sm text-warning">
          Lap in progress — trace shown up to when it was loaded; the full lap loads when it completes.
          <button type="button" onClick={() => q.refetch()} className="rounded text-primary underline focus-visible:outline-2 focus-visible:outline-ring">Refresh</button>
        </p>
      )}
      {SERIES.map((s) => <MiniChart key={s.key} rows={rows} s={s} />)}
    </>
  )
  return (
    <section aria-label="Lap telemetry" className="space-y-2 rounded-lg border bg-panel p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Lap trace{abbr && ` · ${abbr}`}</h2>
        {lap !== null && (
          <label className="flex items-center gap-2 text-sm">
            Lap
            <select className="h-8 rounded-md border bg-background px-2 text-sm" value={lap} onChange={(e) => setPicked(Number(e.target.value))}>
              {Array.from({ length: maxLap }, (_, i) => maxLap - i).map((n) => (
                <option key={n} value={n}>{n}{n > done ? " (in progress)" : ""}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {body}
    </section>
  )
}

function MiniChart({ rows, s }: { rows: Row[]; s: (typeof SERIES)[number] }) {
  const fmt = s.format ?? ((r: Row) => (r[s.key] == null ? "—" : `${r[s.key]} ${s.unit}`))
  return (
    <figure>
      <figcaption className="text-xs text-muted-foreground">{s.title}{s.unit && ` (${s.unit})`}</figcaption>
      <div className="h-24 w-full" role="img" aria-label={`${s.title} against time from lap start`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} syncId="lap-trace">
            <CartesianGrid stroke="currentColor" strokeOpacity={0.1} vertical={false} />
            <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v: number) => `${v.toFixed(0)}s`} tick={{ fill: "currentColor", fontSize: 11 }} />
            <YAxis width={40} domain={s.domain ?? ["auto", "auto"]} allowDecimals={false} tick={{ fill: "currentColor", fontSize: 11 }} />
            <Tooltip content={({ active, payload }) => {
              const r = payload?.[0]?.payload as Row | undefined
              return active && r ? (
                <div className="tabular rounded-md border bg-popover p-2 text-xs text-popover-foreground shadow-md">
                  {r.t.toFixed(2)}s · {s.title}: {fmt(r)}
                </div>
              ) : null
            }} />
            <Line dataKey={s.key} type={s.step ? "stepAfter" : "linear"} stroke={s.color} dot={false} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  )
}
