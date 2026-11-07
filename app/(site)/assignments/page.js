import PageIntro from '@/components/PageIntro';

export const metadata = { title: 'Sanctuary & fortress assignments | K1886', description: 'How Sanctuaries and Fortresses are assigned between the alliances of Kingdom 1886.' };

const FACTS = [
  ['4', 'Fortresses', 'The top four NAP alliances by power each receive one. Drop out of the top four and the Fortress is lost.'],
  ['10', 'Sanctuaries', 'Every NAP alliance receives one. Any left over are free-for-all.'],
  ['↓', 'Pick order', 'Alliances choose in descending order of power.'],
];

const RULES = [
  'Once assigned, an objective belongs to that NAP alliance, and other NAP alliances may not take it.',
  'Disputes over assigned objectives go to the R5s, not to a rally.',
  'Taking another NAP alliance\'s objective, even by mistake, is a pact violation and leads to the blacklist.',
  'Unassigned Sanctuaries are open to any alliance on the server. Taking one is not a violation, but the pact does not settle disputes over them.',
  'Before rallying, confirm your alliance\'s assignments with your R5 or the NAP council in kingdom chat.',
];

export default function Assignments() {
  return (
    <>
      <PageIntro eyebrow="The pact" title="Sanctuary & fortress assignments">
        Who may take which objective, so alliances in the pact never end up fighting over them.
      </PageIntro>
      <div className="mx-auto w-full max-w-4xl px-4 pb-24 sm:px-6">
        <div className="grid gap-5 sm:grid-cols-3">
          {FACTS.map(([big, t, d]) => (
            <div key={t} className="card p-6 text-center">
              <div className="text-4xl font-black text-gold-400">{big}</div>
              <h2 className="mt-1 font-bold text-slate-100">{t}</h2>
              <p className="mt-2 text-sm text-slate-400">{d}</p>
            </div>
          ))}
        </div>

        <section className="mt-12">
          <h2 className="text-2xl font-black text-slate-100">Rules for assigned objectives</h2>
          <ul className="card mt-5 divide-y divide-navy-700/70">
            {RULES.map((r) => <li key={r} className="px-5 py-4 text-sm text-slate-300">{r}</li>)}
          </ul>
        </section>

        <div className="card mt-10 space-y-3 p-6 text-sm text-slate-400">
          <h2 className="text-lg font-bold text-slate-100">Who holds what right now?</h2>
          <p>The current list is kept up to date by the kingdom council. It can go out of date between rotations, so confirm with your R5 before acting on it.</p>
          <a href="https://kingdom1886.com/assignments.html" target="_blank" rel="noopener noreferrer" className="btn-ghost">
            View current assignments<span className="sr-only"> (opens in a new tab)</span> <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>
    </>
  );
}
