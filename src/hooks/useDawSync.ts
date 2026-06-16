import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useDaw } from '../context/DawContext';
import type { DawAction, DawState } from '../context/DawContext';

const SYNCABLE_ACTIONS = new Set([
  // ── Track / region / project ───────────────────────────────────────────────
  'ADD_TRACK', 'REMOVE_TRACK', 'UPDATE_TRACK', 'REORDER_TRACKS', 'RENAME_TRACK',
  'ADD_VERSION', 'SWITCH_VERSION',
  'ADD_REGION', 'REMOVE_REGION', 'MOVE_REGION', 'SPLIT_REGION', 'TOGGLE_REGION_MUTE', 'RENDER_REGIONS',
  'UPDATE_REGION', 'SET_REGION_GAIN',
  'ADD_POOL_ITEM', 'REMOVE_POOL_ITEM',
  'UPDATE_AUDIO_URLS',           // CRITICAL: syncs Supabase public URL to engineer after upload
  'SET_POOL_ITEM_UPLOAD_STATUS', // syncs upload progress badge to engineer
  'RENAME_PROJECT',
  'ADD_CROSSFADE', 'REMOVE_CROSSFADE',
  'DUPLICATE_TRACK',
  // ── Transport (System A — Shared Session Control) ──────────────────────────
  'SET_PLAYING',     // play / stop — engineer pressing Play triggers artist's engine
  'SET_RECORDING',   // record state shown on both sides
  'SET_TEMPO', 'SET_TIME_SIGNATURE',
  'TOGGLE_LOOP', 'SET_LOOP_RANGE',
  'SET_PUNCH_RANGE',
  'TOGGLE_METRONOME', 'SET_COUNT_IN',
  // NOTE: SET_CURRENT_TIME is excluded — it fires every audio frame during playback
  // and would flood the channel. Seek sync is handled separately if needed.
]);

/**
 * @param roomCode        Session room code for the Supabase channel.
 * @param onTransportSync Called when SET_PLAYING arrives from the network AND the
 *                        transport state actually changes.  Use this to drive the
 *                        local audio engine so play/stop syncs across peers.
 */
export const useDawSync = (
  roomCode: string,
  onTransportSync?: (playing: boolean) => void,
) => {
  const { state, originalDispatch, setDispatchMiddleware } = useDaw();
  const channelRef = useRef<any>(null);
  // Keep a live ref to state so presence-join handler can broadcast the current state
  const stateRef = useRef<DawState>(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  // Keep a live ref to the callback so the channel closure never stales.
  const onTransportSyncRef = useRef(onTransportSync);
  useEffect(() => { onTransportSyncRef.current = onTransportSync; }, [onTransportSync]);

  // ── DB load helper (called on mount and on peer-join) ─────────────
  const fetchAndApplyState = (isMountedRef: { current: boolean }) => {
    supabase
      .from('daw_projects')
      .select('state')
      .eq('room_code', roomCode)
      .single()
      .then(({ data, error }) => {
        if (error && error.code !== 'PGRST116') {
          console.error('Failed to load project from DB:', error);
          return;
        }
        if (isMountedRef.current && data?.state) {
          const parsed = data.state as Partial<DawState> & { tempo?: number };
          // Restore the full transport block, not just tempo.
          // Old code only extracted `parsed.tempo` which lost loopStart/End etc.
          const savedTransport = (parsed as any).transport;
          const tempoFallback  = parsed.tempo; // legacy field from older saves
          originalDispatch({
            type: 'SET_STATE',
            payload: {
              ...(parsed.projectName && { projectName: parsed.projectName }),
              ...(parsed.tracks      && { tracks:     parsed.tracks }),
              ...(parsed.regions     && { regions:    parsed.regions }),
              ...(parsed.poolItems   && { poolItems:  parsed.poolItems }),
              ...(savedTransport     && { transport:  savedTransport }),
              ...(!savedTransport && tempoFallback && {
                transport: { ...stateRef.current.transport, tempo: tempoFallback },
              }),
            },
            fromSync: true,
          });
        }
      });
  };

  // Initial load
  useEffect(() => {
    if (!roomCode) return;
    const isMountedRef = { current: true };
    fetchAndApplyState(isMountedRef);
    return () => { isMountedRef.current = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode]);

  // ── Realtime channel + middleware ─────────────────────────
  useEffect(() => {
    if (!roomCode) return;

    const channel = supabase.channel(`daw-${roomCode}`, {
      config: { broadcast: { ack: false } }
    });

    // Incoming action from peer
    channel.on('broadcast', { event: 'action' }, ({ payload }) => {
      const action = payload as DawAction;
      // Capture transport state BEFORE the dispatch so we can detect a real transition.
      // This prevents a feedback loop: if the remote engine calls play() and re-broadcasts
      // SET_PLAYING, we receive it when we're already in that state and skip calling the engine.
      const prevIsPlaying = stateRef.current.transport.isPlaying;
      originalDispatch(action);
      if (action.type === 'SET_PLAYING') {
        const next = action.payload as boolean;
        if (next !== prevIsPlaying) {
          onTransportSyncRef.current?.(next);
        }
      }
    });

    // Peer sends us a full state-sync blob when they join and already have state
    channel.on('broadcast', { event: 'state-sync' }, ({ payload }) => {
      if (payload.state) {
        originalDispatch({ type: 'SET_STATE', payload: payload.state, fromSync: true });
      }
    });

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log(`Joined DAW sync channel: daw-${roomCode}`);
      }
    });

    channelRef.current = channel;

    setDispatchMiddleware((action: DawAction) => {
      // 1. Dispatch locally first
      originalDispatch(action);

      // 2. Broadcast if syncable and NOT from the network
      if (!action.fromSync && SYNCABLE_ACTIONS.has(action.type)) {
        channel.send({
          type: 'broadcast',
          event: 'action',
          payload: { ...action, fromSync: true },
        }).catch(err => console.error('Broadcast failed:', err));
      }
    });

    return () => {
      channel.unsubscribe();
      setDispatchMiddleware(null);
      channelRef.current = null;
    };
  }, [roomCode, originalDispatch, setDispatchMiddleware]);

  // ── Debounced DB Save (saves full transport block now) ──────────
  useEffect(() => {
    if (!roomCode) return;

    const timer = setTimeout(() => {
      const stateToSave = {
        projectName: state.projectName,
        tracks:    state.tracks,
        regions:   state.regions,
        poolItems: state.poolItems,
        // Save full transport so rejoining restores loop ranges, time sig, etc.
        transport: state.transport,
        // Legacy field kept for backwards compat with older saves
        tempo: state.transport.tempo,
      };

      supabase.from('daw_projects').upsert({
        room_code: roomCode,
        state: stateToSave,
        updated_at: new Date().toISOString(),
      }).then(({ error }) => {
        if (error) console.error('Failed to save state to DB:', error);
      });
    }, 2000);

    return () => clearTimeout(timer);
  }, [state.tracks, state.regions, state.poolItems, state.transport, roomCode]);
};
