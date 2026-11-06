'use client';

import { useEffect, useState } from 'react';

// Light / dark switch, shown as a row inside the header menu. The choice is saved in this browser only.
export default function ThemeToggle() {
  const [light, setLight] = useState(false);

  useEffect(() => { setLight(document.documentElement.dataset.theme === 'light'); }, []);

  function toggle() {
    const next = light ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch { /* storage blocked: the choice just won't be remembered */ }
    setLight(!light);
  }

  return (
    <button type="button" role="switch" aria-checked={light} onClick={toggle}
      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-navy-700">
      <span aria-hidden="true" className="w-5 text-center">{light ? '☀️' : '🌙'}</span>
      <span className="flex-1">{light ? 'Light mode' : 'Dark mode'}</span>
      <span aria-hidden="true" className={`relative h-5 w-9 rounded-full border border-navy-600 transition ${light ? 'bg-gold-500/40' : 'bg-navy-900'}`}>
        <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-gold-500 transition-all ${light ? 'left-[1.1rem]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}
