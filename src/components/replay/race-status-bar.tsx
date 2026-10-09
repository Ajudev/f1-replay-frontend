"use client"

import { StatusIndicator } from "@/components/status-indicator"
import { trackStatusStyle } from "@/lib/domain-styles"
import { useLiveStore } from "@/lib/replay/live-store"
import { formatLapTime } from "@/lib/replay/timing-format"
import { cn } from "@/lib/utils"

const PROMINENT = new Set(["SAFETY_CAR", "VIRTUAL_SAFETY_CAR", "VIRTUAL_SAFETY_CAR_ENDING", "RED_FLAG"])

export function RaceStatusBar() {
  const hasState = useLiveStore((s) => s.state !== null)
  const track = useLiveStore((s) => s.state?.track_status)
  const fl = useLiveStore((s) => s.state?.fastest_lap)
  if (!hasState) return null
  const t = trackStatusStyle(track)
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2" role="status" aria-label="Race status">
      {track ? (
        <StatusIndicator treatment={t} className={cn(PROMINENT.has(track) && "px-3 py-1.5 text-base font-semibold")} />
      ) : (
        <span className="text-sm text-muted-foreground">Track status unavailable</span>
      )}
      <p className="text-sm">
        <span className="text-muted-foreground">Fastest lap </span>
        {fl ? <span className="tabular font-medium">{fl.abbreviation} · L{fl.lap_number} · {formatLapTime(fl.lap_time_ms)}</span> : "—"}
      </p>
    </div>
  )
}
