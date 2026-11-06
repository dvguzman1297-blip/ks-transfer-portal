'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';

// Lets a user choose (or change) the name teammates see and the audit log records.
export default function NameForm({ initial = '', onSaved, onCancel, onSignOut }) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) return setError('Please enter a name');
    setBusy(true);
    const { error } = await supabase.rpc('set_display_name', { new_name: clean });
    setBusy(false);
    if (error) return setError(error.message);
    onSaved(clean);
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm text-slate-300">
        This is the name your teammates see in the members list and the name shown in the audit log next to your changes. Your email stays private.
      </p>
      <div>
        <label className="label" htmlFor="display-name">Your name</label>
        <input id="display-name" className="input" value={name} maxLength={40} autoFocus required
          placeholder="e.g. j3ttybear" onChange={(e) => { setName(e.target.value); setError(''); }} />
      </div>
      {error && <p className="rounded-lg border border-rose-500 bg-rose-950 p-2 text-sm text-rose-200">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-gold" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save name'}</button>
        {onCancel && <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>}
        {onSignOut && <button type="button" className="btn-ghost" onClick={onSignOut}>Sign out</button>}
      </div>
    </form>
  );
}
