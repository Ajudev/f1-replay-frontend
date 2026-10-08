import { API_BASE_URL } from "@/lib/env"
import type { ErrorBody } from "./types"

export const API_PREFIX = "/api/v1"
const DEFAULT_TIMEOUT_MS = 15_000

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown

  constructor(status: number, code: string, message: string, details: unknown = null) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
    this.details = details
  }
}

export type QueryValue = string | number | boolean | null | undefined | ReadonlyArray<string | number | boolean>

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH"
  query?: object
  body?: unknown
  signal?: AbortSignal
  timeoutMs?: number
  baseUrl?: string
}

export function buildUrl(path: string, query?: object, baseUrl = API_BASE_URL): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {}) as [string, QueryValue][]) {
    if (value === undefined || value === null) continue
    for (const v of Array.isArray(value) ? value : [value]) params.append(key, String(v))
  }
  const qs = params.toString()
  return `${baseUrl}${API_PREFIX}${path}${qs ? `?${qs}` : ""}`
}

function isErrorBody(v: unknown): v is ErrorBody {
  return typeof v === "object" && v !== null && typeof (v as ErrorBody).code === "string" && typeof (v as ErrorBody).message === "string"
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
  const hasBody = opts.body !== undefined

  let res: Response
  try {
    res = await fetch(buildUrl(path, opts.query, opts.baseUrl), {
      method: opts.method ?? "GET",
      headers: { Accept: "application/json", ...(hasBody ? { "Content-Type": "application/json" } : {}) },
      body: hasBody ? JSON.stringify(opts.body) : undefined,
      signal,
    })
  } catch (err) {
    // Caller abort propagates untouched (TanStack Query cancellation relies on it).
    if (opts.signal?.aborted) throw err
    if (timeout.aborted) throw new ApiError(0, "TIMEOUT", "Request timed out")
    throw new ApiError(0, "NETWORK_ERROR", "Unable to reach the server")
  }

  if (!res.ok) {
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      /* non-JSON error body */
    }
    if (isErrorBody(body)) throw new ApiError(res.status, body.code, body.message, body.details ?? null)
    throw new ApiError(res.status, `HTTP_${res.status}`, res.statusText || `Request failed with status ${res.status}`, body)
  }
  return (await res.json()) as T
}
