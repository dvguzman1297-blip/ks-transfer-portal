import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn('Supabase env vars missing: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

// All queries target the custom `kstransfers` schema instead of `public`.
// Auth sessions are kept in the browser, so every query runs as the signed-in user.
export const supabase = createClient(url || 'http://localhost', anonKey || 'missing', {
  db: { schema: 'kstransfers' },
});
