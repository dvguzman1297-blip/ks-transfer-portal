'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function AuthForm() {
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError(''); setInfo('');
    if (password.length < 8) return setError('Password must be at least 8 characters');
    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        setInfo(data.session
          ? 'Account created.'
          : 'Account created. Check your email to confirm it, then sign in. An admin must approve your access before you can see the portal.');
      }
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <img src="/logo.png" alt="K1886 Kingdom HQ crest" className="mx-auto mb-3 h-24 w-24 object-contain" />
      <h1 className="mb-1 bg-gradient-to-r from-gold-300 via-gold-500 to-gold-600 bg-clip-text text-center text-3xl font-black tracking-wide text-transparent">
        K1886 TRANSFER PORTAL
      </h1>
      <p className="mb-6 text-center text-xs text-slate-400">Kingdom members only</p>

      <form onSubmit={submit} className="card space-y-3 p-5">
        <h2 className="text-lg font-bold text-gold-400">{mode === 'signin' ? 'Sign in' : 'Request access'}</h2>
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label">Password</label>
          <input className="input" type="password" required minLength={8} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p className="text-sm text-rose-400" role="alert">{error}</p>}
        {info && <p className="text-sm text-emerald-400">{info}</p>}
        <button className="btn-blue w-full" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}</button>
        <button type="button" className="w-full text-center text-xs text-gold-400 underline"
          onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); setInfo(''); }}>
          {mode === 'signin' ? 'New here? Request access' : 'Already have an account? Sign in'}
        </button>
      </form>
    </main>
  );
}
