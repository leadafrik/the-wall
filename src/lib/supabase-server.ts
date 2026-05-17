import { createClient } from '@supabase/supabase-js';

// Anonymous server client — used for read paths. Honors RLS.
export function getSupabaseAnonServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase anon env vars missing');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Service-role server client — bypasses RLS. Only used inside API routes
// for writes and admin actions. NEVER expose this key to the browser.
export function getSupabaseServiceServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service-role env vars missing');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
