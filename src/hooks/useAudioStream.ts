import { useRef, useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { RealtimeChannel } from '@supabase/supabase-js';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const CHANNEL = (roomCode: string) => `studiolink_stream_${roomCode}`;

interface UseAudioStreamOptions {
  roomCode: string;
  userId: string;
  userRole: 'artist' | 'engineer';
  getMasterStream: () => MediaStream | null;
}

const buildPc = (onCandidate: (c: RTCIceCandidate) => void): RTCPeerConnection => {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  pc.onicecandidate = ({ candidate }) => { if (candidate) onCandidate(candidate); };
  return pc;
};

const hqSdp = (sdp: string) =>
  sdp.replace('useinbandfec=1', 'useinbandfec=1; stereo=1; sprop-stereo=1; maxaveragebitrate=510000');

export const useAudioStream = ({ roomCode, userId, userRole, getMasterStream }: UseAudioStreamOptions) => {
  const [isStreaming, setIsStreaming]   = useState(false);
  const [isReceiving, setIsReceiving]   = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const pcRef        = useRef<RTCPeerConnection | null>(null);
  const channelRef   = useRef<RealtimeChannel | null>(null);
  const isStreamingRef = useRef(false);
  const pendingRef   = useRef<RTCIceCandidateInit[]>([]);

  // ── Send an offer to Engineer ──────────────────────────────
  const sendOffer = useCallback(async (channel: RealtimeChannel) => {
    const masterStream = getMasterStream();
    if (!masterStream || masterStream.getAudioTracks().length === 0) return;

    // Clean up any existing PC
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }

    const pc = buildPc((candidate) => {
      channel.send({ type: 'broadcast', event: 'stream-ice', payload: { candidate, from: userId } });
    });
    pcRef.current = pc;

    masterStream.getAudioTracks().forEach(track => pc.addTrack(track, masterStream));

    const offer = await pc.createOffer();
    if (offer.sdp) offer.sdp = hqSdp(offer.sdp);
    await pc.setLocalDescription(offer);

    channel.send({ type: 'broadcast', event: 'stream-offer', payload: { offer, from: userId } });
  }, [getMasterStream, userId]);

  // ── Artist side ────────────────────────────────────────────
  const startStream = useCallback(async () => {
    if (userRole !== 'artist') return;

    const masterStream = getMasterStream();
    if (!masterStream) { console.error('AudioContext not ready — play something first to initialise it'); return; }

    const channel = supabase.channel(CHANNEL(roomCode), {
      config: { broadcast: { self: false } },
    });
    channelRef.current = channel;

    // Engineer answers our offer
    channel.on('broadcast', { event: 'stream-answer' }, async ({ payload }) => {
      if (payload.from === userId) return;
      if (pcRef.current) {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload.answer));
      }
    });

    // ICE from Engineer
    channel.on('broadcast', { event: 'stream-ice' }, async ({ payload }) => {
      if (payload.from === userId) return;
      if (pcRef.current?.remoteDescription) {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate));
      }
    });

    // Late-joining Engineer requests the stream
    channel.on('broadcast', { event: 'stream-request' }, () => {
      if (isStreamingRef.current) sendOffer(channel);
    });

    await channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await sendOffer(channel);
      }
    });

    isStreamingRef.current = true;
    setIsStreaming(true);
  }, [userRole, roomCode, userId, getMasterStream, sendOffer]);

  const stopStream = useCallback(() => {
    if (userRole !== 'artist') return;
    isStreamingRef.current = false;
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    if (channelRef.current) {
      channelRef.current.send({ type: 'broadcast', event: 'stream-stop', payload: { from: userId } });
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    setIsStreaming(false);
  }, [userRole, userId]);

  // ── Engineer side — auto-connect when stream is available ──
  useEffect(() => {
    if (userRole !== 'engineer') return;

    const channel = supabase.channel(CHANNEL(roomCode), {
      config: { broadcast: { self: false } },
    });
    channelRef.current = channel;

    channel.on('broadcast', { event: 'stream-offer' }, async ({ payload }) => {
      if (payload.from === userId) return;

      if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
      pendingRef.current = [];

      const pc = buildPc((candidate) => {
        channel.send({ type: 'broadcast', event: 'stream-ice', payload: { candidate, from: userId } });
      });
      pcRef.current = pc;

      pc.ontrack = (e) => {
        const stream = e.streams[0];
        if (stream) { setRemoteStream(stream); setIsReceiving(true); }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          setIsReceiving(false);
        }
      };

      await pc.setRemoteDescription(new RTCSessionDescription(payload.offer));
      for (const c of pendingRef.current) await pc.addIceCandidate(new RTCIceCandidate(c));
      pendingRef.current = [];

      const answer = await pc.createAnswer();
      if (answer.sdp) answer.sdp = hqSdp(answer.sdp);
      await pc.setLocalDescription(answer);

      channel.send({ type: 'broadcast', event: 'stream-answer', payload: { answer, from: userId } });
    });

    channel.on('broadcast', { event: 'stream-ice' }, async ({ payload }) => {
      if (payload.from === userId) return;
      if (pcRef.current?.remoteDescription) {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate));
      } else {
        pendingRef.current.push(payload.candidate);
      }
    });

    channel.on('broadcast', { event: 'stream-stop' }, () => {
      setIsReceiving(false);
      setRemoteStream(null);
      if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    });

    // On connect, ask Artist to re-send offer in case they're already streaming
    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        channel.send({ type: 'broadcast', event: 'stream-request', payload: { from: userId } });
      }
    });

    return () => {
      supabase.removeChannel(channel);
      if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    };
  }, [roomCode, userId, userRole]);

  return { isStreaming, isReceiving, remoteStream, startStream, stopStream };
};
