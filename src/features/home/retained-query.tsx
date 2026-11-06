import { Component, startTransition, type ReactNode } from 'react';

type Props<Request> = {
  request: Request;
  requestKey: string;
  onReset: () => void;
  render: (request: Request, failed: boolean) => ReactNode;
  fallback: (retry: () => void) => ReactNode;
};
type State = { key: string; error: Error | null };

export class RetainedQueryBoundary<Request> extends Component<Props<Request>, State> {
  state: State = { key: this.props.requestKey, error: null };
  private lastReady: { request: Request } | undefined;

  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  static getDerivedStateFromProps(props: Props<unknown>, state: State) {
    return props.requestKey !== state.key ? { key: props.requestKey, error: null } : null;
  }
  componentDidMount() {
    this.rememberReadyRequest();
  }
  componentDidUpdate() {
    this.rememberReadyRequest();
  }
  private rememberReadyRequest() {
    if (!this.state.error) this.lastReady = { request: this.props.request };
  }
  retry = () => {
    this.props.onReset();
    startTransition(() => this.setState({ error: null }));
  };
  render() {
    if (!this.state.error) return this.props.render(this.props.request, false);
    return this.lastReady
      ? this.props.render(this.lastReady.request, true)
      : this.props.fallback(this.retry);
  }
}
