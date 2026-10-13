import { z } from "zod";

/**
 * Rosary guide content, backed by the hosted Rosary API.
 *
 * The API is a small single-maintainer project (3 stars, MIT) already running
 * at `https://the-rosary-api.vercel.app` -- its own README marks the
 * clone/`npm start` instructions "Optional for Local Development", so there
 * is nothing to install or self-host. The app calls the hosted endpoints and
 * treats them as unreliable by design:
 *
 * - every upstream call is validated (unknown fields ignored, wrong shapes
 *   rejected) and individually caught, so one bad endpoint degrades its own
 *   section instead of the whole page;
 * - the parish's own date decides the date on screen and the mystery set, and
 *   the service is asked only for today's links, and only when it agrees with
 *   that date. See "The date is ours" below for why.
 * - nothing is bundled: the prayer texts live upstream and are cached a day
 *   at a time, so a stale copy here can never silently disagree with the
 *   source.
 *
 * ## The date is ours, not the service's
 *
 * `/v1/today` is not a function of when you ask it. On 2026-10-13 at 09:30 in
 * the Philippines it answered `currentDate: "October 12, 2026"`, and because
 * the page printed the service's date, the guide showed yesterday -- with
 * yesterday's mysteries and yesterday's video, as though nothing had turned
 * over. A "today" endpoint that can be a day stale cannot be trusted for the
 * one thing this page is named after.
 *
 * So the date and the set come from the parish's calendar, and a video
 * advertised for yesterday is treated as no video at all: a member would play
 * it and pray Monday's mysteries on a Tuesday.
 *
 * What is NOT done here: raw HTML injection. The API ships a `textHTML`
 * field per mystery and it is never rendered -- only the plain `text`.
 */

import type { Season } from "@/lib/readings/calendar";

export const ROSARY_API_BASE = "https://the-rosary-api.vercel.app";

export const MYSTERY_SETS = ["Joyful", "Sorrowful", "Glorious", "Luminous"] as const;

export type MysterySet = (typeof MYSTERY_SETS)[number];

/** Sunday-first, matching the weekday table's indices. */
const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/**
 * The fixed weekday pairing this devotional collection uses. Verified against
 * the audio it publishes: `monday_joyful`, `tuesday_sorrowful`,
 * `wednesday_glorious`, `thursday_luminous`, `friday_sorrowful`,
 * `saturday_joyful`, `sunday_glorious`.
 *
 * It is not the classic Dominican assignment (which pairs Tuesday with the
 * Glorious and Wednesday with the Sorrowful), and it is deliberately left that
 * way: the guide's texts come from this collection, so matching the collection
 * is what makes the meditations on the page the ones its audio says.
 */
const WEEKDAY_SET: Record<number, MysterySet> = {
  0: "Glorious", // Ordinary Time; Advent/Christmas/Lent override below
  1: "Joyful",
  2: "Sorrowful",
  3: "Glorious",
  4: "Luminous",
  5: "Sorrowful",
  6: "Joyful",
};

