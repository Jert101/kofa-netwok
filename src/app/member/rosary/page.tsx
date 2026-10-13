import { getSetting } from "@/lib/settings/store";
import { churchToday } from "@/lib/time/church-time";
import { loadRosaryGuide, type GuideStep } from "@/lib/rosary/guide";
import { describeDate } from "@/lib/readings/calendar";

export const metadata = { title: "Rosary Guide" };

/**
 * The members' rosary guide.
 *
 * A server component, rendered per request and never prerendered: the page is
 * about *today*, so a copy frozen at build time would answer "Tuesday" with
 * Monday's mysteries. `force-dynamic` is the belt to that braces -- the page
 * reads a setting and calls two third parties, and nothing here should ever be
 * something a build can compute once and forget.
 *
 * The date comes from the parish's own calendar rather than the rosary service's
 * `/v1/today` (see `lib/rosary/guide.ts` for the day it got that wrong), and
 * everything upstream happens before first paint: a member opening this on a
 * slow phone gets the guide or an honest notice, never a spinner that depends
 * on a third party answering.
 */
export const dynamic = "force-dynamic";

export default async function RosaryGuidePage() {
  const tz = await getSetting("report_timezone").catch(() => null);
  const date = churchToday(tz);
  const info = describeDate(date);
  const guide = await loadRosaryGuide(date, info.season);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold sm:text-xl">Rosary Guide</h1>

      {guide.notices.length > 0 ? (
        <div role="status" className="space-y-1 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
          {guide.notices.map((n) => (
            <p key={n} className="text-sm text-[var(--text-muted)]">
              {n}
            </p>
          ))}
        </div>
      ) : null}

      <section aria-labelledby="rosary-today" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 id="rosary-today" className="text-sm font-semibold text-[var(--brand)]">
          Today&apos;s mysteries
        </h2>
        <p className="mt-2 text-lg font-semibold">
          The {guide.set} Mysteries
        </p>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {guide.dayLabel}
          {!guide.liveSeason ? " · " + info.season : ""}
        </p>
        {guide.youtubeUrl || guide.audioUrl ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {guide.youtubeUrl ? (
              <a
                href={guide.youtubeUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center rounded-xl border border-[var(--border)] px-3 text-sm font-medium"
              >
                Watch along
              </a>
            ) : null}
            {guide.audioUrl ? (
              <a
                href={guide.audioUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center rounded-xl border border-[var(--border)] px-3 text-sm font-medium"
              >
                Listen along
              </a>
            ) : null}
          </div>
        ) : null}
      </section>

      <ol className="space-y-4">
        {guide.steps.map((step, i) => (
          <StepCard key={`${step.kind}-${i}`} step={step} />
        ))}
      </ol>

      <p className="text-xs text-[var(--text-muted)]">
        Mysteries and prayer texts: The Rosary API (MIT), catholicdevotion.org.
      </p>
    </div>
  );
}

function StepCard({ step }: { step: GuideStep }) {
  if (step.kind === "decade") {
    const m = step.mystery;
    return (
      <li className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          {ordinal(step.index)} mystery
        </p>
        <h3 className="mt-1 text-base font-semibold">{m.title}</h3>
        {m.verse || m.fruit ? (
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {[m.verse, m.fruit].filter((s) => (s ?? "").trim().length > 0).join(" · ")}
          </p>
        ) : null}
        {m.meditation ? (
          <p className="mt-2 text-sm leading-relaxed">{m.meditation}</p>
        ) : null}
        <p className="mt-3 rounded-xl bg-[var(--surface-2)] p-3 text-sm">
          Pray: {step.repeated.join(" → ")}
        </p>
      </li>
    );
  }
  return (
    <li className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h3 className="text-base font-semibold">{step.title}</h3>
      {step.text ? (
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{step.text}</p>
      ) : (
        <p className="mt-1 text-sm text-[var(--text-muted)]">Text could not be loaded.</p>
      )}
    </li>
  );
}

function ordinal(n: number): string {
  if (n === 1) return "First";
  if (n === 2) return "Second";
  if (n === 3) return "Third";
  if (n === 4) return "Fourth";
  return "Fifth";
}
