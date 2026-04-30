const checks = [
  "Next.js App Router",
  "TypeScript",
  "Prisma schema",
  "Telegram test route",
  "Strava helper shell",
];

export default function HomePage() {
  return (
    <main className="shell">
      <section className="intro">
        <p className="eyebrow">Training Coach Bot</p>
        <h1>Deterministic training analysis before AI commentary.</h1>
        <p className="summary">
          MVP scaffold for Strava activity ingestion, metric calculation, and
          Russian Telegram coach reports.
        </p>
      </section>

      <section className="status" aria-label="Project status">
        {checks.map((item) => (
          <div className="statusItem" key={item}>
            <span aria-hidden="true" />
            {item}
          </div>
        ))}
      </section>
    </main>
  );
}
