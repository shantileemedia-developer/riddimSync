import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useDaw } from '../context/DawContext';
import type { DawAction, DawState } from '../context/DawContext';

const SYNCABLE_ACTIONS = new Set([
  'ADD_TRACK', 'REMOVE_TRACK', 'UPDATE_TRACK', 'REORDER_TRACKS', 'RENAME_TRACK',
  'ADD_VERSION', 'SWITCH_VERSION',
  'ADD_REGION', 'REMOVE_REGION', 'MOVE_REGION', 'SPLIT_REGION', 'TOGGLE_REGION_MUTE', 'GLUE_REGIONS',
  'ADD_POOL_ITEM', 'REMOVE_POOL_ITEM',
  'SET_TEMPO',
]);

export const useDawSync = (roomCode: string) => {
  const { state, originalDispatch, setDispatchMiddleware } = useDaw();
  const channelRef = useRef<any>(null);

  // Initial load
  useEffect(() => {
    if (!roomCode) return;

    let isMounted = true;
    const fetchState = async () => {
      const { data, error } = await supabase
        .from('daw_projects')
        .select('state')
        .eq('room_code', roomCode)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Failed to load project from DB:', error);
      }

      if (isMounted && data?.state) {
        const parsed = data.state as Partial<DawState>;
        // Extract tempo since it's nested in transport
        const tempo = (parsed as any).tempo;
        
        originalDispatch({
          type: 'SET_STATE',
          payload: {
            ...(parsed.tracks && { tracks: parsed.tracks }),
            ...(parsed.regions && { regions: parsed.regions }),
            ...(parsed.poolItems && { poolItems: parsed.poolItems }),
            ...(tempo && { transport: { ...state.transport, tempo } }),
          },
          fromSync: true,
        });
      }
    };

    fetchState();

    return () => { isMounted = false; };
  }, [roomCode, originalDispatch]); // state.transport dependency omitted to run only on mount

  // Setup Realtime & Middleware
  useEffect(() => {
    if (!roomCode) return;

    const channel = supabase.channel(`daw-${roomCode}`, {
      config: { broadcast: { ack: false } }
    });

    channel.on('broadcast', { event: 'action' }, ({ payload }) => {
      // Incoming action from network
      originalDispatch(payload as DawAction);
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

      // 2. Broadcast if it's a syncable action and NOT from the network
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
    };
  }, [roomCode, originalDispatch, setDispatchMiddleware]);

  // Debounced DB Save
  useEffect(() => {
    if (!roomCode) return;

    const timer = setTimeout(() => {
      const stateToSave = {
        tracks: state.tracks,
        regions: state.regions,
        poolItems: state.poolItems,
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
  }, [state.tracks, state.regions, state.poolItems, state.transport.tempo, roomCode]);

};
