import Link from 'next/link';
import HeaderLogin from './HeaderLogin';
import NavLinks from './NavLinks';

export const SITE_LINKS = [
  ['/rules', 'Rules'],
  ['/alliances', 'Alliance Directory'],
  ['/assignments', 'Assignments'],
  ['/request', 'Transfer Request'],
];

// Top bar for the public pages: logo + title + page links on the left, member login on the right.
export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-navy-700/60 bg-navy-950/85 backdrop-blur">
      <nav aria-label="Main" className="mx-auto flex h-16 w-full max-w-7xl items-center gap-4 px-4 sm:gap-6 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-3">
          <img src="/logo.png" alt="" width="40" height="40" className="h-10 w-10 object-contain" />
          <span className="text-lg font-extrabold text-slate-100 sm:text-xl">K1886 <span className="hidden sm:inline">Transfer Portal</span></span>
        </Link>
        <NavLinks links={SITE_LINKS} className="hidden lg:flex" />
        <HeaderLogin />
      </nav>
      {/* smaller screens: the same links on their own row */}
      <NavLinks links={SITE_LINKS} className="mx-auto flex w-full max-w-7xl flex-wrap justify-center border-t border-navy-700/40 px-4 lg:hidden" />
    </header>
  );
}
