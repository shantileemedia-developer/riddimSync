import React, { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Video, Mic, MicOff, VideoOff, Minimize2, X, PhoneCall, MessageSquare, MonitorPlay, Smile, SendHorizonal } from 'lucide-react';

const EMOJIS: Record<string, string[]> = {
  '😀': ['😀','😂','🤣','😍','🥹','😎','🤔','😅','🥺','😭','😤','🤯','🥳','😴','🤩','😬','🙄','😏','😒','🤗','😇','🫡','🤫','😶','🤐'],
  '👍': ['👍','👎','👌','🤌','✌️','🤞','🤟','🤘','👏','🙌','🤜','🤛','💪','🙏','🫶','❤️','🔥','💯','✅','🎉','🚀','💀','👀','🫠','💅'],
  '🎵': ['🎵','🎶','🎸','🥁','🎹','🎤','🎧','🎼','🎷','🎺','🎻','🪗','🎙️','📻','🔊','🔇','🎚️','🎛️','💿','🎬'],
};
import { useWebRTC } from '../../hooks/useWebRTC';
import { useVideoCall } from '../../context/VideoCallContext';
import { useMonitorStream } from '../../context/MonitorStreamContext';
import type { RemoteInputEvent, RcPermissionGrant } from '../../types/remote';
import './FloatingVideoChat.css';

export interface FloatingVideoChatHandle {
  revokeDawControl: () => void;
  revokeDesktopControl: () => void;
}

interface FloatingVideoChatProps {
  userRole: 'artist' | 'engineer';
  userId: string;
  roomCode: string;
  onInputEvent?: (event: RemoteInputEvent, source: 'app' | 'desktop') => void;
  onRcStateChange?: (active: boolean, sendFn: ((e: RemoteInputEvent) => void) | null, viewOnly: boolean) => void;
  onAppRcChange?: (active: boolean, sendFn: ((e: RemoteInputEvent) => void) | null) => void;
  dawControlActive?: boolean;
  onDawControlGranted?: () => void;
  onDawControlRevoked?: () => void;
  muteCallAudio?: boolean;
  masterStreamRef: React.MutableRefObject<MediaStreamAudioDestinationNode | null>;
  nativeStreamRef: React.MutableRefObject<MediaStream | null>;
  audioCtxRef: React.MutableRefObject<AudioContext | null>;
  audioInputDeviceId?: string;
  audioOutputDeviceId?: string;
}

// ── Ringtone synthesized via Web Audio ───────────────────────────────────────
function useRingtone(isIncoming: boolean, isOutgoing: boolean) {
  const ctxRef      = useRef<AudioContext | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isRinging   = isIncoming || isOutgoing;

  useEffect(() => {
    if (!isRinging) {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
      return;
    }

    const ctx = new AudioContext();
    ctxRef.current = ctx;

    const playDualTone = (startTime: number, duration: number, amp: number) => {
      [440, 480].forEach(freq => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(amp, startTime + 0.02);
        gain.gain.setValueAtTime(amp, startTime + duration - 0.04);
        gain.gain.linearRampToValueAtTime(0, startTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + duration);
      });
    };

    if (isIncoming) {
      const playPattern = () => {
        if (!ctxRef.current || ctxRef.current.state === 'closed') return;
        const now = ctx.currentTime;
        playDualTone(now, 0.4, 0.32);
        playDualTone(now + 0.55, 0.4, 0.32);
      };
      playPattern();
      intervalRef.current = setInterval(playPattern, 3000);
    } else {
      const playRingback = () => {
        if (!ctxRef.current || ctxRef.current.state === 'closed') return;
        playDualTone(ctx.currentTime, 1.8, 0.15);
      };
      playRingback();
      intervalRef.current = setInterval(playRingback, 5800);
    }

    return () => {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      ctx.close().catch(() => {});
    };
  }, [isRinging, isIncoming]);
}

// ── Video Grid ────────────────────────────────────────────────────────────────
interface VideoGridProps {
  callActive: boolean;
  remoteStream: MediaStream | null;
  localStream: MediaStream | null;
  previewStream: MediaStream | null;
  isCalling: boolean;
  showLocalCam: boolean;
  setShowLocalCam: (v: boolean) => void;
  userRole: 'artist' | 'engineer';
  muteCallAudio?: boolean;
  audioOutputDeviceId?: string;
}

