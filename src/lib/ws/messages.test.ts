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
})
