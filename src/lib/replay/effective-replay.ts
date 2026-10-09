import type { Replay } from "@/lib/api/types"
import type { LiveStore } from "./live-store"

/**
 * The one replay view the dashboard renders. Live data wins only while the socket is open and has delivered a
 * snapshot; otherwise (initial load, failed socket) the REST copy is used. Clock fields come from REPLAY_CLOCK
 * as received, never interpolated.
 */
export function selectEffectiveReplay(
  rest: Replay,
  live: Pick<LiveStore, "replayId" | "connectionStatus" | "replay" | "clock">,
): Replay {
  if (live.replayId !== rest.id || live.connectionStatus !== "open" || !live.replay || live.replay.id !== rest.id) return rest
  const c = live.clock
  if (!c) return live.replay
  return {
    ...live.replay,
    current_race_time_ms: c.current_race_time_ms,
    current_lap: c.current_lap,
    total_laps: c.total_laps,
    playback_speed: c.playback_speed,
    emitted_event_count: c.emitted_event_count,
    total_events: c.total_events,
  }
}
