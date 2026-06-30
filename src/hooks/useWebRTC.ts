import { useRef, useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { RemoteInputEvent, RcPermissionGrant } from '../types/remote';

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

interface UseWebRTCOptions {
  roomCode: string;
  userId: string;
  isInitiator: boolean;
  onInputEvent?: (event: RemoteInputEvent, source: 'app' | 'desktop') => void;
  onDawControlGranted?: () => void;
  onDawControlRevoked?: () => void;
}

export const useWebRTC = ({
  roomCode, userId, isInitiator,
  onInputEvent, onDawControlGranted, onDawControlRevoked,
}: UseWebRTCOptions) => {
  const [isScreenSharing, setIsScreenSharing]         = useState(false);
  const [rcRequested, setRcRequested]                 = useState(false);
  const [rcActive, setRcActive]                       = useState(false);
  const [rcEngineerName, setRcEngineerName]           = useState('Engineer');
  const [rcViewOnly, setRcViewOnly]                   = useState(false);
  const [remoteDesktopStream, setRemoteDesktopStream] = useState<MediaStream | null>(null);
  const [appRcActive, setAppRcActive]                 = useState(false);
  const [signalChannelReady, setSignalChannelReady]   = useState(false);

  const signalChannelRef   = useRef<RealtimeChannel | null>(null);
  const rcPcRef            = useRef<RTCPeerConnection | null>(null);
  const rcDataChannelRef   = useRef<RTCDataChannel | null>(null);
  const pendingRcIceRef    = useRef<RTCIceCandidateInit[]>([]);
  const handleRcOfferRef   = useRef<((offer: RTCSessionDescriptionInit) => Promise<void>) | null>(null);
  const rcViewOnlyRef      = useRef(false);
  const appRcPcRef         = useRef<RTCPeerConnection | null>(null);
  const appRcDcRef         = useRef<RTCDataChannel | null>(null);
  const pendingAppRcIceRef = useRef<RTCIceCandidateInit[]>([]);
  const onInputEventRef    = useRef(onInputEvent);
  const onDawGrantedRef    = useRef(onDawControlGranted);
  const onDawRevokedRef    = useRef(onDawControlRevoked);

  useEffect(() => { onInputEventRef.current = onInputEvent; },        [onInputEvent]);
  useEffect(() => { onDawGrantedRef.current = onDawControlGranted; }, [onDawControlGranted]);
  useEffect(() => { onDawRevokedRef.current = onDawControlRevoked; }, [onDawControlRevoked]);
  useEffect(() => { rcViewOnlyRef.current   = rcViewOnly; },          [rcViewOnly]);

  // ── Background signaling channel — always active while in the room ─────────
  useEffect(() => {
    const channel = supabase.channel(`studiolink_signal_${roomCode}`, {
      config: { broadcast: { self: false } },
    });
    signalChannelRef.current = channel;

    // Engineer receives: artist's permission decision
    channel.on('broadcast', { event: 'rc-permission-response' }, ({ payload }) => {
      if (!isInitiator || payload.from === userId) return;
      setRcRequested(false);
      if (payload.dawControl) onDawGrantedRef.current?.();
    });

    // Engineer receives: artist revoked DAW control
    channel.on('broadcast', { event: 'daw-control-revoked' }, ({ payload }) => {
      if (!isInitiator || payload?.from === userId) return;
      if (appRcDcRef.current) { appRcDcRef.current.close(); appRcDcRef.current = null; }
      if (appRcPcRef.current) { appRcPcRef.current.close(); appRcPcRef.current = null; }
      pendingAppRcIceRef.current = [];
      setAppRcActive(false);
      onDawRevokedRef.current?.();
    });

    // Artist receives: engineer wants RC
    channel.on('broadcast', { event: 'request-rc' }, ({ payload }) => {
      if (!isInitiator) {
        setRcEngineerName(payload.engineerName ?? 'Engineer');
        setRcRequested(true);
      }
    });

    // Either side: RC session ended
    channel.on('broadcast', { event: 'stop-rc' }, () => {
      setRcActive(false);
      setIsScreenSharing(false);
      setRcRequested(false);
      setRemoteDesktopStream(null);
      handleRcOfferRef.current = null;
      if (rcDataChannelRef.current) { rcDataChannelRef.current.close(); rcDataChannelRef.current = null; }
      if (rcPcRef.current) { rcPcRef.current.close(); rcPcRef.current = null; }
      pendingRcIceRef.current = [];
    });

    // Engineer receives: artist accepted → create RC peer connection
    channel.on('broadcast', { event: 'rc-accepted' }, async () => {
      if (!isInitiator) return;
      if (rcPcRef.current) { rcPcRef.current.close(); rcPcRef.current = null; }
      pendingRcIceRef.current = [];

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

      pc.onicecandidate = ({ candidate }) => {
        if (candidate) channel.send({
          type: 'broadcast', event: 'rc-ice',
          payload: { candidate, from: userId },
        });
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') { setRcActive(true); setRcRequested(false); }
        if (pc.connectionState === 'failed') pc.restartIce();
        if (pc.connectionState === 'closed') { setRcActive(false); setRemoteDesktopStream(null); }
      };

      pc.ontrack = ({ streams }) => {
        if (streams[0]) setRemoteDesktopStream(streams[0]);
      };

      const dc = pc.createDataChannel('rc-input', { ordered: false, maxRetransmits: 0 });
      dc.onmessage = (e) => {
        try { onInputEventRef.current?.(JSON.parse(e.data), 'desktop'); } catch {}
      };
      rcDataChannelRef.current = dc;

      // Without a recvonly transceiver the offer SDP has no video section
      pc.addTransceiver('video', { direction: 'recvonly' });
      rcPcRef.current = pc;

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      channel.send({ type: 'broadcast', event: 'rc-offer', payload: { offer, from: userId } });
    });

    // Artist receives: engineer's RC offer → handled via ref (set in startScreenShare)
    channel.on('broadcast', { event: 'rc-offer' }, async ({ payload }) => {
      if (isInitiator || payload.from === userId) return;
      await handleRcOfferRef.current?.(payload.offer);
    });

    // Engineer receives: artist's answer to RC offer
    channel.on('broadcast', { event: 'rc-answer' }, async ({ payload }) => {
      if (!isInitiator || payload.from === userId) return;
      try {
        await rcPcRef.current?.setRemoteDescription(payload.answer);
        for (const c of pendingRcIceRef.current) {
          await rcPcRef.current?.addIceCandidate(c).catch(() => {});
        }
        pendingRcIceRef.current = [];
      } catch (e) { console.error('[RC] rc-answer error', e); }
    });

    // Both sides: trickle ICE for RC
    channel.on('broadcast', { event: 'rc-ice' }, async ({ payload }) => {
      if (payload.from === userId) return;
      try {
        if (rcPcRef.current?.remoteDescription) {
          await rcPcRef.current.addIceCandidate(payload.candidate);
        } else {
          pendingRcIceRef.current.push(payload.candidate);
        }
      } catch {}
    });

    // ── App RC signaling (no permission dialog) ──────────────────────────────
    let appRcGen = 0;
    channel.on('broadcast', { event: 'app-rc-offer' }, async ({ payload }) => {
      if (isInitiator || payload.from === userId) return;
      const myGen = ++appRcGen;

      if (appRcDcRef.current)  { appRcDcRef.current.close();  appRcDcRef.current  = null; }
      if (appRcPcRef.current)  { appRcPcRef.current.close();  appRcPcRef.current  = null; }
      pendingAppRcIceRef.current = [];

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      appRcPcRef.current = pc;

      pc.onicecandidate = ({ candidate }) => {
        if (candidate && myGen === appRcGen) {
          channel.send({
            type: 'broadcast', event: 'app-rc-ice',
            payload: { candidate, from: userId },
          });
        }
      };
      pc.ondatachannel = (e) => {
        appRcDcRef.current = e.channel;
        e.channel.onopen  = () => setAppRcActive(true);
        e.channel.onclose = () => setAppRcActive(false);
        e.channel.onmessage = (msg) => {
          try {
            const evt = JSON.parse(msg.data) as RemoteInputEvent;
            onInputEventRef.current?.(evt, 'app');
          } catch {}
        };
      };

      try {
        await pc.setRemoteDescription(payload.offer);
        if (myGen !== appRcGen) return;
        for (const c of pendingAppRcIceRef.current) await pc.addIceCandidate(c).catch(() => {});
        pendingAppRcIceRef.current = [];
        const answer = await pc.createAnswer();
        if (myGen !== appRcGen) return;
        await pc.setLocalDescription(answer);
        channel.send({
          type: 'broadcast', event: 'app-rc-answer',
          payload: { answer, from: userId },
        });
      } catch {}
    });

    channel.on('broadcast', { event: 'app-rc-answer' }, async ({ payload }) => {
      if (!isInitiator || payload.from === userId) return;
      try {
        await appRcPcRef.current?.setRemoteDescription(payload.answer);
        for (const c of pendingAppRcIceRef.current) {
          await appRcPcRef.current?.addIceCandidate(c).catch(() => {});
        }
        pendingAppRcIceRef.current = [];
      } catch (e) { console.error('[App RC] answer error', e); }
    });

    channel.on('broadcast', { event: 'app-rc-ice' }, async ({ payload }) => {
      if (payload.from === userId) return;
      try {
        if (appRcPcRef.current?.remoteDescription) {
          await appRcPcRef.current.addIceCandidate(payload.candidate);
        } else {
          pendingAppRcIceRef.current.push(payload.candidate);
        }
      } catch {}
    });

    channel.on('broadcast', { event: 'stop-app-rc' }, () => {
      if (appRcDcRef.current) { appRcDcRef.current.close(); appRcDcRef.current = null; }
      if (appRcPcRef.current) { appRcPcRef.current.close(); appRcPcRef.current = null; }
      pendingAppRcIceRef.current = [];
      setAppRcActive(false);
    });

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') setSignalChannelReady(true);
    });

    return () => {
      setSignalChannelReady(false);
      supabase.removeChannel(channel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode]);

  // ── Remote Control API ────────────────────────────────────────────────────

  const requestRemoteControl = useCallback((engineerName = 'Engineer') => {
    if (!isInitiator) return;
    setRcRequested(true);
    signalChannelRef.current?.send({
      type: 'broadcast', event: 'request-rc',
      payload: { from: userId, engineerName },
    });
  }, [isInitiator, userId]);

  const startScreenShare = useCallback(() => {
    if (isInitiator) return;
    setIsScreenSharing(true);
    setRcRequested(false);

    handleRcOfferRef.current = async (offer: RTCSessionDescriptionInit) => {
      handleRcOfferRef.current = null;
      try {
        let screenStream: MediaStream | null = null;
        try {
          if (window.studioRC?.getScreenSources) {
            const sources = await window.studioRC.getScreenSources();
            const singleScreens = sources.filter(s => {
              const { width, height } = s.thumbnailSize ?? { width: 1, height: 1 };
              return height > 0 && (width / height) < 2.5;
            });
            const primary = singleScreens[0] ?? sources[0];
            if (primary) {
              screenStream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: {
                  mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: primary.id,
                    maxWidth: 3840, maxHeight: 2160, maxFrameRate: 60,
                  },
                } as any,
              });
            }
          }
          if (!screenStream) {
            screenStream = await navigator.mediaDevices.getDisplayMedia({
              video: { frameRate: { ideal: 60, max: 60 } }, audio: false,
            });
          }
        } catch {}

        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

        pc.onicecandidate = ({ candidate }) => {
          if (candidate) {
            signalChannelRef.current?.send({
              type: 'broadcast', event: 'rc-ice',
              payload: { candidate, from: userId },
            });
          }
        };

        pc.ondatachannel = (e) => {
          rcDataChannelRef.current = e.channel;
          e.channel.onmessage = (msg) => {
            if (rcViewOnlyRef.current) return;
            try {
              const evt = JSON.parse(msg.data) as RemoteInputEvent;
              onInputEventRef.current?.(evt, 'desktop');
            } catch {}
          };
        };

        pc.onconnectionstatechange = () => {
          if (pc.connectionState === 'connected') {
            setRcActive(true);
            pc.getSenders().forEach(async sender => {
              if (!sender.track || sender.track.kind !== 'video') return;
              try {
                const params = sender.getParameters();
                if (!params.encodings?.length) params.encodings = [{}];
                params.encodings[0].maxBitrate = 15_000_000;
                await sender.setParameters(params);
              } catch {}
            });
          }
          if (pc.connectionState === 'failed') pc.restartIce();
          if (pc.connectionState === 'closed') {
            setRcActive(false);
            setIsScreenSharing(false);
            screenStream?.getTracks().forEach(t => t.stop());
          }
        };

        rcPcRef.current = pc;

        await pc.setRemoteDescription(offer);
        for (const c of pendingRcIceRef.current) await pc.addIceCandidate(c).catch(() => {});
        pendingRcIceRef.current = [];

        if (screenStream) {
          screenStream.getVideoTracks().forEach(track => {
            pc.addTrack(track, screenStream!);
            track.onended = () => {
              setIsScreenSharing(false);
              setRcActive(false);
              signalChannelRef.current?.send({
                type: 'broadcast', event: 'stop-rc',
                payload: { from: userId },
              });
            };
          });
        }

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        signalChannelRef.current?.send({
          type: 'broadcast', event: 'rc-answer',
          payload: { answer, from: userId },
        });
        setRcActive(true);
      } catch (e) {
        console.error('[RC] handleRcOffer error', e);
        setIsScreenSharing(false);
      }
    };

    signalChannelRef.current?.send({
      type: 'broadcast', event: 'rc-accepted',
      payload: { from: userId },
    });
  }, [isInitiator, userId]);

  const respondToRcPermission = useCallback((grant: RcPermissionGrant) => {
    signalChannelRef.current?.send({
      type: 'broadcast', event: 'rc-permission-response',
      payload: { ...grant, from: userId },
    });
    setRcRequested(false);
    if (grant.desktopAccess !== 'none') {
      setRcViewOnly(grant.desktopAccess === 'view');
      rcViewOnlyRef.current = grant.desktopAccess === 'view';
      startScreenShare();
    }
    if (grant.dawControl) onDawGrantedRef.current?.();
  }, [userId, startScreenShare]);

  const revokeDawControl = useCallback(() => {
    if (appRcDcRef.current) { appRcDcRef.current.close(); appRcDcRef.current = null; }
    if (appRcPcRef.current) { appRcPcRef.current.close(); appRcPcRef.current = null; }
    pendingAppRcIceRef.current = [];
    setAppRcActive(false);
    signalChannelRef.current?.send({
      type: 'broadcast', event: 'daw-control-revoked',
      payload: { from: userId },
    });
    onDawRevokedRef.current?.();
  }, [userId]);

  const revokeRemoteControl = useCallback(() => {
    rcPcRef.current?.getSenders().forEach(s => s.track?.stop());
    if (rcDataChannelRef.current) { rcDataChannelRef.current.close(); rcDataChannelRef.current = null; }
    if (rcPcRef.current) { rcPcRef.current.close(); rcPcRef.current = null; }
    pendingRcIceRef.current = [];
    handleRcOfferRef.current = null;
    setIsScreenSharing(false); setRcActive(false); setRcRequested(false);
    signalChannelRef.current?.send({
      type: 'broadcast', event: 'stop-rc',
      payload: { from: userId },
    });
  }, [userId]);

  const stopRemoteControl = useCallback(() => {
    if (!isInitiator) return;
    if (rcDataChannelRef.current) { rcDataChannelRef.current.close(); rcDataChannelRef.current = null; }
    if (rcPcRef.current) { rcPcRef.current.close(); rcPcRef.current = null; }
    pendingRcIceRef.current = [];
    setRcActive(false);
    signalChannelRef.current?.send({
      type: 'broadcast', event: 'stop-rc',
      payload: { from: userId },
    });
  }, [isInitiator, userId]);

  const sendInputEvent = useCallback((event: RemoteInputEvent) => {
    const dc = rcDataChannelRef.current;
    if (dc?.readyState === 'open') dc.send(JSON.stringify(event));
  }, []);

  const startAppRc = useCallback(async () => {
    if (appRcDcRef.current)  { appRcDcRef.current.close();  appRcDcRef.current  = null; }
    if (appRcPcRef.current)  { appRcPcRef.current.close();  appRcPcRef.current  = null; }
    pendingAppRcIceRef.current = [];

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    appRcPcRef.current = pc;
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) signalChannelRef.current?.send({
        type: 'broadcast', event: 'app-rc-ice',
        payload: { candidate, from: userId },
      });
    };

    const dc = pc.createDataChannel('app-rc', { ordered: false, maxRetransmits: 0 });
    appRcDcRef.current = dc;
    dc.onopen  = () => setAppRcActive(true);
    dc.onclose = () => setAppRcActive(false);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    signalChannelRef.current?.send({
      type: 'broadcast', event: 'app-rc-offer',
      payload: { offer, from: userId },
    });
  }, [userId]);

  const stopAppRc = useCallback(() => {
    if (appRcDcRef.current)  { appRcDcRef.current.close();  appRcDcRef.current  = null; }
    if (appRcPcRef.current)  { appRcPcRef.current.close();  appRcPcRef.current  = null; }
    pendingAppRcIceRef.current = [];
    setAppRcActive(false);
    signalChannelRef.current?.send({
      type: 'broadcast', event: 'stop-app-rc',
      payload: { from: userId },
    });
  }, [userId]);

  const sendAppRcInput = useCallback((event: RemoteInputEvent) => {
    const dc = appRcDcRef.current;
    if (dc?.readyState === 'open') dc.send(JSON.stringify(event));
  }, []);

  return {
    remoteDesktopStream,
    isScreenSharing, rcRequested, rcActive, rcEngineerName, rcViewOnly,
    requestRemoteControl, startScreenShare, revokeRemoteControl, stopRemoteControl,
    respondToRcPermission, revokeDawControl,
    sendInputEvent,
    appRcActive, startAppRc, stopAppRc, sendAppRcInput,
    signalChannelReady,
  };
};
