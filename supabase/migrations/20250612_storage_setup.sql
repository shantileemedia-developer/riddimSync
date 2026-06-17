-- StudioDESK Storage Setup
-- Run this once in the Supabase SQL Editor:
-- Dashboard → SQL Editor → paste this → Run

-- 1. Create the audio_files bucket (public so URLs are accessible without auth)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'audio_files',
  'audio_files',
  true,
  524288000,  -- 500 MB per file
  ARRAY['audio/webm', 'audio/wav', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/*']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 524288000;

-- 2. Allow any authenticated user to upload
CREATE POLICY "authenticated_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'audio_files');

-- 3. Allow anyone to read (needed for playback URLs to work)
CREATE POLICY "public_read" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'audio_files');

-- 4. Allow authenticated users to delete any audio file
CREATE POLICY "authenticated_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'audio_files');
