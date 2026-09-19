"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { ErrorState } from "./States";
import { Button } from "./Button";

type Props = { children: ReactNode; label?: string };
type State = { error: Error | null };

/**
 * Convex `useQuery` throws when a query fails; this boundary turns that into
 * an explicit, visible failure state instead of a blank screen (§45).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Numa UI error", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorState
          title={`${this.props.label ?? "This view"} could not load.`}
          description={this.state.error.message}
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </Button>
          }
        />
      );
    }
    return this.props.children;
  }
}
