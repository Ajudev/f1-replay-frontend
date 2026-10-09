"use client"

import { Component, type ReactNode } from "react"
import { ErrorState } from "@/components/error-state"

/** Isolates a render error to one section; Retry remounts its children. */
export class SectionBoundary extends Component<{ label: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return <ErrorState title={`${this.props.label} failed to render`} message="The rest of the replay is unaffected." onRetry={() => this.setState({ failed: false })} />
  }
}
