/**
 * The parish's public content: who leads it, what the ministry is, and the council.
 *
 * Pure and server-and-client safe, so the landing page and the super admin's editor agree by
 * construction about what counts as a person -- initials, paragraph splitting, whether a profile is
 * worth rendering at all.
 *
 * The database read that fills a `ChurchProfile` is *not* here: it needs the Supabase admin client, and
 * this module is imported by client components. It is `profile-server`, shared by `/api/church` and the
 * landing page so neither can drift from the other.
 */

import type { Milestone, Patron, Role } from "./ministry";

export type CouncilMember = {
  id: string;
  name: string;
  office: string | null;
  bio: string | null;
  /** Public URL of a photograph, or null for initials. Added by migration 039. */
  photo_url?: string | null;
  sort_order: number;
  is_active?: boolean;
};

/**
 * The three landing-page lists.
 *
 * Re-exported from `ministry` rather than restated here, so the shapes the editor edits and the shapes
 * the page renders are literally the same declaration. `ministry` holds the column names, the tables and
 * the validation as well; this module stays pure so client components can import it without pulling in
 * the server-only parts.
 */
export type { Milestone, Patron, Role } from "./ministry";

export type ChurchProfile = {
  parish_name: string | null;
  priest_name: string | null;
  headline: string | null;
  about: string | null;
  photo_url?: string | null;
  updated_at: string | null;
  council: CouncilMember[];
  /**
   * The three editable lists, added with the landing page redesign.
   *
   * Optional rather than required because a public read taken from a database where migration 040 has
   * not been applied yet still has to typecheck against this shape, and because an absent list and an
   * empty one mean the same thing to a page: that section does not appear. The page checks length, not
   * presence, for exactly that reason.
   */
  roles?: Role[];
  milestones?: Milestone[];
  patrons?: Patron[];
};

/**
 * Initials for a person with no photo.
 *
 * Two letters, from the first and last words, skipping a leading title -- "Fr. John Santos" is `JS`,
 * not `FJ`. A member with one word gets the first two letters of it rather than one lonely letter, which
 * reads as a rendering fault.
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  // Strip titles only where one actually leads. "Rosa Sr." is somebody's surname, not a Sister in
  // front of a forename, and "Sr" is deliberately absent from the list for the same reason.
  while (words.length > 0 && isTitle(words[0])) words.shift();
  // Nothing left that is actually a letter -- a name of punctuation, or nothing at all. A circle
  // reading "!" is worse than one reading "?", which at least looks like a placeholder.
  if (words.every((w) => !/[a-z0-9]/i.test(w))) return "?";
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * Whether a leading word is an honorific rather than part of the name.
 *
 * Dot-insensitive, so "Fr." and "Fr" are one title. `sr` is absent on purpose: "Sr." is Sister and does
 * not lead a lay name, and stripping it from "Sr. Rosa" would print RS for Rosa.
 */
function isTitle(word: string): boolean {
  return /^(fr|rev|sir|mr|mrs|ms|mx|atty|bro|br)\.?$/i.test(word);
}

/**
 * The ministry's background, split into paragraphs.
 *
 * Blank lines separate paragraphs rather than newlines, because a paragraph typed as one long line with
 * hard returns is what a textarea produces and it renders as an unreadable block. Anything that is only
 * whitespace is dropped, so trailing blank lines do not leave an empty `<p>`.
 */
export function paragraphsOf(about: string | null | undefined): string[] {
  if (!about) return [];
  return about
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/**
 * Whether there is enough here to be worth a section.
 *
 * The landing page asks this rather than checking each field itself, so "is the council section worth
 * rendering" is one answer in one place. A council of names with no offices still counts; an empty list
 * does not, because an empty section heading reads as a mistake.
 */
export function hasLeadership(church: ChurchProfile | null): boolean {
  return Boolean(church?.priest_name?.trim());
}

export function hasAbout(church: ChurchProfile | null): boolean {
  return paragraphsOf(church?.about).length > 0;
}

export function hasCouncil(church: ChurchProfile | null): boolean {
  return (church?.council ?? []).length > 0;
}

/**
 * Whether each published list has anything to show.
 *
 * All three take the same shape for the same reason: an empty section on a public page reads as a broken
 * page, so the section is left off entirely rather than rendered with a heading over nothing. That is
 * also why the reader degrades an unreadable list to an empty one -- a database missing migration 040
 * loses three sections rather than taking the front door down with it.
 */
export function hasRoles(church: ChurchProfile | null): boolean {
  return (church?.roles ?? []).length > 0;
}

export function hasTimeline(church: ChurchProfile | null): boolean {
  return (church?.milestones ?? []).length > 0;
}

export function hasPatrons(church: ChurchProfile | null): boolean {
  return (church?.patrons ?? []).length > 0;
}

/**
 * The anchor id for each optional section.
 *
 * Declared here rather than written into the markup twice, because the nav links to these ids and the
 * sections declare them. Two hand-written copies of the same string disagree exactly once, and the
 * result is a nav link that scrolls nowhere with nothing on the screen to say so.
 */
export const SECTION_IDS = {
  about: "about",
  roles: "roles",
  timeline: "history",
  council: "council",
} as const;

/**
 * The nav items, given which sections exist.
 *
 * A link to a section that is not on the page scrolls to the top of the footer and looks broken, so the
 * links are derived from the content rather than fixed. `patrons` is deliberately absent from the nav:
 * it is a short section between the timeline and the council, and a fifth link to it is more header than
 * a header needs.
 */
export function navSections(church: ChurchProfile | null): ReadonlyArray<{ href: string; label: string }> {
  const out: Array<{ href: string; label: string }> = [];
  if (hasAbout(church) || hasLeadership(church)) {
    out.push({ href: `#${SECTION_IDS.about}`, label: "About" });
  }
  if (hasRoles(church)) out.push({ href: `#${SECTION_IDS.roles}`, label: "Roles" });
  if (hasTimeline(church)) out.push({ href: `#${SECTION_IDS.timeline}`, label: "History" });
  if (hasCouncil(church)) out.push({ href: `#${SECTION_IDS.council}`, label: "Council" });
  return out;
}