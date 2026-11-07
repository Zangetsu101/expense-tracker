import { Component, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  onReset: () => void;
  fallback: (retry: () => void) => ReactNode;
};

export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  private retry = () => {
    this.props.onReset();
    this.setState({ failed: false });
  };

  render() {
    return this.state.failed ? this.props.fallback(this.retry) : this.props.children;
  }
}
