import { afterEach, describe, expect, it, vi } from "vitest"
import { ApiError, buildUrl, request } from "./client"
import { shouldRetry } from "@/lib/query/query-client"
import { queryKeys } from "@/lib/query/query-keys"

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
afterEach(() => vi.unstubAllGlobals())

describe("buildUrl", () => {
  it("skips undefined/null and repeats arrays", () => {
    const url = buildUrl("/replays/x/events", { event_type: ["OVERTAKE", "NEW_STINT"], driver: undefined, limit: 10, run_id: null }, "http://h")
    expect(url).toBe("http://h/api/v1/replays/x/events?event_type=OVERTAKE&event_type=NEW_STINT&limit=10")
  })
})

describe("request", () => {
  it("returns parsed JSON and sends JSON body", async () => {
    const f = vi.fn().mockResolvedValue(json({ ok: 1 }))
    vi.stubGlobal("fetch", f)
    await expect(request("/x", { method: "POST", body: { a: 1 } })).resolves.toEqual({ ok: 1 })
    expect(f.mock.calls[0][1].body).toBe('{"a":1}')
    expect(f.mock.calls[0][1].headers["Content-Type"]).toBe("application/json")
  })
  it("normalizes backend error body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ code: "REPLAY_NOT_FOUND", message: "nope", details: { id: 1 } }, 404)))
    const err = await request("/x").catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 404, code: "REPLAY_NOT_FOUND", message: "nope", details: { id: 1 } })
  })
  it("maps non-JSON error to HTTP_<status>", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>", { status: 502 })))
    await expect(request("/x")).rejects.toMatchObject({ status: 502, code: "HTTP_502" })
  })
  it("maps fetch failure to NETWORK_ERROR", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("failed")))
    await expect(request("/x")).rejects.toMatchObject({ code: "NETWORK_ERROR", status: 0 })
  })
  it("maps timeout to TIMEOUT", async () => {
    vi.stubGlobal("fetch", (_u: string, init: RequestInit) =>
      new Promise((_r, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("t", "TimeoutError")))))
    await expect(request("/x", { timeoutMs: 5 })).rejects.toMatchObject({ code: "TIMEOUT" })
  })
  it("propagates caller abort unchanged", async () => {
    const ctl = new AbortController()
    vi.stubGlobal("fetch", (_u: string, init: RequestInit) =>
      new Promise((_r, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("a", "AbortError")))))
    const p = request("/x", { signal: ctl.signal })
    ctl.abort()
    const err: unknown = await p.catch((e: unknown) => e)
    expect(err).not.toBeInstanceOf(ApiError)
    expect((err as Error).name).toBe("AbortError")
  })
})

describe("shouldRetry", () => {
  it("never retries 4xx", () => expect(shouldRetry(0, new ApiError(404, "X", "m"))).toBe(false))
  it("retries network/5xx at most twice", () => {
    expect(shouldRetry(0, new ApiError(0, "NETWORK_ERROR", "m"))).toBe(true)
    expect(shouldRetry(1, new ApiError(503, "X", "m"))).toBe(true)
    expect(shouldRetry(2, new ApiError(503, "X", "m"))).toBe(false)
  })
})

describe("queryKeys", () => {
  it("scopes replay keys under ['replays', id]", () => {
    for (const k of [queryKeys.replay("r"), queryKeys.replayState("r"), queryKeys.replayEvents("r"), queryKeys.replayDriver("r", "ver"), queryKeys.replayTiming("r"), queryKeys.replayDriverTiming("r", "ver")]) {
      expect(k.slice(0, 2)).toEqual(["replays", "r"])
    }
  })
})
