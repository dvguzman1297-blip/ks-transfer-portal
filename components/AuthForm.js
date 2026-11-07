'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';

const TITLES = { signin: 'Member login', signup: 'Request access', forgot: 'Reset your password' };

export default function AuthForm() {
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const go = (m) => { setMode(m); setError(''); setInfo(''); };

  async function submit(e) {
    e.preventDefault();
    setError(''); setInfo('');
    if (mode !== 'forgot' && password.length < 8) return setError('Password must be at least 8 characters');
    setBusy(true);
    try {
      if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      } else if (mode === 'signup') {
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: `${window.location.origin}/portal` } });
      if (error) throw error;
      setInfo(data.session
        ? 'Account created.'
        : 'Account created. Check your email to confirm it, then sign in. An admin must approve your access before you can see the portal.');
      } else {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/portal` });
      if (error) throw error;
      // same message whether or not the address exists, so this cannot be used to look up who has an account
      setInfo('If that email has an account, a reset link is on its way. Check your inbox (and spam).');
      }
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card w-full max-w-md space-y-3 p-5 sm:p-6">
      <h2 className="text-lg font-bold text-gold-400">{TITLES[mode]}</h2>
      <div>
        <label className="label" htmlFor="auth-email">Email</label>
        <input id="auth-email" className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      {mode !== 'forgot' && (
        <div>
          <div className="flex items-baseline justify-between">
            <label className="label" htmlFor="auth-password">Password</label>
            {mode === 'signin' && (
              <button type="button" className="text-xs text-gold-400 underline" onClick={() => go('forgot')}>Forgot password?</button>
            )}
          </div>
          <div className="relative">
            <input id="auth-password" className="input pr-16" type={showPw ? 'text' : 'password'} required minLength={8}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" className="absolute inset-y-0 right-0 px-3 text-xs text-slate-400 hover:text-gold-400"
              aria-pressed={showPw} onClick={() => setShowPw((v) => !v)}>{showPw ? 'Hide' : 'Show'}</button>
          </div>
          {mode === 'signup' && <p className="mt-1 text-xs text-slate-500">At least 8 characters.</p>}
        </div>
      )}
      {error && <p className="text-sm text-rose-400" role="alert">{error}</p>}
      {info && <p className="text-sm text-emerald-400" role="status">{info}</p>}
      <button className="btn-blue w-full" disabled={busy}>
        {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
      </button>
      <button type="button" className="w-full text-center text-xs text-gold-400 underline"
        onClick={() => go(mode === 'signin' ? 'signup' : 'signin')}>
        {mode === 'signin' ? 'New here? Request access' : mode === 'signup' ? 'Already have an account? Sign in' : 'Back to sign in'}
      </button>
    </form>
  );
}
