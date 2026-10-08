import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { StatusIndicator } from "@/components/status-indicator"
import { replayStatusStyle } from "@/lib/domain-styles"

describe("EmptyState", () => {
  it("renders title and description", () => {
    render(<EmptyState title="Nothing" description="Come back later" />)
    expect(screen.getByRole("heading", { name: "Nothing" })).toBeInTheDocument()
    expect(screen.getByText("Come back later")).toBeInTheDocument()
  })
})

describe("ErrorState", () => {
  it("is an alert and calls retry", async () => {
    const onRetry = vi.fn()
    render(<ErrorState message="boom" onRetry={onRetry} />)
    expect(screen.getByRole("alert")).toHaveTextContent("boom")
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
  it("hides retry without callback", () => {
    render(<ErrorState />)
    expect(screen.queryByRole("button")).toBeNull()
  })
})

describe("StatusIndicator", () => {
  it("shows a text label", () => {
    render(<StatusIndicator treatment={replayStatusStyle("PAUSED")} />)
    expect(screen.getByText("Paused")).toBeInTheDocument()
  })
})
