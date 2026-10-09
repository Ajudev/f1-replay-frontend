"use client"

import { useMemo } from "react"
import { CartesianGrid, Legend, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  buildRows, deriveStints, eventLapRange, gapDifference, lapFlags, PACE_TYPES, pointAt, selectCursor,
  slotStyle, type Metric, type SlotStyle,
} from "@/lib/analytics/timing"
import { useReplayTiming, useVisible } from "@/lib/analytics/use-replay-timing"
import type { DetectedEvent, DriverTimingSeries } from "@/lib/api/types"
import { compoundStyle } from "@/lib/domain-styles"
import { errorMessage } from "@/lib/api/error-message"
import { evidenceLines, eventLabel } from "@/lib/replay/event-format"
import { MAX_COMPARISON, liveStore, useLiveStore } from "@/lib/replay/live-store"
import { formatLapTime } from "@/lib/replay/timing-format"
import { cn } from "@/lib/utils"

type Sel = { series: DriverTimingSeries; slot: number; style: SlotStyle }

const secs = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(3)}s`)
const FORMAT: Record<Metric, (v: number | null) => string> = {
  lapTime: (v) => formatLapTime(v),
  position: (v) => (v == null ? "—" : `P${v}`),
  gap: (v) => secs(v),
}

export function Analytics({ replayId }: { replayId: string }) {
  const q = useReplayTiming(replayId)
  const cursor = useLiveStore(selectCursor)
  const events = useLiveStore((s) => s.events)
  const ids = useLiveStore((s) => s.comparisonDriverIds)
  const highlightedId = useLiveStore((s) => s.highlightedEventId)
  const drivers = useLiveStore((s) => s.state?.drivers)
  const created = useLiveStore((s) => s.replay?.status === "CREATED")
  const stale = useLiveStore((s) => s.connectionStatus !== "open")
  const currentLap = useLiveStore((s) => s.clock?.current_lap ?? s.replay?.current_lap ?? null)

  const { series: all, shown } = useVisible(q.data, events, cursor)
  const selected: Sel[] = useMemo(
    () => ids.flatMap((id, slot) => {
      const series = id ? all.find((d) => d.driver_id === id) : undefined
      return series ? [{ series, slot, style: slotStyle(slot) }] : []
    }),
    [ids, all],
  )
  const highlighted = shown.find((e) => e.detected_event_id === highlightedId) ?? null
  const paceEvents = shown.filter((e) => PACE_TYPES.has(e.event_type) && e.primary_driver_id && ids.includes(e.primary_driver_id))
  const hasLaps = all.some((d) => d.points.length > 0)

  let body: React.ReactNode
  if (created) body = <EmptyState title="Analytics appear once the replay starts" />
  else if (q.isError && !q.data) body = <ErrorState title="Could not load race analytics" message={errorMessage(q.error)} onRetry={() => q.refetch()} />
  else if (cursor == null || q.isPending) body = <div role="status" aria-busy="true" aria-label="Loading analytics"><Skeleton className="h-64" /></div>
  else if (!hasLaps) body = <EmptyState title="Waiting for completed laps" />
  else if (selected.length === 0) body = <EmptyState title="Select at least one driver to view lap times." />
  else {
    const gapRows = buildRows(selected.map((s) => s.series), "gap")
    const hasGap = gapRows.some((r) => selected.some((s) => r[s.series.driver_id] != null))
    const pair = selected.length === 2 ? gapDifference(selected[0].series, selected[1].series) : null
    body = (
      <Tabs defaultValue="lap">
        <TabsList className="flex-wrap">
          <TabsTrigger value="lap">Lap times</TabsTrigger>
          <TabsTrigger value="pos">Position</TabsTrigger>
          <TabsTrigger value="gap">Gap</TabsTrigger>
          <TabsTrigger value="tyre">Tyre stints</TabsTrigger>
          <TabsTrigger value="pace">Pace evidence</TabsTrigger>
        </TabsList>
        <TabsContent value="lap">
          <MetricChart title="Lap time (m:ss.sss) by lap" metric="lapTime" sel={selected} currentLap={currentLap} marks={paceEvents} highlighted={highlighted} />
        </TabsContent>
        <TabsContent value="pos">
          <MetricChart title="Race position (P1 at top) by lap" metric="position" sel={selected} currentLap={currentLap}
            maxPos={Math.max(drivers?.length ?? 0, ...all.flatMap((d) => d.points.map((p) => p.position ?? 0)))} />
        </TabsContent>
        <TabsContent value="gap" className="space-y-4">
          {hasGap ? <MetricChart title="Gap to leader (seconds) by lap" metric="gap" sel={selected} currentLap={currentLap} /> : <EmptyState title="No gap data available yet." />}
          <GapPair sel={selected} diffs={pair} />
        </TabsContent>
        <TabsContent value="tyre"><Stints sel={selected} /></TabsContent>
        <TabsContent value="pace"><PaceEvidence events={paceEvents} /></TabsContent>
      </Tabs>
    )
  }

  return (
    <section aria-label="Race analytics" className="space-y-3 rounded-lg border bg-panel p-3">
      <h2 className="text-base font-semibold">Race analytics</h2>
      {stale && !created && <p role="status" className="text-sm text-warning">Live data may be stale</p>}
      <DriverPicker />
      {body}
    </section>
  )
}

function DriverPicker() {
  const drivers = useLiveStore((s) => s.state?.drivers)
  const ids = useLiveStore((s) => s.comparisonDriverIds)
  if (!drivers?.length) return null
  const full = ids.filter(Boolean).length >= MAX_COMPARISON
  return (
    <div role="group" aria-label="Compare drivers" className="space-y-1">
      <p className="text-xs text-muted-foreground">Compare up to {MAX_COMPARISON} drivers.</p>
      <div className="flex flex-wrap gap-1">
        {drivers.map((d) => {
          const slot = ids.indexOf(d.driver_id)
          const on = slot >= 0
          const { addComparison, removeComparison } = liveStore.getState()
          return (
            <button key={d.driver_id} type="button" aria-pressed={on} disabled={!on && full}
              onClick={() => (on ? removeComparison(d.driver_id) : addComparison(d.driver_id))}
              className={cn("inline-flex h-8 items-center gap-1 rounded-md border px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50", on && "bg-accent font-semibold")}>
              {on && <span aria-hidden className="size-2 rounded-full" style={{ background: slotStyle(slot).color }} />}
              {d.abbreviation}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Marker({ cx, cy, shape, color, flagged }: { cx?: number; cy?: number; shape: SlotStyle["marker"]; color: string; flagged: boolean }) {
  if (cx == null || cy == null || !Number.isFinite(cx) || !Number.isFinite(cy)) return null
  const r = flagged ? 5 : 3.5
  const p = { fill: flagged ? "none" : color, stroke: color, strokeWidth: 2 }
  switch (shape) {
    case "square": return <rect x={cx - r} y={cy - r} width={2 * r} height={2 * r} {...p} />
    case "triangle": return <polygon points={`${cx},${cy - r} ${cx + r},${cy + r} ${cx - r},${cy + r}`} {...p} />
    case "diamond": return <polygon points={`${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`} {...p} />
    default: return <circle cx={cx} cy={cy} r={r} {...p} />
  }
}

function MetricChart({ title, metric, sel, currentLap, marks = [], highlighted = null, maxPos }: {
  title: string; metric: Metric; sel: Sel[]; currentLap: number | null; marks?: DetectedEvent[]; highlighted?: DetectedEvent | null; maxPos?: number
}) {
  const rows = useMemo(() => buildRows(sel.map((s) => s.series), metric), [sel, metric])
  const format = FORMAT[metric]
  const range = highlighted ? eventLapRange(highlighted) : null
  const noteFor = (s: Sel, lap: number) => { const p = pointAt(s.series, lap); return p ? lapFlags(p) : [] }
  return (
    <figure className="space-y-2">
      <figcaption className="text-sm font-medium">{title}</figcaption>
      <div className="h-72 w-full" role="img" aria-label={`${title}. ${summary(sel, rows, format)}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid stroke="currentColor" strokeOpacity={0.15} />
            <XAxis dataKey="lap" type="number" domain={["dataMin", "dataMax"]} allowDecimals={false} tick={{ fill: "currentColor", fontSize: 12 }} label={{ value: "Lap", position: "insideBottomRight", offset: -2, fill: "currentColor", fontSize: 12 }} />
            <YAxis reversed={metric !== "lapTime"} width={64} tickFormatter={(v) => format(v)} allowDecimals={metric === "gap"} tick={{ fill: "currentColor", fontSize: 12 }}
              domain={metric === "position" ? [1, Math.max(maxPos ?? 1, 2)] : metric === "gap" ? [0, "auto"] : ["auto", "auto"]} />
            <Tooltip content={({ active, label }) => active && typeof label === "number" ? (
              <div className="rounded-md border bg-popover p-2 text-xs text-popover-foreground shadow-md">
                <p className="font-medium">Lap {label}</p>
                {sel.map((s) => {
                  const v = rows.find((r) => r.lap === label)?.[s.series.driver_id] ?? null
                  const notes = noteFor(s, label)
                  return <p key={s.series.driver_id} className="tabular">{s.series.abbreviation}: {format(v)}{notes.length > 0 && ` (${notes.join(", ")})`}</p>
                })}
              </div>
            ) : null} />
            <Legend formatter={(v) => <span className="text-foreground">{v}</span>} />
            {currentLap != null && <ReferenceLine x={currentLap} stroke="currentColor" strokeOpacity={0.5} label={{ value: "Now", fill: "currentColor", fontSize: 11, position: "top" }} />}
            {marks.map((e) => { const r = eventLapRange(e); return r ? <ReferenceLine key={e.detected_event_id} x={r[0]} stroke="#facc15" strokeDasharray="3 3" label={{ value: eventLabel(e.event_type), fill: "#facc15", fontSize: 10, position: "insideTopLeft" }} /> : null })}
            {range && <ReferenceArea x1={range[0]} x2={range[1]} fill="#facc15" fillOpacity={0.15} />}
            {sel.map((s) => (
              <Line key={s.series.driver_id} dataKey={s.series.driver_id} name={s.series.abbreviation} stroke={s.style.color} strokeDasharray={s.style.dash}
                connectNulls={false} isAnimationActive={false} legendType={s.style.marker === "circle" ? "circle" : s.style.marker === "square" ? "square" : s.style.marker === "triangle" ? "triangle" : "diamond"}
                dot={(d: { cx?: number; cy?: number; payload?: { lap: number }; value?: unknown; index?: number }) => (
                  d.value == null ? <g key={`${s.series.driver_id}-${d.index}`} /> :
                    <Marker key={`${s.series.driver_id}-${d.index}`} cx={d.cx} cy={d.cy} shape={s.style.marker} color={s.style.color} flagged={noteFor(s, d.payload?.lap ?? -1).length > 0} />)} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-muted-foreground">Hollow markers: deleted, pit or non-green laps. Hover for details.</p>
      <DataTable caption={title} sel={sel} rows={rows} format={format} note={noteFor} />
    </figure>
  )
}

function summary(sel: Sel[], rows: { lap: number }[], format: (v: number | null) => string) {
  const last = rows[rows.length - 1] as Record<string, number | null> | undefined
  if (!last) return "No data."
  return `Latest lap ${last.lap}: ` + sel.map((s) => `${s.series.abbreviation} ${format(last[s.series.driver_id] ?? null)}`).join(", ")
}

function DataTable({ caption, sel, rows, format, note }: {
  caption: string; sel: Sel[]; rows: ({ lap: number } & Record<string, number | null>)[]; format: (v: number | null) => string; note: (s: Sel, lap: number) => string[]
}) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer rounded text-primary focus-visible:outline-2 focus-visible:outline-ring">Data table</summary>
      <div className="max-h-64 overflow-auto">
        <table className="tabular w-full text-left text-xs">
          <caption className="sr-only">{caption}</caption>
          <thead><tr><th scope="col">Lap</th>{sel.map((s) => <th scope="col" key={s.series.driver_id}>{s.series.abbreviation}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.lap}>
                <th scope="row">{r.lap}</th>
                {sel.map((s) => { const n = note(s, r.lap); return <td key={s.series.driver_id}>{format(r[s.series.driver_id] ?? null)}{n.length > 0 && ` (${n.join(", ")})`}</td> })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

function GapPair({ sel, diffs }: { sel: Sel[]; diffs: { lap: number; diff: number }[] | null }) {
  if (!diffs) return <p className="text-sm text-muted-foreground">Select exactly two drivers to compare the gap between them.</p>
  const [a, b] = sel.map((s) => s.series.abbreviation)
  if (diffs.length === 0) return <EmptyState title="No gap data available yet." description={`${a} and ${b} have no lap with both gaps known.`} />
  return (
    <section aria-label="Driver gap comparison" className="space-y-1">
      <h3 className="text-sm font-medium">Lap-end gap, {a} vs {b} (seconds)</h3>
      <table className="tabular w-full text-left text-xs">
        <caption className="sr-only">Gap between {a} and {b} at each lap end</caption>
        <thead><tr><th scope="col">Lap</th><th scope="col">Gap</th><th scope="col">Ahead</th></tr></thead>
        <tbody>
          {diffs.map((d) => (
            <tr key={d.lap}><th scope="row">{d.lap}</th><td>{Math.abs(d.diff).toFixed(3)}s</td><td>{d.diff === 0 ? "Level" : d.diff > 0 ? a : b}</td></tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function Stints({ sel }: { sel: Sel[] }) {
  const data = sel.map((s) => ({ s, stints: deriveStints(s.series.points) }))
  const maxLap = Math.max(1, ...data.flatMap((d) => d.stints.map((x) => x.endLap)))
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">Tyre stints by lap</h3>
      {data.map(({ s, stints }) => (
        <div key={s.series.driver_id}>
          <p className="text-sm font-medium">{s.series.abbreviation}</p>
          <div className="relative h-7 rounded bg-muted" aria-hidden>
            {stints.map((x) => {
              const c = compoundStyle(x.compound)
              return (
                <span key={x.key} className={cn("absolute flex h-full items-center justify-center overflow-hidden border text-xs font-bold", c.className)}
                  style={{ left: `${((x.startLap - 1) / maxLap) * 100}%`, width: `${((x.endLap - x.startLap + 1) / maxLap) * 100}%` }}>{c.short}</span>
              )
            })}
          </div>
          <ul className="text-xs text-muted-foreground">
            {stints.map((x) => (
              <li key={x.key}>
                {x.stint != null ? `Stint ${x.stint}: ` : ""}{x.compound ? compoundStyle(x.compound).label : "Unknown compound"}, laps {x.startLap}–{x.endLap}
                {x.pitInLap != null && `, pit in lap ${x.pitInLap}`}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function PaceEvidence({ events }: { events: DetectedEvent[] }) {
  if (events.length === 0) return <EmptyState title="No pace events for the selected drivers yet." />
  return (
    <ul className="space-y-2">
      {[...events].reverse().map((e) => (
        <li key={e.detected_event_id} className="rounded-md border bg-card p-2 text-sm">
          <p className="font-medium">{eventLabel(e.event_type)} · {e.primary_driver_abbreviation ?? e.primary_driver_id} · Lap {e.lap_number ?? "—"}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            {evidenceLines(e).map((l) => (<div key={l.label} className="contents"><dt className="text-muted-foreground">{l.label}</dt><dd className="tabular">{l.value}</dd></div>))}
          </dl>
        </li>
      ))}
    </ul>
  )
}
