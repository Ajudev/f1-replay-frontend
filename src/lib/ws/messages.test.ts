import { describe, expect, it } from "vitest"
import { parseServerMessage } from "./messages"
import { msg, replay } from "@/lib/test-fixtures"

describe("parseServerMessage", () => {
  it("accepts a valid message", () => {
    const m = msg("REPLAY_STATUS", { replay: replay() })
    expect(parseServerMessage(JSON.stringify(m))).toEqual({ kind: "message", message: m })
  })
  it("returns unknown for unrecognised types", () => {
    expect(parseServerMessage(JSON.stringify({ ...msg("PONG", {}), type: "FUTURE_THING" }))).toEqual({ kind: "unknown", type: "FUTURE_THING" })
  })
  it("rejects wrong schema_version", () => {
    expect(parseServerMessage(JSON.stringify({ ...msg("PONG", {}), schema_version: 2 })).kind).toBe("invalid")
  })
  it.each(["not json", "42", "null", "{}", JSON.stringify({ ...msg("PONG", {}), payload: null }), JSON.stringify({ ...msg("PONG", {}), replay_id: 1 })])(
    "rejects garbage %s",
    (raw) => expect(parseServerMessage(raw).kind).toBe("invalid"),
  )
  it("keeps nullable fields as null and rejects missing or mistyped payload fields", () => {
    const ok = msg("REPLAY_CLOCK", { status: "RUNNING", current_race_time_ms: 5, current_lap: null, total_laps: null, playback_speed: 1, emitted_event_count: 0, total_events: null })
    const parsed = parseServerMessage(JSON.stringify(ok))
    expect(parsed.kind === "message" && parsed.message.payload).toMatchObject({ current_lap: null })
    const bad = (payload: object) => parseServerMessage(JSON.stringify({ ...ok, payload })).kind
    expect(bad({ ...ok.payload, current_race_time_ms: "5" })).toBe("invalid")
    expect(bad({ ...ok.payload, current_lap: undefined })).toBe("invalid")
    expect(bad({})).toBe("invalid")
  })
  it("rejects a SNAPSHOT without a valid replay and a bad sequence", () => {
    const s = msg("SNAPSHOT", { replay: replay(), state: null, state_error: null })
    expect(parseServerMessage(JSON.stringify(s)).kind).toBe("message")
    expect(parseServerMessage(JSON.stringify({ ...s, payload: { ...s.payload, replay: {} } })).kind).toBe("invalid")
    expect(parseServerMessage(JSON.stringify({ ...s, sequence: "1" })).kind).toBe("invalid")
  })
  it("rejects a DETECTED_EVENT without an id", () => {
    expect(parseServerMessage(JSON.stringify({ ...msg("PONG", {}), type: "DETECTED_EVENT", payload: { event: {} } })).kind).toBe("invalid")
  })
})
