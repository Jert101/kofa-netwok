import saintsData from "./saints.json";

/**
 * Liturgical calendar engine: pure TypeScript, no API, no database.
 *
 * Given any civil date it answers what the Church keeps that day: season,
 * week, color, rank, the celebration's name, and both lectionary cycles.
 * Everything is derived from the date plus the fixed-feast table in
 * `saints.json`, so the Daily Readings page works offline and can never be
 * broken by a third party being down.
 *
 * ## Ordinary Time week numbers (the fiddly part, verified)
 *
 * Ferial weeks are Sunday-headed, counted from the week containing the
 * Baptism (week 1), skipping the 12 weeks from the First Week of Lent
 * through the Sixth Week of Easter. So week 7 never occurs: the count runs
 * 1-6, then resumes at 8 on Pentecost week. Verified against the full 2026
 * calendar (Universalis): Feb 15 = 6th Sunday, May 24-30 = week 8, Jun 14 =
 * 11th Sunday, Oct 11 = 28th Sunday, Nov 22 = Christ the King 34th.
 * Sundays take their week's number when they are Ordinary Time Sundays;
 * solemnities on Sundays (Trinity, Corpus Christi, All Saints) carry no
 * number, which is why the numbers run 2-6 then 11-34 with gaps.
 *
 * ## Sunday cycle correction
 *
 * The common shorthand "remainder 1 = A" is rotated: Advent 2025 begins Year
 * A and 2025 mod 3 = 0, Advent 2026 begins Year B and 2026 mod 3 = 1. So the
 * rule is remainder 0 = A, 1 = B, 2 = C, taken on the civil year in which
 * that Advent begins. The tests pin Oct 12 2026 = A and Advent Nov 29 2026
 * beginning B, so a rotated mapping cannot slip back in.
 *
 * ## Simplifications (see README for the verification list)
 *
 * - Ascension Thursday is kept as the solemnity; the Sunday transfer most
 *   provinces observe is noted, not applied. Same for Corpus Christi
 *   Thursday: Sunday observance.
 * - US rule for Immaculate Conception on a Sunday (moves to Monday).
 * - All Souls is ranked Feast: the precedence table puts it with the
 *   solemnities, but calling a day of remembrance a "Solemnity" on screen
 *   would read wrong, and Feast is the nearest honest label.
 * - Saturday memorials of Our Lady are skipped; those Saturdays are ferial.
 */

export type Season =
  | "Advent"
  | "Christmas"
  | "Ordinary Time"
  | "Lent"
  | "Triduum"
  | "Easter";

export type LitColor = "Green" | "Violet" | "White" | "Red" | "Rose";

export type Rank =
  | "Solemnity"
  | "Feast"
  | "Memorial"
  | "Optional Memorial"
  | "Weekday"
  | "Sunday";

export type NamedKey =
  | "easter"
  | "ascension"
  | "pentecost"
  | "trinity"
  | "corpusChristi"
  | "christKing"
  | "christmas"
  | "maryMotherOfGod"
  | "epiphany"
  | "baptism"
  | "holyFamily"
  | "palmSunday"
  | "ashWednesday"
  | "holyThursday"
  | "goodFriday"
  | "holySaturday";

export type Title =
  | { kind: "otSunday"; n: number }
  | { kind: "seasonSunday"; season: "Advent" | "Lent" | "Easter"; n: number }
  | { kind: "ferial"; season: Season; week: number | null; weekday: number }
  | { kind: "holyWeek"; weekday: number }
  | { kind: "easterOctave"; weekday: number }
  | { kind: "christmasWeekday"; period: "octave" | "beforeEpiphany" | "afterEpiphany"; weekday: number }
  | { kind: "named"; key: NamedKey }
  | { kind: "saint"; name: string }
  | { kind: "allSouls" };

