'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Dashboard from '@/components/Dashboard';
import dynamic from 'next/dynamic';
import NameForm from '@/components/NameForm';
import ResetPassword from '@/components/ResetPassword';
import { Modal, PageSkeleton } from '@/components/ui';

const RequestsModal = dynamic(() => import('@/components/RequestsModal'), { ssr: false });
const MembersModal = dynamic(() => import('@/components/MembersModal'), { ssr: false });

export default function Home() {
  const router = useRouter();
  const [session, setSession] = useState(undefined); // undefined = still loading
  const [role, setRole] = useState(null); // null = checking, else 'admin' | 'member' | 'pending' | 'error'
  const [accessError, setAccessError] = useState('');
  const [pendingCount, setPendingCount] = useState(0);
  const [requestCount, setRequestCount] = useState(0);
  const [showRequests, setShowRequests] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [showMembers, setShowMembers] = useState(false);
  const [showName, setShowName] = useState(false);
  const [recovering, setRecovering] = useState(false); // opened a password-reset link from email
  const [name, setName] = useState(null); // null = checking, '' = not chosen yet
  const [toast, setToast] = useState(null);

  const user = session?.user;
  const userId = user?.id;

  const notify = useCallback((msg, type = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((evt, s) => {
      setSession(s);
      if (evt === 'PASSWORD_RECOVERY') setRecovering(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // Ask the database what this account may do (creates a pending request, or the first admin)
  const checkAccess = useCallback(async () => {
    setRole(null);
    // independent queries: run them together instead of one after the other
    const [{ data, error }, { data: me, error: meErr }] = await Promise.all([
      supabase.rpc('request_access'),
      supabase.from('members').select('display_name').eq('user_id', userId).maybeSingle(),
    ]);
    if (error) { setAccessError(error.message); setRole('error'); return; }
    if (meErr) { setAccessError(meErr.message); setRole('error'); return; }
    setAccessError('');
    setName(me?.display_name || '');
    setRole(data);
  }, [userId]);

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

  const loadRequests = useCallback(async () => {
    const { count } = await supabase.from('transfer_requests').select('id', { count: 'exact', head: true }).eq('status', 'new');
    setRequestCount(count ?? 0);
  }, []);

  // Any approved member: count of new public requests, plus a live toast when one arrives
  useEffect(() => {
    if (role !== 'admin' && role !== 'member') return;
    loadRequests();
    const channel = supabase.channel('transfer-requests')
      .on('postgres_changes', { event: 'INSERT', schema: 'kstransfers', table: 'transfer_requests' }, (payload) => {
        notify(`New transfer request from ${payload.new?.ign || 'a player'}`);
        loadRequests();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'kstransfers', table: 'transfer_requests' }, loadRequests)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [role, loadRequests, notify]);

  async function signOut() {
    await supabase.auth.signOut();
    setRole(null);
    setName(null);
    setShowMembers(false);
    setShowRequests(false);
    setShowName(false);
    router.replace('/');
  }

  // not signed in (or just signed out): the login lives on the landing page
  useEffect(() => { if (session === null) router.replace('/'); }, [session, router]);

  if (session === undefined || !session) return <PageSkeleton />;
  if (recovering) return <ResetPassword onDone={() => setRecovering(false)} />;
  if (role === null || name === null) return <PageSkeleton />;

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

  // First login: everyone chooses the name that teammates and the audit log will show
  if (!name) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
        <div className="card space-y-4 p-6">
          <img src="/logo.png" alt="" className="mx-auto h-16 w-16 object-contain" />
          <h2 className="text-center text-lg font-bold text-gold-400">Welcome! What should we call you?</h2>
          <NameForm onSaved={setName} onSignOut={signOut} />
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
        isAdmin={role === 'admin'}
        userName={name}
        reloadKey={reloadKey}
        requests={{ count: requestCount, onOpen: () => setShowRequests(true) }}
        menuItems={[
          { label: 'Members', icon: '👥', onClick: () => setShowMembers(true), badge: role === 'admin' ? pendingCount : 0 },
          { label: 'My name', icon: '✏️', onClick: () => setShowName(true) },
          { label: 'Sign out', icon: '⏻', onClick: signOut, danger: true },
        ]}
      />

      {showRequests && (
        <RequestsModal notify={notify} onClose={() => setShowRequests(false)} onChanged={loadRequests} onAccepted={() => setReloadKey((k) => k + 1)} />
      )}

      {showMembers && (
        <MembersModal me={user} isAdmin={role === 'admin'} notify={notify} onClose={() => { setShowMembers(false); loadPending(); }} onChanged={loadPending} />
      )}

      {showName && (
        <Modal title="Your name" onClose={() => setShowName(false)}>
          <NameForm initial={name} onSaved={(n) => { setName(n); setShowName(false); notify('Name updated'); }} onCancel={() => setShowName(false)} />
        </Modal>
      )}

      {toast && (
        <div role={toast.type === 'err' ? 'alert' : 'status'} aria-live="polite" className={`fixed bottom-4 left-1/2 z-[70] w-[92%] max-w-md -translate-x-1/2 rounded-lg border px-4 py-3 text-sm shadow-xl ${toast.type === 'err' ? 'border-rose-500 bg-rose-950 text-rose-200' : 'border-emerald-500 bg-emerald-950 text-emerald-200'}`}>
          {toast.msg}
        </div>
      )}
    </>
  );
}
