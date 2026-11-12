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

/**
 * Shows `pending` while a suspense query loads and `error` when it fails. Retry reads again.
 * For a scope that comes from outside, such as a route param, give the scope as the `key`.
 */
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
  const [mounted, setMounted] = useState(false);
  if (!mounted) {
    // TanStack Query does not read a failed suspense query again until reset() runs.
    // Call it when the boundary mounts, so that a screen that opens again reads again.
    // Do not call it for a change of resetKey. A deferred render can run many times
    // before it commits, and each reset() would start the failed read again.
    reset();
    setMounted(true);
  }
  return (
    <ErrorBoundary resetKey={resetKey} onReset={reset} fallback={error}>
      <Suspense fallback={pending}>{children}</Suspense>
    </ErrorBoundary>
  );
}
