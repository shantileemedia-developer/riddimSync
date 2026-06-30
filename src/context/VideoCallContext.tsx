import React, {
  createContext, useCallback, useContext, useEffect, useRef, useState,
} from 'react';
import { supabase } from '../lib/supabaseClient';
import { AudioRouter } from '../audio/AudioRouter';
import type { AudioBusId } from '../audio/AudioRouter';

// PeerConnection #1: camera + mic only.
// DAW monitoring audio lives in MonitorStreamContext (PeerConnection #2).
// Desktop control lives in useWebRTC (PeerConnection #3).

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

export type CallStatus =
  | 'idle'
  | 'calling'
  | 'ringing'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

export interface VCMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: number;
}

interface VideoCallContextValue {
  // Media
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;

  // Status
  status: CallStatus;
  callActive: boolean;
  isConnected: boolean;
  isCalling: boolean;
  incomingCall: boolean;
  callerId: string | null;
  isMicOn: boolean;
  isVideoOn: boolean;

  // Chat
  messages: VCMessage[];

  // Actions
  ring: () => void;
  acceptCall: () => void;
  declineCall: () => void;
  hangup: () => void;
  toggleMic: () => void;
  toggleVideo: () => void;
  sendMessage: (text: string) => void;

  // Settings
  updateAudioInputDevice: (deviceId: string | undefined) => void;
}

const VideoCallContext = createContext<VideoCallContextValue | null>(null);

export function useVideoCall(): VideoCallContextValue {
  const ctx = useContext(VideoCallContext);
  if (!ctx) throw new Error('useVideoCall must be used within VideoCallProvider');
  return ctx;
}

interface VideoCallProviderProps {
  roomCode: string;
  userId: string;
  isInitiator: boolean;
  children: React.ReactNode;
}

