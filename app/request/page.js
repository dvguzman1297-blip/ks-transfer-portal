'use client';

import Link from 'next/link';
import { useState } from 'react';
import { LOOKING_FOR, MAX_PASSES, TRANSFER_WINDOWS } from '@/lib/requests';
import { fmt, parsePower } from '@/lib/utils';

async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!j.success) throw new Error(j.error || 'Something went wrong');
  return j;
}

const EMPTY = { transferPasses: '', transferWindow: '', lookingFor: '', contacted: null, contactedWho: '', contactHandle: '', message: '' };

export default function RequestPage() {
  const [playerId, setPlayerId] = useState('');
  const [player, setPlayer] = useState(null); // looked-up profile
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const set = (k, v) => setF((o) => ({ ...o, [k]: v }));

  async function lookup(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const j = await post('/api/public-lookup', { playerId: playerId.trim() });
      setPlayer(j.data);
    } catch (err) {
      setPlayer(null); setError(err.message);
    } finally { setBusy(false); }
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (f.contacted === null) return setError('Tell us whether you have been in contact with 1886');
    setBusy(true);
    try {
      await post('/api/request', { playerId: playerId.trim(), ...f });
      setDone(true);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  const shell = (children) => (
    <main className="mx-auto flex min-h-[80vh] w-full max-w-lg flex-col justify-center px-4 py-8">
      <div className="card space-y-4 p-5 sm:p-6">{children}</div>
      <Link href="/" className="mt-4 text-center text-sm text-slate-400 hover:text-gold-400">← Back to Kingdom 1886</Link>
    </main>
  );

  if (done) {
    return shell(<>
      <img src="/logo.png" alt="" width="64" height="64" className="mx-auto h-16 w-16 object-contain" />
      <h1 className="text-center text-lg font-bold text-gold-400">Request sent!</h1>
      <p className="text-center text-sm text-slate-300">
        Thanks, <b className="text-slate-100">{player?.ign}</b>. The 1886 leadership has been notified and will get in touch.
      </p>
      <Link href="/" className="btn-gold w-full">Done</Link>
    </>);
  }

  return shell(<>
    <div className="text-center">
      <h1 className="text-xl font-bold text-gold-400">Transfer request</h1>
      <p className="mt-1 text-sm text-slate-400">No login needed. Start with your Player ID.</p>
    </div>

    <form onSubmit={lookup} className="space-y-2">
      <label className="label" htmlFor="pid">Player ID</label>
      <div className="flex gap-2">
        <input id="pid" className="input" inputMode="numeric" autoComplete="off" maxLength={20} placeholder="e.g. 290313686"
          value={playerId} onChange={(e) => { setPlayerId(e.target.value.replace(/\D/g, '')); setPlayer(null); }} />
        <button className="btn-blue shrink-0" disabled={busy || playerId.length < 3}>{busy && !player ? 'Looking…' : 'Look up'}</button>
      </div>
    </form>

    {player && (
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
          <div className="font-bold text-slate-100">{player.ign}</div>
          <div className="text-xs text-slate-400">
            {player.kingdom ? `Kingdom ${player.kingdom}` : 'Kingdom unknown'}
            {player.power ? ` · Power ${fmt(parsePower(player.power))}` : ''}
            {player.alliance ? ` · ${player.alliance}` : ''}
            {player.truegoldGrade ? ` · ${player.truegoldGrade}` : ''}
          </div>
        </div>

        <div>
          <label className="label" htmlFor="passes">Transfer passes you currently have</label>
          <input id="passes" className="input" inputMode="numeric" required min="0" max={MAX_PASSES} type="number"
            value={f.transferPasses} onChange={(e) => set('transferPasses', e.target.value)} />
        </div>

        <div>
          <label className="label" htmlFor="win">Which transfer window are you planning to move?</label>
          <select id="win" className="input" required value={f.transferWindow} onChange={(e) => set('transferWindow', e.target.value)}>
            <option value="">Choose…</option>
            {TRANSFER_WINDOWS.map((w) => <option key={w}>{w}</option>)}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="look">What kind of alliance are you looking for?</label>
          <select id="look" className="input" required value={f.lookingFor} onChange={(e) => set('lookingFor', e.target.value)}>
            <option value="">Choose…</option>
            {LOOKING_FOR.map((w) => <option key={w}>{w}</option>)}
          </select>
        </div>

        <fieldset>
          <legend className="label">Have you been in contact with someone from 1886?</legend>
          <div className="flex gap-2">
            {[[true, 'Yes'], [false, 'No']].map(([v, label]) => (
              <button type="button" key={label} aria-pressed={f.contacted === v} onClick={() => set('contacted', v)}
                className={`btn-ghost flex-1 ${f.contacted === v ? '!border-gold-400 !bg-gold-500/10' : ''}`}>{label}</button>
            ))}
          </div>
          {f.contacted && (
            <input className="input mt-2" required maxLength={60} placeholder="Who did you speak with?" aria-label="Who from 1886 did you speak with"
              value={f.contactedWho} onChange={(e) => set('contactedWho', e.target.value)} />
          )}
        </fieldset>

        <div>
          <label className="label" htmlFor="handle">How can we reach you? <span className="normal-case text-slate-500">(optional, e.g. Discord name)</span></label>
          <input id="handle" className="input" maxLength={60} value={f.contactHandle} onChange={(e) => set('contactHandle', e.target.value)} />
        </div>

        <div>
          <label className="label" htmlFor="msg">Anything else? <span className="normal-case text-slate-500">(optional)</span></label>
          <textarea id="msg" className="input" rows={3} maxLength={500} value={f.message} onChange={(e) => set('message', e.target.value)} />
        </div>

        <button className="btn-gold w-full py-2.5" disabled={busy}>{busy ? 'Sending…' : 'Send transfer request'}</button>
      </form>
    )}

    {error && <p role="alert" className="rounded-lg border border-rose-500 bg-rose-950 p-3 text-sm text-rose-200">{error}</p>}
  </>);
}
