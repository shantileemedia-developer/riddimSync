import React, {
  createContext, useCallback, useContext, useEffect, useRef, useState,
} from 'react';
import { supabase } from '../lib/supabaseClient';

// PeerConnection #3: artist DAW master-out → engineer monitoring
// Lifecycle is completely independent of video call and desktop control.
// Signals on studiolink_monitor_{roomCode}.

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turns:openrelay.metered.ca:443',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

if (import.meta.env.VITE_TURN_URL) {
  ICE_SERVERS.push({
    urls: import.meta.env.VITE_TURN_URL as string,
    username: import.meta.env.VITE_TURN_USER as string | undefined,
    credential: import.meta.env.VITE_TURN_CREDENTIAL as string | undefined,
  });
}

export type MonitorStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting';

interface MonitorStreamContextValue {
  monitorStatus: MonitorStatus;
  hasMonitorStream: boolean;
  monitorVolume: number;
  isMuted: boolean;
  // Artist calls this when DAW audio becomes available (or null to stop)
  setSourceStream: (stream: MediaStream | null) => void;
  // Engineer controls
  setMonitorVolume: (vol: number) => void;
  toggleMute: () => void;
  setOutputDevice: (deviceId: string | undefined) => void;
}

const MonitorStreamContext = createContext<MonitorStreamContextValue | null>(null);

export function useMonitorStream(): MonitorStreamContextValue {
  const ctx = useContext(MonitorStreamContext);
  if (!ctx) throw new Error('useMonitorStream must be used within MonitorStreamProvider');
  return ctx;
}

interface MonitorStreamProviderProps {
  roomCode: string;
  userId: string;
  isEngineer: boolean;
  children: React.ReactNode;
}

