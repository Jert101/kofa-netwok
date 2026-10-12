"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { shiftDays } from "@/lib/time/church-time";
import type { DayInfo } from "@/lib/readings/calendar";
import { usccbLink } from "@/lib/readings/calendar";
import { en } from "@/lib/readings/i18n/en";
import { SECTION_ORDER, type DayCitations, type ReadingSection } from "@/lib/readings/citations";

/** Liturgical colors hold on any theme, so they are fixed hex, not tokens. */
const COLOR_DOT: Record<string, string> = {
  Green: "#2e7f46",
  Violet: "#6a3fa0",
  White: "#d8d8d8",
  Red: "#c62828",
  Rose: "#d77a99",
};

const SECTION_LABEL: Record<ReadingSection, string> = {
  firstReading: en.firstReading,
  psalm: en.responsorialPsalm,
  secondReading: en.secondReading,
  gospel: en.gospel,
};

/**
 * Everything the page shows for one civil date. The calendar and the citations
 * were both resolved by the server before first paint (see `lib/readings`), so
 * this only formats what it is handed -- no fetch, no loading state, and a
 * missing citation degrades to a line under its own heading.
 */
export function ReadingsView({
  date,
  info,
  readings,
}: {
  date: string;
  info: DayInfo;
  readings: DayCitations;
}) {
  const router = useRouter();
  const [y, m, d] = date.split("-").map(Number);
  const heading = `${en.weekdays[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${en.months[m - 1]} ${d}, ${y}`;
  const isSundayOrSolemnity = info.rank === "Sunday" || info.rank === "Solemnity";

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold sm:text-xl">{en.pageTitle}</h1>

      {/* Day stepper. The Today link goes through the index route so "today"
          is the church's date, not the browser's guess. Kept out of the
          printed page, so a browser print still shows the readings alone. */}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Link
          href={`/member/readings/${shiftDays(date, -1)}`}
          aria-label={en.prevDay}
          className="inline-flex min-h-11 items-center rounded-xl border border-[var(--border)] px-4 text-lg"
        >
          ‹
        </Link>
        <input
          type="date"
          value={date}
          max="2100-12-31"
          aria-label={en.chooseDate}
          onChange={(e) => {
            if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) router.push(`/member/readings/${e.target.value}`);
          }}
          className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
        />
        <Link
          href={`/member/readings/${shiftDays(date, 1)}`}
          aria-label={en.nextDay}
          className="inline-flex min-h-11 items-center rounded-xl border border-[var(--border)] px-4 text-lg"
        >
          ›
        </Link>
        <Link
          href="/member/readings"
          className="inline-flex min-h-11 items-center rounded-xl bg-[var(--brand)] px-4 text-sm font-semibold text-white"
        >
          {en.today}
        </Link>
      </div>

      {readings.notices.length > 0 ? (
        <div role="status" className="space-y-1 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
          {readings.notices.map((notice) => (
            <p key={notice} className="text-sm text-[var(--text-muted)]">
              {notice}
            </p>
          ))}
        </div>
      ) : null}

      <section aria-labelledby="reading-day" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <p className="text-sm text-[var(--text-muted)]">{heading}</p>
        <h2 id="reading-day" className="mt-1 text-xl font-semibold tracking-tight">
          {en.celebration(info.title)}
        </h2>
        {info.commemorations.length > 0 ? (
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {info.commemorations.map((c) => en.orSaint(c)).join(" · ")}
          </p>
        ) : null}

        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[var(--text-muted)]">{en.seasonLabel}</dt>
            <dd className="font-medium">
              {en.seasons[info.season]}
              {info.seasonWeek !== null ? ` · ${en.weekOf(info.seasonWeek)}` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">{en.colorLabel}</dt>
            <dd className="font-medium">
              <span
                aria-hidden
                className="mr-2 inline-block size-3 rounded-full border border-black/20 align-baseline"
                style={{ backgroundColor: COLOR_DOT[info.color] ?? "#888" }}
              />
              {en.colors[info.color]}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">{en.rankLabel}</dt>
            <dd className="font-medium">{en.ranks[info.rank]}</dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">{en.cycleLabel}</dt>
            <dd className="font-medium">
              {en.sundayCycle(info.sundayCycle)} · {en.weekdayCycle(info.weekdayCycle)}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="reading-about" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 id="reading-about" className="text-sm font-semibold text-[var(--brand)]">
          {en.aboutToday}
        </h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">{en.seasonMeanings[info.season]}</p>
        <p className="mt-1 text-sm text-[var(--text-muted)]">{en.colorMeanings[info.color]}</p>
      </section>

      <section aria-labelledby="reading-texts" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 id="reading-texts" className="text-sm font-semibold text-[var(--brand)]">
          {en.readingsTitle}
        </h2>
        {SECTION_ORDER.map((section) => {
          const citation = readings.citations[section];
          return (
            <div key={section} className="border-t border-[var(--border)] py-3 first:mt-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                {SECTION_LABEL[section]}
              </p>
              <p className="mt-1 text-[15px]">
                {citation ?? (
                  <span className="text-[var(--text-muted)]">
                    {section === "secondReading" && !isSundayOrSolemnity
                      ? en.secondReadingNote
                      : en.citationUnavailable}
                  </span>
                )}
              </p>
            </div>
          );
        })}

        <div className="border-t border-[var(--border)] pt-3">
          <a
            href={usccbLink(date)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-12 items-center rounded-xl bg-[var(--brand)] px-4 text-sm font-semibold text-white"
          >
            {en.usccbButton} ↗
          </a>
        </div>
      </section>
    </div>
  );
}
