import { Component, Suspense, useState, type ReactNode } from 'react';
import { QueryErrorResetBoundary } from '@tanstack/react-query';

type Props = {
  children: ReactNode;
  resetKey?: string;
  onReset: () => void;
  fallback: (retry: () => void) => ReactNode;
};

export class ErrorBoundary extends Component<Props, { failed: boolean; resetKey?: string }> {
  state = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: Props, state: { resetKey?: string }) {
    return props.resetKey !== state.resetKey ? { failed: false, resetKey: props.resetKey } : null;
  }

  private retry = () => {
    this.props.onReset();
    this.setState({ failed: false });
  };

  render() {
    return this.state.failed ? this.props.fallback(this.retry) : this.props.children;
  }
}

type QueryBoundaryProps = {
  pending: ReactNode;
  error: (retry: () => void) => ReactNode;
  resetKey?: string;
  /**
   * Leave this out in most cases. Then the boundary has its own QueryErrorResetBoundary,
   * and Retry is local to this boundary.
   *
   * Some owners must also call reset() when the scope changes, for example when the user
   * selects a different account. Such an owner renders its own QueryErrorResetBoundary
   * above this boundary and gives its reset function here. Then the boundary uses that
   * reset function and does not add a QueryErrorResetBoundary.
   */
  reset?: () => void;
  children: ReactNode;
};

/** Shows `pending` while a suspense query loads and `error` when it fails. Retry reads again. */
export function QueryBoundary({ reset, ...props }: QueryBoundaryProps) {
  if (reset) return <Boundary reset={reset} {...props} />;
  return (
    <QueryErrorResetBoundary>
      {({ reset: localReset }) => <Boundary reset={localReset} {...props} />}
    </QueryErrorResetBoundary>
  );
}

function Boundary({
  pending,
  error,
  resetKey,
  reset,
  children,
}: Omit<QueryBoundaryProps, 'reset'> & { reset: () => void }) {
  return (
    <ErrorBoundary resetKey={resetKey} onReset={reset} fallback={error}>
      <Suspense fallback={pending}>{children}</Suspense>
    </ErrorBoundary>
  );
}

type ScopeBoundaryProps = Omit<QueryBoundaryProps, 'reset' | 'resetKey'> & { scope: string };

function ScopedBoundary({ scope, reset, ...props }: ScopeBoundaryProps & { reset: () => void }) {
  const [current, setCurrent] = useState<string>();
  if (current !== scope) {
    // A new scope reads again, also when its query failed before.
    reset();
    setCurrent(scope);
  }
  return <Boundary key={scope} reset={reset} {...props} />;
}

/**
 * A QueryBoundary for a scope that comes from outside, such as a route param.
 * The scope remounts the boundary, and each new scope reads again.
 */
export function ScopeBoundary(props: ScopeBoundaryProps) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => <ScopedBoundary reset={reset} {...props} />}
    </QueryErrorResetBoundary>
  );
}