export function MonitorStreamProvider({
  roomCode, userId, isEngineer, children,
}: MonitorStreamProviderProps) {
  const [monitorStatus, setMonitorStatus] = useState<MonitorStatus>('idle');
  const [hasMonitorStream, setHasMonitorStream] = useState(false);
  const [monitorVolume, setMonitorVolumeState] = useState(0.7);
  const [isMuted, setIsMuted] = useState(false);

  // Refs for stable closure access
  const pcRef             = useRef<RTCPeerConnection | null>(null);
  const channelRef        = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const sourceStreamRef   = useRef<MediaStream | null>(null);
  const pendingIceRef     = useRef<RTCIceCandidateInit[]>([]);
  const statusRef         = useRef<MonitorStatus>('idle');
  const reconnTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef       = useRef<AudioContext | null>(null);
  const gainNodeRef       = useRef<GainNode | null>(null);
  const sourceNodeRef     = useRef<MediaStreamAudioSourceNode | null>(null);
  const monitorVolumeRef  = useRef(0.7);
  const isMutedRef        = useRef(false);
  const outputDeviceRef   = useRef<string | undefined>(undefined);

  useEffect(() => { statusRef.current = monitorStatus; }, [monitorStatus]);

  // ── Internal AudioContext (engineer side) ─────────────────────────────────
  const ensureAudioCtx = useCallback((): AudioContext => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      const ctx = new AudioContext({ sampleRate: 48000 });
      if (outputDeviceRef.current && outputDeviceRef.current !== 'default') {
        (ctx as any).setSinkId?.(outputDeviceRef.current).catch(() => {});
      }
      audioCtxRef.current = ctx;
    }
    return audioCtxRef.current;
  }, []);

  // Always-current routing fn — called from pc.ontrack closure
  const routeFnRef = useRef<(stream: MediaStream) => void>(() => {});
  useEffect(() => {
    routeFnRef.current = (stream: MediaStream) => {
      const ctx = ensureAudioCtx();
      sourceNodeRef.current?.disconnect();
      gainNodeRef.current?.disconnect();
      const src  = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();
      gain.gain.value = isMutedRef.current ? 0 : monitorVolumeRef.current;
      src.connect(gain);
      gain.connect(ctx.destination);
      sourceNodeRef.current = src;
      gainNodeRef.current   = gain;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      setHasMonitorStream(true);
    };
  });

  // ── Peer connection factory ────────────────────────────────────────────────
  // Kept in a ref so signaling effect closures always call the latest version
  const createPCFnRef = useRef<() => RTCPeerConnection>(() => {
    throw new Error('createPC not initialized');
  });
  useEffect(() => {
    createPCFnRef.current = () => {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

      pc.onicecandidate = ({ candidate }) => {
        if (candidate && channelRef.current) {
          channelRef.current.send({
            type: 'broadcast', event: 'monitor-ice',
            payload: { candidate, from: userId },
          });
        }
      };

      if (isEngineer) {
        pc.ontrack = ({ streams }) => {
          const stream = streams[0];
          if (stream) {
            setMonitorStatus('connected');
            routeFnRef.current(stream);
          }
        };
      }

      let localReconnTimer: ReturnType<typeof setTimeout> | null = null;

      pc.onconnectionstatechange = () => {
        const s = pc.connectionState;
        if (s === 'connected') {
          console.log('[Monitor] connected');
          if (localReconnTimer) { clearTimeout(localReconnTimer); localReconnTimer = null; }
          if (reconnTimerRef.current) { clearTimeout(reconnTimerRef.current); reconnTimerRef.current = null; }
          setMonitorStatus('connected');
          // High-fidelity bitrate for monitoring
          if (!isEngineer) {
            pc.getSenders().forEach(async sender => {
              if (!sender.track) return;
              try {
                const params = sender.getParameters();
                if (!params.encodings?.length) params.encodings = [{}];
                params.encodings[0].maxBitrate = 510_000;
                await sender.setParameters(params);
              } catch {}
            });
          } else {
            pc.getReceivers().forEach(rx => {
              try { (rx as any).jitterBufferTarget = 0; } catch {}
            });
          }
        } else if (s === 'disconnected') {
          console.log('[Monitor] reconnecting');
          setMonitorStatus('reconnecting');
          localReconnTimer = setTimeout(() => {
            if (pcRef.current?.connectionState === 'disconnected') pcRef.current.restartIce();
          }, 4000);
        } else if (s === 'failed' || s === 'closed') {
          if (localReconnTimer) { clearTimeout(localReconnTimer); localReconnTimer = null; }
          pcRef.current?.close();
          pcRef.current = null;
          if (isEngineer) {
            sourceNodeRef.current?.disconnect();
            gainNodeRef.current?.disconnect();
            sourceNodeRef.current = null;
            gainNodeRef.current   = null;
            setHasMonitorStream(false);
            setMonitorStatus('idle');
          } else {
            // Artist: re-signal after delay so engineer can re-offer
            console.log('[Monitor] reconnecting');
            setMonitorStatus('reconnecting');
            reconnTimerRef.current = setTimeout(() => {
              if (sourceStreamRef.current && channelRef.current) {
                console.log('[Monitor] ready sent');
                channelRef.current.send({
                  type: 'broadcast', event: 'monitor-ready',
                  payload: { from: userId },
                });
                setMonitorStatus('connecting');
              } else {
                setMonitorStatus('idle');
              }
            }, 5000);
          }
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'failed') pc.restartIce();
      };

      pcRef.current = pc;
      return pc;
    };
  });

  // ── Signaling channel ─────────────────────────────────────────────────────
  useEffect(() => {
    const ch = supabase.channel(`studiolink_monitor_${roomCode}`, {
      config: { broadcast: { self: false } },
    });
    channelRef.current = ch;

    if (isEngineer) {
      // Engineer receives artist's readiness signal → create recvonly offer
      ch.on('broadcast', { event: 'monitor-ready' }, async ({ payload }) => {
        if (payload.from === userId) return;
        if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
        const pc = createPCFnRef.current();
        pc.addTransceiver('audio', { direction: 'recvonly' });
        setMonitorStatus('connecting');
        try {
          const offer = await pc.createOffer();
          if (offer.sdp) {
            offer.sdp = offer.sdp.replace(
              'useinbandfec=1',
              'useinbandfec=1; stereo=1; sprop-stereo=1; maxaveragebitrate=510000',
            );
          }
          await pc.setLocalDescription(offer);
          ch.send({
            type: 'broadcast', event: 'monitor-offer',
            payload: { offer, from: userId },
          });
        } catch (err) { console.error('[Monitor] offer error', err); }
      });

      ch.on('broadcast', { event: 'monitor-answer' }, async ({ payload }) => {
        if (payload.from === userId) return;
        try {
          await pcRef.current?.setRemoteDescription(new RTCSessionDescription(payload.answer));
          for (const c of pendingIceRef.current) {
            await pcRef.current?.addIceCandidate(new RTCIceCandidate(c));
          }
          pendingIceRef.current = [];
        } catch (err) { console.error('[Monitor] answer error', err); }
      });

      ch.on('broadcast', { event: 'monitor-stop' }, () => {
        pcRef.current?.close();
        pcRef.current = null;
        sourceNodeRef.current?.disconnect();
        gainNodeRef.current?.disconnect();
        sourceNodeRef.current = null;
        gainNodeRef.current   = null;
        setHasMonitorStream(false);
        setMonitorStatus('idle');
      });
    } else {
      // Artist receives engineer's offer → answer with DAW audio track
      ch.on('broadcast', { event: 'monitor-offer' }, async ({ payload }) => {
        if (payload.from === userId) return;
        try {
          if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
          const pc = createPCFnRef.current();
          const stream = sourceStreamRef.current;
          if (stream) {
            stream.getAudioTracks().forEach(t => pc.addTrack(t, stream));
          }
          await pc.setRemoteDescription(new RTCSessionDescription(payload.offer));
          for (const c of pendingIceRef.current) {
            await pc.addIceCandidate(new RTCIceCandidate(c));
          }
          pendingIceRef.current = [];
          const answer = await pc.createAnswer();
          if (answer.sdp) {
            answer.sdp = answer.sdp.replace(
              'useinbandfec=1',
              'useinbandfec=1; stereo=1; sprop-stereo=1; maxaveragebitrate=510000',
            );
          }
          await pc.setLocalDescription(answer);
          ch.send({
            type: 'broadcast', event: 'monitor-answer',
            payload: { answer, from: userId },
          });
          setMonitorStatus('connecting');
        } catch (err) { console.error('[Monitor] artist answer error', err); }
      });
    }

    // Both sides handle ICE
    ch.on('broadcast', { event: 'monitor-ice' }, async ({ payload }) => {
      if (payload.from === userId) return;
      try {
        if (pcRef.current?.remoteDescription) {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } else {
          pendingIceRef.current.push(payload.candidate);
        }
      } catch {}
    });

    ch.subscribe();
    return () => {
      supabase.removeChannel(ch);
      channelRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode]);

  // Artist: retry monitor-ready until engineer responds (handles late engineer join)
  useEffect(() => {
    if (isEngineer) return;
    if (monitorStatus !== 'idle' || !sourceStreamRef.current) return;
    if (retryTimerRef.current) { clearInterval(retryTimerRef.current); retryTimerRef.current = null; }
    retryTimerRef.current = setInterval(() => {
      if (statusRef.current === 'idle' && sourceStreamRef.current) {
        console.log('[Monitor] ready sent');
        channelRef.current?.send({
          type: 'broadcast', event: 'monitor-ready', payload: { from: userId },
        });
      } else {
        if (retryTimerRef.current) { clearInterval(retryTimerRef.current); retryTimerRef.current = null; }
      }
    }, 20_000);
    return () => {
      if (retryTimerRef.current) { clearInterval(retryTimerRef.current); retryTimerRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monitorStatus, isEngineer]);

  // Engineer: keep AudioContext alive
  useEffect(() => {
    if (!isEngineer) return;
    const iv = setInterval(() => {
      const ctx = audioCtxRef.current;
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    }, 10_000);
    return () => clearInterval(iv);
  }, [isEngineer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (reconnTimerRef.current) clearTimeout(reconnTimerRef.current);
      if (retryTimerRef.current) clearInterval(retryTimerRef.current);
      pcRef.current?.close();
      sourceNodeRef.current?.disconnect();
      gainNodeRef.current?.disconnect();
      audioCtxRef.current?.close().catch(() => {});
      if (!isEngineer && sourceStreamRef.current) {
        channelRef.current?.send({
          type: 'broadcast', event: 'monitor-stop', payload: { from: userId },
        });
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Artist: set source stream ─────────────────────────────────────────────
  const setSourceStream = useCallback((stream: MediaStream | null) => {
    sourceStreamRef.current = stream;
    if (!stream) {
      channelRef.current?.send({
        type: 'broadcast', event: 'monitor-stop', payload: { from: userId },
      });
      pcRef.current?.close();
      pcRef.current = null;
      setMonitorStatus('idle');
      return;
    }

    // Already connected: swap the audio track
    const pc = pcRef.current;
    if (pc && (pc.connectionState === 'connected' || pc.connectionState === 'connecting')) {
      const newTrack = stream.getAudioTracks()[0];
      if (newTrack) {
        const sender = pc.getSenders().find(s => s.track?.kind === 'audio');
        sender?.replaceTrack(newTrack).catch(() => {});
      }
      return;
    }

    // Signal engineer that a source is available
    console.log('[Monitor] ready sent');
    channelRef.current?.send({
      type: 'broadcast', event: 'monitor-ready', payload: { from: userId },
    });
    setMonitorStatus('connecting');
  }, [userId]);

  // ── Engineer: volume + mute ───────────────────────────────────────────────
  const setMonitorVolume = useCallback((vol: number) => {
    monitorVolumeRef.current = vol;
    setMonitorVolumeState(vol);
    if (gainNodeRef.current && audioCtxRef.current) {
      gainNodeRef.current.gain.setTargetAtTime(
        isMutedRef.current ? 0 : vol,
        audioCtxRef.current.currentTime,
        0.02,
      );
    }
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
      const next = !prev;
      isMutedRef.current = next;
      if (gainNodeRef.current && audioCtxRef.current) {
        gainNodeRef.current.gain.setTargetAtTime(
          next ? 0 : monitorVolumeRef.current,
          audioCtxRef.current.currentTime,
          0.02,
        );
      }
      return next;
    });
  }, []);

  const setOutputDevice = useCallback((deviceId: string | undefined) => {
    outputDeviceRef.current = deviceId;
    const ctx = audioCtxRef.current;
    if (ctx && deviceId && deviceId !== 'default') {
      (ctx as any).setSinkId?.(deviceId).catch(() => {});
    }
  }, []);

  const value: MonitorStreamContextValue = {
    monitorStatus,
    hasMonitorStream,
    monitorVolume,
    isMuted,
    setSourceStream,
    setMonitorVolume,
    toggleMute,
    setOutputDevice,
  };

  return (
    <MonitorStreamContext.Provider value={value}>
      {children}
    </MonitorStreamContext.Provider>
  );
}
