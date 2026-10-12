import { z } from "zod";

/**
 * The day's Mass texts, assembled from two free sources.
 *
 * The page needs two different things and neither source supplies both:
 *
 * - WHICH passages. Citations ("Galatians 4:22-24, 26-27, 31–5:1") come from
 *   the Catholic Readings API (`cpbjr.github.io`, MIT, no key, no rate limit).
 *   It publishes citations only -- deliberately, because the Mass texts it
 *   extracted are the copyrighted USCCB lectionary. Nothing copyrighted is
 *   fetched, copied or stored here: a citation is a fact.
 * - WHAT they say. The wording comes from the World English Bible as served by
 *   bolls.life, which is public domain (unlike the lectionary, so it needs no
 *   permission) and covers the deuterocanonical books the lectionary uses. It
 *   is NOT the liturgical translation, and the page says so under the texts.
 *
 * Nothing is scraped: two documented JSON GETs, both validated, both cached.
 * As in the rosary loader, every upstream call is validated and individually
 * caught, so an unreachable source degrades its own section instead of the
 * page, and `loadDayReadings` never throws.
 *
 * Known approximations, both deliberate and documented in the README:
 * - A verse-letter subdivision ("Isaiah 25:6-10a") shows the whole verse.
 * - Psalm numbering matches USCCB: WEB is Masoretic-numbered, which is what
 *   the citations use (verified: WEB psalm 113 = "Praise Yah!", psalm 90 =
 *   "A Prayer by Moses").
 * - bolls.life verse text carries light markup (`<b>` for supplied words). It
 *   is stripped to plain text here and never reaches the DOM as HTML.
 */

export const CITATIONS_BASE = "https://cpbjr.github.io/catholic-readings-api";
export const BIBLE_BASE = "https://bolls.life/get-text";
export const TRANSLATION = "WEB";

/** Scripture never changes, so a week of cache keeps the origin warm. */
const SCRIPTURE_REVALIDATE = 604800;
/** A past date's citations never change either; tomorrow's are looked up fresh. */
const CITATIONS_REVALIDATE = 86400;

/** A citation that wide is a data error, not a reading. */
const MAX_CHAPTERS = 12;
const MAX_VERSES = 200;

export type ReadingSection =
  | "firstReading"
  | "psalm"
  | "secondReading"
  | "acclamation"
  | "gospel";

/** The order the readings are proclaimed in. Also the order the page renders. */
export const SECTION_ORDER: readonly ReadingSection[] = [
  "firstReading",
  "psalm",
  "secondReading",
  "acclamation",
  "gospel",
];

export type ReadingPassage = {
  /** Citation exactly as the source published it. */
  citation: string;
  verses: { verse: number; text: string }[];
};

export type DayTexts = {
  passages: Partial<Record<ReadingSection, ReadingPassage>>;
  /** One line per degraded source, for the notice at the top of the page. */
  notices: string[];
};

export type VerseRef = { chapter: number; verse: number };

export type ParsedCitation = {
  section: ReadingSection;
  citation: string;
  bookId: number;
  bookName: string;
  refs: VerseRef[];
};

// ---------------------------------------------------------------------------
// Book names -> bolls.life book ids
// ---------------------------------------------------------------------------

/**
 * The WEB book list as served by bolls.life on 2026-10-12 (83 books). These ids
 * belong to one fixed translation, so they are stable; `resolveBookId` is
 * covered by tests so a rename in the citation source fails there, not on screen.
 */
