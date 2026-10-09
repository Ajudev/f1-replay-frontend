import { WS_BASE_URL } from "@/lib/env"
import { API_PREFIX } from "@/lib/api/client"
import { parseServerMessage, type ClientMessage, type ServerMessage } from "./messages"

export type SocketStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed" | "failed"

export interface ReplaySocketOptions {
  onMessage: (message: ServerMessage) => void
  onStatus?: (status: SocketStatus) => void
  /** Injectable for tests. */
  WebSocketImpl?: typeof WebSocket
  baseUrl?: string
  baseDelayMs?: number
  maxDelayMs?: number
  maxAttempts?: number
  pingIntervalMs?: number
  random?: () => number
}

/** 1008 bad uuid, 4404 unknown replay: retrying cannot help. */
const NO_RECONNECT = new Set([1008, 4404])

export class ReplaySocket {
  private readonly o: Required<Omit<ReplaySocketOptions, "onStatus">> & Pick<ReplaySocketOptions, "onStatus">
  private ws: WebSocket | null = null
  private replayId: string | null = null
  private attempt = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private _status: SocketStatus = "idle"

  constructor(options: ReplaySocketOptions) {
    this.o = {
      WebSocketImpl: globalThis.WebSocket,
      baseUrl: WS_BASE_URL,
      baseDelayMs: 500,
      maxDelayMs: 30_000,
      maxAttempts: 10,
      pingIntervalMs: 25_000,
      random: Math.random,
      ...options,
    }
  }

  get status(): SocketStatus {
    return this._status
  }

  connect(replayId: string): void {
    if (this.replayId === replayId && (this.ws || this.retryTimer)) return
    if (this.replayId !== null) this.teardown()
    this.replayId = replayId
    this.attempt = 0
    this.open("connecting")
  }

  disconnect(): void {
    this.teardown()
    this.replayId = null
    this.setStatus("closed")
  }

  /** Manual reconnect after the bounded retries gave up; resets the attempt counter. */
  retry(): void {
    if (this.replayId === null || this.ws || this.retryTimer) return
    this.attempt = 0
    this.open("connecting")
  }

  resync(): void {
    this.send({ type: "RESYNC" })
  }

  private send(msg: ClientMessage): void {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg))
  }

  private setStatus(s: SocketStatus): void {
    if (this._status === s) return
    this._status = s
    this.o.onStatus?.(s)
  }

  private open(status: SocketStatus): void {
    this.retryTimer = null
    const replayId = this.replayId
    if (replayId === null) return
    this.setStatus(status)
    const ws = new this.o.WebSocketImpl(`${this.o.baseUrl}${API_PREFIX}/replays/${encodeURIComponent(replayId)}/stream`)
    this.ws = ws

    ws.onopen = () => {
      if (this.ws !== ws) return
      this.setStatus("open")
      this.pingTimer = setInterval(() => this.send({ type: "PING" }), this.o.pingIntervalMs)
    }
    ws.onmessage = (e: MessageEvent) => {
      if (this.ws !== ws || typeof e.data !== "string") return
      const r = parseServerMessage(e.data)
      if (r.kind !== "message") {
        if (process.env.NODE_ENV !== "production") console.warn("[ws] dropped frame:", r.kind === "invalid" ? r.reason : `unknown type ${r.type}`)
        return
      }
      if (r.message.replay_id !== this.replayId) return
      // Backend accepts then closes on 1013/1011, so only a SNAPSHOT proves the connection is healthy.
      if (r.message.type === "SNAPSHOT") this.attempt = 0
      this.o.onMessage(r.message)
    }
    ws.onclose = (e: CloseEvent) => {
      if (this.ws !== ws) return
      this.clearPing()
      this.ws = null
      if (NO_RECONNECT.has(e.code)) return this.setStatus("failed")
      if (this.attempt >= this.o.maxAttempts) return this.setStatus("failed")
      const delay = Math.min(this.o.maxDelayMs, this.o.baseDelayMs * 2 ** this.attempt)
      this.attempt += 1
      this.setStatus("reconnecting")
      // Full jitter in [delay/2, delay] keeps a floor while spreading reconnect storms.
      this.retryTimer = setTimeout(() => this.open("reconnecting"), delay * (0.5 + this.o.random() / 2))
    }
    ws.onerror = () => {
      /* onclose always follows and drives reconnect */
    }
  }

  private clearPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = null
  }

  private teardown(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.clearPing()
    const ws = this.ws
    this.ws = null
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null
      ws.close(1000)
    }
  }
}
