import { render, screen } from "@testing-library/react"
import { expect, it } from "vitest"
import { SiteHeader } from "@/components/site-header"

it("has main nav links and a mobile menu button", () => {
  render(<SiteHeader />)
  const nav = screen.getByRole("navigation", { name: "Main" })
  expect(nav.querySelector('a[href="/"]')).toHaveTextContent("Home")
  expect(nav.querySelector('a[href="/races"]')).toHaveTextContent("Races")
  expect(screen.getByRole("button", { name: "Open navigation menu" })).toBeInTheDocument()
})
