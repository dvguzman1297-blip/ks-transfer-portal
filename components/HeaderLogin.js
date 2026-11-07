'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// "Member login" pill for the top bar. Hidden on the landing page, where the login form is already shown.
export default function HeaderLogin() {
  if (usePathname() === '/') return null;
  return <Link href="/" className="btn-gold ml-auto whitespace-nowrap rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-wide">Member login</Link>;
}
