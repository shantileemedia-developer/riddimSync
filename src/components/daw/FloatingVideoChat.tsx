import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Video, Mic, MicOff, VideoOff, Minimize2, Maximize2, X, PhoneCall, MessageSquare, MonitorPlay, MonitorX } from 'lucide-react';
import { useWebRTC } from '../../hooks/useWebRTC';
import { useDaw } from '../../context/DawContext';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import type { RemoteInputEvent } from '../../types/remote';
import './FloatingVideoChat.css';

interface FloatingVideoChatProps {
  userRole: 'artist' | 'engineer';
  userId: string;
  roomCode: string;
  onInputEvent?: (event: RemoteInputEvent) => void;
  onRcStateChange?: (active: boolean, sendFn: ((e: RemoteInputEvent) => void) | null) => void;
}

const FloatingVideoChat: React.FC<FloatingVideoChatProps> = ({
  userRole, userId, roomCode, onInputEvent, onRcStateChange,
}) => {
  const [isMinimized, setIsMinimized] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; initialX: number; initialY: number } | null>(null);

  const { masterStreamRef } = useDaw();
  const { initAudioCtx } = useAudioEngine();

  const {
    localStream, remoteStream, remoteDawStream, isConnected, callActive,
    isMicOn, isVideoOn,
    incomingCall, isCalling, callerId, messages,
    ring, acceptCall, declineCall, sendMessage,
    endCall, toggleMic, toggleVideo,
    rcRequested, rcActive,
    requestRemoteControl, startScreenShare, stopRemoteControl,
    sendInputEvent,
  } = useWebRTC({
    roomCode,
    userId,
    isInitiator: userRole === 'engineer',
    getDawStream: () => {
      if (userRole === 'artist') {
        initAudioCtx();
        return masterStreamRef.current?.stream ?? null;
      }
      return null;
    },
    onInputEvent,
  });

  const localVideoRef   = useRef<HTMLVideoElement>(null);
  const remoteVideoRef  = useRef<HTMLVideoElement>(null);
  const remoteDawAudioRef = useRef<HTMLAudioElement>(null);
  const chatScrollRef   = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (localVideoRef.current && localStream) localVideoRef.current.srcObject = localStream;
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) remoteVideoRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  useEffect(() => {
    if (remoteDawAudioRef.current && remoteDawStream) {
      remoteDawAudioRef.current.srcObject = remoteDawStream;
      remoteDawAudioRef.current.volume = 1.0;
    }
  }, [remoteDawStream]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, showChat]);

  // Notify parent when RC state changes so it can show overlay and wire sendInputEvent
  useEffect(() => {
    onRcStateChange?.(rcActive, rcActive ? sendInputEvent : null);
  }, [rcActive, sendInputEvent, onRcStateChange]);

  // Artist: auto-prompt screen share when Engineer requests RC
  // (no silent auto-accept — the consent banner below handles this)

  // ── Drag Handlers ──────────────────────────────────────────────────
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

  // ── Minimized pill — portalled into the transport bar ────────────
  if (isMinimized) {
    const slot = document.getElementById('transport-chat-slot');
    if (!slot) return null;
    return createPortal(
      <div className="transport-chat-pill" onClick={() => setIsMinimized(false)} title="Restore video chat">
        <div className={`live-dot-small ${callActive && isConnected ? 'connected' : incomingCall ? 'ringing' : ''}`} />
        <div className="minimized-avatars-small">
          <div className="avatar-small">A</div>
          <div className="avatar-small engineer">E</div>
        </div>
        <span className="transport-chat-label">
          {incomingCall ? 'Incoming...' : rcActive ? 'RC Active' : callActive ? (isConnected ? 'Live' : 'Connecting…') : 'Chat'}
        </span>
        <Maximize2 size={11} color="#808080" />
      </div>,
      slot,
    );
  }

  return (
    <div
      className="floating-video-widget"
      style={position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto', margin: 0 } : undefined}
    >
      {remoteDawStream && <audio ref={remoteDawAudioRef} autoPlay />}

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
            {rcActive ? 'Remote Control' : isCalling ? 'Calling...' : callActive ? (isConnected ? 'Live Session' : 'Connecting…') : 'Video Chat'}
          </span>
        </div>
        <div className="widget-controls">
          <button className="icon-btn" onClick={() => setIsMinimized(true)} title="Minimise to bar">
            <Minimize2 size={14} />
          </button>
        </div>
      </div>

      {/* Artist: RC consent banner */}
      {rcRequested && userRole === 'artist' && (
        <div className="rc-consent-banner">
          <span className="rc-consent-text">Engineer is requesting remote control</span>
          <div className="rc-consent-actions">
            <button className="rc-consent-btn decline" onClick={() => {/* just ignore — rcRequested stays */}}>Deny</button>
            <button className="rc-consent-btn accept" onClick={startScreenShare}>Allow</button>
          </div>
        </div>
      )}

      {incomingCall ? (
        <div className="incoming-call-screen">
          <div className="incoming-call-avatar">{callerId?.[0]?.toUpperCase() || '?'}</div>
          <div className="incoming-call-text">Incoming Call...</div>
          <div className="incoming-call-actions">
            <button className="control-btn end-call" onClick={declineCall} title="Decline"><X size={18} /></button>
            <button className="control-btn start-call" onClick={acceptCall} title="Accept"><PhoneCall size={18} /></button>
          </div>
        </div>
      ) : (
        <div className="video-grid">
          <div className="video-feed remote">
            {remoteStream ? (
              <video ref={remoteVideoRef} autoPlay playsInline className="video-el" />
            ) : (
              <div className="video-placeholder">
                {isCalling ? 'Ringing...' : callActive ? 'Connecting...' : userRole === 'artist' ? 'Engineer Cam' : 'Artist Cam'}
              </div>
            )}
            <div className="feed-name">{userRole === 'engineer' ? 'Artist' : 'Engineer'}</div>
          </div>

          {callActive && (
            <div className="video-feed local">
              {localStream ? (
                <video ref={localVideoRef} autoPlay playsInline muted className="video-el" />
              ) : (
                <div className="video-placeholder">Your Cam</div>
              )}
              <div className="feed-name">You</div>
            </div>
          )}
        </div>
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
          <div className="chat-input-row">
            <input
              type="text"
              className="chat-input"
              placeholder="Type a message..."
              onKeyDown={e => {
                if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                  sendMessage(e.currentTarget.value.trim());
                  e.currentTarget.value = '';
                }
              }}
            />
          </div>
        </div>
      )}

      <div className="widget-footer">
        <div className="call-controls">
          {callActive ? (
            <>
              <button className={`control-btn ${!isMicOn ? 'off' : ''}`} onClick={toggleMic} title={isMicOn ? 'Mute mic' : 'Unmute mic'}>
                {isMicOn ? <Mic size={18} /> : <MicOff size={18} />}
              </button>
              <button className={`control-btn ${!isVideoOn ? 'off' : ''}`} onClick={toggleVideo} title={isVideoOn ? 'Turn off camera' : 'Turn on camera'}>
                {isVideoOn ? <Video size={18} /> : <VideoOff size={18} />}
              </button>
              {/* Engineer: Remote Control toggle */}
              {userRole === 'engineer' && isConnected && (
                <button
                  className={`control-btn rc-btn ${rcActive ? 'active' : ''}`}
                  onClick={rcActive ? stopRemoteControl : requestRemoteControl}
                  title={rcActive ? 'Stop remote control' : 'Request remote control'}
                >
                  {rcActive ? <MonitorX size={18} /> : <MonitorPlay size={18} />}
                </button>
              )}
              <button className="control-btn end-call" onClick={endCall} title="End call">
                <X size={18} />
              </button>
            </>
          ) : !incomingCall && (
            <button className={`control-btn start-call ${isCalling ? 'calling' : ''}`} onClick={isCalling ? endCall : ring} title={isCalling ? 'Cancel Call' : 'Call'}>
              {isCalling ? <X size={18} /> : <PhoneCall size={18} />}
              <span style={{ marginLeft: 6, fontSize: 12 }}>{isCalling ? 'Cancel' : 'Call'}</span>
            </button>
          )}
        </div>
        <div className="widget-extra-controls">
          <button className={`chat-toggle-btn ${showChat ? 'active' : ''}`} onClick={() => setShowChat(!showChat)} title="Toggle Chat">
            <MessageSquare size={16} color={showChat ? '#000' : '#fff'} />
            {!showChat && messages.length > 0 && <div className="chat-badge" />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default FloatingVideoChat;
