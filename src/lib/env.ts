function readUrl(value: string | undefined, fallback: string, protocols: string[], name: string): string {
  const raw = (value?.trim() || fallback).replace(/\/+$/, "")
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`${name} is not a valid URL: ${raw}`)
  }
  if (!protocols.includes(url.protocol)) {
    throw new Error(`${name} must use ${protocols.join(" or ")}: ${raw}`)
  }
  return raw
}

// NEXT_PUBLIC_* must be referenced literally so Next.js can inline them.
export const API_BASE_URL = readUrl(
  process.env.NEXT_PUBLIC_API_BASE_URL,
  "http://localhost:8000",
  ["http:", "https:"],
  "NEXT_PUBLIC_API_BASE_URL",
)
export const WS_BASE_URL = readUrl(
  process.env.NEXT_PUBLIC_WS_BASE_URL,
  "ws://localhost:8000",
  ["ws:", "wss:"],
  "NEXT_PUBLIC_WS_BASE_URL",
)
