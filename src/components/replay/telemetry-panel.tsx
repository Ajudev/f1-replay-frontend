"use client"

import { EmptyState } from "@/components/empty-state"
import { Badge } from "@/components/ui/badge"
import type { DrsState } from "@/lib/api/types"
import { useLiveStore } from "@/lib/replay/live-store"
import { cn } from "@/lib/utils"
import { DISCONNECTED } from "./circuit-map"

/** Highest RPM drawn as a full bar; the number shown is never clamped. */
const RPM_SCALE = 13000
const pct = (v: number, max: number) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`

const DRS: Record<DrsState, { label: string; className: string }> = {
  OPEN: { label: "DRS open", className: "border-success/40 bg-success/10 text-success" },
  ELIGIBLE: { label: "DRS eligible", className: "border-info/40 bg-info/10 text-info" },
  OFF: { label: "DRS off", className: "text-muted-foreground" },
  UNKNOWN: { label: "DRS unknown", className: "text-muted-foreground" },
}

export function TelemetryPanel() {
  const id = useLiveStore((s) => s.selectedDriverId)
  const abbr = useLiveStore((s) => s.state?.drivers.find((d) => d.driver_id === s.selectedDriverId)?.abbreviation)
  const car = useLiveStore((s) => (s.selectedDriverId ? s.carFrame?.cars[s.selectedDriverId] : undefined))
  const noTelemetry = useLiveStore((s) => s.trackAvailability?.telemetry === false)
  const disconnected = useLiveStore((s) => DISCONNECTED.has(s.connectionStatus))
  if (!id) return <EmptyState title="Live telemetry" description="Choose a car on the map or a row in the timing tower." />
  const t = car?.telemetry
  return (
    <section aria-label="Live telemetry" className="space-y-3 rounded-lg border bg-panel p-3">
      <h2 className="text-base font-semibold">Live telemetry{abbr && ` · ${abbr}`}</h2>
      {disconnected && <p role="status" className="text-sm text-warning">Disconnected — last received values</p>}
      {!t ? (
        <p className="text-sm text-muted-foreground">{noTelemetry ? "No telemetry for this session." : "No data"}</p>
      ) : (
        <dl className="tabular grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Speed">{t.speed_kph == null ? "No data" : `${t.speed_kph} km/h`}</Stat>
          <Stat label="Gear">{t.gear == null ? "No data" : t.gear === 0 ? "N" : t.gear}</Stat>
          <Stat label="DRS">
            {t.drs == null ? "No data" : <Badge variant="outline" className={cn((DRS[t.drs] ?? DRS.UNKNOWN).className)}>{(DRS[t.drs] ?? DRS.UNKNOWN).label}</Badge>}
          </Stat>
          <Bar label="RPM" value={t.rpm} text={t.rpm == null ? null : t.rpm.toLocaleString("en-US")} max={RPM_SCALE} />
          <Bar label="Throttle" value={t.throttle_pct} text={t.throttle_pct == null ? null : `${t.throttle_pct}%`} max={100} />
          <Stat label="Brake">{t.brake == null ? "No data" : t.brake ? <span className="font-semibold text-primary">ON</span> : "Off"}</Stat>
        </dl>
      )}
    </section>
  )
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  )
}

function Bar({ label, value, text, max }: { label: string; value: number | null; text: string | null; max: number }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="space-y-1 text-sm font-medium">
        <span>{text ?? "No data"}</span>
        {value != null && (
          <span aria-hidden className="block h-1.5 overflow-hidden rounded bg-muted">
            <span className="block h-full bg-primary" style={{ width: pct(value, max) }} />
          </span>
        )}
      </dd>
    </div>
  )
}
