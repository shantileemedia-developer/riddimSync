import React from 'react';

interface Props {
  onBackToDashboard: () => void;
  children: React.ReactNode;
}

interface State {
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  copied: boolean;
}

export class StudioErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, errorInfo: null, copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo });

    // Breadcrumb stays set — safe mode detection on next launch reads it
    const count = parseInt(localStorage.getItem('sl_studio_crash_count') ?? '0', 10);
    localStorage.setItem('sl_studio_crash_count', String(count + 1));

    // Keep a rolling log of the last 5 crashes
    try {
      const prev = JSON.parse(localStorage.getItem('sl_crash_log') ?? '[]');
      prev.unshift({
        time:           new Date().toISOString(),
        message:        error.message,
        stack:          error.stack?.slice(0, 2000) ?? '',
        componentStack: errorInfo.componentStack?.slice(0, 2000) ?? '',
      });
      localStorage.setItem('sl_crash_log', JSON.stringify(prev.slice(0, 5)));
    } catch { /* storage full — non-fatal */ }

    console.error('[StudioErrorBoundary]', error, errorInfo.componentStack);
  }

  private reload = () => {
    // Clear error state — providers remount fresh
    this.setState({ error: null, errorInfo: null, copied: false });
  };

  private reloadSafeMode = () => {
    localStorage.setItem('sl_safe_mode_next', 'true');
    this.reload();
  };

  private copyDetails = () => {
    const { error, errorInfo } = this.state;
    const text = [
      `RiddimSync Studio Crash — ${new Date().toISOString()}`,
      '',
      `Message: ${error?.message ?? 'unknown'}`,
      '',
      `Stack:\n${error?.stack ?? ''}`,
      '',
      `Component Stack:\n${errorInfo?.componentStack ?? ''}`,
    ].join('\n');
    navigator.clipboard.writeText(text)
      .then(() => this.setState({ copied: true }))
      .catch(() => {});
  };

  render() {
    if (!this.state.error) return this.props.children;

    const { error, errorInfo, copied } = this.state;

    return (
      <div style={styles.root}>
        <div style={styles.card}>
          <div style={styles.header}>Studio crashed</div>
          <div style={styles.sub}>
            An unexpected error caused the studio to stop rendering. Your session data is intact.
          </div>

          <div style={styles.logBox}>
            <div style={styles.errorMsg}>{error.message}</div>
            {errorInfo?.componentStack && (
              <pre style={styles.stack}>{errorInfo.componentStack.trim()}</pre>
            )}
          </div>

          <div style={styles.actions}>
            <button onClick={this.reload} style={btn('#00ffcc', '#000')}>
              Reload Studio
            </button>
            <button onClick={this.reloadSafeMode} style={btn('#1a2a28', '#00cc99', '1px solid #00ffcc44')}>
              Reload in Safe Mode
            </button>
            <button onClick={this.props.onBackToDashboard} style={btn('#2a2b2e', '#c8c9cc')}>
              Back to Dashboard
            </button>
            <button onClick={this.copyDetails} style={btn('transparent', copied ? '#00ffcc' : '#666', '1px solid #333')}>
              {copied ? 'Copied!' : 'Copy error details'}
            </button>
          </div>

          <div style={styles.hint}>
            Safe Mode disables native audio init and ASIO scanning — useful if the crash is
            audio-driver related.
          </div>
        </div>
      </div>
    );
  }
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', height: '100vh',
    background: '#121214', color: '#e0e0e0',
    fontFamily: "'Inter', 'Segoe UI', monospace", padding: 32, boxSizing: 'border-box',
  },
  card: {
    maxWidth: 700, width: '100%',
    background: '#1a1b1e', border: '1px solid #3a1f1f',
    borderRadius: 10, padding: '28px 32px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
  },
  header: { color: '#ff6b6b', fontSize: 18, fontWeight: 700, marginBottom: 6 },
  sub:    { color: '#888', fontSize: 13, marginBottom: 18 },
  logBox: {
    background: '#0e0f10', border: '1px solid #2a2b2e',
    borderRadius: 6, padding: '12px 14px',
    marginBottom: 20, maxHeight: 220, overflowY: 'auto',
  },
  errorMsg: { color: '#ff8080', fontSize: 12, marginBottom: 6, fontFamily: 'monospace' },
  stack:    {
    color: '#484848', fontSize: 10, margin: 0,
    whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontFamily: 'monospace',
  },
  actions: { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 },
  hint:    { fontSize: 11, color: '#3a3a3a' },
};

function btn(bg: string, color: string, border = 'none'): React.CSSProperties {
  return {
    background: bg, color, border, borderRadius: 6,
    padding: '8px 16px', fontSize: 13, cursor: 'pointer',
    fontFamily: 'inherit', fontWeight: 500,
  };
}
