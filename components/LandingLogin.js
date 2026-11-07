'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import AuthForm from './AuthForm';

// The member login that lives on the landing page. Anyone who is already signed in (or signs in here)
// is sent straight on to the portal.
export default function LandingLogin() {
  const router = useRouter();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { if (data.session) router.replace('/portal'); });
    const { data } = supabase.auth.onAuthStateChange((evt, session) => { if (session) router.replace('/portal'); });
    return () => data.subscription.unsubscribe();
  }, [router]);
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-4">
      <img src="/logo.png" alt="K1886 Kingdom HQ crest" width="96" height="96" className="h-24 w-24 object-contain drop-shadow-[0_0_18px_rgb(var(--gold-500)/0.35)]" />
      <AuthForm />
    </div>
  );
}
