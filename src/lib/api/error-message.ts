import { ApiError } from "./client"

/** User-facing text for a failed request; never renders raw objects. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return err.message
    if (err.status === 404) return "Not found. It may not have been imported into the backend."
    if (err.status >= 500) return "The backend is unavailable. Try again shortly."
    return err.message
  }
  return "Something unexpected went wrong."
}
