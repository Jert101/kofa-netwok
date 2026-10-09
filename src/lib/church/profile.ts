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

export type ChurchProfile = {
  parish_name: string | null;
  priest_name: string | null;
  headline: string | null;
  about: string | null;
  photo_url?: string | null;
  updated_at: string | null;
  council: CouncilMember[];
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