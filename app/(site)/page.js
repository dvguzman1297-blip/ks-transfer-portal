import Link from 'next/link';
import HashRedirect from '@/components/HashRedirect';
import LandingLogin from '@/components/LandingLogin';

export const metadata = {
  title: 'Kingdom 1886 | Kingshot',
  description: 'One kingdom, one truce. Learn about Kingdom 1886 and send us a transfer request.',
};

// Two rows on large screens: the "KINGDOM 1886" heading lines up with the crest, and the tagline lines up with the
// top of the login box. The items are in that reading order (heading, crest, text, login) so the grid places them
// correctly by itself; on phones `order` stacks them as heading, text, crest, login.
export default function Landing() {
  return (
    <section className="mx-auto grid w-full max-w-7xl flex-1 content-center gap-x-16 gap-y-8 px-4 py-10 sm:px-6 lg:grid-cols-2 lg:gap-y-10">
      <HashRedirect />

      <h1 className="order-1 self-center text-center lg:order-none text-5xl font-extrabold tracking-tight text-slate-100 sm:text-6xl lg:text-left">
        KINGDOM 1886
      </h1>

      <div className="order-3 flex justify-center self-center lg:order-none">
        <img src="/logo.png" alt="K1886 Kingdom HQ crest" width="96" height="96" className="h-24 w-24 object-contain drop-shadow-[0_0_18px_rgb(var(--gold-500)/0.35)]" />
      </div>

      <div className="order-2 mx-auto w-full max-w-xl self-start text-center lg:order-none lg:mx-0 lg:text-left">
        <p className="text-xl font-bold text-gold-400 sm:text-2xl">One kingdom. One truce.</p>
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

      <div className="order-4 flex justify-center self-start lg:order-none">
        <LandingLogin />
      </div>
    </section>
  );
}
