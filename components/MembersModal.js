'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Modal, useConfirm } from './ui';

const ROLE_LABEL = { admin: 'Admin', member: 'Member', pending: 'Pending' };
const UNNAMED = 'No name set yet';

// Everyone approved can open this. Regular members get names only (the database hides everything else);
// admins also see emails and can approve, change roles and remove people.
export default function MembersModal({ me, isAdmin, onClose, onChanged, notify }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ask, confirmDialog] = useConfirm();

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('list_members');
    setLoading(false);
    if (error) return notify(error.message, 'err');
    setMembers(data);
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const who = (m) => m.display_name || m.email || UNNAMED;

  async function approve(m) {
    const { error } = await supabase.from('members').update({ role: 'member', approved_at: new Date().toISOString() }).eq('user_id', m.user_id);
    if (error) return notify(error.message, 'err');
    notify(`${who(m)} approved`);
    load(); onChanged();
  }

  async function setRole(m, role) {
    const { error } = await supabase.from('members').update({ role }).eq('user_id', m.user_id);
    if (error) notify(error.message, 'err');
    load(); onChanged();
  }

  async function remove(m) {
    const pending = m.role === 'pending';
    if (!(await ask({
      title: pending ? `Reject ${who(m)}?` : `Remove ${who(m)}?`,
      message: pending ? 'They will not get access to the portal.' : 'They will lose access to the portal. You can approve them again later if they ask.',
      confirmLabel: pending ? 'Reject' : 'Remove access',
    }))) return;
    const { error } = await supabase.from('members').delete().eq('user_id', m.user_id);
    if (error) return notify(error.message, 'err');
    load(); onChanged();
  }

  const pending = members.filter((m) => m.role === 'pending');
  const approved = members.filter((m) => m.role !== 'pending');

  if (!isAdmin) {
    return (
      <Modal title="Members" onClose={onClose}>
        {loading && <p className="text-sm text-slate-500">Loading…</p>}
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gold-400">Members ({members.length})</h3>
        <ul className="space-y-2">
          {members.map((m) => (
            <li key={m.user_id} className="rounded-lg border border-navy-600 bg-navy-900/60 p-2.5 text-sm text-slate-100">
              {m.display_name || <span className="text-slate-500">{UNNAMED}</span>}
              {m.user_id === me.id && <span className="ml-2 text-xs text-gold-400">(you)</span>}
            </li>
          ))}
        </ul>
        {confirmDialog}
      </Modal>
    );
  }

  return (
    <Modal title="Members & access" onClose={onClose}>
      {loading && <p className="text-sm text-slate-500">Loading…</p>}

      {pending.length > 0 && (
        <section className="mb-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-300">Waiting for approval ({pending.length})</h3>
          <div className="space-y-2">
            {pending.map((m) => (
              <div key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm text-slate-100">{m.display_name || <span className="text-slate-500">{UNNAMED}</span>}</div>
                  <div className="truncate text-xs text-slate-400">{m.email}</div>
                  <div className="text-xs text-slate-500">Requested {new Date(m.created_at).toLocaleString()}</div>
                </div>
                <div className="flex gap-2">
                  <button className="btn-blue px-3 py-1.5" onClick={() => approve(m)}>Approve</button>
                  <button className="btn-ghost px-3 py-1.5 text-rose-300" onClick={() => remove(m)}>Reject</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gold-400">Members ({approved.length})</h3>
        <div className="space-y-2">
          {approved.map((m) => (
            <div key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-navy-600 bg-navy-900/60 p-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm text-slate-100">
                  {m.display_name || <span className="text-slate-500">{UNNAMED}</span>}
                  {m.user_id === me.id && <span className="ml-2 text-xs text-gold-400">(you)</span>}
                </div>
                <div className="truncate text-xs text-slate-400">{m.email}</div>
                <div className="text-xs text-slate-500">
                  {m.approved_at ? `Approved ${new Date(m.approved_at).toLocaleDateString()}` : `Joined ${new Date(m.created_at).toLocaleDateString()}`}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <select className="input w-auto py-1" value={m.role} onChange={(e) => setRole(m, e.target.value)} aria-label={`Role for ${who(m)}`}>
                  <option value="member">{ROLE_LABEL.member}</option>
                  <option value="admin">{ROLE_LABEL.admin}</option>
                </select>
                {m.user_id !== me.id && (
                  <button className="btn-ghost px-3 py-1.5 text-rose-300" onClick={() => remove(m)}>Remove</button>
                )}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Members can view and edit everything and see each other&apos;s names. Only admins see emails, approve people and change access. Every change here is recorded in the audit log.
        </p>
      </section>
      {confirmDialog}
    </Modal>
  );
}
