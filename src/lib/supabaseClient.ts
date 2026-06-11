import { createClient } from '@supabase/supabase-js';

// Strip BOM (U+FEFF) and any other non-printable-ASCII chars that break fetch headers
const sanitize = (s: string) => s.replace(/[^\x20-\x7E]/g, '').trim();

const supabaseUrl     = sanitize(import.meta.env.VITE_SUPABASE_URL     ?? '');
const supabaseAnonKey = sanitize(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '');

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Please check your .env file.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