const VideoGrid: React.FC<VideoGridProps> = memo(({
  callActive, remoteStream, localStream, previewStream, isCalling,
  showLocalCam, setShowLocalCam, userRole, muteCallAudio, audioOutputDeviceId,
}) => {
  const remoteVidRef  = useRef<HTMLVideoElement>(null);
  const localVidRef   = useRef<HTMLVideoElement>(null);
  const previewVidRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (remoteVidRef.current) remoteVidRef.current.srcObject = remoteStream ?? null;
  }, [remoteStream]);

  useEffect(() => {
    const el = remoteVidRef.current as any;
    if (!el || !audioOutputDeviceId || audioOutputDeviceId === 'default') return;
    el.setSinkId?.(audioOutputDeviceId).catch(() => {});
  }, [audioOutputDeviceId, remoteStream]);

  useEffect(() => {
    if (remoteVidRef.current) remoteVidRef.current.muted = muteCallAudio ?? false;
  }, [muteCallAudio]);

  useEffect(() => {
    if (localVidRef.current) localVidRef.current.srcObject = localStream ?? null;
  }, [localStream, showLocalCam]);

  useEffect(() => {
    if (previewVidRef.current) previewVidRef.current.srcObject = previewStream ?? null;
  }, [previewStream]);

  return (
    <div className="video-grid">
      <div className="video-feed remote">
        {callActive ? (
          remoteStream ? (
            <video autoPlay playsInline className="video-el" ref={remoteVidRef} />
          ) : (
            <div className="video-placeholder">{isCalling ? 'Ringing…' : 'Connecting…'}</div>
          )
        ) : (
          previewStream ? (
            <video autoPlay playsInline muted className="video-el" ref={previewVidRef} />
          ) : (
            <div className="video-placeholder">{isCalling ? 'Calling…' : 'Camera Preview'}</div>
          )
        )}
        <div className="feed-name">
          {callActive ? (userRole === 'engineer' ? 'Artist' : 'Engineer') : 'You'}
        </div>
      </div>

      {callActive && showLocalCam && (
        <div className="video-feed local">
          {localStream ? (
            <video autoPlay playsInline muted className="video-el" ref={localVidRef} />
          ) : (
            <div className="video-placeholder" style={{ fontSize: 10 }}>Your Cam</div>
          )}
          <div className="feed-name">You</div>
          <button className="pip-hide-btn" onClick={() => setShowLocalCam(false)} title="Hide your camera">
            <VideoOff size={9} />
          </button>
        </div>
      )}

      {callActive && !showLocalCam && (
        <button className="pip-show-btn" onClick={() => setShowLocalCam(true)} title="Show your camera">
          <Video size={11} />
        </button>
      )}
    </div>
  );
});

// ── Desktop Control fullscreen overlay ────────────────────────────────────────
interface DesktopControlFullscreenProps {
  stream: MediaStream;
  onExit: () => void;
  onStop: () => void;
  onSendInput: (e: RemoteInputEvent) => void;
}

