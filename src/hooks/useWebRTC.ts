import { useRef, useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { RemoteInputEvent } from '../types/remote';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  // Add TURN servers here for production use behind strict firewalls:
  // { urls: 'turn:your-turn-server.com', username: '...', credential: '...' }
];

interface UseWebRTCOptions {
  roomCode: string;
  userId: string;
  isInitiator: boolean; // engineer creates offer; artist waits for it
  getDawStream?: () => MediaStream | null;
  onInputEvent?: (event: RemoteInputEvent) => void;
}

export const useWebRTC = ({ roomCode, userId, isInitiator, getDawStream, onInputEvent }: UseWebRTCOptions) => {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [remoteDawStream, setRemoteDawStream] = useState<MediaStream | null>(null);
  const [remoteScreenStream, setRemoteScreenStream] = useState<MediaStream | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [callActive, setCallActive] = useState(false);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [rcRequested, setRcRequested] = useState(false);
  const [rcActive, setRcActive] = useState(false);

  const [incomingCall, setIncomingCall] = useState(false);
  const [callerId, setCallerId] = useState<string | null>(null);
  const [isCalling, setIsCalling] = useState(false);
  const [messages, setMessages] = useState<Array<{ id: string; sender: string; text: string; timestamp: number }>>([]);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const signalChannelRef = useRef<RealtimeChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const callActiveRef = useRef(false);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const onInputEventRef = useRef(onInputEvent);

  useEffect(() => { onInputEventRef.current = onInputEvent; }, [onInputEvent]);

  const setupDataChannel = useCallback((dc: RTCDataChannel) => {
    dataChannelRef.current = dc;
    dc.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as RemoteInputEvent;
        onInputEventRef.current?.(event);
      } catch { /* ignore malformed */ }
    };
  }, []);

  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = ({ candidate }) => {
      if (candidate && channelRef.current) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'ice-candidate',
          payload: { candidate, from: userId },
        });
      }
    };

    // Identify streams by track composition to handle camera, DAW audio, and screen share
    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (!stream) return;
      const hasVideo = stream.getVideoTracks().length > 0;
      const hasAudio = stream.getAudioTracks().length > 0;
      if (hasVideo && hasAudio) setRemoteStream(stream);
      else if (hasAudio && !hasVideo) setRemoteDawStream(stream);
      else if (hasVideo && !hasAudio) setRemoteScreenStream(stream);
    };

    pc.onconnectionstatechange = () => {
      setIsConnected(pc.connectionState === 'connected');
    };

    // Renegotiation — only fires after initial connection for track additions (e.g. screen share)
    pc.onnegotiationneeded = async () => {
      if (!channelRef.current) return;
      if (!pc.currentRemoteDescription) return; // Skip initial — handled in subscribe callback
      if (pc.signalingState !== 'stable') return;
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        channelRef.current.send({
          type: 'broadcast',
          event: 'offer',
          payload: { offer, from: userId },
        });
      } catch (err) {
        console.error('Renegotiation error:', err);
      }
    };

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    const dawStream = getDawStream?.();
    if (dawStream) {
      dawStream.getAudioTracks().forEach(track => {
        pc.addTrack(track, dawStream);
      });
    }

    // Engineer (initiator) creates DataChannel; Artist receives it via ondatachannel
    if (isInitiator) {
      const dc = pc.createDataChannel('rc-input', { ordered: false, maxRetransmits: 0 });
      setupDataChannel(dc);
    } else {
      pc.ondatachannel = (e) => setupDataChannel(e.channel);
    }

    pcRef.current = pc;
    return pc;
  }, [userId, getDawStream, isInitiator, setupDataChannel]);

  // Background signaling channel — ring/accept/decline/chat and RC signals
  useEffect(() => {
    const channel = supabase.channel(`studiolink_signal_${roomCode}`, {
      config: { broadcast: { self: false } },
    });
    signalChannelRef.current = channel;

    channel.on('broadcast', { event: 'ring' }, ({ payload }) => {
      if (!callActiveRef.current) {
        setIncomingCall(true);
        setCallerId(payload.from);
      }
    });
    channel.on('broadcast', { event: 'decline' }, () => setIsCalling(false));
    channel.on('broadcast', { event: 'accept' }, () => {
      setIsCalling(false);
      setTimeout(() => startCallInternal(), 500);
    });
    channel.on('broadcast', { event: 'chat' }, ({ payload }) => {
      setMessages(prev => [...prev, payload.message]);
    });
    channel.on('broadcast', { event: 'request-rc' }, () => {
      if (!isInitiator) setRcRequested(true); // Artist receives this
    });
    channel.on('broadcast', { event: 'start-rc' }, () => {
      setRcActive(true);
      setRcRequested(false);
    });
    channel.on('broadcast', { event: 'stop-rc' }, () => {
      setRcActive(false);
      setRemoteScreenStream(null);
    });

    channel.subscribe();
    return () => { supabase.removeChannel(channel); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode]);

  const startCallInternal = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      setLocalStream(stream);
      setCallActive(true);
      callActiveRef.current = true;

      const channelName = `studiolink_${roomCode}`;
      const channel = supabase.channel(channelName, {
        config: { broadcast: { self: false } },
      });
      channelRef.current = channel;

      // Artist or renegotiation: use existing PC if available
      channel.on('broadcast', { event: 'offer' }, async ({ payload }) => {
        if (payload.from === userId) return;
        const pc = pcRef.current || createPeerConnection();
        await pc.setRemoteDescription(new RTCSessionDescription(payload.offer));
        for (const c of pendingCandidatesRef.current) {
          await pc.addIceCandidate(new RTCIceCandidate(c));
        }
        pendingCandidatesRef.current = [];
        const answer = await pc.createAnswer();
        if (answer.sdp) {
          answer.sdp = answer.sdp.replace('useinbandfec=1', 'useinbandfec=1; stereo=1; sprop-stereo=1; maxaveragebitrate=510000');
        }
        await pc.setLocalDescription(answer);
        channel.send({ type: 'broadcast', event: 'answer', payload: { answer, from: userId } });
      });

      channel.on('broadcast', { event: 'answer' }, async ({ payload }) => {
        if (payload.from === userId) return;
        if (pcRef.current) {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload.answer));
          for (const c of pendingCandidatesRef.current) {
            await pcRef.current.addIceCandidate(new RTCIceCandidate(c));
          }
          pendingCandidatesRef.current = [];
        }
      });

      channel.on('broadcast', { event: 'ice-candidate' }, async ({ payload }) => {
        if (payload.from === userId) return;
        if (pcRef.current && pcRef.current.remoteDescription) {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } else {
          pendingCandidatesRef.current.push(payload.candidate);
        }
      });

      channel.on('broadcast', { event: 'ready' }, async ({ payload }) => {
        if (payload.from === userId) return;
        if (isInitiator) {
          const pc = pcRef.current || createPeerConnection();
          const offer = await pc.createOffer();
          if (offer.sdp) {
            offer.sdp = offer.sdp.replace('useinbandfec=1', 'useinbandfec=1; stereo=1; sprop-stereo=1; maxaveragebitrate=510000');
          }
          await pc.setLocalDescription(offer);
          channel.send({ type: 'broadcast', event: 'offer', payload: { offer, from: userId } });
        }
      });

      await channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.send({ type: 'broadcast', event: 'ready', payload: { from: userId } });

          if (isInitiator) {
            const pc = pcRef.current || createPeerConnection();
            const offer = await pc.createOffer();
            if (offer.sdp) {
              offer.sdp = offer.sdp.replace('useinbandfec=1', 'useinbandfec=1; stereo=1; sprop-stereo=1; maxaveragebitrate=510000');
            }
            await pc.setLocalDescription(offer);
            channel.send({ type: 'broadcast', event: 'offer', payload: { offer, from: userId } });
          }
        }
      });
    } catch (err) {
      console.error('WebRTC startCall error:', err);
    }
  }, [roomCode, userId, isInitiator, createPeerConnection]);

  const endCall = useCallback(() => {
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    if (localStreamRef.current) { localStreamRef.current.getTracks().forEach(t => t.stop()); localStreamRef.current = null; }
    if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null; }
    if (screenTrackRef.current) { screenTrackRef.current.stop(); screenTrackRef.current = null; }
    pendingCandidatesRef.current = [];
    setLocalStream(null); setRemoteStream(null); setRemoteDawStream(null); setRemoteScreenStream(null);
    setIsConnected(false); setCallActive(false); callActiveRef.current = false;
    setIsCalling(false); setIncomingCall(false);
    setIsScreenSharing(false); setRcActive(false); setRcRequested(false);
  }, []);

  const ring = useCallback(() => {
    setIsCalling(true);
    signalChannelRef.current?.send({ type: 'broadcast', event: 'ring', payload: { from: userId } });
  }, [userId]);

  const acceptCall = useCallback(() => {
    setIncomingCall(false);
    signalChannelRef.current?.send({ type: 'broadcast', event: 'accept', payload: { from: userId } });
    startCallInternal();
  }, [userId, startCallInternal]);

  const declineCall = useCallback(() => {
    setIncomingCall(false);
    signalChannelRef.current?.send({ type: 'broadcast', event: 'decline', payload: { from: userId } });
  }, [userId]);

  const sendMessage = useCallback((text: string) => {
    const msg = { id: `msg_${Date.now()}`, sender: userId, text, timestamp: Date.now() };
    setMessages(prev => [...prev, msg]);
    signalChannelRef.current?.send({ type: 'broadcast', event: 'chat', payload: { message: msg } });
  }, [userId]);

  const toggleMic = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) { track.enabled = !track.enabled; setIsMicOn(track.enabled); }
  }, []);

  const toggleVideo = useCallback(() => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (track) { track.enabled = !track.enabled; setIsVideoOn(track.enabled); }
  }, []);

  // ── Remote Control API ────────────────────────────────────────

  // Engineer: request Artist to share their screen
  const requestRemoteControl = useCallback(() => {
    if (!isInitiator) return;
    signalChannelRef.current?.send({ type: 'broadcast', event: 'request-rc', payload: { from: userId } });
  }, [isInitiator, userId]);

  // Artist: share screen and signal RC is active
  const startScreenShare = useCallback(async () => {
    if (isInitiator) return; // only Artist
    if (!pcRef.current) { console.warn('No active call to add screen share to'); return; }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 } as MediaTrackConstraints,
        audio: false,
      });
      const track = stream.getVideoTracks()[0];
      screenTrackRef.current = track;
      pcRef.current.addTrack(track, stream); // triggers onnegotiationneeded → renegotiation
      track.onended = () => revokeRemoteControl();
      setIsScreenSharing(true);
      signalChannelRef.current?.send({ type: 'broadcast', event: 'start-rc', payload: { from: userId } });
    } catch {
      setRcRequested(false); // User cancelled getDisplayMedia picker
    }
  // revokeRemoteControl is defined below — use ref to avoid circular dep
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInitiator, userId]);

  // Artist: stop sharing screen, revoke RC
  const revokeRemoteControl = useCallback(() => {
    if (screenTrackRef.current) {
      screenTrackRef.current.stop();
      const sender = pcRef.current?.getSenders().find(s => s.track === screenTrackRef.current);
      if (sender) pcRef.current?.removeTrack(sender);
      screenTrackRef.current = null;
    }
    setIsScreenSharing(false);
    setRcActive(false);
    setRcRequested(false);
    signalChannelRef.current?.send({ type: 'broadcast', event: 'stop-rc', payload: { from: userId } });
  }, [userId]);

  // Engineer: stop remote control from their side
  const stopRemoteControl = useCallback(() => {
    if (!isInitiator) return;
    setRcActive(false);
    signalChannelRef.current?.send({ type: 'broadcast', event: 'stop-rc', payload: { from: userId } });
  }, [isInitiator, userId]);

  // Engineer: send an input event over DataChannel to Artist
  const sendInputEvent = useCallback((event: RemoteInputEvent) => {
    if (dataChannelRef.current?.readyState === 'open') {
      dataChannelRef.current.send(JSON.stringify(event));
    }
  }, []);

  useEffect(() => { return () => { endCall(); }; }, [endCall]);

  return {
    localStream, remoteStream, remoteDawStream, remoteScreenStream,
    isConnected, callActive, isMicOn, isVideoOn,
    isScreenSharing, rcRequested, rcActive,
    incomingCall, isCalling, callerId, messages,
    ring, acceptCall, declineCall, sendMessage,
    endCall, toggleMic, toggleVideo,
    requestRemoteControl, startScreenShare, revokeRemoteControl, stopRemoteControl,
    sendInputEvent,
  };
};
