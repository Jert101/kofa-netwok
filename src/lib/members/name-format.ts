/** Each space-separated word: first letter uppercase, rest lowercase (e.g. "Jerson L. Catadman"). */
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