const DesktopControlFullscreen: React.FC<DesktopControlFullscreenProps> = ({
  stream, onExit, onStop, onSendInput,
}) => {
  const vidRef         = useRef<HTMLVideoElement>(null);
  const onSendRef      = useRef(onSendInput);
  const onExitRef      = useRef(onExit);
  const pendingMoveRef = useRef<RemoteInputEvent | null>(null);
  const rafIdRef       = useRef<number | null>(null);

  useEffect(() => { onSendRef.current = onSendInput; }, [onSendInput]);
  useEffect(() => { onExitRef.current = onExit; }, [onExit]);
  useEffect(() => { if (vidRef.current) vidRef.current.srcObject = stream; }, [stream]);

  const normCoords = useCallback((clientX: number, clientY: number) => {
    const vid = vidRef.current;
    if (!vid || !vid.videoWidth || !vid.videoHeight) {
      return { nx: clientX / window.innerWidth, ny: clientY / window.innerHeight };
    }
    const elW = vid.clientWidth; const elH = vid.clientHeight;
    const vA = vid.videoWidth / vid.videoHeight; const eA = elW / elH;
    let cW: number, cH: number, oX: number, oY: number;
    if (vA > eA) { cW = elW; cH = elW / vA; oX = 0; oY = (elH - cH) / 2; }
    else { cH = elH; cW = elH * vA; oX = (elW - cW) / 2; oY = 0; }
    return {
      nx: Math.max(0, Math.min(1, (clientX - oX) / cW)),
      ny: Math.max(0, Math.min(1, (clientY - oY) / cH)),
    };
  }, []);

  const isOnHud = (e: React.SyntheticEvent) =>
    !!(e.target as HTMLElement).closest('[data-desktop-hud]');

  const handlePointerMove = (e: React.PointerEvent) => {
    const { nx, ny } = normCoords(e.clientX, e.clientY);
    pendingMoveRef.current = { type: 'pointermove', nx, ny, button: e.button, buttons: e.buttons };
    if (!rafIdRef.current) {
      rafIdRef.current = requestAnimationFrame(() => {
        if (pendingMoveRef.current) onSendRef.current(pendingMoveRef.current);
        pendingMoveRef.current = null;
        rafIdRef.current = null;
      });
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (isOnHud(e)) return;
    e.stopPropagation();
    const { nx, ny } = normCoords(e.clientX, e.clientY);
    onSendRef.current({ type: 'pointerdown', nx, ny, button: e.button, buttons: e.buttons });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isOnHud(e)) return;
    e.stopPropagation();
    const { nx, ny } = normCoords(e.clientX, e.clientY);
    onSendRef.current({ type: 'pointerup', nx, ny, button: e.button, buttons: 0 });
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (isOnHud(e)) return;
    const { nx, ny } = normCoords(e.clientX, e.clientY);
    onSendRef.current({ type: 'wheel', nx, ny, deltaX: e.deltaX, deltaY: e.deltaY });
  };

  const handleDblClick = (e: React.MouseEvent) => {
    if (isOnHud(e)) return;
    e.stopPropagation();
    const { nx, ny } = normCoords(e.clientX, e.clientY);
    onSendRef.current({ type: 'dblclick', nx, ny, button: e.button });
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (isOnHud(e)) return;
    e.preventDefault(); e.stopPropagation();
    const { nx, ny } = normCoords(e.clientX, e.clientY);
    onSendRef.current({ type: 'contextmenu', nx, ny, button: e.button });
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      e.stopImmediatePropagation();
      if (e.key === 'Escape') { onExitRef.current(); return; }
      onSendRef.current({
        type: 'keydown', key: e.key, code: e.code,
        ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey,
        repeat: e.repeat,
      });
    };
    const onKeyUp = (e: KeyboardEvent) => {
      e.stopImmediatePropagation();
      if (e.key === 'Escape') return;
      onSendRef.current({
        type: 'keyup', key: e.key, code: e.code,
        ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey,
        repeat: false,
      });
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      if (rafIdRef.current) { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = null; }
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, []);

  return createPortal(
    <div
      className="desktop-control-fullscreen"
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
      onDoubleClick={handleDblClick}
      onContextMenu={handleContextMenu}
    >
      <video ref={vidRef} autoPlay playsInline muted className="desktop-control-video" />
      <div className="desktop-control-hud" data-desktop-hud="">
        <div className="desktop-control-hud-label">
          <span className="desktop-hud-dot" />
          Desktop Control Active
        </div>
        <button className="desktop-control-exit-btn" onClick={onExit}>⊠ Exit Fullscreen</button>
        <button className="desktop-control-stop-btn" onClick={onStop}>Stop Control</button>
      </div>
    </div>,
    document.body,
  );
};

