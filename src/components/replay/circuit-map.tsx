"use client"

import { memo, useMemo } from "react"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api/client"
import { errorMessage } from "@/lib/api/error-message"
import type { CircuitLayout, DriverState } from "@/lib/api/types"
import { makeProjector, teamColor, type Projector } from "@/lib/circuit/geometry"
import { useBattlesFallback, useReplayCircuit } from "@/lib/query/hooks"
import { battleGapText, battleRoles, type BattleRoles } from "@/lib/replay/battles"
import { liveStore, useLiveStore } from "@/lib/replay/live-store"
import type { CarFrameCar } from "@/lib/ws/messages"

export function CircuitMap({ replayId }: { replayId: string }) {
  useBattlesFallback(replayId)
  const q = useReplayCircuit(replayId)
  let body: React.ReactNode
  if (q.isPending) body = <div role="status" aria-busy="true" aria-label="Loading circuit"><Skeleton className="aspect-[4/3] w-full" /></div>
  else if (q.error instanceof ApiError && q.error.code === "TRACK_DATA_NOT_IMPORTED")
    body = <EmptyState title="Track data not imported" description="The circuit map needs the session's track data import. Timing and events keep working." />
  else if (!q.data) body = <ErrorState title="Could not load circuit" message={errorMessage(q.error)} onRetry={() => q.refetch()} />
  else body = <MapView circuit={q.data} />
  return (
    <section aria-label="Circuit map" className="space-y-2 rounded-lg border bg-panel p-3">
      <h2 className="text-base font-semibold">{q.data?.circuit_name ?? "Circuit map"}</h2>
      {body}
    </section>
  )
}

/** Before the first connect ("idle"/"connecting") nothing is frozen yet, so only a lost connection is flagged. */
export const DISCONNECTED: ReadonlySet<string> = new Set(["reconnecting", "closed", "failed"])

function MapView({ circuit }: { circuit: CircuitLayout }) {
  const projector = useMemo(() => makeProjector(circuit), [circuit])
  const noCars = useLiveStore((s) => s.trackAvailability !== null && !s.trackAvailability.positions && !s.trackAvailability.telemetry)
  const disconnected = useLiveStore((s) => DISCONNECTED.has(s.connectionStatus))
  return (
    <div className="space-y-2">
      {disconnected && <p role="status" className="text-sm text-warning">Disconnected — car positions are frozen</p>}
      {noCars && <p role="status" className="text-sm text-muted-foreground">No car position data for this session.</p>}
      <svg viewBox={projector.viewBox} preserveAspectRatio="xMidYMid meet" role="group" aria-label={`${circuit.circuit_name ?? "Circuit"} map`}
        className="aspect-[4/3] max-h-[70vh] w-full select-none">
        <Track circuit={circuit} p={projector} />
        <Cars p={projector} />
      </svg>
      <BattleList />
    </div>
  )
}

const Track = memo(function Track({ circuit, p }: { circuit: CircuitLayout; p: Projector }) {
  const s = p.size
  const points = circuit.outline.map(([x, y]) => p.project(x, y).join(",")).join(" ")
  const start = circuit.outline[0] ? p.project(...circuit.outline[0]) : null
  return (
    <g aria-hidden>
      {points && <polygon points={points} fill="none" stroke="currentColor" strokeOpacity={0.35} strokeWidth={s * 0.012} strokeLinejoin="round" />}
      {start && (
        <g transform={`translate(${start[0]} ${start[1]})`}>
          <rect x={-s * 0.004} y={-s * 0.014} width={s * 0.008} height={s * 0.028} fill="currentColor" />
          <text x={s * 0.012} y={-s * 0.014} fontSize={s * 0.022} fill="currentColor" fillOpacity={0.8}>S/F</text>
        </g>
      )}
      {circuit.corners?.map((c) => {
        // angle_deg points away from the track in raw coordinates: offset there, then project with everything else.
        const a = ((c.angle_deg ?? 0) * Math.PI) / 180
        const off = c.angle_deg == null ? 0 : s * 0.03
        const [lx, ly] = p.project(c.x + off * Math.cos(a), c.y + off * Math.sin(a))
        return (
          <text key={`${c.number}${c.letter}`} x={lx} y={ly} fontSize={s * 0.02} fill="currentColor" fillOpacity={0.55} textAnchor="middle" dominantBaseline="central">
            {c.number}{c.letter}
          </text>
        )
      })}
    </g>
  )
})

