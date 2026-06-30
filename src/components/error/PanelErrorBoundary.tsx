import React from 'react';

interface Props {
  name: string;
  children: React.ReactNode;
  /** Fill available space with a placeholder (default). False = compact inline strip. */
  fill?: boolean;
}

interface State {
  error: Error | null;
  showDetail: boolean;
}

export class PanelErrorBoundary extends React.Component<Props, State> {
  static defaultProps = { fill: true };
  state: State = { error: null, showDetail: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[Panel:${this.props.name}]`, error.message, info.componentStack);
    try {
      const prev = JSON.parse(localStorage.getItem('sl_panel_errors') ?? '[]');
      prev.unshift({
        time:   new Date().toISOString(),
        panel:  this.props.name,
        msg:    error.message,
        stack:  error.stack?.slice(0, 800) ?? '',
      });
      localStorage.setItem('sl_panel_errors', JSON.stringify(prev.slice(0, 20)));
    } catch { /* storage full */ }
  }

  private retry = () => this.setState({ error: null, showDetail: false });

  render() {
    if (!this.state.error) return this.props.children;

    const { name, fill } = this.props;
    const { error, showDetail } = this.state;

    if (!fill) {
      // Compact strip — used for floating / overlay panels
      return (
        <div style={strip.root}>
          <span style={strip.label}>⚠ {name} panel crashed</span>
          <button onClick={() => this.setState({ showDetail: !showDetail })} style={strip.link}>
            {showDetail ? 'hide' : 'details'}
          </button>
          <button onClick={this.retry} style={strip.retryBtn}>Retry</button>
          {showDetail && <span style={strip.detail}>{error.message}</span>}
        </div>
      );
    }

    // Full placeholder — fills the panel's layout slot
    return (
      <div style={placeholder.root}>
        <div style={placeholder.icon}>⚠</div>
        <div style={placeholder.name}>{name}</div>
        <div style={placeholder.msg}>{error.message}</div>
        <div style={placeholder.actions}>
          <button onClick={this.retry} style={placeholder.retryBtn}>Retry</button>
          <button
            onClick={() => this.setState({ showDetail: !showDetail })}
            style={placeholder.detailBtn}
          >
            {showDetail ? 'Hide stack' : 'Show stack'}
          </button>
        </div>
        {showDetail && (
          <pre style={placeholder.stack}>{error.stack}</pre>
        )}
      </div>
    );
  }
}

const strip: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
    padding: '4px 12px', background: '#1c1010',
    borderTop: '1px solid #3a1010', fontSize: 11, color: '#cc5555',
  },
  label:    { flex: 1, minWidth: 0 },
  link:     { background: 'none', border: 'none', color: '#666', fontSize: 11, cursor: 'pointer', padding: 0 },
  retryBtn: {
    background: '#2a1616', border: '1px solid #5a2222', color: '#cc6666',
    borderRadius: 3, padding: '2px 10px', fontSize: 11, cursor: 'pointer',
  },
  detail:   { width: '100%', color: '#664444', fontSize: 10, fontFamily: 'monospace', wordBreak: 'break-all' },
};

const placeholder: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    width: '100%', height: '100%', minHeight: 80,
    background: '#111214', border: '1px solid #2a1a1a', borderRadius: 4,
    color: '#555', fontFamily: "'Inter', monospace", gap: 6, padding: 16, boxSizing: 'border-box',
  },
  icon:      { fontSize: 20, color: '#5a2222' },
  name:      { fontSize: 12, fontWeight: 600, color: '#664444' },
  msg:       { fontSize: 11, color: '#4a3030', textAlign: 'center', maxWidth: 320 },
  actions:   { display: 'flex', gap: 8, marginTop: 4 },
  retryBtn:  {
    background: '#1e1010', border: '1px solid #3a1818', color: '#aa5555',
    borderRadius: 4, padding: '4px 14px', fontSize: 11, cursor: 'pointer',
  },
  detailBtn: {
    background: 'none', border: '1px solid #2a2a2a', color: '#444',
    borderRadius: 4, padding: '4px 10px', fontSize: 10, cursor: 'pointer',
  },
  stack: {
    fontSize: 9, color: '#3a2a2a', maxHeight: 120, overflowY: 'auto',
    whiteSpace: 'pre-wrap', wordBreak: 'break-all', width: '100%',
    background: '#0e0e10', border: '1px solid #1e1e20', borderRadius: 3,
    padding: '6px 8px', fontFamily: 'monospace', marginTop: 4,
  },
};