interface DesktopStreamPreviewProps {
  stream: MediaStream;
  onFullscreen: () => void;
}
const DesktopStreamPreview: React.FC<DesktopStreamPreviewProps> = ({ stream, onFullscreen }) => {
  const vidRef = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (vidRef.current) vidRef.current.srcObject = stream; }, [stream]);
  return (
    <div className="desktop-stream-preview">
      <video ref={vidRef} autoPlay playsInline muted className="desktop-stream-preview-video" />
      <button className="desktop-stream-fullscreen-btn" onClick={onFullscreen} title="Full Screen">
        ⛶ Full Screen
      </button>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────

const FloatingVideoChat = forwardRef<FloatingVideoChatHandle, FloatingVideoChatProps>(({
  userRole, userId, roomCode, onInputEvent, onRcStateChange, onAppRcChange,
  dawControlActive, onDawControlGranted, onDawControlRevoked, muteCallAudio,
  masterStreamRef, nativeStreamRef, audioCtxRef,
  audioInputDeviceId, audioOutputDeviceId,
}, ref) => {
  const [isMinimized, setIsMinimized]         = useState(true);
  const [showChat, setShowChat]               = useState(false);
  const [chatInput, setChatInput]             = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojiTab, setEmojiTab]               = useState<string>('😀');
  const [mounted, setMounted]                 = useState(false);
  const [position, setPosition]               = useState<{ x: number; y: number } | null>(null);
  const [size, setSize]                       = useState<{ width: number; height: number }>({ width: 320, height: 0 });
  const [rcDenied, setRcDenied]               = useState(false);
  const [rcDesktopGrant, setRcDesktopGrant]   = useState<'none' | 'view' | 'full'>('full');
  const [rcDawGrant, setRcDawGrant]           = useState(true);
  const [desktopFullscreen, setDesktopFullscreen] = useState(false);
  const [showDesktopPanel, setShowDesktopPanel]   = useState(false);
  const [previewStream, setPreviewStream]     = useState<MediaStream | null>(null);
  const [showLocalCam, setShowLocalCam]       = useState(true);
  const previewStreamRef  = useRef<MediaStream | null>(null);
  const dragRef           = useRef<{ startX: number; startY: number; initialX: number; initialY: number } | null>(null);
  const resizeRef         = useRef<{ startX: number; startY: number; initW: number; initH: number; el: HTMLElement } | null>(null);
  const widgetRef         = useRef<HTMLDivElement>(null);
  const chatInputRef      = useRef<HTMLInputElement>(null);
  const emojiPickerRef    = useRef<HTMLDivElement>(null);

  // ── PeerConnection #1: video call (camera + mic only) ────────────────────
  const {
    localStream, remoteStream,
    callActive, isConnected, isCalling, incomingCall, callerId,
    isMicOn, isVideoOn, messages,
    ring, acceptCall, declineCall, hangup,
    toggleMic, toggleVideo, sendMessage,
    updateAudioInputDevice,
  } = useVideoCall();

  // ── PeerConnection #2: DAW monitor stream (artist → engineer) ────────────
  const {
    monitorStatus, hasMonitorStream,
    monitorVolume, isMuted: monitorMuted,
    setSourceStream, setMonitorVolume, toggleMute: toggleMonitorMute,
    setOutputDevice: setMonitorOutputDevice,
  } = useMonitorStream();

  // ── PeerConnection #3: desktop RC ────────────────────────────────────────
  const {
    remoteDesktopStream, rcRequested, rcActive, rcEngineerName, rcViewOnly,
    requestRemoteControl, revokeRemoteControl, stopRemoteControl,
    respondToRcPermission, revokeDawControl,
    sendInputEvent,
    appRcActive, startAppRc, stopAppRc, sendAppRcInput, signalChannelReady,
  } = useWebRTC({
    roomCode, userId,
    isInitiator: userRole === 'engineer',
    onInputEvent,
    onDawControlGranted,
    onDawControlRevoked,
  });

  // Sync audio input device preference to VideoCallContext
  useEffect(() => {
    updateAudioInputDevice(audioInputDeviceId);
  }, [audioInputDeviceId, updateAudioInputDevice]);

  // Sync audio output device preference to MonitorStreamContext
  useEffect(() => {
    setMonitorOutputDevice(audioOutputDeviceId);
  }, [audioOutputDeviceId, setMonitorOutputDevice]);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!showEmojiPicker) return;
    const handler = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showEmojiPicker]);

  const insertEmoji = useCallback((emoji: string) => {
    const el = chatInputRef.current;
    if (!el) { setChatInput(v => v + emoji); return; }
    const start = el.selectionStart ?? chatInput.length;
    const end   = el.selectionEnd   ?? chatInput.length;
    const next  = chatInput.slice(0, start) + emoji + chatInput.slice(end);
    setChatInput(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  }, [chatInput]);

  useEffect(() => { if (!rcRequested) setRcDenied(false); }, [rcRequested]);

  useImperativeHandle(ref, () => ({
    revokeDawControl,
    revokeDesktopControl: revokeRemoteControl,
  }), [revokeDawControl, revokeRemoteControl]);

  useEffect(() => {
    if (!rcActive) { setDesktopFullscreen(false); setShowDesktopPanel(false); }
  }, [rcActive]);

  useEffect(() => {
    return () => {
      if (rcActive) stopRemoteControl();
      stopAppRc();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (rcActive && remoteDesktopStream) setIsMinimized(false);
  }, [rcActive, remoteDesktopStream]);

  useEffect(() => {
    onRcStateChange?.(rcActive, rcActive ? sendInputEvent : null, rcViewOnly);
  }, [rcActive, sendInputEvent, onRcStateChange, rcViewOnly]);

  useEffect(() => {
    onAppRcChange?.(appRcActive, appRcActive ? sendAppRcInput : null);
  }, [appRcActive, sendAppRcInput, onAppRcChange]);

  // App RC lifecycle — start when DAW control is granted
  useEffect(() => {
    if (userRole === 'engineer') {
      if (dawControlActive && !appRcActive && signalChannelReady) {
        startAppRc();
      } else if (!dawControlActive) {
        stopAppRc();
      }
    } else {
      if (!dawControlActive) stopAppRc();
    }
  }, [dawControlActive, appRcActive, signalChannelReady, userRole, startAppRc, stopAppRc]);

  // Artist: watch master bus stream and push to MonitorStreamContext (PeerConnection #2).
  // Polls indefinitely — handles stream creation, object recreation (device switch),
  // and stream loss. Completely independent of video call state.
  useEffect(() => {
    if (userRole !== 'artist') return;
    const getStream = (): MediaStream | null =>
      nativeStreamRef.current ?? masterStreamRef.current?.stream ?? null;

    let lastStream: MediaStream | null = null;

    const check = () => {
      const stream = getStream();
      if (stream === lastStream) return;         // no change — nothing to do
      if (stream && !lastStream) {
        console.log('[Monitor] source stream detected');
      } else if (!stream && lastStream) {
        console.log('[Monitor] source stream lost');
      }
      lastStream = stream;
      setSourceStream(stream);
    };

    check(); // immediate check on mount
    const iv = setInterval(check, 2000);
    return () => clearInterval(iv);
  // nativeStreamRef and masterStreamRef are stable ref objects — no need in deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userRole, setSourceStream]);

  // Artist: keep AudioContext alive (needed for Web Audio master bus)
  useEffect(() => {
    if (userRole !== 'artist') return;
    const iv = setInterval(() => {
      const ctx = audioCtxRef.current;
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    }, 8000);
    return () => clearInterval(iv);
  }, [userRole, audioCtxRef]);

  // Camera preview when widget is open but not in a call
  useEffect(() => {
    if (isMinimized || callActive) {
      previewStreamRef.current?.getTracks().forEach(t => t.stop());
      previewStreamRef.current = null;
      setPreviewStream(null);
      return;
    }
    let cancelled = false;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then(stream => {
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        previewStreamRef.current = stream;
        setPreviewStream(stream);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      previewStreamRef.current?.getTracks().forEach(t => t.stop());
      previewStreamRef.current = null;
      setPreviewStream(null);
    };
  }, [isMinimized, callActive]);

  useRingtone(incomingCall, isCalling);

  // Scroll chat to bottom
  const chatScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [messages, showChat]);

  // ── Drag handlers ─────────────────────────────────────────────────────────
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const rect = e.currentTarget.parentElement!.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      initialX: position ? position.x : rect.left,
      initialY: position ? position.y : rect.top,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    setPosition({
      x: dragRef.current.initialX + (e.clientX - dragRef.current.startX),
      y: dragRef.current.initialY + (e.clientY - dragRef.current.startY),
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  const handleResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation();
    const el = widgetRef.current;
    if (!el) return;
    resizeRef.current = { startX: e.clientX, startY: e.clientY, initW: el.offsetWidth, initH: el.offsetHeight, el };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current) return;
    const { startX, startY, initW, initH } = resizeRef.current;
    setSize({ width: Math.max(240, initW + (e.clientX - startX)), height: Math.max(180, initH + (e.clientY - startY)) });
  };

  const handleResizeUp = (e: React.PointerEvent<HTMLDivElement>) => {
    resizeRef.current = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  // ── Always-mounted hidden videos (prevent srcObject loss on minimize) ──────
  const localVideoRef  = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => { if (localVideoRef.current)  localVideoRef.current.srcObject  = localStream  ?? null; }, [localStream]);
  useEffect(() => { if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream ?? null; }, [remoteStream]);

  const hiddenVideos = (
    <>
      <video ref={remoteVideoRef} autoPlay playsInline style={{ display: 'none' }} />
      <video ref={localVideoRef}  autoPlay playsInline muted style={{ display: 'none' }} />
    </>
  );

  // ── Incoming call modal ───────────────────────────────────────────────────
  const incomingCallModal = incomingCall ? createPortal(
    <div className="incoming-call-modal">
      <div className="incoming-call-modal-card">
        <div className="incoming-call-avatar">{callerId?.[0]?.toUpperCase() || '?'}</div>
        <div className="incoming-call-text">Incoming Call…</div>
        <div className="incoming-call-from">{callerId ?? 'Unknown'}</div>
        <div className="incoming-call-actions">
          <button className="control-btn end-call" onClick={declineCall} title="Decline">
            <X size={20} />
            <span style={{ marginLeft: 6, fontSize: 12 }}>Decline</span>
          </button>
          <button className="control-btn start-call" onClick={() => { acceptCall(); setIsMinimized(false); }} title="Accept">
            <PhoneCall size={20} />
            <span style={{ marginLeft: 6, fontSize: 12 }}>Accept</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  ) : null;

  // ── RC consent modal ──────────────────────────────────────────────────────
  const rcConsentModal = rcRequested && !rcDenied && userRole === 'artist' ? createPortal(
    <div className="rc-consent-overlay">
      <div className="rc-consent-card">
        <div className="rc-consent-monitor-icon"><MonitorPlay size={32} color="#ff7744" /></div>
        <h3 className="rc-consent-title">Remote Access Request</h3>
        <p className="rc-consent-body">
          <strong>{rcEngineerName}</strong> is requesting remote session access.
        </p>
        <div className="rc-consent-section">
          <div className="rc-consent-section-label">Desktop Access</div>
          <div className="rc-consent-radio-group">
            <label className="rc-consent-radio-label">
              <input type="radio" name="rc-desktop" value="none"
                checked={rcDesktopGrant === 'none'} onChange={() => setRcDesktopGrant('none')} />
              No desktop access
            </label>
            <label className="rc-consent-radio-label">
              <input type="radio" name="rc-desktop" value="view"
                checked={rcDesktopGrant === 'view'} onChange={() => setRcDesktopGrant('view')} />
              Screen view only
            </label>
            <label className="rc-consent-radio-label">
              <input type="radio" name="rc-desktop" value="full"
                checked={rcDesktopGrant === 'full'} onChange={() => setRcDesktopGrant('full')} />
              Full desktop control
            </label>
          </div>
          {rcDesktopGrant === 'full' && (
            <p className="rc-consent-hint">
              Engineer can see and control your entire screen, including apps outside the DAW.
            </p>
          )}
        </div>
        <div className="rc-consent-section">
          <div className="rc-consent-section-label">DAW Access</div>
          <label className="rc-consent-checkbox-row">
            <input type="checkbox" checked={rcDawGrant} onChange={e => setRcDawGrant(e.target.checked)} />
            <span>Allow DAW control</span>
          </label>
        </div>
        <div className="rc-consent-actions">
          <button className="rc-consent-btn decline"
            onClick={() => { setRcDenied(true); respondToRcPermission({ desktopAccess: 'none', dawControl: false } as RcPermissionGrant); }}>
            Cancel
          </button>
          <button className="rc-consent-btn accept"
            onClick={() => respondToRcPermission({ desktopAccess: rcDesktopGrant, dawControl: rcDawGrant })}>
            Grant Access
          </button>
        </div>
      </div>
    </div>,
    document.body,
  ) : null;

  // ── Minimized pill ────────────────────────────────────────────────────────
  if (isMinimized) {
    const slot = mounted ? document.getElementById('transport-chat-slot') : null;
    const pillStatus = incomingCall ? 'ringing'
      : callActive && isConnected ? 'connected'
      : callActive ? 'connecting'
      : 'idle';
    return (
      <>
        {hiddenVideos}
        {incomingCallModal}
        {rcConsentModal}
        {slot && createPortal(
          <div
            className={`transport-chat-pill pill-${pillStatus}`}
            data-desktop-hud=""
            onClick={() => setIsMinimized(false)}
            title="Open Video Chat"
          >
            <div className="pill-video-icon"><Video size={14} /></div>
            <div className={`live-dot-small ${pillStatus === 'connected' ? 'connected' : pillStatus === 'ringing' ? 'ringing' : ''}`} />
            <span className="transport-chat-label">
              {incomingCall ? 'Incoming Call'
                : rcActive ? 'Remote Control'
                : callActive ? (isConnected ? 'In Call' : 'Connecting…')
                : 'Video Call'}
            </span>
          </div>,
          slot,
        )}
      </>
    );
  }

  return (
    <>
      {hiddenVideos}
      {incomingCallModal}
      {rcConsentModal}

      <div
        ref={widgetRef}
        data-desktop-hud=""
        className="floating-video-widget"
        style={{
          ...(position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto', margin: 0 } : undefined),
          width: size.width,
          ...(size.height > 0 ? { height: size.height } : undefined),
        }}
      >
        <div className="widget-inner-clip">
          <div
            className="widget-header"
            style={{ cursor: 'move', userSelect: 'none' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <div className="widget-title">
              <div className={`live-dot ${rcActive ? 'rc' : callActive && isConnected ? 'connected' : ''}`} />
              <span>
                {rcActive ? 'Remote Control'
                  : isCalling ? 'Calling...'
                  : callActive ? (isConnected ? 'Live Session' : 'Connecting…')
                  : 'Video Chat'}
              </span>
            </div>
            <div className="widget-controls">
              <button className="icon-btn" onClick={() => setIsMinimized(true)} title="Minimise to bar">
                <Minimize2 size={14} />
              </button>
            </div>
          </div>

          <VideoGrid
            callActive={callActive}
            remoteStream={remoteStream}
            localStream={localStream}
            previewStream={previewStream}
            isCalling={isCalling}
            showLocalCam={showLocalCam}
            setShowLocalCam={setShowLocalCam}
            userRole={userRole}
            muteCallAudio={muteCallAudio}
            audioOutputDeviceId={audioOutputDeviceId}
          />

          {userRole === 'engineer' && rcActive && remoteDesktopStream && showDesktopPanel && !desktopFullscreen && (
            <DesktopStreamPreview
              stream={remoteDesktopStream}
              onFullscreen={() => setDesktopFullscreen(true)}
            />
          )}

          {userRole === 'engineer' && rcActive && remoteDesktopStream && desktopFullscreen && (
            <DesktopControlFullscreen
              stream={remoteDesktopStream}
              onExit={() => setDesktopFullscreen(false)}
              onStop={stopRemoteControl}
              onSendInput={sendInputEvent}
            />
          )}

          {showChat && (
            <div className="chat-pane">
              <div className="chat-messages" ref={chatScrollRef}>
                {messages.length === 0 && <div className="chat-empty">No messages yet.</div>}
                {messages.map(m => (
                  <div key={m.id} className={`chat-message ${m.sender === userId ? 'self' : 'other'}`}>
                    <span className="msg-text">{m.text}</span>
                  </div>
                ))}
              </div>
              <div className="chat-input-row" style={{ position: 'relative' }}>
                {showEmojiPicker && (
                  <div className="emoji-picker" ref={emojiPickerRef}>
                    <div className="emoji-tabs">
                      {Object.keys(EMOJIS).map(tab => (
                        <button key={tab} className={`emoji-tab ${emojiTab === tab ? 'active' : ''}`}
                          onClick={() => setEmojiTab(tab)}>{tab}</button>
                      ))}
                    </div>
                    <div className="emoji-grid">
                      {(EMOJIS[emojiTab] ?? []).map(e => (
                        <button key={e} className="emoji-btn" onClick={() => insertEmoji(e)}>{e}</button>
                      ))}
                    </div>
                  </div>
                )}
                <button
                  className={`emoji-toggle-btn ${showEmojiPicker ? 'active' : ''}`}
                  onClick={() => setShowEmojiPicker(v => !v)}
                  title="Emoji" type="button"
                >
                  <Smile size={14} />
                </button>
                <input
                  ref={chatInputRef}
                  type="text"
                  className="chat-input"
                  placeholder="Type a message…"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && chatInput.trim()) {
                      sendMessage(chatInput.trim());
                      setChatInput('');
                      setShowEmojiPicker(false);
                    }
                  }}
                />
                <button
                  className="chat-send-btn"
                  disabled={!chatInput.trim()}
                  onClick={() => {
                    if (!chatInput.trim()) return;
                    sendMessage(chatInput.trim());
                    setChatInput('');
                    setShowEmojiPicker(false);
                    chatInputRef.current?.focus();
                  }}
                  title="Send" type="button"
                >
                  <SendHorizonal size={14} />
                </button>
              </div>
            </div>
          )}

          <div className="widget-footer">
            <div className="call-controls">
              {callActive ? (
                <>
                  <button className={`control-btn ${!isMicOn ? 'off' : ''}`} onClick={toggleMic}
                    title={isMicOn ? 'Mute mic' : 'Unmute mic'}>
                    {isMicOn ? <Mic size={18} /> : <MicOff size={18} />}
                  </button>
                  <button className={`control-btn ${!isVideoOn ? 'off' : ''}`} onClick={toggleVideo}
                    title={isVideoOn ? 'Turn off camera' : 'Turn on camera'}>
                    {isVideoOn ? <Video size={18} /> : <VideoOff size={18} />}
                  </button>
                  <button className="control-btn end-call" onClick={hangup} title="End call">
                    <X size={18} />
                  </button>
                </>
              ) : !incomingCall && (
                <button
                  className={`control-btn start-call ${isCalling ? 'calling' : ''}`}
                  onClick={isCalling ? hangup : ring}
                  title={isCalling ? 'Cancel Call' : 'Call'}
                >
                  {isCalling ? <X size={18} /> : <PhoneCall size={18} />}
                  <span style={{ marginLeft: 6, fontSize: 12 }}>{isCalling ? 'Cancel' : 'Call'}</span>
                </button>
              )}

              {userRole === 'engineer' && (
                rcActive ? (
                  <>
                    {remoteDesktopStream && (
                      <button
                        className={`session-ctrl-btn${showDesktopPanel ? ' active' : ''}`}
                        onClick={() => setShowDesktopPanel(v => !v)}
                        title={showDesktopPanel ? 'Hide desktop preview' : 'View artist desktop'}
                      >
                        {showDesktopPanel ? 'Hide Desktop' : 'View Desktop'}
                      </button>
                    )}
                    <button
                      className="session-ctrl-btn desktop active"
                      onClick={stopRemoteControl}
                      title="Stop Desktop Control"
                    >
                      Stop Desktop
                    </button>
                  </>
                ) : rcRequested ? (
                  <button className="session-ctrl-btn" disabled title="Waiting for artist…">
                    Requesting…
                  </button>
                ) : (
                  <button
                    className="session-ctrl-btn"
                    onClick={() => requestRemoteControl(userId)}
                    title="Request desktop and DAW access from artist"
                  >
                    Request Access
                  </button>
                )
              )}
            </div>

            {/* Monitor stream volume — engineer only, shown when stream is active */}
            {userRole === 'engineer' && hasMonitorStream && (
              <div className="monitor-knob-row">
                <button
                  className={`monitor-mute-btn${monitorMuted ? ' muted' : ''}`}
                  onClick={toggleMonitorMute}
                  title={monitorMuted ? 'Unmute monitor' : 'Mute monitor'}
                >
                  {monitorMuted ? '🔇' : '🎧'}
                </button>
                <input
                  type="range"
                  className="monitor-knob-slider"
                  min={0} max={1} step={0.01}
                  value={monitorVolume}
                  onChange={e => setMonitorVolume(parseFloat(e.target.value))}
                  title={`Monitor level: ${Math.round(monitorVolume * 100)}%`}
                />
                <span className="monitor-knob-value">{Math.round(monitorVolume * 100)}%</span>
                {monitorStatus === 'reconnecting' && (
                  <span className="monitor-reconnect-badge">reconnecting</span>
                )}
              </div>
            )}

            <div className="widget-extra-controls">
              <button
                className={`chat-toggle-btn ${showChat ? 'active' : ''}`}
                onClick={() => setShowChat(!showChat)}
                title="Toggle Chat"
              >
                <MessageSquare size={16} color={showChat ? '#000' : '#fff'} />
                {!showChat && messages.length > 0 && <div className="chat-badge" />}
              </button>
            </div>
          </div>
        </div>

        <div
          className="widget-resize-handle"
          onPointerDown={handleResizeDown}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeUp}
        />
      </div>
    </>
  );
});

FloatingVideoChat.displayName = 'FloatingVideoChat';
export default FloatingVideoChat;
