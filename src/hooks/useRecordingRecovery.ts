import { useState, useCallback } from 'react';
import { useDaw } from '../context/DawContext';
import type { Region, PoolItem } from '../context/DawContext';
import { generatePeaksStereo, uploadAudioToSupabase } from '../utils/audioUtils';
import { logTransport } from '../utils/transportLog';

const MARKER_KEY = 'sl_recording_marker';
const MIN_RECOVERY_SIZE_BYTES = 4096; // ignore tiny/empty WAV files

export interface RecordingMarker {
  version: 1;
  takeName: string;
  filePath: string;
  trackId: string;
  trackName: string;
  startTime: number;
  roomCode: string;
  timestamp: number;
}

export function writeRecordingMarker(m: Omit<RecordingMarker, 'version'>): void {
  localStorage.setItem(MARKER_KEY, JSON.stringify({ version: 1, ...m }));
}

export function clearRecordingMarker(): void {
  localStorage.removeItem(MARKER_KEY);
}

export function readRecordingMarker(): RecordingMarker | null {
  try {
    const raw = localStorage.getItem(MARKER_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as RecordingMarker;
    if (m.version !== 1) return null;
    return m;
  } catch {
    return null;
  }
}

export interface RecoveredTake {
  marker: RecordingMarker;
  sizeBytes: number;
  estimatedDurationSecs: number;
}

export function useRecordingRecovery(roomCode: string) {
  const { state, dispatch } = useDaw();
  const [recoveredTake, setRecoveredTake] = useState<RecoveredTake | null>(null);
  const [checking, setChecking] = useState(false);

  const checkForRecovery = useCallback(async () => {
    const eng = window.audioEngine;
    if (!eng?.checkFile) return;
    const marker = readRecordingMarker();
    if (!marker) return;
    if (marker.roomCode !== roomCode) {
      // Stale marker from a different session — discard silently
      clearRecordingMarker();
      return;
    }
    setChecking(true);
    try {
      const info = await eng.checkFile(marker.filePath);
      if (info.exists && info.sizeBytes > MIN_RECOVERY_SIZE_BYTES) {
        // Estimate duration from file size: stereo 16-bit 48kHz WAV = 192000 bytes/sec
        const estimatedDurationSecs = info.sizeBytes / 192_000;
        setRecoveredTake({ marker, sizeBytes: info.sizeBytes, estimatedDurationSecs });
        logTransport('crash_recovery', { takeName: marker.takeName, sizeBytes: info.sizeBytes });
      } else {
        // WAV exists but is empty or missing — discard marker
        clearRecordingMarker();
        if (info.exists) await eng.deleteFile(marker.filePath).catch(() => {});
      }
    } finally {
      setChecking(false);
    }
  }, [roomCode]);

  const restoreRecoveredTake = useCallback(async () => {
    if (!recoveredTake) return;
    const { marker } = recoveredTake;
    const audioUrl = `file://${marker.filePath}`;
    const poolItemId = `pool_${Date.now()}`;
    const regionId   = `region_${Date.now()}`;

    const trackObj = state.tracks.find(t => t.id === marker.trackId);

    dispatch({ type: 'ADD_POOL_ITEM', payload: {
      id: poolItemId, name: marker.takeName, audioUrl, duration: recoveredTake.estimatedDurationSecs,
      localFileName: `${marker.takeName}.wav`, createdAt: new Date(marker.timestamp),
      waveformPeaks: [], waveformPeaksR: null,
    } as PoolItem });

    dispatch({ type: 'ADD_REGION', payload: {
      id: regionId, poolItemId, trackId: marker.trackId,
      versionId: trackObj?.activeVersionId ?? 'default',
      startTime: marker.startTime, duration: recoveredTake.estimatedDurationSecs,
      name: marker.takeName, audioUrl,
      waveformPeaks: [], waveformPeaksR: null,
      sourceDuration: recoveredTake.estimatedDurationSecs, sourcePeaks: [],
    } as Region });

    clearRecordingMarker();
    setRecoveredTake(null);
    logTransport('recording_recovered', { takeName: marker.takeName });

    // Background: decode peaks + upload to Supabase
    const eng = window.audioEngine;
    fetch(audioUrl)
      .then(r => r.arrayBuffer())
      .then(async ab => {
        const blob = new Blob([ab]);
        const tmpCtx = new AudioContext();
        const buf = await tmpCtx.decodeAudioData(ab.slice(0));
        await tmpCtx.close();
        const stereo = await generatePeaksStereo(buf);
        const isStereo = trackObj?.type === 'stereo';
        dispatch({ type: 'UPDATE_REGION', payload: {
          id: regionId,
          updates: {
            waveformPeaks: stereo.left, waveformPeaksR: isStereo ? stereo.right : null,
            sourcePeaks: stereo.left, sourcePeaksR: isStereo ? stereo.right : null,
            duration: buf.duration, sourceDuration: buf.duration,
          },
        }});
        const { publicUrl } = await uploadAudioToSupabase(blob, `${marker.takeName}.wav`);
        if (publicUrl && publicUrl !== audioUrl) {
          dispatch({ type: 'UPDATE_AUDIO_URLS', payload: { poolItemId, audioUrl: publicUrl } });
          dispatch({ type: 'UPDATE_REGION', payload: { id: regionId, updates: { audioUrl: publicUrl } } });
        }
      })
      .catch(err => console.warn('[RecoveryRestore] background peaks/upload failed:', err));

    // Clean up the temp WAV once upload is done (not critical — leave for now)
    void eng;
  }, [recoveredTake, state.tracks, dispatch]);

  const discardRecoveredTake = useCallback(async () => {
    if (!recoveredTake) return;
    const eng = window.audioEngine;
    if (eng?.deleteFile) await eng.deleteFile(recoveredTake.marker.filePath).catch(() => {});
    clearRecordingMarker();
    setRecoveredTake(null);
    logTransport('recording_discarded', { takeName: recoveredTake.marker.takeName });
  }, [recoveredTake]);

  return { recoveredTake, checking, checkForRecovery, restoreRecoveredTake, discardRecoveredTake };
}