function Cars({ p }: { p: Projector }) {
  const frame = useLiveStore((s) => s.carFrame)
  const drivers = useLiveStore((s) => s.state?.drivers)
  const battles = useLiveStore((s) => s.battles)
  const selected = useLiveStore((s) => s.selectedDriverId)
  const roles = useMemo(() => battleRoles(battles), [battles])
  if (!frame || !drivers) return null
  const colorOf = (id: string) => teamColor(drivers.find((x) => x.driver_id === id)?.team_color)
  // Selected marker is drawn last so it stays on top.
  const ordered = [...drivers].sort((a, b) => Number(a.driver_id === selected) - Number(b.driver_id === selected))
  return (
    <g>
      {ordered.map((d) => {
        const car = frame.cars[d.driver_id]
        if (!car || car.x == null || car.y == null) return null
        const [x, y] = p.project(car.x, car.y)
        const battle = roles.get(d.driver_id)
        return (
          <CarMarker key={d.driver_id} d={d} car={car} x={x} y={y} size={p.size} snap={frame.snap} selected={d.driver_id === selected}
            battle={battle} defendColor={battle?.defending ? colorOf(battle.defending.attacker_id) : null} />
        )
      })}
    </g>
  )
}

const CarMarker = memo(function CarMarker({ d, car, x, y, size, snap, selected, battle, defendColor }: {
  d: DriverState; car: CarFrameCar; x: number; y: number; size: number; snap: boolean; selected: boolean; battle?: BattleRoles; defendColor: string | null
}) {
  const r = size * 0.009
  const color = teamColor(d.team_color)
  const label = `P${d.position ?? "—"} ${d.abbreviation}`
  const roles = [battle?.attacking && "attacking", battle?.defending && "defending"].filter(Boolean).join(" and ")
  const select = () => liveStore.getState().selectDriver(selected ? null : d.driver_id)
  return (
    <g
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${label}${car.off_track ? ", off track" : ""}${roles ? `, ${roles} in battle` : ""}`}
      onClick={select}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select() } }}
      className="cursor-pointer outline-none focus-visible:[&>circle:first-child]:stroke-ring"
      // Animates toward each new frame over one frame interval; reduced-motion CSS cuts the transition.
      style={{ transform: `translate(${x}px, ${y}px)`, transition: snap ? "none" : "transform 250ms linear" }}
    >
      <circle r={r * 2.6} fill="transparent" stroke={selected ? "currentColor" : "transparent"} strokeWidth={r * 0.5} />
      {/* Battle rings in the attacker's colour: solid when attacking, dashed (outer) when defending. */}
      {battle?.attacking && <circle r={r * 1.9} fill="none" stroke={color} strokeWidth={r * 0.45} />}
      {battle?.defending && defendColor && (
        <circle r={r * 2.4} fill="none" stroke={defendColor} strokeWidth={r * 0.45} strokeDasharray={`${r * 0.8} ${r * 0.6}`} />
      )}
      <circle r={r} fill={color} className="stroke-background" strokeWidth={r * 0.3} strokeDasharray={car.off_track ? `${r * 0.5} ${r * 0.4}` : undefined} />
      <text x={r * 1.6} y={-r * 1.4} fontSize={size * 0.022} fontWeight={selected ? 700 : 500} fill="currentColor"
        strokeWidth={size * 0.004} paintOrder="stroke" className="tabular stroke-background">
        {label}{car.off_track ? " OFF" : ""}
      </text>
    </g>
  )
})

function BattleList() {
  const battles = useLiveStore((s) => s.battles)
  const list = Object.values(battles)
  return (
    <details className="text-sm">
      <summary className="cursor-pointer rounded text-primary focus-visible:outline-2 focus-visible:outline-ring">Active battles ({list.length})</summary>
      {list.length === 0 ? <p className="text-muted-foreground">No active battles.</p> : (
        <ul className="tabular space-y-0.5">
          {list.map((b) => (
            <li key={`${b.attacker_id}:${b.defender_id}`}>
              {b.attacker_abbreviation} attacking {b.defender_abbreviation} · {battleGapText(b)}
              {b.started_lap != null && ` · since lap ${b.started_lap}`}
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}
