import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// ── Global renderer error logging ────────────────────────────────────────────

function logRendererError(kind: string, message: string, stack = '') {
  try {
    const prev = JSON.parse(localStorage.getItem('sl_renderer_errors') ?? '[]');
    prev.unshift({ time: new Date().toISOString(), kind, message, stack: stack.slice(0, 1500) });
    localStorage.setItem('sl_renderer_errors', JSON.stringify(prev.slice(0, 10)));
  } catch { /* storage full */ }
  console.error(`[renderer:${kind}]`, message, stack);
}

window.onerror = (_msg, _src, _line, _col, err) => {
  logRendererError('uncaught', err?.message ?? String(_msg), err?.stack);
  return false; // don't suppress default behaviour
};

window.onunhandledrejection = (e) => {
  const err = e.reason;
  logRendererError('unhandledrejection',
    err instanceof Error ? err.message : String(err),
    err instanceof Error ? (err.stack ?? '') : '',
  );
};

function ElectronWindowControls() {
  if (!window.electronWindow) return null;
  return (
    <div className="app-wc">
      <button className="wc-btn wc-minimize" title="Minimize"
        onClick={() => window.electronWindow!.minimize()}>─</button>
      <button className="wc-btn wc-maximize" title="Maximize / Restore"
        onClick={() => window.electronWindow!.maximize()}>□</button>
      <button className="wc-btn wc-close" title="Close"
        onClick={() => window.electronWindow!.close()}>✕</button>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <ElectronWindowControls />
  </StrictMode>,
)
