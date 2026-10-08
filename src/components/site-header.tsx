import Link from "next/link"
import { Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

const NAV = [
  { href: "/", label: "Home" },
  { href: "/races", label: "Races" },
]

export function SiteHeader() {
  return (
    <header className="border-b bg-panel">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="rounded-sm font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-ring">
          <span className="text-primary">F1</span> Replay
        </Link>
        <nav aria-label="Main" className="hidden gap-1 sm:flex">
          {NAV.map((n) => (
            <Button key={n.href} variant="ghost" asChild>
              <Link href={n.href}>{n.label}</Link>
            </Button>
          ))}
        </nav>
        <div className="sm:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open navigation menu">
                <Menu aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {NAV.map((n) => (
                <DropdownMenuItem key={n.href} asChild>
                  <Link href={n.href}>{n.label}</Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}
