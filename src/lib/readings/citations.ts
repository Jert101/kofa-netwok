import { z } from "zod";

/**
 * The day's Mass citations.
 *
 * The page shows WHAT is read ("Galatians 4:22-24, 26-27, 31–5:1") and sends the
 * member to the official texts for the words. That is a deliberate limit, not a
 * missing feature: the readings themselves come from the Lectionary for Mass
 * (ICEL/NABRE), which is copyrighted, and the antiphon and refrain of a
 * responsorial psalm belong to that publication rather than to any Bible. Every
 * free source found -- the Catholic Readings API included, which is where these
 * citations come from -- publishes the citation and withholds the text, because
 * it cannot give away what it may not.
 *
 * So the only honest choice was between a translation of the Bible, which is not
 * the liturgical wording and reads wrong to anyone who knows the psalm they
 * sing, and this. The parish decided on the citations.
 *
 * Nothing is scraped: one documented JSON GET, validated, cached a day. An
 * unreachable source degrades to a notice; `loadDayCitations` never throws.
 */

export const CITATIONS_BASE = "https://cpbjr.github.io/catholic-readings-api";

/** A past date's citations never change; tomorrow's are looked up fresh. */
const CITATIONS_REVALIDATE = 86400;

/**
 * The sections the page shows, in the order they are proclaimed.
 *
 * The Gospel Acclamation is deliberately absent: it is a short verse drawn from
 * the psalm or another song, and no free citation source publishes one -- the
 * field exists in the payload below but is always empty. A row that could never
 * fill would only look broken; the official texts have it.
 */
export const SECTION_ORDER = ["firstReading", "psalm", "secondReading", "gospel"] as const;

export type ReadingSection = (typeof SECTION_ORDER)[number];

export type CitationDay = Partial<Record<ReadingSection, string>>;

export type DayCitations = {
  citations: CitationDay;
  /** One line per degraded source, for the notice at the top of the page. */
  notices: string[];
};

const citationsSchema = z
  .object({
    date: z.string(),
    season: z.string().optional(),
    readings: z
      .object({
        firstReading: z.string().optional(),
        psalm: z.string().optional(),
        secondReading: z.string().optional(),
        // Present in the source's shape, always empty in practice. See above.
        acclamation: z.string().optional(),
        gospel: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

/** Narrow one raw readings file to the citations, dropping blank ones. */
export function parseCitationsDay(raw: unknown): CitationDay {
  const doc = citationsSchema.parse(raw);
  const out: CitationDay = {};
  for (const section of SECTION_ORDER) {
    const value = doc.readings[section]?.trim();
    if (value) out[section] = value;
  }
  return out;
}

function citationsUrl(date: string): string {
  const [, month, day] = date.split("-");
  return `${CITATIONS_BASE}/readings/${date.slice(0, 4)}/${month}-${day}.json`;
}

/**
 * The citations for one civil date. Never throws: an unreachable source leaves
 * a notice and the page keeps its headings and the official-readings link.
 */
export async function loadDayCitations(date: string): Promise<DayCitations> {
  try {
    const res = await fetch(citationsUrl(date), {
      next: { revalidate: CITATIONS_REVALIDATE },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Citations answered ${res.status}`);
    return { citations: parseCitationsDay((await res.json()) as unknown), notices: [] };
  } catch {
    return {
      citations: {},
      notices: ["The citations for this date could not be loaded. Open the official readings below instead."],
    };
  }
}
