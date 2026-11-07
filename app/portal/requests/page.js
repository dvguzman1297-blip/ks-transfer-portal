'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import RequestsBoard from '@/components/RequestsBoard';
import { PageSkeleton } from '@/components/ui';
import { supabase } from '@/lib/supabase';

// Transfer requests page (members only): incoming and past requests from the public form.
export default function RequestsPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState(null);

  const notify = useCallback((msg, type = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // signed-out visitors go to the landing page, people who are not approved yet go to the portal's waiting screen
  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      if (!data.session) return router.replace('/');
      const { data: approved } = await supabase.rpc('is_approved');
      if (!alive) return;
      if (!approved) return router.replace('/portal');
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((evt, s) => { if (!s) router.replace('/'); });
    return () => { alive = false; data.subscription.unsubscribe(); };
  }, [router]);

  if (!ready) return <PageSkeleton />;

  return (
    <main className="mx-auto w-full max-w-4xl px-3 py-4 sm:px-6 sm:py-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-gold-400 sm:text-3xl">Transfer requests</h1>
          <p className="text-xs text-slate-400">Players who asked to join through the public form</p>
        </div>
        <Link href="/portal" className="btn-ghost">← Back to dashboard</Link>
      </header>

      <RequestsBoard notify={notify} onCreateCycle={() => router.push('/portal?next-cycle=1')} />

      {toast && (
        <div role={toast.type === 'err' ? 'alert' : 'status'} aria-live="polite" className={`fixed bottom-4 left-1/2 z-[70] w-[92%] max-w-md -translate-x-1/2 rounded-lg border px-4 py-3 text-sm shadow-xl ${toast.type === 'err' ? 'border-rose-500 bg-rose-950 text-rose-200' : 'border-emerald-500 bg-emerald-950 text-emerald-200'}`}>
          {toast.msg}
        </div>
      )}
    </main>
  );
}
