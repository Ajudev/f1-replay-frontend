import Link from "next/link"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <EmptyState title="Page not found" description="The page you are looking for does not exist.">
      <Button asChild variant="outline">
        <Link href="/">Go home</Link>
      </Button>
    </EmptyState>
  )
}