export function VideoCallProvider({
  roomCode, userId, isInitiator, children,
}: VideoCallProviderProps) {
  const [localStream, setLocalStream]       = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream]     = useState<MediaStream | null>(null);
  const [status, setStatus]                 = useState<CallStatus>('idle');
  const [isMicOn, setIsMicOn]               = useState(true);
  const [isVideoOn, setIsVideoOn]           = useState(true);
  const [incomingCallFrom, setIncomingCallFrom] = useState<string | null>(null);
  const [messages, setMessages]             = useState<VCMessage[]>([]);

  const pcRef           = useRef<RTCPeerConnection | null>(null);
  const channelRef      = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const localStreamRef  = useRef<MediaStream | null>(null);
  const pendingIceRef   = useRef<RTCIceCandidateInit[]>([]);
  const pendingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const statusRef       = useRef<CallStatus>('idle');
  const teardownRef     = useRef<() => void>(() => {});
  const startCallRef    = useRef<() => Promise<void>>(() => Promise.resolve());
  const sendOfferRef    = useRef<() => Promise<void>>(() => Promise.resolve());
  // Tracks which AudioRouter bus is in use so teardown can release it
  const activeBusRef    = useRef<AudioBusId | null>(null);
  const audioDeviceRef  = useRef<string | undefined>(undefined);

  useEffect(() => { statusRef.current = status; }, [status]);

  // ── Peer connection ───────────────────────────────────────────────────────
  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = ({ candidate }) => {
      if (candidate && channelRef.current) {
        channelRef.current.send({
          type: 'broadcast', event: 'vc-ice',
          payload: { candidate, from: userId },
        });
      }
    };

    pc.ontrack = ({ streams }) => {
      const stream = streams[0];
      if (stream) setRemoteStream(stream);
    };

    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') {
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        setStatus('connected');
        pc.getSenders().forEach(async sender => {
          if (!sender.track) return;
          try {
            const params = sender.getParameters();
            if (!params.encodings?.length) params.encodings = [{}];
            if (sender.track.kind === 'video') {
              params.encodings[0].maxBitrate   = 1_500_000;
              params.encodings[0].maxFramerate = 30;
            } else {
              params.encodings[0].maxBitrate = 128_000;
            }
            await sender.setParameters(params);
          } catch {}
        });
        pc.getReceivers().forEach(receiver => {
          if (receiver.track.kind === 'audio') {
            try { (receiver as any).jitterBufferTarget = 0; } catch {}
          }
        });
      } else if (s === 'disconnected') {
        setStatus('reconnecting');
        reconnectTimer = setTimeout(() => {
          if (pcRef.current?.connectionState === 'disconnected') pcRef.current.restartIce();
        }, 5000);
      } else if (s === 'failed') {
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        if (statusRef.current !== 'idle') teardownRef.current();
      } else if (s === 'closed') {
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        if (statusRef.current !== 'idle') teardownRef.current();
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') pc.restartIce();
    };

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current!));
    }

    pcRef.current = pc;
    return pc;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Always-active VC signaling channel ───────────────────────────────────
  useEffect(() => {
    const ch = supabase.channel(`studiolink_vc_${roomCode}`, {
      config: { broadcast: { self: false } },
    });
    channelRef.current = ch;

    ch.on('broadcast', { event: 'vc-ring' }, ({ payload }) => {
      if (statusRef.current === 'idle') {
        setStatus('ringing');
        setIncomingCallFrom(payload.from);
      }
    });

    ch.on('broadcast', { event: 'vc-decline' }, () => {
      if (statusRef.current === 'calling') setStatus('idle');
    });

    ch.on('broadcast', { event: 'vc-accept' }, () => {
      if (statusRef.current === 'calling') {
        setStatus('connecting');
        setTimeout(() => startCallRef.current(), 200);
      }
    });

    ch.on('broadcast', { event: 'vc-hangup' }, () => {
      teardownRef.current();
    });

    ch.on('broadcast', { event: 'vc-chat' }, ({ payload }) => {
      setMessages(prev => [...prev, payload.message as VCMessage]);
    });

    ch.on('broadcast', { event: 'vc-ready' }, async ({ payload }) => {
      if (payload.from === userId || !isInitiator) return;
      if (pcRef.current && localStreamRef.current) {
        await sendOfferRef.current();
      }
    });

    ch.on('broadcast', { event: 'vc-offer' }, async ({ payload }) => {
      if (payload.from === userId) return;
      if (statusRef.current === 'idle') return;
      try {
        if (!pcRef.current) {
          pendingOfferRef.current = payload.offer;
          return;
        }
        const pc = pcRef.current;
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
        ch.send({ type: 'broadcast', event: 'vc-answer', payload: { answer, from: userId } });
      } catch (err) { console.error('[VideoCall] vc-offer error', err); }
    });

    ch.on('broadcast', { event: 'vc-answer' }, async ({ payload }) => {
      if (payload.from === userId) return;
      try {
        await pcRef.current?.setRemoteDescription(new RTCSessionDescription(payload.answer));
        for (const c of pendingIceRef.current) {
          await pcRef.current?.addIceCandidate(new RTCIceCandidate(c));
        }
        pendingIceRef.current = [];
      } catch (err) { console.error('[VideoCall] vc-answer error', err); }
    });

    ch.on('broadcast', { event: 'vc-ice' }, async ({ payload }) => {
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

  // ── Send WebRTC offer (initiator only) ───────────────────────────────────
  const sendOffer = useCallback(async () => {
    const pc = pcRef.current;
    const ch = channelRef.current;
    if (!pc || !ch) return;
    const offer = await pc.createOffer();
    if (offer.sdp) {
      offer.sdp = offer.sdp.replace(
        'useinbandfec=1',
        'useinbandfec=1; stereo=1; sprop-stereo=1; maxaveragebitrate=510000',
      );
    }
    await pc.setLocalDescription(offer);
    ch.send({ type: 'broadcast', event: 'vc-offer', payload: { offer, from: userId } });
  }, [userId]);

  useEffect(() => { sendOfferRef.current = sendOffer; }, [sendOffer]);

  // ── Acquire camera + mic, create PC ──────────────────────────────────────
  const startCallInternal = useCallback(async () => {
    try {
      const nativeAvail = await window.audioEngine?.isAvailable().catch(() => false);
      const LOW_LAT: MediaTrackConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        ...(audioDeviceRef.current && audioDeviceRef.current !== 'default'
          ? { deviceId: { exact: audioDeviceRef.current } }
          : {}),
      };
      const VIDEO: MediaTrackConstraints = {
        width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 },
      };

      let stream: MediaStream;
      if (nativeAvail) {
        // Reuse engine's mic bus to avoid competing for the ASIO device
        if (activeBusRef.current) {
          AudioRouter.getInstance().releaseStream(activeBusRef.current);
          activeBusRef.current = null;
        }
        const busStream = AudioRouter.getInstance().getStream('mic-input');
        if (busStream) activeBusRef.current = 'mic-input';

        const vid = await navigator.mediaDevices.getUserMedia({ video: VIDEO, audio: false })
          .catch(() => new MediaStream());

        let audioTracks = busStream?.getAudioTracks() ?? [];
        if (audioTracks.length === 0) {
          const fallback = await navigator.mediaDevices.getUserMedia({ audio: LOW_LAT }).catch(() => null);
          audioTracks = fallback?.getAudioTracks() ?? [];
        }

        stream = new MediaStream([...vid.getVideoTracks(), ...audioTracks]);
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ video: VIDEO, audio: LOW_LAT });
      }

      localStreamRef.current = stream;
      setLocalStream(stream);

      const pc = createPeerConnection();

      if (!isInitiator) {
        // Artist signals PC is ready so engineer knows to send the offer
        channelRef.current?.send({
          type: 'broadcast', event: 'vc-ready', payload: { from: userId },
        });

        if (pendingOfferRef.current) {
          const pending = pendingOfferRef.current;
          pendingOfferRef.current = null;
          await pc.setRemoteDescription(new RTCSessionDescription(pending));
          for (const c of pendingIceRef.current) await pc.addIceCandidate(new RTCIceCandidate(c));
          pendingIceRef.current = [];
          const answer = await pc.createAnswer();
          if (answer.sdp) {
            answer.sdp = answer.sdp.replace(
              'useinbandfec=1',
              'useinbandfec=1; stereo=1; sprop-stereo=1; maxaveragebitrate=510000',
            );
          }
          await pc.setLocalDescription(answer);
          channelRef.current?.send({
            type: 'broadcast', event: 'vc-answer', payload: { answer, from: userId },
          });
        }
      } else {
        await sendOffer();
      }
    } catch (err) {
      console.error('[VideoCall] startCallInternal error', err);
      setStatus('idle');
    }
  }, [isInitiator, userId, createPeerConnection, sendOffer]);

  useEffect(() => { startCallRef.current = startCallInternal; }, [startCallInternal]);

  // ── Teardown ──────────────────────────────────────────────────────────────
  const teardown = useCallback(() => {
    if (activeBusRef.current) {
      AudioRouter.getInstance().releaseStream(activeBusRef.current);
      activeBusRef.current = null;
    }
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    pendingIceRef.current   = [];
    pendingOfferRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setStatus('idle');
    setIsMicOn(true);
    setIsVideoOn(true);
    setIncomingCallFrom(null);
  }, []);

  useEffect(() => { teardownRef.current = teardown; }, [teardown]);
  useEffect(() => () => { teardown(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Public call actions ───────────────────────────────────────────────────
  const ring = useCallback(() => {
    setStatus('calling');
    channelRef.current?.send({ type: 'broadcast', event: 'vc-ring', payload: { from: userId } });
  }, [userId]);

  const acceptCall = useCallback(() => {
    setIncomingCallFrom(null);
    setStatus('connecting');
    channelRef.current?.send({ type: 'broadcast', event: 'vc-accept', payload: { from: userId } });
    startCallRef.current();
  }, [userId]);

  const declineCall = useCallback(() => {
    setStatus('idle');
    setIncomingCallFrom(null);
    channelRef.current?.send({ type: 'broadcast', event: 'vc-decline', payload: { from: userId } });
  }, [userId]);

  const hangup = useCallback(() => {
    channelRef.current?.send({ type: 'broadcast', event: 'vc-hangup', payload: { from: userId } });
    teardown();
  }, [userId, teardown]);

  const toggleMic = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) { track.enabled = !track.enabled; setIsMicOn(track.enabled); }
  }, []);

  const toggleVideo = useCallback(() => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (track) { track.enabled = !track.enabled; setIsVideoOn(track.enabled); }
  }, []);

  const sendMessage = useCallback((text: string) => {
    const msg: VCMessage = { id: `msg_${Date.now()}`, sender: userId, text, timestamp: Date.now() };
    setMessages(prev => [...prev, msg]);
    channelRef.current?.send({ type: 'broadcast', event: 'vc-chat', payload: { message: msg } });
  }, [userId]);

  const updateAudioInputDevice = useCallback((deviceId: string | undefined) => {
    audioDeviceRef.current = deviceId;
  }, []);

  // ── Context value ─────────────────────────────────────────────────────────
  const value: VideoCallContextValue = {
    localStream,
    remoteStream,
    status,
    callActive: status !== 'idle',
    isConnected: status === 'connected',
    isCalling: status === 'calling',
    incomingCall: status === 'ringing',
    callerId: incomingCallFrom,
    isMicOn,
    isVideoOn,
    messages,
    ring,
    acceptCall,
    declineCall,
    hangup,
    toggleMic,
    toggleVideo,
    sendMessage,
    updateAudioInputDevice,
  };

  return (
    <VideoCallContext.Provider value={value}>
      {children}
    </VideoCallContext.Provider>
  );
}
