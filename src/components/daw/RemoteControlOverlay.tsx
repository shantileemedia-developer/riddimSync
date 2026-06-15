import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import type { RemoteInputEvent } from '../../types/remote';
import './RemoteControlOverlay.css';

interface Props {
  userRole: 'artist' | 'engineer';
  onSendInput?: (event: RemoteInputEvent) => void;
  onRevoke?: () => void;
  onExit?: () => void;
  viewOnly?: boolean;
}

export interface RemoteControlOverlayHandle {
  moveCursor: (nx: number, ny: number) => void;
}

const RemoteControlOverlay = forwardRef<RemoteControlOverlayHandle, Props>((
  { userRole, onSendInput, onRevoke, onExit, viewOnly },
  ref,
) => {
  const cursorRef = useRef<HTMLDivElement>(null);

  // Stable refs so event listeners never need to be torn down due to prop changes
  const onSendInputRef = useRef(onSendInput);
  const onExitRef      = useRef(onExit);
  const onRevokeRef    = useRef(onRevoke);
  useEffect(() => { onSendInputRef.current = onSendInput; }, [onSendInput]);
  useEffect(() => { onExitRef.current      = onExit;      }, [onExit]);
  useEffect(() => { onRevokeRef.current    = onRevoke;    }, [onRevoke]);

  // Expose direct DOM cursor update — bypasses React state/re-render entirely
  useImperativeHandle(ref, () => ({
    moveCursor: (nx: number, ny: number) => {
      const el = cursorRef.current;
      if (!el) return;
      el.style.left    = `${nx * 100}%`;
      el.style.top     = `${ny * 100}%`;
      el.style.display = 'block';
    },
  }));

  // ── Engineer: forward events, rAF-throttle pointermove ───────────────────
  useEffect(() => {
    if (userRole !== 'engineer') return;

    const norm = (e: PointerEvent | MouseEvent | WheelEvent) => ({
      nx: e.clientX / window.innerWidth,
      ny: e.clientY / window.innerHeight,
    });

    // Cap pointermove sends to one per animation frame (~60fps)
    let pendingMove: RemoteInputEvent | null = null;
    let rafId: number | null = null;
    const flushMove = () => {
      if (pendingMove) { onSendInputRef.current?.(pendingMove); pendingMove = null; }
      rafId = null;
    };

    const onPointerMove = (e: PointerEvent) => {
      const { nx, ny } = norm(e);
      pendingMove = { type: 'pointermove', nx, ny, button: e.button, buttons: e.buttons };
      if (!rafId) rafId = requestAnimationFrame(flushMove);
    };
    const onPointerDown = (e: PointerEvent) => {
      const { nx, ny } = norm(e);
      onSendInputRef.current?.({ type: 'pointerdown', nx, ny, button: e.button, buttons: e.buttons });
    };
    const onPointerUp = (e: PointerEvent) => {
      const { nx, ny } = norm(e);
      onSendInputRef.current?.({ type: 'pointerup', nx, ny, button: e.button, buttons: 0 });
    };
    const onDblClick = (e: MouseEvent) => {
      onSendInputRef.current?.({ type: 'dblclick', ...norm(e), button: e.button });
    };
    const onContextMenu = (e: MouseEvent) => {
      onSendInputRef.current?.({ type: 'contextmenu', ...norm(e), button: e.button });
    };
    const onWheel = (e: WheelEvent) => {
      onSendInputRef.current?.({ type: 'wheel', ...norm(e), deltaX: e.deltaX, deltaY: e.deltaY });
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onExitRef.current?.(); return; }
      onSendInputRef.current?.({
        type: 'keydown', key: e.key, code: e.code,
        ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey,
        repeat: e.repeat,
      });
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return;
      onSendInputRef.current?.({
        type: 'keyup', key: e.key, code: e.code,
        ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey,
        repeat: false,
      });
    };

    window.addEventListener('pointerdown',  onPointerDown);
    window.addEventListener('pointermove',  onPointerMove);
    window.addEventListener('pointerup',    onPointerUp);
    window.addEventListener('dblclick',     onDblClick);
    window.addEventListener('contextmenu',  onContextMenu);
    window.addEventListener('wheel',        onWheel, { passive: true });
    window.addEventListener('keydown',      onKeyDown, true);
    window.addEventListener('keyup',        onKeyUp,   true);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('pointerdown',  onPointerDown);
      window.removeEventListener('pointermove',  onPointerMove);
      window.removeEventListener('pointerup',    onPointerUp);
      window.removeEventListener('dblclick',     onDblClick);
      window.removeEventListener('contextmenu',  onContextMenu);
      window.removeEventListener('wheel',        onWheel);
      window.removeEventListener('keydown',      onKeyDown, true);
      window.removeEventListener('keyup',        onKeyUp,   true);
    };
  // Only re-run if role changes — callbacks are accessed via stable refs
  }, [userRole]);

  // ── Artist: ESC revokes RC ────────────────────────────────────────────────
  useEffect(() => {
    if (userRole !== 'artist') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onRevokeRef.current?.(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [userRole]);

  const label = viewOnly ? 'VIEW ONLY' : 'REMOTE MODE';

  // ── Engineer view: badge only (they see their own app natively) ───────────
  if (userRole === 'engineer') {
    return createPortal(
      <div className="rc-badge-wrap">
        <div className={`rc-badge${viewOnly ? ' rc-badge-view' : ''}`}>
          <span className="rc-badge-dot" />
          <span className="rc-badge-label">{label}</span>
          <button className="rc-badge-exit" onClick={onExit} title="Exit Remote Mode (Esc)">✕</button>
        </div>
      </div>,
      document.body,
    );
  }

  // ── Artist view: badge + cursor dot (DOM-direct, zero React overhead) ─────
  return (
    <>
      {createPortal(
        <div className="rc-badge-wrap">
          <div className={`rc-badge${viewOnly ? ' rc-badge-view' : ''}`}>
            <span className="rc-badge-dot" />
            <span className="rc-badge-label">
              {viewOnly ? 'ENGINEER WATCHING' : 'REMOTE MODE'}
            </span>
            <button className="rc-badge-exit" onClick={onRevoke} title="Stop sharing (Esc)">✕</button>
          </div>
        </div>,
        document.body,
      )}
      {createPortal(
        <div ref={cursorRef} className="rc-remote-cursor" style={{ display: 'none' }} />,
        document.body,
      )}
    </>
  );
});

RemoteControlOverlay.displayName = 'RemoteControlOverlay';
export default RemoteControlOverlay;
