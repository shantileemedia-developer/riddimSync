import { supabase } from '../lib/supabaseClient';

export const generatePeaks = async (audioBuffer: AudioBuffer, count = 200): Promise<number[]> => {
  const data = audioBuffer.getChannelData(0);
  const blockSize = Math.floor(data.length / count);
  const peaks: number[] = [];
  for (let i = 0; i < count; i++) {
    let max = 0;
    for (let j = 0; j < blockSize; j++) {
      const v = Math.abs(data[i * blockSize + j] ?? 0);
      if (v > max) max = v;
    }
    peaks.push(max);
  }
  return peaks;
};

export const uploadAudioToSupabase = async (blob: Blob, fileName: string): Promise<string> => {
  const path = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
  const { error } = await supabase.storage
    .from('audio_files')
    .upload(path, blob, { contentType: blob.type || 'audio/wav' });

  if (error) {
    console.error('Supabase upload failed, falling back to local blob:', error);
    return URL.createObjectURL(blob);
  }

  const { data } = supabase.storage.from('audio_files').getPublicUrl(path);
  return data.publicUrl;
};
