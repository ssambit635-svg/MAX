import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * A window with no content is the worst possible failure: the island is still
 * there, still always-on-top, and completely blank. One bad value in one tab
 * must never cost the user the whole pet, so every panel renders inside this.
 */
export class Boundary extends Component<{ children: ReactNode; label: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Local only: this goes to %APPDATA%/MAX/state/logs/max.log, never the network.
    void fetch("/api/diagnostics/report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: `${this.props.label}: ${error?.message ?? "unknown"}`,
        detail: String(info?.componentStack ?? "").slice(0, 1200),
      }),
    }).catch(() => undefined);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="boundary" role="alert">
        <p className="boundary__title">That panel tripped over something.</p>
        <p className="boundary__body">Nothing was lost — your notes and settings are on disk. Reopen it and carry on.</p>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => this.setState({ failed: false })}
        >
          Try again
        </button>
      </div>
    );
  }
}
