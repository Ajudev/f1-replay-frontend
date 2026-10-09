"use client"

import { memo, useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeftRight, ChevronDown, ChevronRight, CircleHelp, Gauge, Swords, Timer, TrendingDown, type LucideIcon } from "lucide-react"
import { EmptyState } from "@/components/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { DetectedEvent } from "@/lib/api/types"
import { severityStyle } from "@/lib/domain-styles"
import {
  CATEGORIES, evidenceLines, eventCategory, eventLabel, eventSummary, filterEvents, newestFirst, type EventCategory,
} from "@/lib/replay/event-format"
import { MAX_EVENTS } from "@/lib/replay/live-reducer"
import { liveStore, useLiveStore } from "@/lib/replay/live-store"
import { formatRaceClock } from "@/lib/replay/playback"

const ICONS: Record<string, LucideIcon> = {
  battles: Swords, overtakes: ArrowLeftRight, pace: TrendingDown, performance: Gauge, stints: Timer,
}
const TOP_THRESHOLD = 24

export function EventFeed({ onRetry }: { onRetry?: () => void } = {}) {
  const events = useLiveStore((s) => s.events)
  const hasSnapshot = useLiveStore((s) => s.replay !== null)
  const connectionStatus = useLiveStore((s) => s.connectionStatus)
  const backfillError = useLiveStore((s) => s.eventsBackfillError)
  const open = useLiveStore((s) => s.connectionStatus === "open")
  const completed = useLiveStore((s) => s.replay?.is_completed === true)
  const [category, setCategory] = useState<EventCategory | "all">("all")
  const [pickedDriver, setDriverId] = useState<string | null>(null)
  const [pickedExpanded, setExpandedId] = useState<string | null>(null)
  const [unseen, setUnseen] = useState(0)
  const scroller = useRef<HTMLDivElement>(null)
  const newestId = useRef<string | null>(null)

  const drivers = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of events) {
      if (e.primary_driver_id) m.set(e.primary_driver_id, e.primary_driver_abbreviation ?? e.primary_driver_id)
      if (e.secondary_driver_id) m.set(e.secondary_driver_id, e.secondary_driver_abbreviation ?? e.secondary_driver_id)
    }
    return [...m].sort((a, b) => a[1].localeCompare(b[1]))
  }, [events])
  // A restart empties the list: a pick that no longer exists is ignored (derived, no effect).
  const driverId = drivers.some(([id]) => id === pickedDriver) ? pickedDriver : null
  const expandedId = events.some((e) => e.detected_event_id === pickedExpanded) ? pickedExpanded : null
  const visible = useMemo(() => newestFirst(filterEvents(events, category, driverId)), [events, category, driverId])

  // New events while scrolled down must not move the viewport; count them instead.
  const topId = visible[0]?.detected_event_id ?? null
  useEffect(() => {
    const prev = newestId.current
    newestId.current = topId
    if (prev === null || topId === prev) return
    if ((scroller.current?.scrollTop ?? 0) <= TOP_THRESHOLD) return
    const added = visible.findIndex((e) => e.detected_event_id === prev)
    setUnseen((n) => n + (added === -1 ? 1 : added))
  }, [topId, visible])

  const reset = () => { setCategory("all"); setDriverId(null) }
  const toTop = () => { scroller.current?.scrollTo({ top: 0 }); setUnseen(0) }
  const filtered = category !== "all" || driverId !== null

  return (
    <section aria-label="Detected events" className="flex min-h-0 flex-col gap-2 rounded-lg border bg-panel p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Events</h2>
        <span className="tabular text-sm text-muted-foreground">
          {filtered ? `${visible.length} of ${events.length}` : events.length}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Event category" className="flex flex-wrap gap-1">
          {[{ id: "all" as const, label: "All" }, ...CATEGORIES].map((c) => (
            <Button key={c.id} size="sm" variant={category === c.id ? "default" : "outline"} aria-pressed={category === c.id} onClick={() => setCategory(c.id)}>
              {c.label}
            </Button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-sm">
          <span className="text-muted-foreground">Driver</span>
          <select className="h-8 rounded-md border bg-background px-2 text-sm" value={driverId ?? ""} onChange={(e) => setDriverId(e.target.value || null)}>
            <option value="">All drivers</option>
            {drivers.map(([id, abbr]) => <option key={id} value={id}>{abbr}</option>)}
          </select>
        </label>
        {filtered && <Button size="sm" variant="ghost" onClick={reset}>Reset filters</Button>}
      </div>
      {connectionStatus !== "open" && hasSnapshot && <p role="status" className="text-sm text-warning">Live events may be delayed</p>}
      {completed && <p className="text-sm text-muted-foreground">Replay finished. Event history stays available.</p>}
      {backfillError && (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-warning">
          Couldn&apos;t load earlier events
          {onRetry && open && <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>}
        </p>
      )}
      {events.length >= MAX_EVENTS && <p className="text-xs text-muted-foreground">Showing latest {MAX_EVENTS} events</p>}
      {!hasSnapshot ? (
        <div role="status" aria-busy="true" aria-label="Loading events"><Skeleton className="h-40" /></div>
      ) : events.length === 0 ? (
        backfillError ? null : open ? <EmptyState title="No events detected yet" /> : <EmptyState title="Events unavailable" description="Waiting for the live connection." />
      ) : visible.length === 0 ? (
        <EmptyState title="No events match these filters"><Button size="sm" variant="outline" onClick={reset}>Reset filters</Button></EmptyState>
      ) : (
        <div className="relative min-h-0">
          {unseen > 0 && (
            <Button size="sm" className="absolute left-1/2 top-1 z-10 -translate-x-1/2" onClick={toTop}>
              {unseen} new {unseen === 1 ? "event" : "events"}
            </Button>
          )}
          <div ref={scroller} tabIndex={0} aria-label="Event list" className="max-h-[32rem] overflow-y-auto rounded-md focus-visible:outline-2 focus-visible:outline-ring" onScroll={(e) => { if (e.currentTarget.scrollTop <= TOP_THRESHOLD) setUnseen(0) }}>
            <ul className="space-y-2">
              {visible.map((e) => (
                <EventCard key={e.detected_event_id} event={e} expanded={expandedId === e.detected_event_id}
                  onToggle={() => setExpandedId((id) => (id === e.detected_event_id ? null : e.detected_event_id))} />
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  )
}

const EventCard = memo(function EventCard({ event: e, expanded, onToggle }: { event: DetectedEvent; expanded: boolean; onToggle: () => void }) {
  const Icon = ICONS[eventCategory(e.event_type) ?? ""] ?? CircleHelp
  const sev = e.severity ? severityStyle(e.severity) : null
  const summary = eventSummary(e)
  const lines = expanded ? evidenceLines(e) : []
  const detailsId = `event-details-${e.detected_event_id}`
  return (
    <li className="rounded-md border bg-card p-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="inline-flex items-center gap-1.5 font-medium"><Icon aria-hidden className="size-4" />{eventLabel(e.event_type)}</span>
        {sev && <Badge variant="outline" className={sev.className}><sev.icon aria-hidden className="size-3" />{sev.label} severity</Badge>}
        <span className="tabular ml-auto text-xs text-muted-foreground">
          Lap {e.lap_number ?? "—"} · {formatRaceClock(e.race_time_ms)}
        </span>
      </div>
      {(e.primary_driver_abbreviation || e.primary_driver_id) && (
        <p className="mt-1 flex items-center gap-1">
          <DriverButton id={e.primary_driver_id} abbr={e.primary_driver_abbreviation} />
          {(e.secondary_driver_id || e.secondary_driver_abbreviation) && (<><span aria-hidden>→</span><DriverButton id={e.secondary_driver_id} abbr={e.secondary_driver_abbreviation} /></>)}
        </p>
      )}
      {summary && <p className="mt-1 text-muted-foreground">{summary}</p>}
      <button type="button" aria-expanded={expanded} aria-controls={detailsId} onClick={onToggle}
        className="mt-1 inline-flex items-center gap-1 rounded text-xs text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring">
        {expanded ? <ChevronDown aria-hidden className="size-3.5" /> : <ChevronRight aria-hidden className="size-3.5" />}
        {expanded ? "Hide details" : "Show details"}
      </button>
      {e.primary_driver_id && (
        <button type="button" onClick={() => liveStore.getState().highlightEvent(e)}
          className="ml-3 mt-1 inline-flex items-center gap-1 rounded text-xs text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring">
          Show on charts
        </button>
      )}
      {expanded && (
        <div id={detailsId} className="mt-1 space-y-1 border-t pt-1">
          {lines.length > 0 ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              {lines.map((l) => (<div key={l.label} className="contents"><dt className="text-muted-foreground">{l.label}</dt><dd className="tabular">{l.value}</dd></div>))}
            </dl>
          ) : <p className="text-muted-foreground">No evidence details available.</p>}
          <p className="text-xs text-muted-foreground">
            {e.detector_name} v{e.detector_version}
            {e.confidence != null && <> · Confidence {e.confidence}</>}
          </p>
        </div>
      )}
    </li>
  )
})

function DriverButton({ id, abbr }: { id: string | null; abbr: string | null }) {
  const label = abbr ?? id ?? "—"
  if (!id) return <span className="font-medium">{label}</span>
  return (
    <button type="button" aria-label={`Select driver ${label}`} onClick={() => liveStore.getState().selectDriver(id)}
      className="rounded px-1 font-medium underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring">
      {label}
    </button>
  )
}
