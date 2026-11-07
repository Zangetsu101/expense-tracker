import { Component, type ReactNode } from 'react';

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
