import React, { useRef, useEffect } from 'react';
import type { RemoteInputEvent } from '../../types/remote';
import './RemoteControlOverlay.css';

interface Props {
  userRole: 'artist' | 'engineer';
  remoteScreenStream?: MediaStream | null;
  onSendInput?: (event: RemoteInputEvent) => void;
  onRevoke?: () => void; // artist
  onExit?: () => void;   // engineer
}

const RemoteControlOverlay: React.FC<Props> = ({
  userRole, remoteScreenStream, onSendInput, onRevoke, onExit,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && remoteScreenStream) {
      videoRef.current.srcObject = remoteScreenStream;
    }
  }, [remoteScreenStream]);

  // ── Engineer: capture all input from the video element ──
  useEffect(() => {
    if (userRole !== 'engineer') return;
    const el = videoRef.current;
    if (!el) return;

    const getNorm = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      return {
        nx: (e.clientX - rect.left) / rect.width,
        ny: (e.clientY - rect.top) / rect.height,
      };
    };

    const onPointerDown = (e: PointerEvent) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const { nx, ny } = getNorm(e);
      onSendInput?.({ type: 'pointerdown', nx, ny, button: e.button, buttons: e.buttons });
    };

    const onPointerMove = (e: PointerEvent) => {
      const { nx, ny } = getNorm(e);
      onSendInput?.({ type: 'pointermove', nx, ny, button: e.button, buttons: e.buttons });
    };

    const onPointerUp = (e: PointerEvent) => {
      e.preventDefault();
      const { nx, ny } = getNorm(e);
      onSendInput?.({ type: 'pointerup', nx, ny, button: e.button, buttons: 0 });
    };

    const onDblClick = (e: MouseEvent) => {
      e.preventDefault();
      const { nx, ny } = getNorm(e);
      onSendInput?.({ type: 'dblclick', nx, ny, button: e.button });
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const { nx, ny } = getNorm(e);
      onSendInput?.({ type: 'contextmenu', nx, ny, button: e.button });
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { nx, ny } = getNorm(e);
      onSendInput?.({ type: 'wheel', nx, ny, deltaX: e.deltaX, deltaY: e.deltaY });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Let Escape through so Engineer can exit RC
      if (e.key === 'Escape') { onExit?.(); return; }
      e.preventDefault();
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

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('dblclick', onDblClick);
    el.addEventListener('contextmenu', onContextMenu);
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('dblclick', onDblClick);
      el.removeEventListener('contextmenu', onContextMenu);
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [userRole, onSendInput, onExit]);

  if (userRole === 'engineer') {
    return (
      <div className="rc-engineer-overlay">
        <div className="rc-engineer-bar">
          <div className="rc-bar-left">
            <div className="rc-dot" />
            <span>REMOTE CONTROL ACTIVE — Artist&apos;s Session</span>
          </div>
          <button className="rc-exit-btn" onClick={onExit}>Exit Remote Control (Esc)</button>
        </div>
        <video
          ref={videoRef}
          className="rc-screen-video"
          autoPlay
          playsInline
          muted
        />
      </div>
    );
  }

  // Artist view
  return (
    <div className="rc-artist-overlay">
      <div className="rc-artist-bar">
        <div className="rc-bar-left">
          <div className="rc-dot" />
          <span>REMOTE CONTROL ACTIVE — Engineer is controlling your session</span>
        </div>
        <button className="rc-revoke-btn" onClick={onRevoke}>Revoke Access</button>
      </div>
    </div>
  );
};

export default RemoteControlOverlay;
