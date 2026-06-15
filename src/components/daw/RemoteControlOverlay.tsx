import React, { useEffect } from 'react';
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

const RemoteControlOverlay: React.FC<Props> = ({
  userRole, onSendInput, onRevoke, onExit, viewOnly,
}) => {

  // ── Engineer: forward all interactions to artist via window listeners ─────
  // The engineer controls their own (identical) app — no screen share needed.
  useEffect(() => {
    if (userRole !== 'engineer') return;

    const norm = (e: MouseEvent | PointerEvent | WheelEvent) => ({
      nx: e.clientX / window.innerWidth,
      ny: e.clientY / window.innerHeight,
    });

    const onPointerDown = (e: PointerEvent) => {
      const { nx, ny } = norm(e);
      onSendInput?.({ type: 'pointerdown', nx, ny, button: e.button, buttons: e.buttons });
    };
    const onPointerMove = (e: PointerEvent) => {
      const { nx, ny } = norm(e);
      onSendInput?.({ type: 'pointermove', nx, ny, button: e.button, buttons: e.buttons });
    };
    const onPointerUp = (e: PointerEvent) => {
      const { nx, ny } = norm(e);
      onSendInput?.({ type: 'pointerup', nx, ny, button: e.button, buttons: 0 });
    };
    const onDblClick = (e: MouseEvent) => {
      onSendInput?.({ type: 'dblclick', ...norm(e), button: e.button });
    };
    const onContextMenu = (e: MouseEvent) => {
      onSendInput?.({ type: 'contextmenu', ...norm(e), button: e.button });
    };
    const onWheel = (e: WheelEvent) => {
      onSendInput?.({ type: 'wheel', ...norm(e), deltaX: e.deltaX, deltaY: e.deltaY });
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onExit?.(); return; }
      onSendInput?.({
        type: 'keydown', key: e.key, code: e.code,
        ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey,
        repeat: e.repeat,
      });
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return;
      onSendInput?.({
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
      window.removeEventListener('pointerdown',  onPointerDown);
      window.removeEventListener('pointermove',  onPointerMove);
      window.removeEventListener('pointerup',    onPointerUp);
      window.removeEventListener('dblclick',     onDblClick);
      window.removeEventListener('contextmenu',  onContextMenu);
      window.removeEventListener('wheel',        onWheel);
      window.removeEventListener('keydown',      onKeyDown, true);
      window.removeEventListener('keyup',        onKeyUp,   true);
    };
  }, [userRole, onSendInput, onExit]);

  // ── Artist: ESC revokes RC ────────────────────────────────────────────────
  useEffect(() => {
    if (userRole !== 'artist') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onRevoke?.(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [userRole, onRevoke]);

  const label = viewOnly ? 'VIEW ONLY' : 'REMOTE MODE';

  // ── Engineer view: just the badge — they see their own app normally ───────
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

  // ── Artist view: badge only ───────────────────────────────────────────────
  return createPortal(
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
  );
};

export default RemoteControlOverlay;
