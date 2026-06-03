/** Capitalize each word in a name part (e.g. "john" → "John", "de la cruz" → "De La Cruz"). */
export function capitalizeName(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

/** Capitalize each space-separated word (e.g. "Jerson L. Catadman"). */
export function formatMemberFullName(raw: string): string {
  const collapsed = raw.trim().replace(/\s+/g, " ");
  if (!collapsed) return "";
  return collapsed
    .split(" ")
    .map((word) => {
      if (!word) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

/** Convert "First M. Last" → "Last, First M." */
export function formatNameLastFirst(raw: string): string {
  const parts = raw.trim().split(/\s+/);
  if (parts.length <= 1) return raw.trim();

  const last = parts[parts.length - 1];
  const rest = parts.slice(0, -1).join(" ");
  return `${last}, ${rest}`;
}
