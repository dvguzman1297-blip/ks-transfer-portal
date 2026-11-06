'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AuthForm from '@/components/AuthForm';
import Dashboard from '@/components/Dashboard';
import MembersModal from '@/components/MembersModal';

export default function Home() {
  const [session, setSession] = useState(undefined); // undefined = still loading
  const [role, setRole] = useState(null); // null = checking, else 'admin' | 'member' | 'pending' | 'error'
  const [accessError, setAccessError] = useState('');
  const [pendingCount, setPendingCount] = useState(0);
  const [showMembers, setShowMembers] = useState(false);
  const [toast, setToast] = useState(null);

  const user = session?.user;
  const userId = user?.id;

  const notify = useCallback((msg, type = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_evt, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  // Ask the database what this account may do (creates a pending request, or the first admin)
  const checkAccess = useCallback(async () => {
    setRole(null);
    const { data, error } = await supabase.rpc('request_access');
    if (error) { setAccessError(error.message); setRole('error'); return; }
    setAccessError('');
    setRole(data);
  }, []);

  useEffect(() => {
    if (!userId) { setRole(null); return; }
    checkAccess();
  }, [userId, checkAccess]);

  const loadPending = useCallback(async () => {
    const { count } = await supabase.from('members').select('user_id', { count: 'exact', head: true }).eq('role', 'pending');
    setPendingCount(count ?? 0);
  }, []);

  useEffect(() => {
    if (role !== 'admin') return;
    loadPending();
    const t = setInterval(loadPending, 60000);
    return () => clearInterval(t);
  }, [role, loadPending]);

  async function signOut() {
    await supabase.auth.signOut();
    setRole(null);
    setShowMembers(false);
  }

  if (session === undefined) return <p className="py-24 text-center text-slate-400">Loading…</p>;
  if (!session) return <AuthForm />;
  if (role === null) return <p className="py-24 text-center text-slate-400">Checking access…</p>;

  if (role === 'error') {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 px-4">
        <div className="card space-y-3 p-6">
          <h2 className="text-lg font-bold text-rose-300">Could not check your access</h2>
          <p className="text-sm text-slate-300">{accessError}</p>
          <p className="text-xs text-slate-500">If this is a new setup, run the latest schema.sql in Supabase and try again.</p>
          <div className="flex gap-2">
            <button className="btn-blue" onClick={checkAccess}>Try again</button>
            <button className="btn-ghost" onClick={signOut}>Sign out</button>
          </div>
        </div>
      </main>
    );
  }

  if (role === 'pending') {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
        <div className="card space-y-4 p-6 text-center">
          <img src="/logo.png" alt="" className="mx-auto h-20 w-20 object-contain" />
          <h2 className="text-lg font-bold text-gold-400">Waiting for approval</h2>
          <p className="text-sm text-slate-300">
            Your account <b className="text-slate-100">{user.email}</b> has been registered. A kingdom admin needs to approve it before you can open the portal.
          </p>
          <div className="flex justify-center gap-2">
            <button className="btn-blue" onClick={checkAccess}>Check again</button>
            <button className="btn-ghost" onClick={signOut}>Sign out</button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <>
      <Dashboard
        headerEnd={(
          <>
            <button className="btn-ghost shrink-0" onClick={signOut}>Sign out</button>
          </>
        )}
        headerExtra={role === 'admin' && (
          <button className="btn-ghost shrink-0" onClick={() => setShowMembers(true)}>
            👥 Members
            {pendingCount > 0 && (
              <span className="ml-1 rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-navy-950">{pendingCount}</span>
            )}
          </button>
        )}
      />

      {showMembers && (
        <MembersModal me={user} notify={notify} onClose={() => { setShowMembers(false); loadPending(); }} onChanged={loadPending} />
      )}

      {toast && (
        <div className={`fixed bottom-4 left-1/2 z-[70] w-[92%] max-w-md -translate-x-1/2 rounded-lg border px-4 py-3 text-sm shadow-xl ${toast.type === 'err' ? 'border-rose-500 bg-rose-950 text-rose-200' : 'border-emerald-500 bg-emerald-950 text-emerald-200'}`}>
          {toast.msg}
        </div>
      )}
    </>
  );
}
