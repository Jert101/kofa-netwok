import type {
  LitColor,
  Rank,
  Season,
  Title,
} from "../calendar";

/** localStorage keys for per-device preferences (not translated content). */
export const LANG_STORAGE_KEY = "kofa-readings-lang";
export const SIZE_STORAGE_KEY = "kofa-readings-size";

/**
 * Display strings for the Daily Readings page. Every user-facing word on the
 * page comes from here, so the EN/CEB toggle is a dictionary swap and no
 * English leaks through the Cebuano view.
 *
 * Both files must satisfy `Dictionary` (see index.ts): adding a key to one
 * and forgetting the other is a compile error, not a blank label in prod.
 */

export type SeasonKey = Season;
export type ColorKey = LitColor;
export type RankKey = Rank;

export type Dictionary = {
  /** "Daily Readings" */
  pageTitle: string;
  /** Button: back to church today. "Today" */
  today: string;
  /** Date picker label. "Choose a date" */
  chooseDate: string;
  /** Aria labels for the day-stepper. */
  prevDay: string;
  nextDay: string;
  /** Section heading. "About today" */
  aboutToday: string;
  /** Field labels. */
  seasonLabel: string;
  weekLabel: string;
  colorLabel: string;
  rankLabel: string;
  celebrationLabel: string;
  cycleLabel: string;
  /** "Week {n}" fallback when a season week has no special name. */
  weekOf: (n: number) => string;
  /** Seasons, colors, ranks. */
  seasons: Record<SeasonKey, string>;
  seasonMeanings: Record<SeasonKey, string>;
  colors: Record<ColorKey, string>;
  colorMeanings: Record<ColorKey, string>;
  ranks: Record<RankKey, string>;
  /** Sunday cycles. */
  sundayCycle: (cycle: "A" | "B" | "C") => string;
  weekdayCycle: (cycle: "I" | "II") => string;
  /** Weekday names, Sunday-first. */
  weekdays: [string, string, string, string, string, string, string];
  /** Month names, January-first. */
  months: [string, string, string, string, string, string, string, string, string, string, string, string];
  /** "28th" / "2nd" style ordinals for Sunday numbers. */
  ordinal: (n: number) => string;
  /** Renders a structured celebration title. */
  celebration: (t: Title) => string;
  /** Fixed solemnity/feast names by key. */
  named: Record<string, string>;
  /** "or Saint …" companion lines under a celebration. */
  orSaint: (name: string) => string;
  /** Readings section. */
  readingsTitle: string;
  firstReading: string;
  psalm: string;
  secondReading: string;
  acclamation: string;
  gospel: string;
  /** Shown when the day has no Second Reading (ferials). */
  secondReadingNote: string;
  /** The USCCB button + the honesty note under it. */
  usccbButton: string;
  usccbNote: string;
  /** Text-size control. */
  textSize: string;
  sizeSmall: string;
  sizeMedium: string;
  sizeLarge: string;
  /** Print button. */
  print: string;
};
