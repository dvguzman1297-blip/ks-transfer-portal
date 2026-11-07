export default function PageIntro({ eyebrow, title, children }) {
  return (
    <section className="mx-auto w-full max-w-3xl px-4 pb-10 pt-14 text-center sm:px-6 sm:pt-20">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-gold-400">{eyebrow}</p>
      <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-100 sm:text-5xl">{title}</h1>
      {children && <p className="mt-4 text-base leading-relaxed text-slate-400 sm:text-lg">{children}</p>}
    </section>
  );
}

export function SourceNote({ href, label }) {
  return (
    <p className="mt-10 text-center text-sm text-slate-500">
      Summary of the official page. For the latest version see{' '}
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-gold-400 underline underline-offset-2">{label}<span className="sr-only"> (opens in a new tab)</span></a>.
    </p>
  );
}
