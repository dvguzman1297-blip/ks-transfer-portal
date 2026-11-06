'use client';

import { useRef, useState } from 'react';

export function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className={`card max-h-[90vh] w-full ${wide ? 'max-w-4xl' : 'max-w-2xl'} overflow-y-auto rounded-b-none p-4 sm:rounded-b-xl sm:p-6`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gold-400">{title}</h2>
          <button className="btn-ghost px-2 py-1" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const ROLE_LABEL = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' };
export const ROLE_HELP = {
  owner: 'Full control, manages members and invites',
  editor: 'Can add and edit prospects and cycles',
  viewer: 'Read-only',
};

// Dropdown of suggestions that also accepts free text.
// options: [{ value, label, hint? }]
export function Combobox({ value, onChange, options, placeholder, ariaLabel, maxLength = 40 }) {
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false); // filter only while the user is typing
  const inputRef = useRef(null);
  const q = typing ? value.trim().toLowerCase() : '';
  const shown = options.filter((o) => !q || o.value.toLowerCase().includes(q) || o.label.toLowerCase().includes(q));

  function pick(o) {
    onChange(o.value);
    setTyping(false);
    setOpen(false);
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        className="input pr-9"
        role="combobox"
        aria-expanded={open}
        aria-label={ariaLabel}
        autoComplete="off"
        maxLength={maxLength}
        placeholder={placeholder}
        value={value}
        onChange={(e) => { onChange(e.target.value); setTyping(true); setOpen(true); }}
        onFocus={() => { setTyping(false); setOpen(true); }}
        onBlur={() => {
          setOpen(false);
          // normalise "t86" to the canonical "T86" when it matches an option
          const hit = options.find((o) => o.value.toLowerCase() === value.trim().toLowerCase());
          if (hit && hit.value !== value) onChange(hit.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
          if (e.key === 'ArrowDown') { setTyping(false); setOpen(true); }
          if (e.key === 'Enter' && open && typing && shown.length === 1) { e.preventDefault(); pick(shown[0]); }
        }}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Show options"
        className="absolute inset-y-0 right-0 px-3 text-slate-400 hover:text-gold-400"
        onMouseDown={(e) => { e.preventDefault(); setTyping(false); inputRef.current?.focus(); setOpen(true); }}
      >
        ▾
      </button>
      {open && shown.length > 0 && (
        <ul role="listbox" onMouseDown={(e) => e.preventDefault()} className="scroll-thin absolute z-30 mt-1 max-h-44 w-full overflow-y-auto overscroll-contain rounded-lg border border-navy-600 bg-navy-900 py-1 shadow-xl shadow-black/50">
          {shown.map((o) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}
              className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm hover:bg-navy-700 ${o.value === value ? 'text-gold-300' : 'text-slate-100'}`}
            >
              <span className="truncate">{o.label}</span>
              {o.hint && <span className="shrink-0 text-[10px] uppercase text-slate-500">{o.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
