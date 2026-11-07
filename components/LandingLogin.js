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
  return <AuthForm />;
}
