import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { SectionBoundary } from "./section-boundary"

let broken = true
const Bomb = () => { if (broken) throw new Error("boom"); return <p>recovered</p> }

describe("SectionBoundary", () => {
  it("isolates a throw to its section and retry remounts", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    render(<><SectionBoundary label="Events"><Bomb /></SectionBoundary><p>sibling</p></>)
    expect(screen.getByRole("alert")).toHaveTextContent("Events failed to render")
    expect(screen.getByText("sibling")).toBeInTheDocument()
    broken = false
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(screen.getByText("recovered")).toBeInTheDocument()
  })
})
