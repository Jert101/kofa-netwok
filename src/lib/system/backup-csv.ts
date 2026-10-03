/**
 * The CSV half of the backup export.
 *
 * Split out of the route because Next.js route modules may only export HTTP verbs -- the build fails on
 * any other named export -- and because these functions are worth testing without a database.
 */



/**
 * RFC 4180 quoting.
 *
 * A member called O'Brien is not a comma problem, but "Santos, Maria" and a free-text guest reading
 * "3ft 6in" are, and an unquoted comma ends the row early -- which turns one member into two rows and
 * shifts every column after it.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.join(",") : String(value);
  if (/[",\n\r]/.test(text) || text !== text.trim()) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function csvRow(values: readonly unknown[]): string {
  return values.map(csvCell).join(",");
}