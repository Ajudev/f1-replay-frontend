"use client"

import Link from "next/link"
import { AlertTriangle, Loader2, Pause, Play, Radio, RefreshCw, RotateCcw, Square, WifiOff } from "lucide-react"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { StatusIndicator } from "@/components/status-indicator"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api/client"
import { errorMessage } from "@/lib/api/error-message"
import type { Replay } from "@/lib/api/types"
import { replayStatusStyle } from "@/lib/domain-styles"
import { useRace, useReplay, useReplayControl, type ReplayCommand } from "@/lib/query/hooks"
import { selectEffectiveReplay } from "@/lib/replay/effective-replay"
import { useLiveStore } from "@/lib/replay/live-store"
import { useReplayLiveConnection } from "@/lib/replay/use-replay-live-connection"
import { canDo, formatRaceClock, lapProgress, PLAYBACK_SPEEDS, type ReplayAction } from "@/lib/replay/playback"

const ACTIONS: { action: ReplayAction; label: string; icon: typeof Play }[] = [
  { action: "start", label: "Start", icon: Play },
  { action: "pause", label: "Pause", icon: Pause },
  { action: "resume", label: "Resume", icon: Play },
  { action: "stop", label: "Stop", icon: Square },
  { action: "restart", label: "Restart", icon: RotateCcw },
]

// Keyed by replayId so local state (command errors) never leaks between replays.
export function ReplayDashboard({ replayId }: { replayId: string }) {
  return <Dashboard key={replayId} replayId={replayId} />
}

function Dashboard({ replayId }: { replayId: string }) {
  const q = useReplay(replayId)
  const { retry } = useReplayLiveConnection(replayId)
  const replay = useEffectiveReplay(q.data)
  if (q.isPending) return <div role="status" aria-busy="true" aria-label="Loading replay"><Skeleton className="h-40" /></div>
  if (!q.data || !replay) {
    if (q.error instanceof ApiError && q.error.status === 404) return <EmptyState title="Replay not found" description="This replay does not exist."><Link href="/races" className="text-sm text-primary hover:underline">Browse races</Link></EmptyState>
    return <ErrorState title="Could not load replay" message={errorMessage(q.error)} onRetry={() => q.refetch()} />
  }
  return (
    <div className="space-y-4">
      <Header replay={replay} />
      <ConnectionStatus onRetry={retry} />
      {q.isRefetchError && <p role="status" className="text-sm text-warning">Live updates interrupted: {errorMessage(q.error)} Showing the last known state.</p>}
      <Controls replay={replay} />
    </div>
  )
}

function useEffectiveReplay(rest: Replay | undefined): Replay | undefined {
  const replayId = useLiveStore((s) => s.replayId)
  const connectionStatus = useLiveStore((s) => s.connectionStatus)
  const live = useLiveStore((s) => s.replay)
  const clock = useLiveStore((s) => s.clock)
  return rest && selectEffectiveReplay(rest, { replayId, connectionStatus, replay: live, clock })
}

function ConnectionStatus({ onRetry }: { onRetry: () => void }) {
  const status = useLiveStore((s) => s.connectionStatus)
  const hasSnapshot = useLiveStore((s) => s.replay !== null)
  const syncError = useLiveStore((s) => s.needsResync || (s.lastError !== null && s.lastError.code !== "REPLAY_NOT_STARTED"))
  const view =
    status === "open" && hasSnapshot
      ? syncError
        ? { label: "Sync error", icon: AlertTriangle, live: false }
        : { label: "Live", icon: Radio, live: true }
      : status === "reconnecting"
        ? { label: "Reconnecting", icon: RefreshCw, live: false }
        : status === "failed" || status === "closed"
          ? { label: "Disconnected", icon: WifiOff, live: false }
          : { label: "Connecting", icon: Loader2, live: false }
  const Icon = view.icon
  return (
    <div role="status" aria-label="Connection" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="inline-flex items-center gap-1.5 font-medium">
        <Icon aria-hidden className={view.label === "Connecting" || view.label === "Reconnecting" ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"} />
        {view.label}
      </span>
      {!view.live && <span className="text-muted-foreground">Displayed state may be stale.</span>}
      {status === "failed" && <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>}
    </div>
  )
}

function Header({ replay: r }: { replay: Replay }) {
  const race = useRace(r.race_id)
  const session = race.data?.sessions.find((s) => s.id === r.session_id)
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <p className="text-lg font-semibold">
        {race.data ? <>{race.data.name} <span className="tabular text-muted-foreground">{race.data.season}</span></> : "Race"}
        {session && <span className="text-muted-foreground"> · {session.name}</span>}
      </p>
      <Link className="text-sm text-primary hover:underline" href={`/races/${r.race_id}`}>Race details</Link>
    </div>
  )
}

function Controls({ replay: r }: { replay: Replay }) {
  const control = useReplayControl(r.id)
  const busy = control.isPending
  const run = (c: ReplayCommand) => control.mutate(c)
  const progress = lapProgress(r)
  const lapText = r.current_lap == null && r.total_laps == null ? "Not started" : `Lap ${r.current_lap ?? "—"} / ${r.total_laps ?? "—"}`
  return (
    <section aria-label="Playback" className="space-y-4 rounded-lg border bg-panel p-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <StatusIndicator treatment={replayStatusStyle(r.status)} />
        <p className="tabular text-2xl font-semibold" aria-label="Race clock">{formatRaceClock(r.current_race_time_ms)}</p>
        <p className="tabular text-lg">{lapText}</p>
      </div>
      {r.status_reason && <p className="text-sm text-muted-foreground">Reason: {r.status_reason}</p>}
      <div>
        {progress == null ? (
          <p className="text-sm text-muted-foreground">Lap progress unavailable</p>
        ) : (
          <>
            <div className="mb-1 flex justify-between text-xs text-muted-foreground"><span id="lap-progress">Lap progress</span><span className="tabular">{progress}%</span></div>
            <div role="progressbar" aria-labelledby="lap-progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
            </div>
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {ACTIONS.map(({ action, label, icon: Icon }) => {
          const allowed = canDo(r.status, action)
          const active = busy && control.variables === action
          return (
            <Button key={action} variant={allowed ? "default" : "outline"} disabled={!allowed || busy} onClick={() => run(action)}
              title={allowed ? undefined : `${label} is not available while ${replayStatusStyle(r.status).label.toLowerCase()}`}>
              {active ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Icon aria-hidden />}
              {label}
            </Button>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">Stop ends the replay; only Restart can play it again.</p>
      <div role="group" aria-label="Playback speed" className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Speed</span>
        {PLAYBACK_SPEEDS.map((s) => (
          <Button key={s} size="sm" variant={r.playback_speed === s ? "default" : "outline"} aria-pressed={r.playback_speed === s}
            disabled={busy} onClick={() => run({ speed: s })}>{s}x</Button>
        ))}
      </div>
      {control.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(control.error)}</p>}
    </section>
  )
}
