import { useState, useEffect, useRef, useCallback } from 'react';
import './DawWorkspace.css';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useDawSync } from '../../hooks/useDawSync';
import { useDaw } from '../../context/DawContext';
import { useRemoteControlReplay } from '../../hooks/useRemoteControl';
import { useAudioStream } from '../../hooks/useAudioStream';
import type { RemoteInputEvent } from '../../types/remote';
import TransportPanel from './TransportPanel';
import InspectorPanel from './InspectorPanel';
import TrackList from './TrackList';
import ArrangeWindow from './ArrangeWindow';
import MediaPoolPanel from './MediaPoolPanel';
import TopToolbar from './TopToolbar';
import MenuBar from './MenuBar';
import PreferencesDialog from './PreferencesDialog';
import FloatingVideoChat from './FloatingVideoChat';
import RemoteControlOverlay from './RemoteControlOverlay';
import { supabase } from '../../lib/supabaseClient';

interface DawWorkspaceProps {
  userRole: 'artist' | 'engineer';
  userId: string;
  roomCode: string;
}

const DawWorkspace: React.FC<DawWorkspaceProps> = ({ userRole, userId, roomCode }) => {
  const [showInspector, setShowInspector] = useState(true);
  const [showPreferences, setShowPreferences] = useState(false);
  const [onlineCount, setOnlineCount] = useState(1);
  const [toast, setToast] = useState<{ msg: string; id: number } | null>(null);
  const [rcActive, setRcActive] = useState(false);
  const sendRcInputRef = useRef<((e: RemoteInputEvent) => void) | null>(null);

  const { play, stop, record } = useAudioEngine();
  const { state, dispatch, masterStreamRef, audioCtxRef } = useDaw();

  // ── Live stream (ListenTo-style) ────────────────────────────
  const getMasterStream = useCallback(() => {
    // Initialise AudioContext on first call (must be inside a user-gesture callsite)
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') return null;
    if (!masterStreamRef.current) return null;
    return masterStreamRef.current.stream;
  }, [audioCtxRef, masterStreamRef]);

  const {
    isStreaming, isReceiving, remoteStream: liveRemoteStream,
    startStream, stopStream,
  } = useAudioStream({ roomCode, userId, userRole, getMasterStream });

  const liveAudioRef = useRef<HTMLAudioElement>(null);

  useDawSync(roomCode);

  // Play received live stream in a hidden audio element
  useEffect(() => {
    if (liveAudioRef.current && liveRemoteStream) {
      liveAudioRef.current.srcObject = liveRemoteStream;
    }
  }, [liveRemoteStream]);

  // Artist: replay remote input events when RC is active
  const { replayEvent } = useRemoteControlReplay(rcActive && userRole === 'artist');

  // Stream toggle — artist must have played once so AudioContext is alive
  const handleToggleStream = useCallback(() => {
    if (isStreaming) {
      stopStream();
    } else {
      // Ensure AudioContext is initialised (requires prior user gesture — play/record)
      if (!audioCtxRef.current) {
        alert('Press Play at least once to initialise the audio engine, then start streaming.');
        return;
      }
      startStream();
    }
  }, [isStreaming, startStream, stopStream, audioCtxRef]);

  const handleRcStateChange = useCallback((active: boolean, sendFn: ((e: RemoteInputEvent) => void) | null) => {
    setRcActive(active);
    sendRcInputRef.current = sendFn;
  }, []);

  const lastSpaceRef = useRef<number>(0);
  const actionsRef = useRef({ play, stop, record });
  useEffect(() => {
    actionsRef.current = { play, stop, record };
  }, [play, stop, record]);

  // ── Remote Control RPC ──────────────────────────────────────
  const sendRemoteCmd = (action: 'play' | 'stop' | 'record') => {
    supabase.channel(`daw-workspace-${roomCode}`).send({
      type: 'broadcast',
      event: 'rpc',
      payload: { action }
    }).catch(err => console.error('Failed to send RPC:', err));
  };

  const handlePlay   = () => userRole === 'engineer' ? sendRemoteCmd('play')   : actionsRef.current.play();
  const handleStop   = () => userRole === 'engineer' ? sendRemoteCmd('stop')   : actionsRef.current.stop();
  const handleRecord = () => userRole === 'engineer' ? sendRemoteCmd('record') : actionsRef.current.record();

  useEffect(() => {
    const channel = supabase.channel(`daw-workspace-${roomCode}`);

    channel.on('broadcast', { event: 'rpc' }, ({ payload }) => {
      if (userRole === 'artist') {
        if (payload.action === 'play')   actionsRef.current.play();
        if (payload.action === 'stop')   actionsRef.current.stop();
        if (payload.action === 'record') actionsRef.current.record();
      }
    });

    channel.on('presence', { event: 'sync' }, () => {
      const presenceState = channel.presenceState();
      setOnlineCount(Object.keys(presenceState).length);
    });

    channel.on('presence', { event: 'join' }, ({ newPresences }) => {
      const others = newPresences.filter(p => p.user_id !== userId);
      if (others.length > 0) {
        const joinedRole = others[0].role || 'user';
        setToast({ msg: `${joinedRole.charAt(0).toUpperCase() + joinedRole.slice(1)} joined the session!`, id: Date.now() });
      }
    });

    channel.on('presence', { event: 'leave' }, ({ leftPresences }) => {
      const others = leftPresences.filter(p => p.user_id !== userId);
      if (others.length > 0) {
        const leftRole = others[0].role || 'user';
        setToast({ msg: `${leftRole.charAt(0).toUpperCase() + leftRole.slice(1)} left the session.`, id: Date.now() });
      }
    });

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({ user_id: userId, role: userRole });
      }
    });

    return () => { supabase.removeChannel(channel); };
  }, [roomCode, userRole, userId]);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key === 'a' || e.key === 'A' || e.key === 'b' || e.key === 'B') {
        const { tracks, selectedTrackId } = state;
        const track = tracks.find(t => t.id === selectedTrackId && t.type === 'stereo');
        if (track) {
          const wantIdx = (e.key === 'a' || e.key === 'A') ? 0 : 1;
          if (wantIdx < track.versions.length) {
            dispatch({ type: 'SWITCH_VERSION', payload: { trackId: track.id, versionId: track.versions[wantIdx].id } });
          } else {
            dispatch({ type: 'ADD_VERSION', payload: { trackId: track.id } });
          }
          return;
        }
      }

      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z') {
          e.preventDefault();
          dispatch({ type: e.shiftKey ? 'REDO' : 'UNDO' });
          return;
        }
        if (e.key === 'l') { e.preventDefault(); dispatch({ type: 'TOGGLE_LOOP' }); return; }
        if (e.key === 'm') { e.preventDefault(); dispatch({ type: 'TOGGLE_METRONOME' }); return; }
        if (e.key === ',') { e.preventDefault(); setShowPreferences(true); return; }
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (state.selectedRegionId) {
          dispatch({ type: 'REMOVE_REGION', payload: state.selectedRegionId });
          dispatch({ type: 'SELECT_REGION', payload: null });
        }
        return;
      }

      if (e.key === 'r' || e.key === 'R') { handleRecord(); return; }

      if (e.code !== 'Space') return;
      e.preventDefault();

      const now = Date.now();
      const timeSinceLast = now - lastSpaceRef.current;
      lastSpaceRef.current = now;

      if (timeSinceLast <= 400) { handleStop(); return; }
      if (state.transport.isPlaying) { handleStop(); } else { handlePlay(); }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state, dispatch, handlePlay, handleStop, handleRecord]);

  return (
    <div className="daw-workspace" style={{ position: 'relative' }}>
      {/* Hidden audio output for received live stream (Engineer side) */}
      {userRole === 'engineer' && <audio ref={liveAudioRef} autoPlay style={{ display: 'none' }} />}
      <MenuBar onOpenPreferences={() => setShowPreferences(true)} />
      {showPreferences && <PreferencesDialog onClose={() => setShowPreferences(false)} />}
      <TopToolbar roomCode={roomCode} userRole={userRole} onlineCount={onlineCount} />

      {toast && (
        <div key={toast.id} className="daw-toast-notification">
          {toast.msg}
        </div>
      )}

      <div className="daw-main-area">
        {showInspector && <InspectorPanel />}

        <div className="daw-arrange-section">
          <div className="daw-arrange-container">
            <TrackList />
            <ArrangeWindow />
          </div>
        </div>

        <MediaPoolPanel />
      </div>

      <TransportPanel
        toggleInspector={() => setShowInspector(v => !v)}
        onPlay={handlePlay}
        onStop={handleStop}
        onRecord={handleRecord}
        userRole={userRole}
        isStreaming={isStreaming}
        isReceiving={isReceiving}
        onToggleStream={handleToggleStream}
      />

      <FloatingVideoChat
        userRole={userRole}
        userId={userId}
        roomCode={roomCode}
        onInputEvent={userRole === 'artist' ? replayEvent : undefined}
        onRcStateChange={handleRcStateChange}
      />

      {/* Remote control overlays */}
      {rcActive && userRole === 'engineer' && (
        <RemoteControlOverlay
          userRole="engineer"
          onSendInput={(e) => sendRcInputRef.current?.(e)}
          onExit={() => setRcActive(false)}
        />
      )}
      {rcActive && userRole === 'artist' && (
        <RemoteControlOverlay
          userRole="artist"
          onRevoke={() => setRcActive(false)}
        />
      )}
    </div>
  );
};

export default DawWorkspace;
