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
  // Email links (confirm sign-up, reset password) carry the session in the URL hash. Only the portal may consume it,
  // so a link that lands on the landing page is forwarded there first (see HashRedirect) instead of being eaten here.
  auth: { detectSessionInUrl: typeof window === 'undefined' || window.location.pathname.startsWith('/portal') },
});
