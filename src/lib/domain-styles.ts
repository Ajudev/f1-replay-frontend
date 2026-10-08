import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Circle,
  CircleAlert,
  CirclePause,
  CirclePlay,
  Flag,
  HelpCircle,
  Minus,
  OctagonX,
  ShieldAlert,
  Square,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react"

export type Treatment = {
  label: string
  /** Token-based Tailwind classes (text + border + subtle background). */
  className: string
  icon: LucideIcon
}

const UNKNOWN: Treatment = {
  label: "Unknown",
  className: "text-muted-foreground border-border bg-muted",
  icon: HelpCircle,
}

const tone = {
  success: "text-success border-success/40 bg-success/10",
  warning: "text-warning border-warning/40 bg-warning/10",
  error: "text-destructive border-destructive/40 bg-destructive/10",
  info: "text-info border-info/40 bg-info/10",
  neutral: "text-muted-foreground border-border bg-muted",
  accent: "text-primary border-primary/40 bg-primary/10",
}

function lookup(map: Record<string, Treatment>, value: string | null | undefined): Treatment {
  if (!value) return UNKNOWN
  return map[value.toUpperCase()] ?? UNKNOWN
}

// ReplayStatus: docs/openapi.json components.schemas.ReplayStatus
const REPLAY_STATUS: Record<string, Treatment> = {
  CREATED: { label: "Created", className: tone.neutral, icon: Circle },
  RUNNING: { label: "Running", className: tone.success, icon: CirclePlay },
  PAUSED: { label: "Paused", className: tone.warning, icon: CirclePause },
  STOPPED: { label: "Stopped", className: tone.neutral, icon: Square },
  COMPLETED: { label: "Completed", className: tone.info, icon: CheckCircle2 },
  FAILED: { label: "Failed", className: tone.error, icon: CircleAlert },
}
export const replayStatusStyle = (v: string | null | undefined) => lookup(REPLAY_STATUS, v)

// Compound is a free string in the API (FastF1 values: SOFT, MEDIUM, HARD, INTERMEDIATE, WET).
// Letter badge text is the non-color signal.
export type CompoundTreatment = Treatment & { short: string }
const COMPOUND: Record<string, CompoundTreatment> = {
  SOFT: { label: "Soft", short: "S", className: "text-red-400 border-red-400/50 bg-red-400/10", icon: Circle },
  MEDIUM: { label: "Medium", short: "M", className: "text-yellow-300 border-yellow-300/50 bg-yellow-300/10", icon: Circle },
  HARD: { label: "Hard", short: "H", className: "text-foreground border-foreground/40 bg-foreground/10", icon: Circle },
  INTERMEDIATE: { label: "Intermediate", short: "I", className: "text-green-400 border-green-400/50 bg-green-400/10", icon: Circle },
  WET: { label: "Wet", short: "W", className: "text-blue-400 border-blue-400/50 bg-blue-400/10", icon: Circle },
}
export const compoundStyle = (v: string | null | undefined): CompoundTreatment => {
  if (!v) return { ...UNKNOWN, short: "?" }
  return COMPOUND[v.toUpperCase()] ?? { ...UNKNOWN, short: "?" }
}

// TrackStatus: components.schemas.TrackStatus
const TRACK_STATUS: Record<string, Treatment> = {
  GREEN: { label: "Green flag", className: tone.success, icon: Flag },
  YELLOW: { label: "Yellow flag", className: tone.warning, icon: TriangleAlert },
  SAFETY_CAR: { label: "Safety car", className: tone.warning, icon: ShieldAlert },
  VIRTUAL_SAFETY_CAR: { label: "Virtual safety car", className: tone.warning, icon: ShieldAlert },
  VIRTUAL_SAFETY_CAR_ENDING: { label: "VSC ending", className: tone.warning, icon: ShieldAlert },
  RED_FLAG: { label: "Red flag", className: tone.error, icon: OctagonX },
  UNKNOWN: UNKNOWN,
}
export const trackStatusStyle = (v: string | null | undefined) => lookup(TRACK_STATUS, v)

// Severity: components.schemas.Severity (nullable on DetectedEventOut)
const SEVERITY: Record<string, Treatment> = {
  LOW: { label: "Low", className: tone.info, icon: Minus },
  MEDIUM: { label: "Medium", className: tone.warning, icon: TriangleAlert },
  HIGH: { label: "High", className: tone.error, icon: CircleAlert },
}
export const severityStyle = (v: string | null | undefined) => lookup(SEVERITY, v)

// Not a backend enum: UI-only presentation of a numeric position delta.
export type PositionChange = "gain" | "loss" | "none"
const POSITION_CHANGE: Record<PositionChange, Treatment> = {
  gain: { label: "Gained", className: tone.success, icon: ArrowUp },
  loss: { label: "Lost", className: tone.error, icon: ArrowDown },
  none: { label: "No change", className: tone.neutral, icon: Minus },
}
export const positionChangeStyle = (v: string | null | undefined): Treatment =>
  (v && Object.hasOwn(POSITION_CHANGE, v) ? POSITION_CHANGE[v as PositionChange] : UNKNOWN)

