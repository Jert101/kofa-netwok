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
 * - when `/v1/today` is unreachable the mystery set falls back to the weekday
 *   tradition, which is fixed and needs no API at all;
 * - nothing is bundled: the prayer texts live upstream and are cached a day
 *   at a time, so a stale copy here can never silently disagree with the
 *   source.
 *
 * What is NOT done here: raw HTML injection. The API ships a `textHTML`
 * field per mystery and it is never rendered -- only the plain `text`.
 */

export const ROSARY_API_BASE = "https://the-rosary-api.vercel.app";

export const MYSTERY_SETS = ["Joyful", "Sorrowful", "Glorious", "Luminous"] as const;

export type MysterySet = (typeof MYSTERY_SETS)[number];

/** Fixed weekday tradition. Sundays follow the liturgical season, which only the API knows. */
const WEEKDAY_SET: Record<number, MysterySet> = {
  0: "Glorious", // Ordinary-Time default; the season may override this
  1: "Joyful",
  2: "Sorrowful",
  3: "Glorious",
  4: "Luminous",
  5: "Sorrowful",
  6: "Joyful",
};

/** Which mysteries today, by weekday alone. Sunday answers Ordinary Time. */
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
  dateLabel: string;
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
    dateLabel: first.currentDate?.trim() || first.rosary_date.trim(),
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
  reading: TodayReading;
  /** False when the set came from the weekday table instead of the API. */
  liveSeason: boolean;
  mysteries: Mystery[];
  steps: GuideStep[];
  /** One line per degraded section, for the notice at the top of the page. */
  notices: string[];
};

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
 * `now` is a parameter (in church time, decided by the caller) so the weekday
 * fallback is testable without freezing clocks.
 */
export async function loadRosaryGuide(now: Date): Promise<RosaryGuide> {
  const notices: string[] = [];
  let reading: TodayReading;
  let liveSeason = true;

  try {
    reading = parseTodayReading(await fetchJson(`${ROSARY_API_BASE}/v1/today`, 3600));
  } catch {
    // The weekday table is fixed tradition; only the Sunday-season refinement
    // is lost, and the notice says exactly that.
    liveSeason = false;
    reading = {
      set: weekdayMysterySet(now),
      season: "Weekday tradition",
      dayLabel: "",
      dateLabel: "",
      youtubeUrl: null,
      audioUrl: null,
    };
    notices.push(
      "Today's mysteries could not be confirmed and follow the weekday tradition instead. Sundays follow the liturgical season, so confirm Sunday's set with the parish when in doubt.",
    );
  }

  let mysteries: Mystery[] = [];
  try {
    mysteries = parseMysteries(
      await fetchJson(`${ROSARY_API_BASE}/v1/${reading.set.toLowerCase()}`, 86400),
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

  return { reading, liveSeason, mysteries, steps: assembleGuide(mysteries, prayers), notices };
}
