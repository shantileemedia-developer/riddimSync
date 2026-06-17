/**
 * Exports an audio blob to FLAC using the WebCodecs AudioEncoder API
 * (Chromium 107+ / Electron 36+). Falls back to 24-bit PCM WAV if
 * FLAC is not supported in the current environment.
 */

// ── WAV fallback encoder ─────────────────────────────────────────────
function encodeWAV(audioBuffer: AudioBuffer): Blob {
  const numChannels   = audioBuffer.numberOfChannels;
  const sampleRate    = audioBuffer.sampleRate;
  const numSamples    = audioBuffer.length;
  const bytesPerSample = 3; // 24-bit
  const blockAlign    = numChannels * bytesPerSample;
  const byteRate      = sampleRate * blockAlign;
  const dataSize      = numSamples * blockAlign;

  const buf  = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);

  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  str(0,  'RIFF'); view.setUint32(4,  36 + dataSize, true);
  str(8,  'WAVE');
  str(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);              // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 24, true);             // bit depth
  str(36, 'data'); view.setUint32(40, dataSize, true);

  let off = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const s    = Math.max(-1, Math.min(1, audioBuffer.getChannelData(ch)[i]));
      const i24  = s < 0 ? Math.ceil(s * 8388608) : Math.floor(s * 8388607);
      view.setUint8(off,     i24          & 0xFF);
      view.setUint8(off + 1, (i24 >> 8)   & 0xFF);
      view.setUint8(off + 2, (i24 >> 16)  & 0xFF);
      off += 3;
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// ── WebCodecs FLAC encoder ───────────────────────────────────────────
async function encodeFlacWebCodecs(audioBuffer: AudioBuffer): Promise<Blob> {
  // AudioEncoder / AudioData are part of the WebCodecs API (Chrome 107+)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const AE = (globalThis as any).AudioEncoder;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const AD = (globalThis as any).AudioData;
  if (!AE || !AD) throw new Error('WebCodecs not available');

  const cfg = {
    codec: 'flac',
    sampleRate: audioBuffer.sampleRate,
    numberOfChannels: audioBuffer.numberOfChannels,
  };
  const { supported } = await AE.isConfigSupported(cfg);
  if (!supported) throw new Error('FLAC codec not supported');

  const chunks: Uint8Array[] = [];

  await new Promise<void>((resolve, reject) => {
    const encoder = new AE({
      output: (chunk: { byteLength: number; copyTo: (d: Uint8Array) => void }) => {
        const d = new Uint8Array(chunk.byteLength);
        chunk.copyTo(d);
        chunks.push(d);
      },
      error: reject,
    });

    encoder.configure(cfg);

    const FRAME  = 4096;
    const nCh    = audioBuffer.numberOfChannels;
    const nSamp  = audioBuffer.length;

    for (let off = 0; off < nSamp; off += FRAME) {
      const count       = Math.min(FRAME, nSamp - off);
      const interleaved = new Float32Array(count * nCh);
      for (let i = 0; i < count; i++)
        for (let ch = 0; ch < nCh; ch++)
          interleaved[i * nCh + ch] = audioBuffer.getChannelData(ch)[off + i];

      const ad = new AD({
        format: 'f32',
        sampleRate: audioBuffer.sampleRate,
        numberOfFrames: count,
        numberOfChannels: nCh,
        timestamp: Math.floor((off / audioBuffer.sampleRate) * 1_000_000),
        data: interleaved,
      });
      encoder.encode(ad);
      ad.close();
    }

    encoder.flush().then(() => { encoder.close(); resolve(); }).catch(reject);
  });

  const total    = chunks.reduce((s, c) => s + c.length, 0);
  const combined = new Uint8Array(total);
  let pos        = 0;
  for (const c of chunks) { combined.set(c, pos); pos += c.length; }
  return new Blob([combined], { type: 'audio/flac' });
}

// ── Public API ───────────────────────────────────────────────────────
export interface ExportResult { blob: Blob; ext: 'flac' | 'wav' }

export async function exportAudioBlob(sourceBlob: Blob): Promise<ExportResult> {
  const ctx    = new AudioContext();
  const ab     = await sourceBlob.arrayBuffer();
  const buffer = await ctx.decodeAudioData(ab);
  await ctx.close();

  try {
    const blob = await encodeFlacWebCodecs(buffer);
    return { blob, ext: 'flac' };
  } catch {
    return { blob: encodeWAV(buffer), ext: 'wav' };
  }
}
