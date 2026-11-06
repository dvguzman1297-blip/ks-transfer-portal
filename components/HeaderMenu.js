'use client';

import { useEffect, useRef, useState } from 'react';
import ThemeToggle from './ThemeToggle';

// One "⋯" menu that holds the secondary header actions so the header stays uncluttered.
// items: [{ label, icon, onClick, badge?, danger? }]. Normal items come first, then the theme switch, then danger items.
export default function HeaderMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const normal = items.filter((i) => !i.danger);
  const danger = items.filter((i) => i.danger);
  const pending = items.reduce((n, i) => n + (i.badge || 0), 0);

  const row = (i) => (
    <button key={i.label} type="button" role="menuitem"
      onClick={() => { setOpen(false); i.onClick(); }}
      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-navy-700 ${i.danger ? 'text-rose-300' : 'text-slate-200'}`}>
      <span aria-hidden="true" className="w-5 text-center">{i.icon}</span>
      <span className="flex-1">{i.label}</span>
      {i.badge > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-slate-950">{i.badge}</span>}
    </button>
  );

  return (
    <div className="relative shrink-0" ref={ref}>
      <button type="button" className="btn-ghost relative !px-3 text-base" onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu" aria-expanded={open} aria-label="Menu" title="Menu">
        ⋯
        {pending > 0 && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-amber-500" aria-hidden="true" />}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-56 rounded-xl border border-gold-500/30 bg-navy-800 p-1.5 shadow-xl shadow-black/30">
          {normal.map(row)}
          {normal.length > 0 && <div className="my-1 border-t border-navy-600" />}
          <ThemeToggle />
          {danger.length > 0 && <div className="my-1 border-t border-navy-600" />}
          {danger.map(row)}
        </div>
      )}
    </div>
  );
}