/** 0 = Sunday … 6 = Saturday, from a `YYYY-MM-DD` date. UTC: a civil date has no timezone. */
export function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The `MMDDYY` form the service publishes, so two dates compare without parsing prose. */
export function mmddyy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}${d}${y.slice(2)}`;
}

/**
 * Sunday's set follows the season, as the collection's own filenames show:
 * `sunday_joyful_mysteries_advent`, `sunday_joyful_mysteries_christmas`,
 * `sunday_sorrowful_mysteries_lent`, and plain `sunday_glorious_mysteries`
 * otherwise.
 */
export function sundaySet(season: Season): MysterySet {
  if (season === "Lent" || season === "Triduum") return "Sorrowful";
  if (season === "Advent" || season === "Christmas" || season === "Easter") return "Joyful";
  return "Glorious";
}

/** Which mysteries today -- the parish's date and its own calendar decide, never the service. */
export function mysterySetFor(iso: string, season: Season): MysterySet {
  const day = weekdayOf(iso);
  return day === 0 ? sundaySet(season) : (WEEKDAY_SET[day] ?? "Glorious");
}

/** Which mysteries today, by weekday alone. Kept for callers with no calendar to hand. */
export function weekdayMysterySet(date: Date): MysterySet {
  return WEEKDAY_SET[date.getDay()] ?? "Glorious";
}

function canonicalSet(raw: string): MysterySet | null {
  const found = MYSTERY_SETS.find((s) => s.toLowerCase() === raw.trim().toLowerCase());
  return found ?? null;
}

const todayRowSchema = z
  .object({
    rosary_date: z.string(),
    rosary_day: z.string(),
    mystery: z.string(),
    season: z.string(),
    currentDate: z.string().optional(),
    /** `MMDDYY` -- the one date field here that compares without parsing prose. */
    dateMMDDYY: z.string().optional(),
    youtubeLink: z.string().optional(),
    youtubeCode: z.string().optional(),
    mp3AudioUrl: z.string().optional(),
  })
  .passthrough();

const todaySchema = z.array(todayRowSchema).min(1);

export type TodayReading = {
  set: MysterySet;
  season: string;
  dayLabel: string;
  /** The date the service answered for, `MMDDYY`, or null if it published none. */
  serviceDate: string | null;
  youtubeUrl: string | null;
  audioUrl: string | null;
};

/** Narrow one raw `/v1/today` row to what the page renders. Unknown sets are rejected. */
export function parseTodayReading(raw: unknown): TodayReading {
  const rows = todaySchema.parse(raw);
  const first = rows[0];
  const set = canonicalSet(first.mystery);
  if (!set) throw new Error(`Unknown mystery set: ${first.mystery}`);
  return {
    set,
    season: first.season.trim() || "Unknown season",
    dayLabel: first.rosary_day.trim() || "",
    serviceDate: first.dateMMDDYY?.trim() || null,
    youtubeUrl: first.youtubeLink?.trim() || null,
    audioUrl: first.mp3AudioUrl?.trim() || null,
  };
}

const mysterySchema = z
  .object({
    title: z.string(),
    verse: z.string().optional(),
    fruit: z.string().optional(),
    text: z.string().optional(),
  })
  .passthrough();

export type Mystery = {
  title: string;
  verse: string | null;
  fruit: string | null;
  meditation: string | null;
};

/** Five mysteries of one set. Titles are required; anything else may be absent. */
export function parseMysteries(raw: unknown): Mystery[] {
  const rows = z.array(mysterySchema).parse(raw);
  return rows
    .filter((r) => r.title.trim().length > 0)
    .slice(0, 5)
    .map((r) => ({
      title: r.title.trim(),
      verse: r.verse?.trim() || null,
      fruit: r.fruit?.trim() || null,
      meditation: r.text?.trim() || null,
    }));
}

const prayerSchema = z
  .object({
    title: z.string(),
    prayerText: z.string(),
  })
  .passthrough();

/** Prayer title -> full text. Empty texts are dropped, not rendered blank. */
export function parsePrayers(raw: unknown): Map<string, string> {
  const rows = z.array(prayerSchema).parse(raw);
  const out = new Map<string, string>();
  for (const r of rows) {
    const title = r.title.trim();
    const text = r.prayerText.trim();
    if (title && text && !out.has(title)) out.set(title, text);
  }
  return out;
}

export type GuideStep =
  | { kind: "prayer"; title: string; text: string | null }
  | {
      kind: "decade";
      index: number;
      mystery: Mystery;
      /** Prayer titles said in each decade, in order. */
      repeated: readonly string[];
    };

const DECADE_PRAYERS = ["Our Father", "Hail Mary ×10", "Glory Be", "Oh My Jesus"] as const;

const OPENING_TITLES = ["Sign of the Cross", "Apostles' Creed", "Our Father"] as const;

const CLOSING_TITLES = ["Hail Holy Queen", "Final Prayer"] as const;

/**
 * The full praying order: opening prayers, five decades, closing prayers.
 *
 * Texts resolve from the prayer map; a missing text renders as a titled step
 * with no body rather than dropping the step, because a decade that silently
 * loses its Glory Be teaches the wrong order. The three Hail Marys after the
 * Creed share one text block with a note instead of repeating it three times.
 */
export function assembleGuide(mysteries: Mystery[], prayers: Map<string, string>): GuideStep[] {
  const steps: GuideStep[] = [];
  for (const title of OPENING_TITLES) {
    steps.push({ kind: "prayer", title, text: prayers.get(title) ?? null });
  }
  steps.push({
    kind: "prayer",
    title: "Hail Mary ×3",
    text: prayers.get("Hail Mary") ?? null,
  });
  steps.push({ kind: "prayer", title: "Glory Be", text: prayers.get("Glory Be") ?? null });
  mysteries.forEach((mystery, i) => {
    steps.push({ kind: "decade", index: i + 1, mystery, repeated: DECADE_PRAYERS });
  });
  for (const title of CLOSING_TITLES) {
    steps.push({ kind: "prayer", title, text: prayers.get(title) ?? null });
  }
  return steps;
}

export type RosaryGuide = {
  /** The parish's date for this guide, `YYYY-MM-DD`. Ours, always. */
  date: string;
  /** Day name from our own date, not the service's. */
  dayLabel: string;
  /** Decided by `mysterySetFor`, so it cannot follow a stale service. */
  set: MysterySet;
  youtubeUrl: string | null;
  audioUrl: string | null;
  /** False when the service did not confirm today's links. */
  liveSeason: boolean;
  mysteries: Mystery[];
  steps: GuideStep[];
  /** One line per degraded section, for the notice at the top of the page. */
  notices: string[];
};

/**
 * The header: our date, our set, and the service's links only if it agrees.
 *
 * Pure, so the rule that matters most on this page is testable without a
 * network: a service answering for a different date contributes nothing, because
 * its video and audio are for that other day.
 */
export function buildHeader(
  date: string,
  season: Season,
  service: TodayReading | null,
): Pick<RosaryGuide, "date" | "dayLabel" | "set" | "youtubeUrl" | "audioUrl" | "liveSeason"> & {
  notices: string[];
} {
  const weekday = weekdayOf(date);
  const agrees = service !== null && service.serviceDate !== null && service.serviceDate === mmddyy(date);
  return {
    date,
    dayLabel: WEEKDAY_LABELS[weekday] ?? "",
    set: mysterySetFor(date, season),
    youtubeUrl: agrees ? service?.youtubeUrl ?? null : null,
    audioUrl: agrees ? service?.audioUrl ?? null : null,
    liveSeason: agrees,
    notices: agrees
      ? []
      : [
          service === null
            ? "The rosary service could not be reached. Today's date and mysteries come from the parish calendar."
            : "The rosary service has not rolled over to today yet, so today's video and audio are not shown. The date and mysteries above come from the parish calendar.",
        ],
  };
}

async function fetchJson(url: string, revalidateSeconds: number): Promise<unknown> {
  const res = await fetch(url, {
    next: { revalidate: revalidateSeconds },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Rosary API answered ${res.status} for ${url}`);
  return (await res.json()) as unknown;
}