const BOOK_TABLE: readonly (readonly [string, number])[] = [
  ["Genesis", 1], ["Exodus", 2], ["Leviticus", 3], ["Numbers", 4], ["Deuteronomy", 5],
  ["Joshua", 6], ["Judges", 7], ["Ruth", 8], ["1 Samuel", 9], ["2 Samuel", 10],
  ["1 Kings", 11], ["2 Kings", 12], ["1 Chronicles", 13], ["2 Chronicles", 14], ["Ezra", 15],
  ["Nehemiah", 16], ["Esther", 17], ["Job", 18], ["Psalms", 19], ["Proverbs", 20],
  ["Ecclesiastes", 21], ["Song of Solomon", 22], ["Isaiah", 23], ["Jeremiah", 24],
  ["Lamentations", 25], ["Ezekiel", 26], ["Daniel", 27], ["Hosea", 28], ["Joel", 29],
  ["Amos", 30], ["Obadiah", 31], ["Jonah", 32], ["Micah", 33], ["Nahum", 34],
  ["Habakkuk", 35], ["Zephaniah", 36], ["Haggai", 37], ["Zechariah", 38], ["Malachi", 39],
  ["Matthew", 40], ["Mark", 41], ["Luke", 42], ["John", 43], ["Acts", 44], ["Romans", 45],
  ["1 Corinthians", 46], ["2 Corinthians", 47], ["Galatians", 48], ["Ephesians", 49],
  ["Philippians", 50], ["Colossians", 51], ["1 Thessalonians", 52], ["2 Thessalonians", 53],
  ["1 Timothy", 54], ["2 Timothy", 55], ["Titus", 56], ["Philemon", 57], ["Hebrews", 58],
  ["James", 59], ["1 Peter", 60], ["2 Peter", 61], ["1 John", 62], ["2 John", 63],
  ["3 John", 64], ["Jude", 65], ["Revelation", 66],
  // Deuterocanonical, in the WEB's order (these are what the lectionary uses).
  ["1 Esdras", 67], ["2 Esdras", 77], ["1 Maccabees", 74], ["2 Maccabees", 75],
  ["3 Maccabees", 76], ["4 Maccabees", 80], ["Tobit", 68], ["Judith", 69],
  ["Wisdom of Solomon", 70], ["Sirach", 71], ["Jeremy's Letter", 72], ["Baruch", 73],
  ["Susanna", 78], ["Bel and the Dragon", 79], ["Greek Additions to Esther", 81],
  ["3 Holy Children's Song", 82], ["Prayer of Manasses", 83],
];

/** Lectionary and WEB spell the same books differently. */
const BOOK_ALIASES: Readonly<Record<string, number>> = {
  psalm: 19,
  psalms: 19,
  responsorialpsalm: 19,
  songofsongs: 22,
  songofsolomon: 22,
  wisdom: 70,
  wisdomofsolomon: 70,
  ecclesiasticus: 71,
  sirach: 71,
  tobias: 68,
  tobit: 68,
  songofthreeholychildren: 82,
  thesongofthethreeholychildren: 82,
  letterofjeremiah: 72,
  jeremyletter: 72,
  additionstoesther: 81,
  estheradditions: 81,
  bel: 79,
  manasses: 83,
};

function normalizeBookName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const BOOK_IDS = new Map<string, number>(
  BOOK_TABLE.map(([name, id]) => [normalizeBookName(name), id]),
);

/** Levenshtein distance, abandoned as soon as it passes `max`. */
function editDistance(a: string, b: string, max: number): number | null {
  if (Math.abs(a.length - b.length) > max) return null;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowBest = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
      if (current[j] < rowBest) rowBest = current[j];
    }
    if (rowBest > max) return null;
    previous = current;
  }
  return previous[b.length] <= max ? previous[b.length] : null;
}

/** Two typos, and the near-match has to be unambiguous. */
const MAX_NAME_EDITS = 2;

/**
 * The bolls.life book id for a citation's book name, or null if unknown.
 *
 * The last resort is a near-match, because the citation source ships typos --
 * "Phiippians 2:12-18" (2026-11-04) would otherwise lose the whole reading. A
 * near-match must be unique and within two edits, so a genuinely unknown book
 * still falls through to "citation only" rather than to the wrong book.
 */
export function resolveBookId(name: string): number | null {
  const key = normalizeBookName(name);
  const exact = BOOK_IDS.get(key) ?? BOOK_ALIASES[key];
  if (exact !== undefined) return exact;

  let bestId: number | null = null;
  let best = MAX_NAME_EDITS + 1;
  let ambiguous = false;
  for (const [candidate, id] of BOOK_IDS) {
    const distance = editDistance(key, candidate, MAX_NAME_EDITS);
    if (distance === null) continue;
    if (distance < best) {
      best = distance;
      bestId = id;
      ambiguous = false;
    } else if (distance === best) {
      ambiguous = true;
    }
  }
  return ambiguous ? null : bestId;
}

// ---------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------

