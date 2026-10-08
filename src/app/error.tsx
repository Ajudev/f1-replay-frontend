"use client"

import { ErrorState } from "@/components/error-state"

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorState message="An unexpected error occurred while rendering this page." onRetry={reset} />
}
