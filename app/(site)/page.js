import Link from 'next/link';
import HashRedirect from '@/components/HashRedirect';
import LandingLogin from '@/components/LandingLogin';

export const metadata = {
  title: 'Kingdom 1886 | Kingshot',
  description: 'One kingdom, one truce. Learn about Kingdom 1886 and send us a transfer request.',
};

export default function Landing() {
  return (
    <section className="mx-auto grid w-full max-w-7xl flex-1 items-center gap-10 px-4 py-10 sm:px-6 lg:grid-cols-2 lg:gap-16">
      <HashRedirect />
      <div className="max-w-xl text-center lg:text-left">
        <h1 className="text-5xl font-extrabold tracking-tight text-slate-100 sm:text-6xl">KINGDOM 1886</h1>
        <p className="mt-4 text-xl font-bold text-gold-400 sm:text-2xl">One kingdom. One truce.</p>
        <p className="mt-6 text-base leading-relaxed text-slate-300 sm:text-lg">
          Kingdom 1886&apos;s alliances run on a Non-Aggression Pact. We stop fighting each other and take the fight
          outward, together. Members are backed rather than farmed, avoidable losses are prevented, and the game
          stays fun, so we arrive at KvK stronger.
        </p>
        <div className="mt-9 flex justify-center lg:justify-start">
          <Link href="/request" className="btn-ghost rounded-full px-7 py-3 text-sm font-bold uppercase tracking-wide">Transfer request</Link>
        </div>
        <p className="mt-4 text-xs text-slate-500">Transfer requests are free and need no account, just your Player ID.</p>
      </div>
      <div className="flex justify-center lg:justify-end">
        <LandingLogin />
      </div>
    </section>
  );
}
