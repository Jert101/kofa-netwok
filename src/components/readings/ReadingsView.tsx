"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { shiftDays } from "@/lib/time/church-time";
import type { DayInfo } from "@/lib/readings/calendar";
import { usccbLink } from "@/lib/readings/calendar";
import { ceb } from "@/lib/readings/i18n/ceb";
import { en } from "@/lib/readings/i18n/en";
import { LANG_STORAGE_KEY, SIZE_STORAGE_KEY, type Dictionary } from "@/lib/readings/i18n";

type Lang = "en" | "ceb";
type Size = "sm" | "md" | "lg";

const SIZE_CLASS: Record<Size, string> = {
  sm: "text-sm",
  md: "text-[17px] leading-relaxed",
  lg: "text-lg leading-relaxed",
};

/** Liturgical colors hold on any theme, so they are fixed hex, not tokens. */
const COLOR_DOT: Record<string, string> = {
  Green: "#2e7f46",
  Violet: "#6a3fa0",
  White: "#d8d8d8",
  Red: "#c62828",
  Rose: "#d77a99",
};

function readStored(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode and locked-down WebViews throw here. Preferences are a
    // convenience, so losing them is silent rather than a crash.
  }
}

/**
 * Everything the page shows for one civil date. Client-side on purpose: the
 * language toggle and the text size are per-device preferences kept in
 * localStorage, and the calendar behind `info` is already computed -- there
 * is nothing left to fetch.
 */
export function ReadingsView({ date, info }: { date: string; info: DayInfo }) {
  const [lang, setLang] = useState<Lang>("en");
  const [size, setSize] = useState<Size>("md");
  const router = useRouter();

  useEffect(() => {
    const stored = readStored(LANG_STORAGE_KEY, "en");
    setLang(stored === "ceb" ? "ceb" : "en");
    const storedSize = readStored(SIZE_STORAGE_KEY, "md");
    setSize(storedSize === "sm" || storedSize === "lg" ? storedSize : "md");
  }, []);

  const pickLang = (next: Lang) => {
    setLang(next);
    store(LANG_STORAGE_KEY, next);
  };
  const pickSize = (next: Size) => {
    setSize(next);
    store(SIZE_STORAGE_KEY, next);
  };

  const t: Dictionary = lang === "ceb" ? ceb : en;
  const [y, m, d] = date.split("-").map(Number);
  const heading = `${t.weekdays[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${t.months[m - 1]} ${d}, ${y}`;
  const showSecond = info.rank === "Sunday" || info.rank === "Solemnity";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold sm:text-xl">{t.pageTitle}</h1>
        {/* Screen-only controls. Print keeps the readings, not the chrome. */}
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <div role="group" aria-label={t.textSize} className="flex overflow-hidden rounded-xl border border-[var(--border)]">
            {(["sm", "md", "lg"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => pickSize(s)}
                aria-pressed={size === s}
                className={`min-h-11 px-3 text-sm ${size === s ? "bg-[var(--brand-soft)] font-semibold text-[var(--brand-text)]" : "text-[var(--text-muted)]"}`}
              >
                {s === "sm" ? t.sizeSmall : s === "md" ? t.sizeMedium : t.sizeLarge}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Language" className="flex overflow-hidden rounded-xl border border-[var(--border)]">
            {(["en", "ceb"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => pickLang(l)}
                aria-pressed={lang === l}
                className={`min-h-11 px-3 text-sm font-semibold ${lang === l ? "bg-[var(--brand-soft)] text-[var(--brand-text)]" : "text-[var(--text-muted)]"}`}
              >
                {l === "en" ? "EN" : "CEB"}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-11 rounded-xl border border-[var(--border)] px-3 text-sm font-medium"
          >
            {t.print}
          </button>
        </div>
      </div>

      {/* Day stepper. The Today link goes through the index route so "today"
          is the church's date, not the browser's guess. */}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Link
          href={`/member/readings/${shiftDays(date, -1)}`}
          aria-label={t.prevDay}
          className="inline-flex min-h-11 items-center rounded-xl border border-[var(--border)] px-4 text-lg"
        >
          ‹
        </Link>
        <input
          type="date"
          value={date}
          max="2100-12-31"
          aria-label={t.chooseDate}
          onChange={(e) => {
            if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) router.push(`/member/readings/${e.target.value}`);
          }}
          className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
        />
        <Link
          href={`/member/readings/${shiftDays(date, 1)}`}
          aria-label={t.nextDay}
          className="inline-flex min-h-11 items-center rounded-xl border border-[var(--border)] px-4 text-lg"
        >
          ›
        </Link>
        <Link
          href="/member/readings"
          className="inline-flex min-h-11 items-center rounded-xl bg-[var(--brand)] px-4 text-sm font-semibold text-white"
        >
          {t.today}
        </Link>
      </div>

      <div className={SIZE_CLASS[size]}>
        <section aria-labelledby="reading-day" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="text-sm text-[var(--text-muted)]">{heading}</p>
          <h2 id="reading-day" className="mt-1 text-xl font-semibold tracking-tight">
            {t.celebration(info.title)}
          </h2>
          {info.commemorations.length > 0 ? (
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              {info.commemorations.map((c) => t.orSaint(c)).join(" · ")}
            </p>
          ) : null}

          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[var(--text-muted)]">{t.seasonLabel}</dt>
              <dd className="font-medium">
                {t.seasons[info.season]}
                {info.seasonWeek !== null ? ` · ${t.weekOf(info.seasonWeek)}` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">{t.colorLabel}</dt>
              <dd className="font-medium">
                <span
                  aria-hidden
                  className="mr-2 inline-block size-3 rounded-full border border-black/20 align-baseline"
                  style={{ backgroundColor: COLOR_DOT[info.color] ?? "#888" }}
                />
                {t.colors[info.color]}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">{t.rankLabel}</dt>
              <dd className="font-medium">{t.ranks[info.rank]}</dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">{t.cycleLabel}</dt>
              <dd className="font-medium">
                {t.sundayCycle(info.sundayCycle)} · {t.weekdayCycle(info.weekdayCycle)}
              </dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="reading-about" className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 id="reading-about" className="text-sm font-semibold text-[var(--brand)]">
            {t.aboutToday}
          </h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{t.seasonMeanings[info.season]}</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{t.colorMeanings[info.color]}</p>
        </section>

        <section aria-labelledby="reading-texts" className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 id="reading-texts" className="text-sm font-semibold text-[var(--brand)]">
            {t.readingsTitle}
          </h2>
          <ul className="mt-2 divide-y divide-[var(--border)] text-sm">
            <li className="py-2 font-medium">{t.firstReading}</li>
            <li className="py-2 font-medium">{t.psalm}</li>
            {showSecond ? (
              <li className="py-2 font-medium">{t.secondReading}</li>
            ) : (
              <li className="py-2 text-[var(--text-muted)]">{t.secondReadingNote}</li>
            )}
            <li className="py-2 font-medium">{t.acclamation}</li>
            <li className="py-2 font-medium">{t.gospel}</li>
          </ul>
          <a
            href={usccbLink(date)}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex min-h-12 items-center rounded-xl bg-[var(--brand)] px-4 text-sm font-semibold text-white"
          >
            {t.usccbButton} ↗
          </a>
          <p className="mt-2 text-xs text-[var(--text-muted)]">{t.usccbNote}</p>
        </section>
      </div>
    </div>
  );
}