export type DayInfo = {
  /** `YYYY-MM-DD` as asked. */
  date: string;
  season: Season;
  /**
   * Week of the season: Lent 1-6 (Holy Week 6), Easter 1-7, Advent 1-4,
   * Christmas 1 (Octave) / 2, Ordinary Time = the OT week number, Triduum =
   * null (the days are named, not numbered).
   */
  seasonWeek: number | null;
  /** The Ordinary Time week number, or null outside OT ferial weeks. */
  otWeek: number | null;
  color: LitColor;
  rank: Rank;
  title: Title;
  /** Extra optional saints for the day, shown smaller ("or Saint …"). */
  commemorations: string[];
  /** Sunday lectionary cycle, from the Advent that opened the liturgical year. */
  sundayCycle: "A" | "B" | "C";
  /** Weekday lectionary cycle, from the civil year the liturgical year ends in. */
  weekdayCycle: "I" | "II";
};

export type SaintEntry = {
  month: number;
  day?: number;
  rule?: string;
  name: string;
  rank: "Solemnity" | "Feast" | "Memorial" | "Optional Memorial";
  color: LitColor;
};

// ---------------------------------------------------------------------------
// Date arithmetic (UTC throughout: a civil date has no timezone)
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

function parseDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

/** 0 = Sunday … 6 = Saturday. */
function weekday(d: Date): number {
  return d.getUTCDay();
}

function eq(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime();
}

/** Most recent Sunday on or before `d`. */
function sundayOnOrBefore(d: Date): Date {
  return addDays(d, -weekday(d));
}

/** First Sunday strictly after `d`. */
function sundayAfter(d: Date): Date {
  const delta = weekday(d) === 0 ? 7 : 7 - weekday(d);
  return addDays(d, delta);
}

// ---------------------------------------------------------------------------
// Easter and the movable feasts (Anonymous Gregorian algorithm)
// ---------------------------------------------------------------------------

/** Easter Sunday for a civil year. Valid across the Gregorian calendar. */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/** First Sunday of Advent: Advent IV (Sunday on/before Dec 24) minus 21 days. */
export function adventSunday(year: number): Date {
  return addDays(sundayOnOrBefore(new Date(Date.UTC(year, 11, 24))), -21);
}

/** Sunday in Jan 2-8 (US/PH observance). */
function epiphanySunday(year: number): Date {
  const jan2 = new Date(Date.UTC(year, 0, 2));
  return addDays(jan2, (7 - weekday(jan2)) % 7);
}

/**
 * Baptism of the Lord. Sunday after Epiphany, unless Epiphany falls Jan 7-8,
 * in which case Monday (US rule).
 */
function baptismDate(year: number): Date {
  const epiphany = epiphanySunday(year);
  if (epiphany.getUTCDate() >= 7) return addDays(epiphany, 1);
  return addDays(epiphany, 7);
}

function holyFamilySunday(year: number): Date {
  for (let d = 26; d <= 31; d++) {
    const cand = new Date(Date.UTC(year, 11, d));
    if (weekday(cand) === 0) return cand;
  }
  // No Sunday in Dec 26-31 (Christmas itself was Sunday): Dec 30.
  return new Date(Date.UTC(year, 11, 30));
}

function thirdSundayOfJanuary(year: number): Date {
  const jan1 = new Date(Date.UTC(year, 0, 1));
  return addDays(addDays(jan1, (7 - weekday(jan1)) % 7), 14);
}

// ---------------------------------------------------------------------------
// The fixed table (saints.json) plus transfers
// ---------------------------------------------------------------------------

type SaintsFile = {
  fixed: SaintEntry[];
  philippine: (SaintEntry & { verify?: string })[];
};

const SAINTS = saintsData as unknown as SaintsFile;

type DatedSaint = SaintEntry & { date: string };

