/**
 * Name handling for registration, approval and the member directory (module 03).
 *
 * Names are stored exactly as entered, but compared in a normalized form so
 * "  jose   de  la  cruz " matches "Jose De La Cruz".
 *
 * Accents and punctuation are deliberately preserved: "Ma. Cristina" and "Niño" must
 * match themselves. Only case and whitespace are normalized (module 03, §8).
 */

/** Collapses runs of whitespace and trims, leaving case and punctuation alone. */
export function collapseWhitespace(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/**
 * The comparison key for duplicate detection.
 *
 * Lowercase and whitespace, plus one extra step: the period after a single-letter
 * middle initial is dropped. "Jerson L Catadman" and the stored "Jerson L. Catadman"
 * are the same person, and missing that would let a real duplicate through.
 *
 * Only single letters are affected, so "Ma. Cristina" keeps its abbreviation and
 * still does not match "Cristina". Accents are never folded: "Niño" and "Nino"
 * stay different names.
 *
 * Being slightly generous here is deliberate. A match produces a "Possible
 * duplicate" badge for an admin to judge, not a block, so a false positive costs a
 * glance while a false negative lets the same person into the directory twice.
 */
export function normalizeName(raw: string): string {
  return collapseWhitespace(raw)
    .toLowerCase()
    .replace(/\b([a-z])\./g, "$1");
}

export type NameParts = {
  firstName: string;
  /** Optional, so a caller can pass a form field that is still null. */
  middleInitial?: string | null;
  lastName: string;
};

/** Strip a trailing period from a middle initial and uppercase it. */
export function normalizeMiddleInitial(raw: string | null | undefined): string {
  const trimmed = collapseWhitespace(raw ?? "").replace(/\./g, "");
  return trimmed ? trimmed.charAt(0).toUpperCase() : "";
}

/**
 * Splits a stored `full_name` back into editable parts. The inverse of
 * `composeFullName`, so a save with no edits does not change the stored name.
 *
 * "Jerson L. Catadman" → { firstName: "Jerson", middleInitial: "L", lastName: "Catadman" }
 * "Maria Santos"       → { firstName: "Maria",  middleInitial: "",   lastName: "Santos" }
 *
 * Two limits worth knowing about, both inherent to a single stored string:
 *
 * - A single-letter token is only read as a middle initial when it carries a period,
 *   matching what the directory displays. "Jerson L Catadman" is therefore read as
 *   first name "Jerson L". Reading it the other way would turn a person legitimately
 *   named "Jerson L" into an initial.
 * - A particle surname splits at the last token, so "Jose De La Cruz" comes back as
 *   first "Jose De La", last "Cruz". Re-composing still yields the same string, so
 *   this never rewrites a name; the edit form simply shows the parts split there.
 *   Guessing at particles is not safe because "de la" is not always a surname.
 */
export function splitName(fullName: string): NameParts {
  const tokens = collapseWhitespace(fullName).split(" ").filter(Boolean);
  if (tokens.length === 0) {
    return { firstName: "", middleInitial: "", lastName: "" };
  }
  if (tokens.length === 1) {
    return { firstName: tokens[0], middleInitial: "", lastName: "" };
  }

  const initialIndex = tokens.findIndex((t) => t.length > 1 && t.endsWith("."));
  if (initialIndex > 0 && initialIndex < tokens.length - 1) {
    return {
      firstName: tokens.slice(0, initialIndex).join(" "),
      middleInitial: normalizeMiddleInitial(tokens[initialIndex]),
      lastName: tokens.slice(initialIndex + 1).join(" "),
    };
  }

  return {
    firstName: tokens.slice(0, -1).join(" "),
    middleInitial: "",
    lastName: tokens[tokens.length - 1],
  };
}

/**
 * Composes the stored `full_name` from parts.
 *
 * Words are title-cased, matching what the directory already stores today. The
 * middle initial always gets a period. `splitName` is the inverse of this, so
 * editing a member and saving without changes leaves the stored name identical.
 */
export function composeFullName(parts: {
  firstName: string;
  middleInitial?: string | null;
  lastName: string;
}): string {
  const first = titleCase(collapseWhitespace(parts.firstName));
  const last = titleCase(collapseWhitespace(parts.lastName));
  const initial = normalizeMiddleInitial(parts.middleInitial);
  if (!first) return last;
  if (!last) return first;
  return initial ? `${first} ${initial}. ${last}` : `${first} ${last}`;
}

function titleCase(raw: string): string {
  return raw
    .split(" ")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

/**
 * Compares a composed name against a list of stored names.
 *
 * Returns the first match in the given order, or null. The list is expected to be
 * already-scoped by the caller (for example active members only).
 */
export function findDuplicateName<T>(
  candidate: string,
  entries: readonly T[],
  getName: (entry: T) => string,
): T | null {
  const target = normalizeName(candidate);
  if (!target) return null;
  for (const entry of entries) {
    if (normalizeName(getName(entry)) === target) return entry;
  }
  return null;
}
