'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Page links in the top bar; the current page is highlighted.
export default function NavLinks({ links, className = '' }) {
  const path = usePathname();
  return (
    <ul className={`items-center gap-1 ${className}`}>
      {links.map(([href, label]) => {
        const active = path.startsWith(href);
        return (
          <li key={href}>
            <Link href={href} aria-current={active ? 'page' : undefined}
              className={`rounded-lg px-3 py-2 text-sm font-medium hover:text-gold-300 ${active ? 'text-gold-400' : 'text-slate-300'}`}>
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
