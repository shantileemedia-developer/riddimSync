import { useEffect, useRef, useCallback, useState } from 'react';
import { useDaw } from '../context/DawContext';
import type { DawState, Region, PoolItem } from '../context/DawContext';
import { logTransport } from '../utils/transportLog';

const AUTOSAVE_INTERVAL_MS = 30_000;
const AUTOSAVE_VERSION = 2;

export interface AutosaveSnapshot {
  version: number;
  roomCode: string;
  savedAt: number;
  projectName: string;
  projectLength: number;
  snapOn: boolean;
  snapValue: string;
  tracks: DawState['tracks'];
  regions: Array<Omit<Region, 'waveformPeaks' | 'waveformPeaksR' | 'sourcePeaks' | 'sourcePeaksR' | 'localFilePath'>>;
  poolItems: Array<Pick<PoolItem, 'id' | 'name' | 'audioUrl' | 'duration' | 'localFileName' | 'createdAt' | 'uploadStatus'>>;
  transport: Pick<DawState['transport'], 'tempo' | 'timeSignature' | 'isLooping' | 'loopStart' | 'loopEnd' | 'punchIn' | 'punchOut' | 'metronomeOn' | 'countInBars'>;
  markers: DawState['markers'];
}

function autosaveKey(roomCode: string) {
  return `sl_autosave_${roomCode}`;
}

function serializeState(state: DawState, roomCode: string): AutosaveSnapshot {
  return {
    version: AUTOSAVE_VERSION,
    roomCode,
    savedAt: Date.now(),
    projectName: state.projectName,
    projectLength: state.projectLength,
    snapOn: state.snapOn,
    snapValue: state.snapValue,
    tracks: state.tracks,
    regions: state.regions.map(({ waveformPeaks: _wp, waveformPeaksR: _wpr, sourcePeaks: _sp, sourcePeaksR: _spr, localFilePath: _lp, ...rest }) => rest),
    poolItems: state.poolItems.map(({ id, name, audioUrl, duration, localFileName, createdAt, uploadStatus }) => ({
      id, name, audioUrl, duration, localFileName, createdAt, uploadStatus,
    })),
    transport: {
      tempo: state.transport.tempo,
      timeSignature: state.transport.timeSignature,
      isLooping: state.transport.isLooping,
      loopStart: state.transport.loopStart,
      loopEnd: state.transport.loopEnd,
      punchIn: state.transport.punchIn,
      punchOut: state.transport.punchOut,
      metronomeOn: state.transport.metronomeOn,
      countInBars: state.transport.countInBars,
    },
    markers: state.markers,
  };
}

export function loadAutosave(roomCode: string): AutosaveSnapshot | null {
  try {
    const raw = localStorage.getItem(autosaveKey(roomCode));
    if (!raw) return null;
    const snap = JSON.parse(raw) as AutosaveSnapshot;
    if (snap.version !== AUTOSAVE_VERSION) return null;
    return snap;
  } catch {
    return null;
  }
}

export function useSessionAutosave(roomCode: string) {
  const { state, dispatch } = useDaw();
  const stateRef = useRef(state);
  stateRef.current = state;

  const wasRecordingRef = useRef(false);

  // Track autosave existence without re-reading localStorage on every render.
  const [hasAutosaveState, setHasAutosaveState] = useState<boolean>(
    () => localStorage.getItem(autosaveKey(roomCode)) !== null,
  );

  const saveNow = useCallback(() => {
    // Never autosave while recording — state is mid-flight
    if (stateRef.current.transport.isRecording) return;
    try {
      const snap = serializeState(stateRef.current, roomCode);
      localStorage.setItem(autosaveKey(roomCode), JSON.stringify(snap));
      setHasAutosaveState(true);
      logTransport('autosave', { savedAt: snap.savedAt, regions: snap.regions.length });
    } catch (err) {
      console.warn('[Autosave] save failed:', err);
    }
  }, [roomCode]);

  // 30-second interval — skip during recording
  useEffect(() => {
    const id = setInterval(saveNow, AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [saveNow]);

  // Save when recording starts (captures the pre-recording project state)
  // Save when recording stops (captures the newly created region)
  useEffect(() => {
    const isRec = state.transport.isRecording;
    if (isRec && !wasRecordingRef.current) {
      // about to record — save current state before any changes
      saveNow();
    } else if (!isRec && wasRecordingRef.current) {
      // recording just ended — save after a short delay so the region settles
      const id = setTimeout(saveNow, 2500);
      return () => clearTimeout(id);
    }
    wasRecordingRef.current = isRec;
  }, [state.transport.isRecording, saveNow]);

  const restoreAutosave = useCallback(() => {
    const snap = loadAutosave(roomCode);
    if (!snap) return;
    dispatch({
      type: 'SET_STATE',
      payload: {
        projectName: snap.projectName,
        projectLength: snap.projectLength,
        snapOn: snap.snapOn,
        snapValue: snap.snapValue,
        tracks: snap.tracks,
        regions: snap.regions.map(r => ({
          ...r,
          waveformPeaks: [],
          waveformPeaksR: null,
          sourcePeaks: [],
          sourcePeaksR: null,
        })),
        poolItems: snap.poolItems.map(p => ({
          ...p,
          waveformPeaks: [],
          waveformPeaksR: null,
          createdAt: new Date(p.createdAt),
        })),
        markers: snap.markers,
        transport: { ...stateRef.current.transport, ...snap.transport },
      },
    });
    logTransport('autosave_restored', { roomCode, savedAt: snap.savedAt });
  }, [roomCode, dispatch]);

  const clearAutosave = useCallback(() => {
    localStorage.removeItem(autosaveKey(roomCode));
    setHasAutosaveState(false);
  }, [roomCode]);

  return { saveNow, hasAutosave: hasAutosaveState, restoreAutosave, clearAutosave };
}
