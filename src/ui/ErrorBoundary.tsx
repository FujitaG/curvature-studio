import { Component, createRef, type ErrorInfo, type ReactNode } from 'react';
import { prepareRecoveryFile } from '../project/recovery';
import { downloadText } from '../state/persistence';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  loadFailure: boolean;
  downloadMessage: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, loadFailure: false, downloadMessage: '' };
  private heading = createRef<HTMLHeadingElement>();
  private recovery: ReturnType<typeof prepareRecoveryFile> | undefined;
  private recoveryError = '';

  private captureRecovery = () => {
    if (this.recovery) return;
    try { this.recovery = prepareRecoveryFile(); this.recoveryError = ''; }
    catch (error) { this.recoveryError = error instanceof Error ? error.message : 'Could not prepare a recovery file.'; }
  };

  private onLoadFailure = (event: Event) => {
    // Capture cameras before React removes the scene. Never auto-reload an editor.
    this.captureRecovery();
    const payload = (event as Event & { payload?: unknown }).payload;
    this.setState({ error: payload instanceof Error ? payload : new Error('A feature could not be loaded.'), loadFailure: true });
    // Leave Vite's rejected import intact so React's error boundary handles it too.
  };

  componentDidMount(): void { window.addEventListener('vite:preloadError', this.onLoadFailure); }
  componentWillUnmount(): void { window.removeEventListener('vite:preloadError', this.onLoadFailure); }
  componentDidUpdate(_props: Props, previous: State): void {
    if (this.state.error && !previous.error) this.heading.current?.focus();
  }

  static getDerivedStateFromError(error: Error): Pick<State, 'error'> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.captureRecovery();
    console.error('Curvature Studio render error', error, info);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="app">
        <div className="modal-backdrop">
          <section className="shortcut-modal panel" aria-labelledby="recovery-heading">
            <h2 id="recovery-heading" tabIndex={-1} ref={this.heading}>{this.state.loadFailure ? 'A feature could not be loaded' : 'Something went wrong'}</h2>
            {this.state.loadFailure && <p>The connection may be interrupted, or the app may have been updated. Download your work before reloading.</p>}
            <p>The recovery file includes your project and both structures if you used Compare, including the hidden side. Undo history and unconfirmed dialog changes are not included.</p>
            <div className="row-value" style={{ overflowWrap: 'anywhere' }}>{this.state.error.message}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
              <button className="button primary" onClick={() => {
                this.captureRecovery();
                if (!this.recovery) { this.setState({ downloadMessage: `Recovery file could not be prepared: ${this.recoveryError}. Keep this tab open.` }); return; }
                try {
                  downloadText(this.recovery.filename, this.recovery.text, 'application/json');
                  this.setState({ downloadMessage: 'Download requested. Check that the file is saved, then reload and use Open project.' });
                } catch { this.setState({ downloadMessage: 'Download could not start. Keep this tab open and try again.' }); }
              }}>Download recovery file</button>
              <button className="button" onClick={() => window.location.reload()}>Reload app</button>
            </div>
            <p className="muted">Reload restores the last browser save. Use the recovery file to restore more recent edits.</p>
            {this.state.downloadMessage && <p role="status">{this.state.downloadMessage}</p>}
          </section>
        </div>
      </div>
    );
  }
}
