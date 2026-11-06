'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Open dialogs, oldest first. Esc only closes the newest one (e.g. a confirmation on top of a form).
const modalStack = [];

// Accessible dialog: Esc closes it, the page behind does not scroll, and screen readers announce it as a dialog.
// The backdrop only closes it when the click both starts and ends on the backdrop, so dragging a text
// selection out of an input never throws away what was typed.
export function Modal({ title, onClose, children, wide, small }) {
  const panel = useRef(null);
  const downOnBackdrop = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose; // callers pass a new function every render; keep the effect below from re-running

  useEffect(() => {
    const id = Symbol('modal');
    modalStack.push(id);
    const onKey = (e) => {
      if (e.key === 'Escape' && modalStack[modalStack.length - 1] === id) { e.stopPropagation(); closeRef.current(); }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const previouslyFocused = document.activeElement;
    // move focus into the dialog unless a field inside already grabbed it (autoFocus)
    if (panel.current && !panel.current.contains(document.activeElement)) panel.current.focus();
    return () => {
      modalStack.splice(modalStack.indexOf(id), 1);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget) onClose(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
        className={`card max-h-[90vh] w-full ${wide ? 'max-w-4xl' : small ? 'max-w-md' : 'max-w-2xl'} overflow-y-auto rounded-b-none p-4 outline-none sm:rounded-b-xl sm:p-6`}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gold-400">{title}</h2>
          <button className="btn-ghost px-2 py-1" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// A proper confirmation dialog in place of the browser's confirm() box.
//   const [ask, confirmDialog] = useConfirm();
//   if (!(await ask({ title: 'Delete Bob?', message: '...', confirmLabel: 'Delete' }))) return;
//   ...render {confirmDialog} once in the component.
export function useConfirm() {
  const [state, setState] = useState(null);
  const ask = useCallback((opts) => new Promise((resolve) => setState({ ...opts, resolve })), []);
  const answer = (value) => { state?.resolve(value); setState(null); };
  const dialog = state && (
    <Modal small title={state.title || 'Are you sure?'} onClose={() => answer(false)}>
      {state.message && <p className="mb-5 text-sm text-slate-300">{state.message}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" autoFocus onClick={() => answer(false)}>{state.cancelLabel || 'Cancel'}</button>
        <button type="button" className={state.danger === false ? 'btn-blue' : 'btn bg-rose-600 text-white hover:bg-rose-500'} onClick={() => answer(true)}>
          {state.confirmLabel || 'Confirm'}
        </button>
      </div>
    </Modal>
  );
  return [ask, dialog];
}

// Dropdown of suggestions that also accepts free text. Arrow keys move through the list, Enter picks.
// options: [{ value, label, hint? }]
export function Combobox({ value, onChange, options, placeholder, ariaLabel, maxLength = 40 }) {
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false); // filter only while the user is typing
  const [active, setActive] = useState(-1);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const q = typing ? value.trim().toLowerCase() : '';
  const shown = options.filter((o) => !q || o.value.toLowerCase().includes(q) || o.label.toLowerCase().includes(q));

  useEffect(() => { setActive(-1); }, [q, open]);
  useEffect(() => {
    if (active >= 0) listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function pick(o) {
    onChange(o.value);
    setTyping(false);
    setOpen(false);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      if (open) { e.stopPropagation(); setOpen(false); } // closes the list first, not the whole dialog
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) { setTyping(false); setOpen(true); } else setActive((i) => Math.min(shown.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && open) {
      const target = active >= 0 ? shown[active] : (typing && shown.length === 1 ? shown[0] : null);
      if (target) { e.preventDefault(); pick(target); }
    }
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        className="input pr-9"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
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
        onKeyDown={onKeyDown}
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
        <ul ref={listRef} role="listbox" onMouseDown={(e) => e.preventDefault()} className="scroll-thin absolute z-30 mt-1 max-h-44 w-full overflow-y-auto overscroll-contain rounded-lg border border-navy-600 bg-navy-900 py-1 shadow-xl shadow-black/50">
          {shown.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}
              className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm hover:bg-navy-700 ${i === active ? 'bg-navy-700' : ''} ${o.value === value ? 'text-gold-300' : 'text-slate-100'}`}
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
