/**
 * Telling "this database is not deployed yet" apart from "this query failed".
 *
 * A feature that has been built but whose migration has not been applied answers every question about it
 * with a Postgres error: `relation "public.council_members" does not exist`. That reaches the officer as
 * a failed page, and it is the single most likely thing to be wrong after a deploy -- so it is worth
 * naming rather than passing along as a string about a relation they have never heard of.
 *
 * 42P01 is `undefined_table` in Postgres. It is checked by code first and by message second, because the
 * message is free text from the server and the code is not.
 */

const UNDEFINED_TABLE = "42P01";
const UNDEFINED_COLUMN = "42703";
const UNDEFINED_FUNCTION = "42883";

/** Whether this error is a table that has not been created yet. */
export function isMissingTableError(
  error: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (!error) return false;
  if (error.code === UNDEFINED_TABLE) return true;
  // The code is authoritative when present. Matching the message alone would also catch a *column* that
  // does not exist, which is a different problem with a different fix.
  if (error.code) return false;
  return /does not exist|schema cache/i.test(error.message ?? "");
}

/** Whether the schema is behind this build at all -- table, column or function. */
export function isUndeployedSchemaError(
  error: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (!error) return false;
  if (
    error.code === UNDEFINED_TABLE ||
    error.code === UNDEFINED_COLUMN ||
    error.code === UNDEFINED_FUNCTION
  ) {
    return true;
  }
  if (error.code) return false;
  return /does not exist|schema cache|not found/i.test(error.message ?? "");
}

/**
 * What to tell the person looking at the screen.
 *
 * `migration` is named so the instruction is a step they can take rather than a diagnosis they have to
 * arrive at themselves.
 */
export function migrationMessage(migration: string): string {
  return `This database does not have the tables this feature needs yet. Apply ${migration} and reload.`;
}