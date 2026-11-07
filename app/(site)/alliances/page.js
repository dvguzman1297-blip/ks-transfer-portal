import Link from 'next/link';
import PageIntro from '@/components/PageIntro';
import { ALLIANCES } from '@/lib/alliances';

export const metadata = { title: 'Alliances | K1886', description: 'The alliances of Kingdom 1886.' };

const alliances = ALLIANCES.filter((a) => a.name);

export default function Alliances() {
  return (
    <>
      <PageIntro eyebrow="The pact" title="Our alliances">
        Every alliance listed here has agreed to stop fighting each other and start fighting as a kingdom. Most are recruiting.
      </PageIntro>
      <div className="mx-auto w-full max-w-4xl px-4 pb-24 sm:px-6">
        <ul className="grid gap-4 sm:grid-cols-2">
          {alliances.map((a) => (
            <li key={a.tag} className="card flex items-center gap-4 p-5">
              <span className="flex h-12 w-14 shrink-0 items-center justify-center rounded-lg bg-gold-500/10 text-sm font-extrabold text-gold-400">{a.tag}</span>
              <span className="font-semibold text-slate-100">{a.name}</span>
            </li>
          ))}
        </ul>

        <div className="card mt-10 space-y-3 p-6 text-sm text-slate-400">
          <h2 className="text-lg font-bold text-slate-100">Looking for leadership, farm alliances or bear trap times?</h2>
          <p>The full directory lists each alliance&apos;s R5 leadership, its farm and academy alliances and its bear trap times. Alliances not listed there are not members of the pact.</p>
          <a href="https://kingdom1886.com/alliances.html" target="_blank" rel="noopener noreferrer" className="btn-ghost">
            Open the full directory<span className="sr-only"> (opens in a new tab)</span> <span aria-hidden="true">↗</span>
          </a>
        </div>

        <div className="mt-10 text-center">
          <p className="mb-4 text-slate-400">Not sure which one fits you? Tell us what you are looking for and we will point you to it.</p>
          <Link href="/request" className="btn-gold px-7 py-3 text-base">Create a transfer request</Link>
        </div>
      </div>
    </>
  );
}
