'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';

// Shown after someone opens the "reset your password" link from their email.
export default function ResetPassword({ onDone }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (password.length < 8) return setError('Password must be at least 8 characters');
    if (password !== confirm) return setError('The two passwords do not match');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(error.message);
    onDone();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <img src="/logo.png" alt="" className="mx-auto mb-3 h-20 w-20 object-contain" />
      <form onSubmit={submit} className="card space-y-3 p-5">
        <h1 className="text-lg font-bold text-gold-400">Choose a new password</h1>
        <div>
          <label className="label" htmlFor="new-password">New password</label>
          <input id="new-password" className="input" type="password" required minLength={8} autoComplete="new-password" autoFocus
            value={password} onChange={(e) => { setPassword(e.target.value); setError(''); }} />
        </div>
        <div>
          <label className="label" htmlFor="confirm-password">Confirm password</label>
          <input id="confirm-password" className="input" type="password" required minLength={8} autoComplete="new-password"
            value={confirm} onChange={(e) => { setConfirm(e.target.value); setError(''); }} />
        </div>
        {error && <p className="text-sm text-rose-400" role="alert">{error}</p>}
        <button className="btn-gold w-full" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
      </form>
    </main>
  );
}
