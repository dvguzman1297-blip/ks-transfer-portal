import Link from 'next/link';
import PageIntro, { SourceNote } from '@/components/PageIntro';

export const metadata = { title: 'Kingdom rules | K1886', description: 'The Kingdom 1886 pact rules: violations, what is allowed, reporting, punishments and appeals.' };

const VIOLATIONS = [
  ['Attacking a NAP member\'s Town Center', 'No attacks on another NAP player\'s city, at any time.'],
  ['Zeroing a NAP member', 'Automatic expulsion and blacklisting.'],
  ['Attacking a NAP member\'s RSS tile outside of All Out', 'Gatherers are protected except during All Out.'],
  ['Attacking a non-NAP Town Center more than twice', 'Non-NAP players can be hit at most two times.'],
  ['Attacking NAP alliance structures, banners or buildings', 'Including planting to force a fight.'],
  ['Blocking an alliance\'s banner path', 'Racing to Outposts is fair; cutting off another alliance\'s route is not.'],
  ['Harassment of any player', 'Verbal, sexual or racial harassment is banned in every channel. Severity sets the penalty.'],
  ['Misuse of the Minister of Justice position', 'The office must serve the kingdom, not personal or alliance interests.'],
  ['Stealing a Fort or Sanctuary from the assigned list', 'Assigned objectives can\'t be taken by another NAP alliance outside the council process.'],
  ['Poaching members by direct message', 'Private recruiting of another alliance\'s players is banned. Public recruiting in world chat is fine.'],
  ['Harboring a NAP blacklisted member', 'Blacklisted players can\'t join any NAP alliance while listed.'],
  ['Breaking the KvK rules', 'KvK terms are renegotiated each window, so check the current ruling before marching.'],
  ['Abusing the system to get around the rules', 'Alt, farm or swap tactics to dodge a rule count as the violation plus evasion.'],
  ['Taking a LVL 4 Outpost when not Top 4', 'Only the Top 4 alliances should fight over LVL 4 Outposts.'],
  ['Jumping between Main, Academy or Farm alliances to capture a LVL 1-3 Outpost', 'No switching between your own alliances mid-contest.'],
];

const TRIALS = [
  ['Arrogance Trial', 'Town Center resource production reduced by 40%.'],
  ['Indolence Trial', 'Training speed reduced by 25%.'],
  ['Avarice Trial', 'Training, research and construction speed reduced by 10%.'],
];

const ALLOWED = [
  ['Kingdom vs Kingdom', 'Other kingdoms are fair game within the current KvK terms.'],
  ['All Out', 'RSS tile hits on NAP members only during All Out. Town Centers stay protected.'],
  ['Non-NAP players', 'Up to two Town Center attacks each. Tiles and marches are open.'],
  ['Arena', 'Hitting K1886 players in Arena is never a violation, but use refreshes on other kingdoms first.'],
  ['Event combat', 'In-event fights between kingdom members don\'t carry over to the map.'],
];

const PROCESS = [
  ['1', 'Gather evidence', 'Attacks need battle reports. Chat needs full-context screenshots plus the account ID.'],
  ['2', 'Escalate internally', 'Report to your R4 or R5, who contacts the other alliance\'s R5.'],
  ['3', 'Council review', 'Unresolved cases go to the NAP R5s and the Minister of Justice.'],
  ['4', 'No retaliation', 'Never strike back before the R5s approve it.'],
];

function Block({ title, intro, children }) {
  return (
    <section className="mt-14">
      <h2 className="text-2xl font-black text-slate-100">{title}</h2>
      {intro && <p className="mt-2 text-sm text-slate-400">{intro}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Rows({ items }) {
  return (
    <ul className="card divide-y divide-navy-700/70">
      {items.map(([t, d]) => (
        <li key={t} className="px-5 py-4">
          <h3 className="font-semibold text-slate-100">{t}</h3>
          <p className="mt-0.5 text-sm text-slate-400">{d}</p>
        </li>
      ))}
    </ul>
  );
}

export default function Rules() {
  return (
    <>
      <PageIntro eyebrow="The pact" title="Kingdom rules">
        Every alliance in the pact agrees to these rules. Read them before you transfer, so there are no surprises.
      </PageIntro>
      <div className="mx-auto w-full max-w-3xl px-4 pb-24 sm:px-6">
        <Block title="Violations" intro="These break the pact and can lead to a trial, expulsion or the NAP blacklist.">
          <Rows items={VIOLATIONS} />
        </Block>

        <Block title="What each trial does" intro="Penalties are weighed per case. Honest mistakes usually need only an apology and repayment. Harassment, spying, farm or swap abuse and zeroing skip the ladder.">
          <div className="grid gap-4 sm:grid-cols-3">
            {TRIALS.map(([t, d]) => (
              <div key={t} className="card p-5">
                <h3 className="font-bold text-gold-400">{t}</h3>
                <p className="mt-1 text-sm text-slate-400">{d}</p>
              </div>
            ))}
          </div>
        </Block>

        <Block title="What is still allowed">
          <Rows items={ALLOWED} />
        </Block>

        <Block title="Reporting a violation">
          <ol className="grid gap-4 sm:grid-cols-2">
            {PROCESS.map(([n, t, d]) => (
              <li key={n} className="card flex gap-4 p-5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gold-500/50 bg-gold-500/10 font-extrabold text-gold-400">{n}</span>
                <div><h3 className="font-semibold text-slate-100">{t}</h3><p className="mt-0.5 text-sm text-slate-400">{d}</p></div>
              </li>
            ))}
          </ol>
        </Block>

        <Block title="Appeals and rule changes">
          <div className="card space-y-3 p-5 text-sm text-slate-400">
            <p><b className="text-slate-200">Appeals:</b> players can appeal through their R5 within 48 hours. A simple majority of NAP R5s can overturn or reduce a ruling.</p>
            <p><b className="text-slate-200">Changing the rules:</b> discuss with the NAP council, get a second alliance, then pass with a two-thirds majority. Rule changes and punishment changes are voted on separately.</p>
            <p><b className="text-slate-200">NAP blacklist:</b> bars a player from NAP alliances only. It does not change how they can be attacked.</p>
          </div>
        </Block>

        <SourceNote href="https://kingdom1886.com/rules.html" label="kingdom1886.com/rules" />
        <div className="mt-8 text-center">
          <Link href="/request" className="btn-gold px-7 py-3 text-base">Create a transfer request</Link>
        </div>
      </div>
    </>
  );
}