/**
 * Load everything the guide page needs. Never throws: each upstream call is
 * caught where it happens, and the result says which parts degraded.
 *
 * `date` and `season` come from the parish's own calendar, decided by the caller,
 * so "today" here means the parish's today and never the service's.
 */
export async function loadRosaryGuide(date: string, season: Season): Promise<RosaryGuide> {
  // Five minutes, not an hour: this endpoint is a rolling "today", and an hour
  // of cache on it is how yesterday survives into the morning.
  let service: TodayReading | null = null;
  try {
    service = parseTodayReading(await fetchJson(`${ROSARY_API_BASE}/v1/today`, 300));
  } catch {
    service = null;
  }

  const header = buildHeader(date, season, service);
  const notices = [...header.notices];

  let mysteries: Mystery[] = [];
  try {
    mysteries = parseMysteries(
      await fetchJson(`${ROSARY_API_BASE}/v1/${header.set.toLowerCase()}`, 86400),
    );
    if (mysteries.length === 0) throw new Error("empty mystery set");
  } catch {
    mysteries = [];
    notices.push("The mysteries for today could not be loaded. Try again in a little while.");
  }

  let prayers = new Map<string, string>();
  try {
    prayers = parsePrayers(await fetchJson(`${ROSARY_API_BASE}/v1/prayers`, 86400));
    if (prayers.size === 0) throw new Error("empty prayer list");
  } catch {
    prayers = new Map<string, string>();
    notices.push("The prayer texts could not be loaded. The order below still shows what to pray.");
  }

  return { ...header, mysteries, steps: assembleGuide(mysteries, prayers), notices };
}