const citationsSchema = z
  .object({
    date: z.string(),
    season: z.string().optional(),
    readings: z
      .object({
        firstReading: z.string().optional(),
        psalm: z.string().optional(),
        secondReading: z.string().optional(),
        acclamation: z.string().optional(),
        gospel: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type CitationDay = Partial<Record<ReadingSection, string>>;

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

/** Book name and everything from the first number on: "Galatians" + "4:22-24, 31–5:1". */
const CITATION_HEAD = /^(.+?)\s+(\d.*)$/;

/** En dash, em dash, figure dash, minus: all mean "through" here. */
const DASHES = /[\u2010-\u2015\u2212]/g;

function expandRange(from: VerseRef, to: VerseRef): VerseRef[] | null {
  if (from.chapter !== to.chapter || from.verse > to.verse) return null;
  const out: VerseRef[] = [];
  for (let verse = from.verse; verse <= to.verse; verse += 1) {
    out.push({ chapter: from.chapter, verse });
    if (out.length > MAX_VERSES) return null;
  }
  return out;
}

/**
 * A range that crosses a chapter ("31–5:1"). How long the first chapter is
 * cannot be known from the citation alone, so this resolves to the cited verse
 * plus the target chapter's opening run -- which is how the lectionary writes
 * this in practice: "Galatians 4:31 to 5:1" is two verses, not a hundred and
 * seventy. The citation stays on screen, so a citation that genuinely needed its
 * middle filled shows the gap next to the reference instead of quietly reading
 * the wrong verses.
 */
function expandSpan(from: VerseRef, to: VerseRef): VerseRef[] | null {
  if (from.chapter > to.chapter) return null;
  const out: VerseRef[] = [from];
  for (let verse = 1; verse <= to.verse; verse += 1) {
    out.push({ chapter: to.chapter, verse });
    if (out.length > MAX_VERSES) return null;
  }
  return out;
}

/**
 * One separated piece, resolved against the chapter in force.
 *
 * Handles the shapes the citation source actually publishes: `6-10a` (a verse
 * range), `5a` (a verse with a subdivision letter), `31–5:1` (a range crossing
 * a chapter), `12:1-6A` (a piece that names its own chapter) and `25:6`.
 *
 * The chapter it leaves in force is returned with it: in "Revelation 11:19A;
 * 12:1-6A, 10AB" the trailing "10AB" belongs to chapter 12, not to the chapter
 * the citation opened with.
 */
function expandPiece(
  piece: string,
  chapter: number,
): { chapter: number; refs: VerseRef[] } | null {
  const text = piece.replace(DASHES, "-").replace(/\s+/g, "");
  // Subdivision letters are a/b/c on ferials and A/B/C on some solemnities.
  // They are dropped either way: the verse is shown whole.
  const crossChapter = /^(\d+):(\d+)[a-zA-Z]*-(\d+):(\d+)[a-zA-Z]*$/.exec(text);
  if (crossChapter) {
    const to = { chapter: Number(crossChapter[3]), verse: Number(crossChapter[4]) };
    const refs = expandSpan({ chapter: Number(crossChapter[1]), verse: Number(crossChapter[2]) }, to);
    return refs ? { chapter: to.chapter, refs } : null;
  }

  const rangedChapter = /^(\d+):(\d+)[a-zA-Z]*-(\d+)[a-zA-Z]*$/.exec(text);
  if (rangedChapter) {
    const own = Number(rangedChapter[1]);
    const refs = expandRange({ chapter: own, verse: Number(rangedChapter[2]) }, { chapter: own, verse: Number(rangedChapter[3]) });
    return refs ? { chapter: own, refs } : null;
  }

  // "31-5:1": the head already consumed the first chapter, so only the far end
  // carries one.
  const outOfChapter = /^(\d+)[a-zA-Z]*-(\d+):(\d+)[a-zA-Z]*$/.exec(text);
  if (outOfChapter) {
    const to = { chapter: Number(outOfChapter[2]), verse: Number(outOfChapter[3]) };
    const refs = expandSpan({ chapter, verse: Number(outOfChapter[1]) }, to);
    return refs ? { chapter: to.chapter, refs } : null;
  }

  const explicitChapter = /^(\d+):(\d+)[a-zA-Z]*$/.exec(text);
  if (explicitChapter) {
    const own = Number(explicitChapter[1]);
    return { chapter: own, refs: [{ chapter: own, verse: Number(explicitChapter[2]) }] };
  }

  const range = /^(\d+)[a-zA-Z]*-(\d+)[a-zA-Z]*$/.exec(text);
  if (range) {
    const refs = expandRange({ chapter, verse: Number(range[1]) }, { chapter, verse: Number(range[2]) });
    return refs ? { chapter, refs } : null;
  }

  const single = /^(\d+)[a-zA-Z]*$/.exec(text);
  if (single) return { chapter, refs: [{ chapter, verse: Number(single[1]) }] };

  return null;
}

/**
 * A citation into the verses it names. Null when the book is unknown to WEB or
 * the reference does not parse -- an unreadable citation must not become an
 * empty text block on screen.
 */
export function parseCitation(section: ReadingSection, citation: string): ParsedCitation | null {
  const head = CITATION_HEAD.exec(citation.trim());
  if (!head) return null;
  const [, bookName, rest] = head;
  const bookId = resolveBookId(bookName);
  if (bookId === null) return null;

  // The first colon divides the chapter from the verses. With no colon at all
  // the citation is a bare verse list ("Philemon 9-10, 12-17"), so chapter 1.
  const colon = rest.indexOf(":");
  const chapter = colon === -1 ? 1 : Number(rest.slice(0, colon));
  const tail = colon === -1 ? rest : rest.slice(colon + 1);
  if (!Number.isInteger(chapter) || chapter < 1) return null;

  // The source publishes alternatives in one citation ("Luke 2:22-40 or
  // 2:22-32"), semicolons ("Revelation 11:19A; 12:1-6A"), and "and"
  // ("Psalm 90:3-4, 5-6, 12-13, 14 and 17"). Splitting on all of them keeps the
  // first option of an "or", which is the longer lectionary form.
  const pieces = tail
    .split(/\s*(?:,|;|\band\b|\bor\b|&)\s*/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const refs: VerseRef[] = [];
  const chapters = new Set<number>();
  let current = chapter;
  for (const piece of pieces) {
    const expanded = expandPiece(piece, current);
    if (!expanded) continue;
    current = expanded.chapter;
    for (const ref of expanded.refs) {
      const key = `${ref.chapter}:${ref.verse}`;
      if (refs.some((r) => `${r.chapter}:${r.verse}` === key)) continue;
      refs.push(ref);
      chapters.add(ref.chapter);
    }
  }
  if (refs.length === 0 || refs.length > MAX_VERSES || chapters.size > MAX_CHAPTERS) return null;
  return { section, citation: citation.trim(), bookId, bookName, refs };
}

// ---------------------------------------------------------------------------
// Verse text
// ---------------------------------------------------------------------------

const verseSchema = z
  .object({
    verse: z.number().int().positive(),
    text: z.string(),
  })
  .passthrough();

/** WEB's Psalms, the one book where a superscription sits inside verse 1. */
const PSALMS_BOOK_ID = 19;

/**
 * WEB opens every psalm with an editorial heading -- "By David.", "A Prayer by
 * Moses, the man of God.", "For the Chief Musician… A wedding song." -- wrapped
 * in `<b>` at the start of verse 1. It is a title, not a line of the psalm, and
 * nothing in the responsorial psalm is ever sung from it. Left in, the page
 * opens "By David. Yahweh is my light and my salvation", which reads as the
 * wrong psalm to anyone who knows the one they sing.
 */
export function stripSuperscription(raw: string): string {
  return raw.replace(/^\s*<b>[\s\S]*?<\/b>\s*/, "");
}

/**
 * Upstream verse text carries light markup (`<b>` for supplied words). Strip
 * every tag and refuse anything that still looks like markup, so no upstream
 * string can reach the DOM as HTML.
 */
export function plainText(raw: string): string | null {
  const stripped = raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (stripped.length === 0) return null;
  if (/[<>]/.test(stripped)) return null;
  return stripped;
}

export function chapterKey(bookId: number, chapter: number): string {
  return `${bookId}/${chapter}`;
}

async function fetchJson(url: string, revalidate: number): Promise<unknown> {
  const res = await fetch(url, {
    next: { revalidate },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Upstream answered ${res.status} for ${url}`);
  return (await res.json()) as unknown;
}

/** One chapter as verse number -> plain text. Throws on an unusable answer. */
async function loadChapter(bookId: number, chapter: number): Promise<Map<number, string>> {
  const rows = z.array(verseSchema).parse(
    await fetchJson(`${BIBLE_BASE}/${TRANSLATION}/${bookId}/${chapter}/`, SCRIPTURE_REVALIDATE),
  );
  const out = new Map<number, string>();
  for (const row of rows) {
    const source = bookId === PSALMS_BOOK_ID && row.verse === 1 ? stripSuperscription(row.text) : row.text;
    const text = plainText(source);
    if (text) out.set(row.verse, text);
  }
  if (out.size === 0) throw new Error(`Chapter ${bookId}/${chapter} had no readable verses`);
  return out;
}

/**
 * The verses a citation names, in citation order. A chapter that failed to load
 * costs only its own verses: the rest of the section still shows.
 */
export function buildPassage(
  parsed: ParsedCitation,
  chapters: ReadonlyMap<string, Map<number, string>>,
): ReadingPassage | null {
  const verses: { verse: number; text: string }[] = [];
  const seen = new Set<string>();
  for (const ref of parsed.refs) {
    const key = `${ref.chapter}:${ref.verse}`;
    if (seen.has(key)) continue;
    const chapter = chapters.get(chapterKey(parsed.bookId, ref.chapter));
    const text = chapter?.get(ref.verse);
    if (!text) continue;
    seen.add(key);
    verses.push({ verse: ref.verse, text });
  }
  return verses.length > 0 ? { citation: parsed.citation, verses } : null;
}

// ---------------------------------------------------------------------------
// The loader
// ---------------------------------------------------------------------------

function citationsUrl(date: string): string {
  const [, month, day] = date.split("-");
  return `${CITATIONS_BASE}/readings/${date.slice(0, 4)}/${month}-${day}.json`;
}

/**
 * Every passage for one civil date. Never throws: a missing source leaves a
 * notice and the page keeps its labels and the official-readings link.
 */
export async function loadDayReadings(date: string): Promise<DayTexts> {
  const notices: string[] = [];

  let citations: CitationDay;
  try {
    citations = parseCitationsDay(await fetchJson(citationsUrl(date), CITATIONS_REVALIDATE));
  } catch {
    return {
      passages: {},
      notices: [
        "The readings for this date could not be loaded. Open the official readings below instead.",
      ],
    };
  }

  const parsed: ParsedCitation[] = [];
  // A citation that cannot be resolved still goes on screen: knowing WHAT is
  // read is worth more than a blank section, and the reference can be checked
  // against the official texts. Empty `verses` is what says "no text here".
  const passages: DayTexts["passages"] = {};
  let unresolved = 0;
  for (const section of SECTION_ORDER) {
    const citation = citations[section];
    if (!citation) continue;
    const entry = parseCitation(section, citation);
    if (entry) parsed.push(entry);
    else {
      passages[section] = { citation, verses: [] };
      unresolved += 1;
    }
  }

  // Every chapter the day needs, fetched once each and all at once.
  const wanted = new Set<string>();
  for (const entry of parsed) {
    for (const ref of entry.refs) wanted.add(chapterKey(entry.bookId, ref.chapter));
  }

  const loaded = await Promise.all(
    [...wanted].map(async (key) => {
      const [bookId, chapter] = key.split("/").map(Number);
      try {
        return [key, await loadChapter(bookId, chapter)] as const;
      } catch {
        // One missing chapter costs its own verses, not the page.
        return [key, null] as const;
      }
    }),
  );
  const chapters = new Map(loaded.filter((e): e is [string, Map<number, string>] => e[1] !== null));

  let missing = 0;
  for (const entry of parsed) {
    const passage = buildPassage(entry, chapters);
    if (passage) passages[entry.section] = passage;
    else {
      passages[entry.section] = { citation: entry.citation, verses: [] };
      missing += 1;
    }
  }
  if (missing + unresolved > 0) {
    notices.push("Some passages could not be loaded. The rest of the readings are below.");
  }

  return { passages, notices };
}