/** One entry per row, so two saints sharing a date both survive; callers pick. */
function datedEntries(year: number): DatedSaint[] {
  const out: DatedSaint[] = [];
  const push = (e: SaintEntry, date: string) => out.push({ ...e, date });
  for (const e of SAINTS.fixed) {
    if (e.month == null || e.day == null) continue;
    push(e, fmt(new Date(Date.UTC(year, e.month - 1, e.day))));
  }
  for (const e of SAINTS.philippine) {
    if (e.rule === "thirdSundayOfJanuary") {
      push(e, fmt(thirdSundayOfJanuary(year)));
    } else if (e.month != null && e.day != null) {
      push(e, fmt(new Date(Date.UTC(year, e.month - 1, e.day))));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Season + week placement
// ---------------------------------------------------------------------------

function seasonOf(date: Date, year: number, easter: Date, ashWednesday: Date): Season {
  const t = date.getTime();
  const month = date.getUTCMonth();
  if (month === 11) {
    // December: Advent until Christmas Eve, Christmas from the 25th.
    return t < new Date(Date.UTC(year, 11, 25)).getTime() ? "Advent" : "Christmas";
  }
  if (month === 0) {
    return t <= baptismDate(year).getTime() ? "Christmas" : "Ordinary Time";
  }
  if (t >= ashWednesday.getTime() && t <= addDays(easter, -1).getTime()) return "Lent";
  if (t >= easter.getTime() && t <= addDays(easter, 49).getTime()) return "Easter";
  return "Ordinary Time";
}

/**
 * Ordinary Time week number for a date in an OT week, or null.
 *
 * Weeks are Sunday-headed, counted from the week containing the Baptism
 * (week 1), skipping the 12 weeks from the First Week of Lent through the
 * Sixth Week of Easter. Ascension week is counted (silently -- it is always
 * labeled Easter VII), which is exactly what makes Pentecost week come out
 * as 8 rather than 7.
 */
export function otWeekOf(date: Date | string, year?: number): number | null {
  const d = typeof date === "string" ? parseDate(date) : date;
  const y = year ?? d.getUTCFullYear();
  const baptism = baptismDate(y);
  const anchor = sundayOnOrBefore(baptism);
  const idx = Math.round((sundayOnOrBefore(d).getTime() - anchor.getTime()) / (7 * DAY_MS)) + 1;
  const easter = easterSunday(y);
  const lent1 = sundayAfter(addDays(easter, -46));
  const lent1Idx = Math.round((lent1.getTime() - anchor.getTime()) / (7 * DAY_MS)) + 1;
  if (idx < lent1Idx) return idx;
  // Easter VI Sunday heads the last skipped week; Ascension week (12 later)
  // is counted.
  if (idx < lent1Idx + 12) return null;
  return idx - 12;
}

function seasonWeekOf(date: Date, year: number, easter: Date, ashWednesday: Date): number | null {
  const season = seasonOf(date, year, easter, ashWednesday);
  const sun = sundayOnOrBefore(date);
  if (season === "Advent") {
    const a1 = adventSunday(onOrAfterDate(date, adventSunday(year)) ? year : year - 1);
    return Math.round((sun.getTime() - a1.getTime()) / (7 * DAY_MS)) + 1;
  }
  if (season === "Lent") {
    // Ash Wed..Sat (before Lent I) belong to no numbered week; Holy Week is 6.
    const lent1 = sundayAfter(ashWednesday);
    if (date.getTime() < lent1.getTime()) return null;
    return Math.round((sun.getTime() - lent1.getTime()) / (7 * DAY_MS)) + 1;
  }
  if (season === "Easter") {
    return Math.round((sun.getTime() - easter.getTime()) / (7 * DAY_MS)) + 1;
  }
  if (season === "Christmas") {
    return date.getUTCMonth() === 11 ? 1 : 2;
  }
  if (season === "Ordinary Time") return otWeekOf(date, year);
  return null;
}

function onOrAfterDate(d: Date, from: Date): boolean {
  return d.getTime() >= from.getTime();
}

// ---------------------------------------------------------------------------
// Transfers of fixed solemnities
// ---------------------------------------------------------------------------

type Transferred = {
  date: string;
  name: string;
  season: Season;
};

/**
 * Fixed solemnities that move when impeded. Joseph and Annunciation move out
 * of Holy Week (and off Lenten Sundays); Immaculate Conception moves off an
 * Advent Sunday per the US rule. Everything else fixed keeps its date and
 * loses to a Sunday by the check order in describeDate.
 */
function transferredSolemnities(year: number, easter: Date, palmSunday: Date): Transferred[] {
  const out: Transferred[] = [];
  const holyStart = palmSunday.getTime();
  const holyEnd = addDays(easter, -1).getTime();
  const inHolyWeek = (d: Date) => d.getTime() >= holyStart && d.getTime() <= holyEnd;

  const joseph = new Date(Date.UTC(year, 2, 19));
  out.push({
    date: inHolyWeek(joseph) || (weekday(joseph) === 0 && joseph.getTime() > addDays(easter, -46).getTime())
      ? fmt(addDays(palmSunday, -1))
      : fmt(joseph),
    name: "Saint Joseph, Spouse of the Blessed Virgin Mary",
    season: "Lent",
  });

  const annun = new Date(Date.UTC(year, 2, 25));
  const inOctave = annun.getTime() >= easter.getTime() && annun.getTime() <= addDays(easter, 6).getTime();
  if (inHolyWeek(annun) || inOctave) {
    out.push({ date: fmt(addDays(easter, 8)), name: "The Annunciation of the Lord", season: "Easter" });
  } else if (weekday(annun) === 0) {
    out.push({ date: fmt(addDays(annun, 1)), name: "The Annunciation of the Lord", season: "Lent" });
  } else {
    out.push({ date: fmt(annun), name: "The Annunciation of the Lord", season: "Lent" });
  }

  const immac = new Date(Date.UTC(year, 11, 8));
  out.push({
    date: weekday(immac) === 0 ? fmt(addDays(immac, 1)) : fmt(immac),
    name: "The Immaculate Conception of the Blessed Virgin Mary",
    season: "Advent",
  });

  return out;
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

export function describeDate(iso: string): DayInfo {
  const date = parseDate(iso);
  const year = date.getUTCFullYear();
  const wd = weekday(date);

  const easter = easterSunday(year);
  const ashWednesday = addDays(easter, -46);
  const palmSunday = addDays(easter, -7);
  const holyThursday = addDays(easter, -3);
  const goodFriday = addDays(easter, -2);
  const holySaturday = addDays(easter, -1);
  const ascensionThursday = addDays(easter, 39);
  const pentecost = addDays(easter, 49);
  // Sunday observance (US/PH). Thursday itself is kept out; see README.
  const trinitySunday = addDays(pentecost, 7);
  const corpusSunday = addDays(pentecost, 14);

  // The liturgical year containing this date starts at last Advent.
  const thisAdvent = adventSunday(year);
  const adventYear = onOrAfterDate(date, thisAdvent) ? year : year - 1;
  const sundayCycle = (["A", "B", "C"] as const)[adventYear % 3];
  const weekdayCycle: "I" | "II" = (adventYear + 1) % 2 === 1 ? "I" : "II";

  const base = { date: iso, sundayCycle, weekdayCycle };

  // --- Triduum ---------------------------------------------------------------
  if (eq(date, holyThursday))
    return { ...base, season: "Triduum", seasonWeek: null, otWeek: null, color: "White", rank: "Solemnity", title: { kind: "named", key: "holyThursday" }, commemorations: [] };
  if (eq(date, goodFriday))
    return { ...base, season: "Triduum", seasonWeek: null, otWeek: null, color: "Red", rank: "Solemnity", title: { kind: "named", key: "goodFriday" }, commemorations: [] };
  if (eq(date, holySaturday))
    return { ...base, season: "Triduum", seasonWeek: null, otWeek: null, color: "White", rank: "Solemnity", title: { kind: "named", key: "holySaturday" }, commemorations: [] };

  // --- Easter Octave (outranks everything but the Triduum) --------------------
  if (onOrAfterDate(date, easter) && date.getTime() <= addDays(easter, 6).getTime()) {
    if (eq(date, easter))
      return { ...base, season: "Easter", seasonWeek: 1, otWeek: null, color: "White", rank: "Solemnity", title: { kind: "named", key: "easter" }, commemorations: [] };
    return { ...base, season: "Easter", seasonWeek: 1, otWeek: null, color: "White", rank: "Solemnity", title: { kind: "easterOctave", weekday: wd }, commemorations: [] };
  }

  // --- Ash Wednesday -----------------------------------------------------------
  if (eq(date, ashWednesday))
    return { ...base, season: "Lent", seasonWeek: null, otWeek: null, color: "Violet", rank: "Weekday", title: { kind: "named", key: "ashWednesday" }, commemorations: [] };

  // --- Movable solemnities and feasts of the Lord -------------------------------
  const christmas = new Date(Date.UTC(year, 11, 25));
  const movables: { date: Date; color: LitColor; rank: Rank; title: Title; season: Season; seasonWeek: number | null; otWeek: number | null }[] = [
    { date: christmas, color: "White", rank: "Solemnity", title: { kind: "named", key: "christmas" }, season: "Christmas", seasonWeek: 1, otWeek: null },
    { date: new Date(Date.UTC(year, 0, 1)), color: "White", rank: "Solemnity", title: { kind: "named", key: "maryMotherOfGod" }, season: "Christmas", seasonWeek: 2, otWeek: null },
    { date: epiphanySunday(year), color: "White", rank: "Solemnity", title: { kind: "named", key: "epiphany" }, season: "Christmas", seasonWeek: 2, otWeek: null },
    { date: baptismDate(year), color: "White", rank: "Feast", title: { kind: "named", key: "baptism" }, season: "Christmas", seasonWeek: 2, otWeek: null },
    { date: holyFamilySunday(year), color: "White", rank: "Feast", title: { kind: "named", key: "holyFamily" }, season: "Christmas", seasonWeek: 1, otWeek: null },
    { date: palmSunday, color: "Red", rank: "Sunday", title: { kind: "named", key: "palmSunday" }, season: "Lent", seasonWeek: 6, otWeek: null },
    { date: ascensionThursday, color: "White", rank: "Solemnity", title: { kind: "named", key: "ascension" }, season: "Easter", seasonWeek: 6, otWeek: null },
    { date: pentecost, color: "Red", rank: "Solemnity", title: { kind: "named", key: "pentecost" }, season: "Easter", seasonWeek: 7, otWeek: null },
    { date: trinitySunday, color: "White", rank: "Solemnity", title: { kind: "named", key: "trinity" }, season: "Ordinary Time", seasonWeek: otWeekOf(trinitySunday, year), otWeek: otWeekOf(trinitySunday, year) },
    { date: corpusSunday, color: "White", rank: "Solemnity", title: { kind: "named", key: "corpusChristi" }, season: "Ordinary Time", seasonWeek: otWeekOf(corpusSunday, year), otWeek: otWeekOf(corpusSunday, year) },
  ];
  // Christ the King belongs to the liturgical year that is ending: the Sunday
  // before this civil year's Advent, or last year's when Advent has begun.
  const ckAdvent = onOrAfterDate(date, adventSunday(year)) ? year + 1 : year;
  const christKing = addDays(adventSunday(ckAdvent), -7);
  if (eq(date, christKing)) {
    const n = otWeekOf(date, year);
    return { ...base, season: "Ordinary Time", seasonWeek: n, otWeek: n, color: "White", rank: "Solemnity", title: { kind: "named", key: "christKing" }, commemorations: [] };
  }
  // Santo Niño: third Sunday of January, a feast that IS the Sunday (like
  // Christ the King), so it is checked here rather than left to lose to the
  // Nth-Sunday label. Name, rank and color come from the Philippine section
  // of saints.json, which is where the parish edits or verifies them.
  const stoNinoEntry = SAINTS.philippine.find((e) => e.rule === "thirdSundayOfJanuary");
  if (stoNinoEntry && eq(date, thirdSundayOfJanuary(year))) {
    const n = otWeekOf(date, year);
    return { ...base, season: "Ordinary Time", seasonWeek: n, otWeek: n, color: stoNinoEntry.color, rank: stoNinoEntry.rank as Rank, title: { kind: "saint", name: stoNinoEntry.name }, commemorations: [] };
  }
  const movable = movables.find((m) => eq(m.date, date));
  if (movable) {
    return {
      ...base,
      season: movable.season,
      seasonWeek: movable.seasonWeek,
      otWeek: movable.otWeek,
      color: movable.color,
      rank: movable.rank,
      title: movable.title,
      commemorations: [],
    };
  }

  // --- Holy Week ferials outrank every memorial -----------------------------------------
  // (Placed before the fixed tables: nothing fixed survives here except the
  // transferred solemnities, which already returned above.)
  if (seasonOf(date, year, easter, ashWednesday) === "Lent" && date.getTime() > palmSunday.getTime() && date.getTime() < holyThursday.getTime()) {
    return { ...base, season: "Lent", seasonWeek: 6, otWeek: null, color: "Violet", rank: "Weekday", title: { kind: "holyWeek", weekday: wd }, commemorations: [] };
  }

  // --- Christmas Octave ferials (Dec 29-31 weekdays) ------------------------------------
  // Outrank optional memorials (Becket, Silvester), which ride along as
  // commemorations instead. Holy Family Sunday already returned above.
  if (date.getUTCMonth() === 11 && date.getUTCDate() >= 29 && wd !== 0) {
    const optionals = datedEntries(year)
      .filter((e) => e.date === iso && e.rank === "Optional Memorial")
      .map((e) => e.name);
    return { ...base, season: "Christmas", seasonWeek: 1, otWeek: null, color: "White", rank: "Weekday", title: { kind: "christmasWeekday", period: "octave", weekday: wd }, commemorations: optionals };
  }

  // --- Sundays of Advent, Lent, Easter (outrank fixed solemnities) ---------------
  if (wd === 0) {
    const adv = adventSunday(onOrAfterDate(date, adventSunday(year)) ? year : year - 1);
    if (date.getTime() >= adv.getTime() && date.getTime() < new Date(Date.UTC(year, 11, 25)).getTime()) {
      const n = Math.round((date.getTime() - adv.getTime()) / (7 * DAY_MS)) + 1;
      if (n >= 1 && n <= 4) {
        return { ...base, season: "Advent", seasonWeek: n, otWeek: null, color: n === 3 ? "Rose" : "Violet", rank: "Sunday", title: { kind: "seasonSunday", season: "Advent", n }, commemorations: [] };
      }
    }
    const lent1 = sundayAfter(ashWednesday);
    if (date.getTime() >= lent1.getTime() && date.getTime() <= palmSunday.getTime()) {
      const n = Math.round((date.getTime() - lent1.getTime()) / (7 * DAY_MS)) + 1;
      if (n >= 1 && n <= 5) {
        return { ...base, season: "Lent", seasonWeek: n, otWeek: null, color: n === 4 ? "Rose" : "Violet", rank: "Sunday", title: { kind: "seasonSunday", season: "Lent", n }, commemorations: [] };
      }
    }
    if (date.getTime() > easter.getTime() && date.getTime() < pentecost.getTime()) {
      const n = Math.round((date.getTime() - easter.getTime()) / (7 * DAY_MS)) + 1;
      if (n >= 2 && n <= 7) {
        return { ...base, season: "Easter", seasonWeek: n, otWeek: null, color: "White", rank: "Sunday", title: { kind: "seasonSunday", season: "Easter", n }, commemorations: [] };
      }
    }
  }

  // --- Fixed solemnities (transferred where the rules say so) ----------------------
  // Advent/Lent/Easter Sundays above already won, so reaching here is safe.
  const transferred = transferredSolemnities(year, easter, palmSunday);
  const hit = transferred.find((t) => t.date === iso);
  if (hit) {
    return { ...base, season: hit.season, seasonWeek: seasonWeekOf(date, year, easter, ashWednesday), otWeek: null, color: "White", rank: "Solemnity", title: { kind: "saint", name: hit.name }, commemorations: [] };
  }

  // --- Fixed solemnities (transferred where the rules say so) ----------------------
  // Advent/Lent/Easter Sundays above already won, so reaching here is safe.
  // This covers both ferial days and Ordinary Time Sundays, which solemnities
  // outrank (All Saints on a Sunday is still All Saints). A solemnity the
  // transfers moved elsewhere is skipped on its printed date -- otherwise
  // Joseph would still outrank Wednesday of Holy Week from Mar 19.
  const movedAway = new Set(
    transferredSolemnities(year, easter, palmSunday)
      .filter((t) => t.date !== iso)
      .map((t) => t.name),
  );
  const fixedSolemn = datedEntries(year).find(
    (e) => e.date === iso && e.rank === "Solemnity" && !movedAway.has(e.name),
  );
  if (fixedSolemn) {
    const season = seasonOf(date, year, easter, ashWednesday);
    return { ...base, season, seasonWeek: seasonWeekOf(date, year, easter, ashWednesday), otWeek: season === "Ordinary Time" ? otWeekOf(date, year) : null, color: fixedSolemn.color, rank: "Solemnity", title: { kind: "saint", name: fixedSolemn.name }, commemorations: [] };
  }

  // --- All Souls ---------------------------------------------------------------------
  if (date.getUTCMonth() === 10 && date.getUTCDate() === 2) {
    const n = otWeekOf(date, year);
    return { ...base, season: "Ordinary Time", seasonWeek: n, otWeek: n, color: "Violet", rank: "Feast", title: { kind: "allSouls" }, commemorations: [] };
  }

  // --- Ordinary Time Sundays ------------------------------------------------------------
  if (wd === 0) {
    const n = otWeekOf(date, year);
    if (n !== null)
      return { ...base, season: "Ordinary Time", seasonWeek: n, otWeek: n, color: "Green", rank: "Sunday", title: { kind: "otSunday", n }, commemorations: [] };
  }

  // --- Fixed feasts (lose to any Sunday) ---------------------------------------------------
  const daySaints = datedEntries(year).filter((e) => e.date === iso);
  const feasts = daySaints.filter((e) => e.rank === "Feast");
  if (wd !== 0 && feasts.length > 0) {
    const [first, ...rest] = feasts;
    const season = seasonOf(date, year, easter, ashWednesday);
    return { ...base, season, seasonWeek: seasonWeekOf(date, year, easter, ashWednesday), otWeek: season === "Ordinary Time" ? otWeekOf(date, year) : null, color: first.color, rank: "Feast", title: { kind: "saint", name: first.name }, commemorations: rest.map((e) => e.name) };
  }

  // --- Memorials ---------------------------------------------------------------------------
  const memorials = daySaints.filter((e) => e.rank === "Memorial" || e.rank === "Optional Memorial");
  if (wd !== 0 && memorials.length > 0) {
    const season = seasonOf(date, year, easter, ashWednesday);
    const obligatory = memorials.filter((e) => e.rank === "Memorial");
    const chosen = obligatory[0] ?? memorials[0];
    const rest = memorials.filter((e) => e !== chosen).map((e) => e.name);
    return {
      ...base,
      season,
      seasonWeek: seasonWeekOf(date, year, easter, ashWednesday),
      otWeek: season === "Ordinary Time" ? otWeekOf(date, year) : null,
      color: chosen.color,
      // In Lent an obligatory memorial is reduced to a commemoration-level
      // observance; Optional Memorial is the honest on-screen rank.
      rank: season === "Lent" && chosen.rank === "Memorial" ? "Optional Memorial" : chosen.rank,
      title: { kind: "saint", name: chosen.name },
      commemorations: rest,
    };
  }

  // --- Ferial day ------------------------------------------------------------------------------
  // Ash Wed..Sat have no numbered week (seasonWeek null: they are "after Ash
  // Wednesday", not "week 0 of Lent").
  const season = seasonOf(date, year, easter, ashWednesday);
  // January ferials name their place around Epiphany rather than a week number.
  if (season === "Christmas" && date.getUTCMonth() === 0 && wd !== 0) {
    const period = date.getTime() < epiphanySunday(year).getTime() ? "beforeEpiphany" : "afterEpiphany";
    return { ...base, season, seasonWeek: 2, otWeek: null, color: "White", rank: "Weekday", title: { kind: "christmasWeekday", period, weekday: wd }, commemorations: [] };
  }
  const week = seasonWeekOf(date, year, easter, ashWednesday);
  return {
    ...base,
    season,
    seasonWeek: week,
    otWeek: season === "Ordinary Time" ? otWeekOf(date, year) : null,
    color: season === "Lent" || season === "Advent" ? "Violet" : season === "Easter" || season === "Christmas" ? "White" : "Green",
    rank: "Weekday",
    title: { kind: "ferial", season, week, weekday: wd },
    commemorations: [],
  };
}

/** USCCB daily readings link for a civil date (MMDDYY.cfm). No scraping: just the address. */
export function usccbLink(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `https://bible.usccb.org/bible/readings/${m}${d}${y.slice(2)}.cfm`;
}
